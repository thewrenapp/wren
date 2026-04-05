use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use sqlx::Row;
use std::sync::Arc;
use tauri::Emitter;
use uuid::Uuid;

use super::models::*;
use super::ConnectorState;
use crate::commands::entries::{refresh_entry_creators_sort, refresh_entry_fts};
use crate::search::indexer::EntryMetadata;

/// Zotero-compatible version string so the connector framework recognizes us
const COMPAT_VERSION: &str = "7.0.0";

/// Pre-parsed header value for COMPAT_VERSION, avoiding repeated `.parse().unwrap()`.
fn compat_header_value() -> axum::http::HeaderValue {
    axum::http::HeaderValue::from_static(COMPAT_VERSION)
}

/// GET /connector/ping — health check, no auth required.
/// Returns X-Zotero-Version header and prefs for connector framework compatibility.
pub async fn ping() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());
    (
        headers,
        Json(serde_json::json!({
            "prefs": {
                "downloadAssociatedFiles": true,
                "automaticSnapshots": true,
                "supportsAttachmentUpload": true,
                "reportActiveURL": false
            }
        })),
    )
}

/// GET /connector/collections — list all collections
pub async fn get_collections(
    headers: HeaderMap,
    State(state): State<Arc<ConnectorState>>,
) -> Result<Json<CollectionsResponse>, StatusCode> {
    validate_token(&headers, &state.token)?;

    let rows = sqlx::query(
        "SELECT id, name, parent_id FROM collections ORDER BY name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let collections = rows
        .iter()
        .map(|r| CollectionInfo {
            id: r.get("id"),
            name: r.get("name"),
            parent_id: r.get("parent_id"),
        })
        .collect();

    Ok(Json(CollectionsResponse { collections }))
}

/// POST /connector/saveItems — save items from the browser extension.
/// Compatible with the Zotero connector protocol.
pub async fn save_items(
    State(state): State<Arc<ConnectorState>>,
    Json(request): Json<SaveItemsRequest>,
) -> impl IntoResponse {
    let mut saved = Vec::new();
    let mut errors = Vec::new();

    for item in &request.items {
        match save_single_item(&state, item, request.collection_id).await {
            Ok(entry) => saved.push(entry),
            Err(e) => {
                tracing::warn!("Failed to save item: {}", e);
                errors.push(e);
            }
        }
    }

    // Commit search index changes
    if let Err(e) = state.search_index.commit().await {
        tracing::error!("Failed to commit search index: {}", e);
    }

    // Track session → entry IDs mapping
    if let Some(session_id) = &request.session_id
        && !session_id.is_empty() {
            let entry_ids: Vec<i64> = saved.iter().map(|e| e.id).collect();
            state.sessions.lock().await.insert(session_id.clone(), entry_ids);
        }

    // Emit event to frontend for each saved entry
    for entry in &saved {
        let _ = state.app_handle.emit(
            "connector:item-saved",
            serde_json::json!({
                "id": entry.id,
                "key": &entry.key,
                "title": &entry.title,
                "itemType": &entry.item_type,
            }),
        );
    }

    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());
    (headers, Json(SaveItemsResponse { items: saved }))
}

async fn save_single_item(
    state: &ConnectorState,
    item: &ConnectorItem,
    collection_id: Option<i64>,
) -> Result<SavedEntry, String> {
    let title = item.title.trim();
    if title.is_empty() {
        return Err("Item has no title".to_string());
    }

    // Deduplicate by URL or DOI
    if let Some(url) = &item.url {
        let existing: Option<i64> =
            sqlx::query_scalar("SELECT id FROM entries WHERE url = ? AND is_deleted = 0")
                .bind(url)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| e.to_string())?;
        if existing.is_some() {
            return Err(format!("Entry with URL '{}' already exists", url));
        }
    }

    if let Some(doi) = &item.doi {
        let existing: Option<i64> = sqlx::query_scalar(
            r#"SELECT e.id FROM entries e
               JOIN entry_fields ef ON ef.entry_id = e.id
               JOIN fields f ON f.id = ef.field_id
               WHERE f.name = 'DOI' AND ef.value = ? AND e.is_deleted = 0"#,
        )
        .bind(doi)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;
        if existing.is_some() {
            return Err(format!("Entry with DOI '{}' already exists", doi));
        }
    }

    // Resolve item type
    let item_type_id: i64 = match sqlx::query_scalar::<_, i64>(
        "SELECT id FROM item_types WHERE name = ?",
    )
    .bind(&item.item_type)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(id)) => id,
        _ => {
            // Fall back to webpage
            sqlx::query_scalar::<_, i64>("SELECT id FROM item_types WHERE name = 'webpage'")
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?
        }
    };

    let entry_key = Uuid::new_v4().to_string();

    // Insert entry
    let entry_id: i64 = sqlx::query_scalar(
        r#"INSERT INTO entries (key, item_type_id, title, date, url, access_date)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           RETURNING id"#,
    )
    .bind(&entry_key)
    .bind(item_type_id)
    .bind(title)
    .bind(&item.date)
    .bind(&item.url)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to insert entry '{}': {}", title, e))?;

    // Insert creators
    for (i, creator) in item.creators.iter().enumerate() {
        let creator_type_id: i64 = sqlx::query_scalar(
            "SELECT id FROM creator_types WHERE name = ?",
        )
        .bind(&creator.creator_type)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None)
        .unwrap_or(1); // default to 'author'

        let _ = sqlx::query(
            r#"INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
               VALUES (?, ?, ?, ?, ?, ?)"#,
        )
        .bind(entry_id)
        .bind(creator_type_id)
        .bind(&creator.first_name)
        .bind(&creator.last_name)
        .bind(&creator.name)
        .bind(i as i32)
        .execute(&state.db)
        .await;
    }

    if let Err(e) = refresh_entry_creators_sort(&state.db, entry_id).await {
        tracing::warn!("Failed to refresh creators_sort for entry {}: {}", entry_id, e);
    }

    // Insert fields (EAV)
    let field_values: Vec<(&str, Option<&str>)> = vec![
        ("DOI", item.doi.as_deref()),
        ("abstractNote", item.abstract_note.as_deref()),
        ("publicationTitle", item.publication_title.as_deref()),
        ("volume", item.volume.as_deref()),
        ("issue", item.issue.as_deref()),
        ("pages", item.pages.as_deref()),
        ("publisher", item.publisher.as_deref()),
        ("ISBN", item.isbn.as_deref()),
        ("ISSN", item.issn.as_deref()),
        ("language", item.language.as_deref()),
        ("journalAbbreviation", item.journal_abbreviation.as_deref()),
        ("bookTitle", item.book_title.as_deref()),
        ("conferenceName", item.conference_name.as_deref()),
        ("institution", item.institution.as_deref()),
        ("university", item.university.as_deref()),
        ("archiveID", item.archive_id.as_deref()),
        ("archive", item.archive.as_deref()),
    ];

    for (field_name, value) in field_values {
        if let Some(val) = value
            && !val.is_empty()
                && let Ok(Some(field_id)) =
                    sqlx::query_scalar::<_, i64>("SELECT id FROM fields WHERE name = ?")
                        .bind(field_name)
                        .fetch_optional(&state.db)
                        .await
                {
                    let _ = sqlx::query(
                        "INSERT OR REPLACE INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)",
                    )
                    .bind(entry_id)
                    .bind(field_id)
                    .bind(val)
                    .execute(&state.db)
                    .await;
                }
    }

    // Insert tags
    for tag in &item.tags {
        let tag_value = tag.value().trim();
        if tag_value.is_empty() {
            continue;
        }

        // Find or create tag (handle deleted tags and UNIQUE constraint)
        let tag_id: i64 = if let Ok(Some(id)) = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM tags WHERE name = ?",
        )
        .bind(tag_value)
        .fetch_optional(&state.db)
        .await
        {
            // Tag exists — un-delete if needed
            let _ = sqlx::query("UPDATE tags SET is_deleted = 0 WHERE id = ? AND is_deleted = 1")
                .bind(id)
                .execute(&state.db)
                .await;
            id
        } else {
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO tags (name, is_imported) VALUES (?, 1)",
            )
            .bind(tag_value)
            .execute(&state.db)
            .await;
            sqlx::query_scalar::<_, i64>("SELECT id FROM tags WHERE name = ?")
                .bind(tag_value)
                .fetch_one(&state.db)
                .await
                .unwrap_or(0)
        };

        let _ = sqlx::query("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
            .bind(entry_id)
            .bind(tag_id)
            .execute(&state.db)
            .await;
    }

    // Add to collection
    if let Some(coll_id) = collection_id {
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO collection_items (collection_id, entry_id) VALUES (?, ?)",
        )
        .bind(coll_id)
        .bind(entry_id)
        .execute(&state.db)
        .await;
    }

    // Refresh FTS
    if let Err(e) = refresh_entry_fts(&state.db, entry_id).await {
        tracing::warn!("Failed to refresh entries_fts for entry {}: {}", entry_id, e);
    }

    // Index in Tantivy
    let creators_str: String = item
        .creators
        .iter()
        .filter_map(|c| {
            if let Some(name) = &c.name {
                Some(name.clone())
            } else {
                match (&c.first_name, &c.last_name) {
                    (Some(f), Some(l)) => Some(format!("{} {}", f, l)),
                    (None, Some(l)) => Some(l.clone()),
                    (Some(f), None) => Some(f.clone()),
                    _ => None,
                }
            }
        })
        .collect::<Vec<_>>()
        .join("; ");

    let entry_metadata = EntryMetadata {
        entry_id,
        entry_key: entry_key.clone(),
        title: Some(title.to_string()),
        creators: if creators_str.is_empty() {
            None
        } else {
            Some(creators_str)
        },
        abstract_text: item.abstract_note.clone(),
        item_type: item.item_type.clone(),
    };

    if let Err(e) = state.search_index.index_entry_metadata(&entry_metadata).await {
        tracing::warn!("Failed to index entry metadata for {}: {}", entry_key, e);
    }

    // Save notes as note attachments (e.g. arXiv comments)
    if !item.notes.is_empty() {
        let library_path = state.library_path.read().await;
        let entry_dir = library_path.join("library").join("entries").join(&entry_key);
        std::fs::create_dir_all(&entry_dir).ok();

        let note_type_id: i64 = sqlx::query_scalar(
            "SELECT id FROM attachment_types WHERE name = 'note'"
        )
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(2);

        for (i, note) in item.notes.iter().enumerate() {
            if let Some(note_text) = &note.note {
                let note_text = note_text.trim();
                if note_text.is_empty() {
                    continue;
                }
                let note_key = uuid::Uuid::new_v4().to_string();
                let note_filename = if i == 0 { "Note.md".to_string() } else { format!("Note_{}.md", i + 1) };
                let note_path = entry_dir.join(&note_filename);
                let _ = std::fs::write(&note_path, note_text);
                let rel_path = crate::utils::to_relative_path(&library_path, &note_path);

                let _ = sqlx::query(
                    r#"INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, markdown_path)
                       VALUES (?, ?, ?, ?, ?, ?)"#,
                )
                .bind(&note_key)
                .bind(entry_id)
                .bind(note_type_id)
                .bind(note_text.chars().take(100).collect::<String>())
                .bind(&rel_path)
                .bind(&rel_path)
                .execute(&state.db)
                .await;
            }
        }
    }

    Ok(SavedEntry {
        id: entry_id,
        key: entry_key,
        title: title.to_string(),
        item_type: item.item_type.clone(),
    })
}

/// POST /connector/updateSession — move saved items to a different collection
pub async fn update_session(
    State(state): State<Arc<ConnectorState>>,
    Json(request): Json<serde_json::Value>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());

    let session_id = request.get("sessionID").and_then(|v| v.as_str()).unwrap_or("");
    let target = request.get("target").and_then(|v| v.as_str()).unwrap_or("");

    // Parse target: "C123" → collection ID 123, "L1" → library (no collection)
    let collection_id: Option<i64> = target.strip_prefix('C').and_then(|s| s.parse().ok());

    // Get entry IDs for this session
    let entry_ids = {
        let sessions = state.sessions.lock().await;
        sessions.get(session_id).cloned().unwrap_or_default()
    };

    if !entry_ids.is_empty() {
        for entry_id in &entry_ids {
            // Remove from all collections first
            let _ = sqlx::query("DELETE FROM collection_items WHERE entry_id = ?")
                .bind(entry_id)
                .execute(&state.db)
                .await;

            // Add to new collection if specified
            if let Some(coll_id) = collection_id {
                let _ = sqlx::query(
                    "INSERT OR IGNORE INTO collection_items (collection_id, entry_id) VALUES (?, ?)",
                )
                .bind(coll_id)
                .bind(entry_id)
                .execute(&state.db)
                .await;
            }
        }
        tracing::info!(
            "updateSession {}: moved {} entries to target {}",
            session_id,
            entry_ids.len(),
            target
        );
    }

    // Handle tags if provided
    if let Some(tags) = request.get("tags").and_then(|v| v.as_array()) {
        for entry_id in &entry_ids {
            for tag_val in tags {
                if let Some(tag_name) = tag_val.as_str() {
                    let tag_name = tag_name.trim();
                    if tag_name.is_empty() {
                        continue;
                    }
                    // Find or create tag
                    let tag_id: i64 = if let Ok(Some(id)) = sqlx::query_scalar::<_, i64>(
                        "SELECT id FROM tags WHERE name = ?",
                    )
                    .bind(tag_name)
                    .fetch_optional(&state.db)
                    .await
                    {
                        let _ = sqlx::query("UPDATE tags SET is_deleted = 0 WHERE id = ? AND is_deleted = 1")
                            .bind(id)
                            .execute(&state.db)
                            .await;
                        id
                    } else {
                        let _ = sqlx::query("INSERT OR IGNORE INTO tags (name, is_imported) VALUES (?, 1)")
                            .bind(tag_name)
                            .execute(&state.db)
                            .await;
                        sqlx::query_scalar::<_, i64>("SELECT id FROM tags WHERE name = ?")
                            .bind(tag_name)
                            .fetch_one(&state.db)
                            .await
                            .unwrap_or(0)
                    };
                    if tag_id > 0 {
                        let _ = sqlx::query("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
                            .bind(entry_id)
                            .bind(tag_id)
                            .execute(&state.db)
                            .await;
                    }
                }
            }
        }
    }

    (headers, Json(serde_json::json!({})))
}

/// POST /connector/delaySync — stub, we don't sync externally
pub async fn delay_sync() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());
    (headers, Json(serde_json::json!({})))
}

/// POST /connector/saveAttachment — receive binary attachment data uploaded by the extension
pub async fn save_attachment(
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    State(state): State<Arc<ConnectorState>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert("X-Zotero-Version", compat_header_value());

    let session_id = params.get("sessionID").cloned().unwrap_or_default();

    // Parse X-Metadata header
    let metadata_str = headers
        .get("X-Metadata")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("{}");
    let metadata: serde_json::Value = serde_json::from_str(metadata_str).unwrap_or_default();

    let _parent_item_id = metadata.get("parentItemID").and_then(|v| v.as_str()).unwrap_or("");
    let content_type = metadata.get("contentType").and_then(|v| v.as_str()).unwrap_or("application/octet-stream");
    let title = metadata.get("title").and_then(|v| v.as_str()).unwrap_or("Attachment");
    let url = metadata.get("url").and_then(|v| v.as_str()).unwrap_or("");

    if body.is_empty() {
        return (resp_headers, Json(serde_json::json!({"error": "empty body"})));
    }

    // Find the entry for this session + parentItemID
    let entry_ids = {
        let sessions = state.sessions.lock().await;
        sessions.get(&session_id).cloned().unwrap_or_default()
    };

    // Use the first entry from this session (parentItemID is the connector's internal ID, not ours)
    let entry_id = match entry_ids.first() {
        Some(id) => *id,
        None => {
            tracing::warn!("saveAttachment: no entry found for session {}", session_id);
            return (resp_headers, Json(serde_json::json!({"error": "no entry for session"})));
        }
    };

    // Get entry key for the file path
    let entry_key: String = match sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
    {
        Ok(k) => k,
        Err(_) => {
            return (resp_headers, Json(serde_json::json!({"error": "entry not found"})));
        }
    };

    let library_path = state.library_path.read().await;
    let entry_dir = library_path.join("library").join("entries").join(&entry_key);
    std::fs::create_dir_all(&entry_dir).ok();

    // Determine file extension and attachment type
    let att_type_name = mime_to_attachment_type(content_type, url);
    let ext = mime_to_extension(content_type, url);

    // Generate filename
    let safe_title: String = title
        .chars()
        .take(100)
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let filename = format!("{}.{}", safe_title.trim().trim_matches('_'), ext);

    // Write file
    let mut file_path = entry_dir.join(&filename);
    if let Err(e) = std::fs::write(&file_path, &body) {
        tracing::error!("Failed to write attachment: {}", e);
        return (resp_headers, Json(serde_json::json!({"error": e.to_string()})));
    }

    // Auto-rename if setting enabled
    let auto_rename = crate::commands::settings::is_setting_enabled(&state.db, "auto_rename_files").await;
    let mut final_title = title.to_string();
    if auto_rename {
        // Fetch entry metadata for rename
        #[derive(sqlx::FromRow)]
        struct EntryMeta {
            title: Option<String>,
            date: Option<String>,
        }
        let entry_meta: Option<EntryMeta> = sqlx::query_as(
            "SELECT title, date FROM entries WHERE id = ?"
        )
        .bind(entry_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let creators: Vec<crate::db::models::Creator> = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, String, i32)>(
            "SELECT first_name, last_name, name, ct.name as creator_type, ec.sort_order FROM entry_creators ec JOIN creator_types ct ON ec.creator_type_id = ct.id WHERE ec.entry_id = ? ORDER BY ec.sort_order"
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(first, last, name, ct, so)| crate::db::models::Creator {
            id: None, creator_type: ct, creator_type_display: None,
            first_name: first, last_name: last, name, sort_order: so,
        })
        .collect();

        if let Some(meta) = entry_meta {
            let entry_title = meta.title.as_deref().unwrap_or("Untitled");
            let year = meta.date.as_deref().and_then(|d| d.get(..4));
            let generated = crate::filename::generate_filename(entry_title, &creators, year, ext);
            if !generated.is_empty() {
                let new_path = crate::filename::resolve_conflict(&entry_dir, &generated);
                if std::fs::rename(&file_path, &new_path).is_ok() {
                    file_path = new_path;
                    final_title = file_path.file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or(final_title);
                }
            }
        }
    }

    // Hash
    use sha2::{Digest, Sha256};
    let hash = hex::encode(Sha256::digest(&body));

    // Page count for PDFs
    let page_count = if att_type_name == "pdf" {
        lopdf::Document::load(&file_path).ok().map(|doc| doc.get_pages().len() as i64)
    } else {
        None
    };

    let att_key = uuid::Uuid::new_v4().to_string();
    let rel_path = {
        let lib = state.library_path.read().await;
        crate::utils::to_relative_path(&lib, &file_path)
    };

    let att_type_id: i64 = sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = ?")
        .bind(&att_type_name)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(6);

    let attachment_id: i64 = match sqlx::query_scalar(
        r#"INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, file_hash, file_size, page_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"#,
    )
    .bind(&att_key)
    .bind(entry_id)
    .bind(att_type_id)
    .bind(&final_title)
    .bind(&rel_path)
    .bind(&hash)
    .bind(body.len() as i64)
    .bind(page_count)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("Failed to insert attachment: {}", e);
            return (resp_headers, Json(serde_json::json!({"error": e.to_string()})));
        }
    };

    tracing::info!("Saved uploaded {} attachment for entry {}: {}", att_type_name, entry_key, filename);

    // Enqueue extraction for all extractable file types (PDF, HTML, EPUB, DOCX, etc.)
    let extractable = matches!(att_type_name.as_str(), "pdf" | "snapshot" | "epub" | "generic");
    if extractable {
        let extract_name = file_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&filename);
        let _ = state.job_queue.enqueue(
            crate::jobs::types::JobType::OcrExtract,
            Some(format!("Extract: {}", extract_name)),
            serde_json::json!({ "attachmentId": attachment_id }),
            0,
        ).await;
    }

    (resp_headers, Json(serde_json::json!({"attachmentID": att_key})))
}

/// POST /connector/saveSnapshot — stub for connector compatibility
/// POST /connector/hasAttachmentResolvers — we don't have OA resolvers
pub async fn has_attachment_resolvers() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());
    (headers, Json(serde_json::json!(false)))
}

pub async fn save_snapshot() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());
    (headers, Json(serde_json::json!({"result": "ok"})))
}

/// POST /connector/saveSingleFile — save an HTML snapshot captured by SingleFile
pub async fn save_single_file(
    State(state): State<Arc<ConnectorState>>,
    Json(request): Json<serde_json::Value>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());

    let session_id = request.get("sessionID").and_then(|v| v.as_str()).unwrap_or("");
    let snapshot_content = request.get("snapshotContent").and_then(|v| v.as_str()).unwrap_or("");
    let url = request.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let title = request.get("title").and_then(|v| v.as_str()).unwrap_or("Snapshot");

    if snapshot_content.is_empty() {
        return (headers, Json(serde_json::json!({"error": "empty snapshot"})));
    }

    // Find entry for this session
    let entry_ids = {
        let sessions = state.sessions.lock().await;
        sessions.get(session_id).cloned().unwrap_or_default()
    };

    let entry_id = match entry_ids.first() {
        Some(id) => *id,
        None => {
            tracing::warn!("saveSingleFile: no entry for session {}", session_id);
            return (headers, Json(serde_json::json!({"error": "no entry for session"})));
        }
    };

    let entry_key: String = match sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
    {
        Ok(k) => k,
        Err(_) => return (headers, Json(serde_json::json!({"error": "entry not found"}))),
    };

    let library_path = state.library_path.read().await;
    let entry_dir = library_path.join("library").join("entries").join(&entry_key);
    std::fs::create_dir_all(&entry_dir).ok();

    let file_path = entry_dir.join("Snapshot.html");
    if let Err(e) = std::fs::write(&file_path, snapshot_content.as_bytes()) {
        return (headers, Json(serde_json::json!({"error": e.to_string()})));
    }

    use sha2::{Digest, Sha256};
    let hash = hex::encode(Sha256::digest(snapshot_content.as_bytes()));
    let att_key = uuid::Uuid::new_v4().to_string();
    let rel_path = {
        let lib = state.library_path.read().await;
        crate::utils::to_relative_path(&lib, &file_path)
    };

    let att_type_id: i64 = sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = 'snapshot'")
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(3);

    let attachment_id: i64 = match sqlx::query_scalar(
        r#"INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, file_hash, file_size)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id"#,
    )
    .bind(&att_key)
    .bind(entry_id)
    .bind(att_type_id)
    .bind(title)
    .bind(&rel_path)
    .bind(&hash)
    .bind(snapshot_content.len() as i64)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("Failed to insert snapshot attachment: {}", e);
            return (headers, Json(serde_json::json!({"error": e.to_string()})));
        }
    };

    tracing::info!("Saved snapshot for entry {}: {} ({} bytes)", entry_key, url, snapshot_content.len());

    // Enqueue extraction for the snapshot
    let _ = state.job_queue.enqueue(
        crate::jobs::types::JobType::OcrExtract,
        Some("Extract: Snapshot.html".to_string()),
        serde_json::json!({ "attachmentId": attachment_id }),
        0,
    ).await;

    (headers, Json(serde_json::json!({"result": "ok"})))
}

/// POST /connector/sessionProgress — returns done so the extension completes its save flow
pub async fn session_progress() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());
    (
        headers,
        Json(serde_json::json!({
            "done": true,
            "items": []
        })),
    )
}

/// POST /connector/getSelectedCollection — returns library info with targets (collections)
pub async fn get_selected_collection(
    State(state): State<Arc<ConnectorState>>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-Zotero-Version", compat_header_value());

    // Fetch collections for the target picker
    let collections: Vec<serde_json::Value> = sqlx::query(
        "SELECT id, name, parent_id FROM collections ORDER BY name",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .iter()
    .map(|r| {
        let id: i64 = r.get("id");
        let name: String = r.get("name");
        let parent_id: Option<i64> = r.get("parent_id");
        serde_json::json!({
            "id": format!("C{}", id),
            "name": name,
            "level": if parent_id.is_some() { 1 } else { 0 },
            "filesEditable": true
        })
    })
    .collect();

    let mut targets = vec![serde_json::json!({
        "id": "L1",
        "name": "My Library",
        "level": 0,
        "filesEditable": true
    })];
    targets.extend(collections);

    (
        headers,
        Json(serde_json::json!({
            "libraryID": 1,
            "libraryEditable": true,
            "editable": true,
            "id": "L1",
            "name": "My Library",
            "filesEditable": true,
            "targets": targets
        })),
    )
}

/// Map a MIME type to a Wren attachment_type name
fn mime_to_attachment_type(mime: &str, url: &str) -> String {
    if mime.contains("pdf") || url.ends_with(".pdf") {
        "pdf".to_string()
    } else if mime.contains("html") {
        "snapshot".to_string()
    } else if mime.contains("epub") {
        "epub".to_string()
    } else if mime.starts_with("image/") {
        "image".to_string()
    } else if mime.contains("text") {
        "note".to_string()
    } else {
        "generic".to_string()
    }
}

/// File extension for a given MIME type
fn mime_to_extension(mime: &str, url: &str) -> &'static str {
    if mime.contains("pdf") || url.ends_with(".pdf") {
        "pdf"
    } else if mime.contains("html") {
        "html"
    } else if mime.contains("epub") {
        "epub"
    } else if mime.contains("png") {
        "png"
    } else if mime.contains("jpeg") || mime.contains("jpg") {
        "jpg"
    } else if mime.contains("gif") {
        "gif"
    } else if mime.contains("webp") {
        "webp"
    } else {
        "bin"
    }
}

/// Download an attachment from a URL and save it to the entry directory.
/// Returns (file_path, file_size, sha256_hash).
fn validate_token(headers: &HeaderMap, expected: &str) -> Result<(), StatusCode> {
    let token = headers
        .get("X-Wren-Token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if token != expected {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}
