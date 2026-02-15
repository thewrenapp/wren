use serde::Serialize;
use sqlx::FromRow;
use tauri::State;

use crate::search::extractor::{is_worth_saving, markdown_path_for, save_markdown, ExtractionConfig};
use crate::search::searcher::FullSearchResult;
use crate::state::AppState;

// =====================================================
// PROGRESS EVENT TYPES
// =====================================================

/// Detailed progress event for reindexing
#[derive(Debug, Clone, Serialize)]
pub struct ReindexProgress {
    /// Current entry index (0-based)
    pub current: usize,
    /// Total number of entries
    pub total: usize,
    /// Entry title being processed
    pub entry_title: Option<String>,
    /// Current file being processed (if any)
    pub file_name: Option<String>,
    /// Current step: "metadata", "extracting", "indexing", "annotations"
    pub step: String,
    /// Method being used: "kreuzberg", "direct"
    pub method: Option<String>,
    /// Status: "processing", "success", "skipped", "failed"
    pub status: String,
    /// Optional message (e.g., error reason)
    pub message: Option<String>,
}

// =====================================================
// ROW TYPES (for sqlx queries)
// =====================================================

#[derive(Debug, FromRow)]
struct EntrySearchRow {
    id: i64,
    key: String,
    item_type: String,
    title: Option<String>,
}

#[derive(Debug, FromRow)]
struct CreatorNamesRow {
    full_name: Option<String>,
}

#[derive(Debug, FromRow)]
struct AbstractRow {
    value: Option<String>,
}

#[derive(Debug, FromRow)]
struct AttachmentRow {
    id: i64,
    file_path: Option<String>,
    attachment_type: String,
}

#[derive(Debug, FromRow)]
struct AnnotationRow {
    selected_text: Option<String>,
    comment: Option<String>,
}

#[derive(Debug, FromRow)]
struct MarkdownPathRow {
    markdown_path: Option<String>,
}

// =====================================================
// TAURI COMMANDS
// =====================================================

/// Full-text search across document content
#[tauri::command]
pub async fn full_text_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<FullSearchResult>, String> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    state
        .search_index
        .search(&query, limit, offset)
        .map_err(|e| e.to_string())
}

/// Get markdown content for an attachment
#[tauri::command]
pub async fn get_markdown_content(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> Result<Option<String>, String> {
    let row: Option<MarkdownPathRow> = sqlx::query_as(
        "SELECT markdown_path FROM attachments WHERE id = ?",
    )
    .bind(attachment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let markdown_path = match row.and_then(|r| r.markdown_path) {
        Some(p) => p,
        None => return Ok(None),
    };

    // Resolve path relative to library
    let library_path = state.library_path.read().await;
    let full_path = library_path.join(&markdown_path);

    if full_path.exists() {
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

/// Save markdown content for an attachment (auto-save from editor, no reindex)
#[tauri::command]
pub async fn save_markdown_content(
    state: State<'_, AppState>,
    attachment_id: i64,
    content: String,
) -> Result<(), String> {
    // Get attachment info including file_path, markdown_path, entry_key, and type
    #[derive(Debug, FromRow)]
    struct AttachmentSaveRow {
        file_path: Option<String>,
        markdown_path: Option<String>,
        entry_key: String,
        attachment_key: String,
        attachment_type: String,
    }

    let attachment: AttachmentSaveRow = sqlx::query_as(
        r#"
        SELECT a.file_path, a.markdown_path, e.key as entry_key, a.key as attachment_key,
               at.name as attachment_type
        FROM attachments a
        JOIN entries e ON a.entry_id = e.id
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.id = ?
        "#,
    )
    .bind(attachment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Attachment not found".to_string())?;

    let library_path = state.library_path.read().await;
    let is_note = attachment.attachment_type == "note";

    let md_relative_path = if is_note {
        // Note attachment: the .md file IS the content itself
        if let Some(ref existing_md) = attachment.markdown_path {
            // Existing note — overwrite it
            let full_md = library_path.join(existing_md);
            std::fs::write(&full_md, &content).map_err(|e| e.to_string())?;
            existing_md.clone()
        } else {
            // New note with no file — create in entry's files directory
            let dir = library_path.join("files").join(&attachment.entry_key);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let md_path = dir.join(format!("note-{}.md", &attachment.attachment_key));
            std::fs::write(&md_path, &content).map_err(|e| e.to_string())?;
            md_path
                .strip_prefix(&*library_path)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string()
        }
    } else if let Some(ref file_path) = attachment.file_path {
        // Non-note attachment with a file on disk (PDF, EPUB, etc.) — save markdown alongside it
        let full_path = library_path.join(file_path);
        let md_path = markdown_path_for(&full_path);
        std::fs::write(&md_path, &content).map_err(|e| e.to_string())?;
        md_path
            .strip_prefix(&*library_path)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string()
    } else {
        return Err("Attachment has no file path".to_string());
    };

    // Update DB: notes set both file_path (absolute) and markdown_path (relative)
    if is_note {
        let full_path = library_path.join(&md_relative_path);
        let abs_path = full_path.to_string_lossy().to_string();
        sqlx::query("UPDATE attachments SET markdown_path = ?, file_path = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&md_relative_path)
            .bind(&abs_path)
            .bind(attachment_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        sqlx::query("UPDATE attachments SET markdown_path = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&md_relative_path)
            .bind(attachment_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Update inline table refs from the saved content
    update_inline_table_refs(&state.db, attachment_id, &content).await;

    Ok(())
}

/// Reindex a single attachment (re-extract text, update index, save/clear markdown)
#[tauri::command]
pub async fn reindex_attachment(
    state: State<'_, AppState>,
    attachment_id: i64,
    _enable_ocr: Option<bool>,
    _force_ocr: Option<bool>,
) -> Result<(), String> {
    // Get attachment info
    #[derive(Debug, FromRow)]
    struct AttachmentInfoRow {
        id: i64,
        entry_id: i64,
        entry_key: String,
        file_path: Option<String>,
        attachment_type: String,
        entry_title: Option<String>,
    }

    let attachment: AttachmentInfoRow = sqlx::query_as(
        r#"
        SELECT a.id, a.entry_id, e.key as entry_key, a.file_path,
               at.name as attachment_type, e.title as entry_title
        FROM attachments a
        JOIN entries e ON a.entry_id = e.id
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.id = ?
        "#,
    )
    .bind(attachment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Attachment not found".to_string())?;

    let is_note = attachment.attachment_type == "note";

    if is_note {
        // Notes: read markdown, expand inline tables, index inline (fast, no OCR).
        let library_path = state.library_path.read().await;
        let full_path = if let Some(ref fp) = attachment.file_path {
            library_path.join(fp)
        } else {
            let md_row: Option<MarkdownPathRow> = sqlx::query_as(
                "SELECT markdown_path FROM attachments WHERE id = ?",
            )
            .bind(attachment_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

            match md_row.and_then(|r| r.markdown_path) {
                Some(md_path) => library_path.join(&md_path),
                None => return Err("Attachment has no file path".to_string()),
            }
        };

        if !full_path.exists() {
            return Err(format!("File not found: {}", full_path.display()));
        }

        state
            .search_index
            .delete_attachment(attachment_id)
            .await
            .map_err(|e| e.to_string())?;

        let attachment_data = crate::search::indexer::AttachmentData {
            entry_id: attachment.entry_id,
            entry_key: attachment.entry_key,
            attachment_id: attachment.id,
            title: attachment.entry_title,
            file_path: full_path.to_string_lossy().to_string(),
            content_source: attachment.attachment_type,
        };

        let raw_text = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        let expanded_text = expand_inline_tables(&state.db, &raw_text).await;

        match state
            .search_index
            .index_text_content(&attachment_data, &expanded_text)
            .await
        {
            Ok(result) => {
                tracing::info!(
                    "Reindexed note {}: {} chars (expanded from {})",
                    attachment_id,
                    expanded_text.len(),
                    raw_text.len()
                );
                if !result.indexed {
                    tracing::info!("Note {} had no indexable content", attachment_id);
                }
            }
            Err(e) => {
                tracing::warn!("Failed to reindex note {}: {}", attachment_id, e);
                return Err(format!("Indexing failed: {}", e));
            }
        }

        update_inline_table_refs(&state.db, attachment_id, &raw_text).await;

        state
            .search_index
            .commit()
            .await
            .map_err(|e| e.to_string())?;
    } else {
        // Non-note attachments: enqueue background OCR extraction job
        let title = attachment.entry_title.as_deref().unwrap_or("attachment");
        state.job_queue.enqueue(
            crate::jobs::types::JobType::OcrExtract,
            Some(format!("Re-extract: {}", title)),
            serde_json::json!({ "attachmentId": attachment_id }),
            0,
        ).await.map_err(|e| format!("Failed to enqueue OCR job: {}", e))?;
    }

    Ok(())
}

/// Reindex a single entry and its attachments.
/// Metadata and annotations are indexed inline (fast).
/// Non-note attachment OCR extraction is enqueued as a background job.
#[tauri::command]
pub async fn reindex_entry(
    state: State<'_, AppState>,
    entry_id: i64,
    _enable_ocr: Option<bool>,
    _force_ocr: Option<bool>,
) -> Result<(), String> {
    // First delete existing documents for this entry
    state
        .search_index
        .delete_entry(entry_id)
        .await
        .map_err(|e| e.to_string())?;

    // Get entry from database
    let entry: Option<EntrySearchRow> = sqlx::query_as(
        r#"
        SELECT e.id, e.key, it.name as item_type, e.title
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ? AND e.is_deleted = 0
        "#,
    )
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let entry = match entry {
        Some(e) => e,
        None => return Ok(()), // Entry not found or trashed
    };

    // Get creators
    let creators: Vec<CreatorNamesRow> = sqlx::query_as(
        r#"
        SELECT COALESCE(
            NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
            name
        ) as full_name
        FROM entry_creators WHERE entry_id = ? ORDER BY sort_order
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let creators_str = creators
        .into_iter()
        .filter_map(|c| c.full_name)
        .collect::<Vec<_>>()
        .join("; ");

    // Get abstract
    let abstract_row: Option<AbstractRow> = sqlx::query_as(
        r#"
        SELECT ef.value FROM entry_fields ef
        JOIN fields f ON ef.field_id = f.id
        WHERE ef.entry_id = ? AND f.name = 'abstractNote'
        "#,
    )
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let abstract_text = abstract_row.and_then(|r| r.value);

    // Index metadata (fast, inline)
    let metadata = crate::search::indexer::EntryMetadata {
        entry_id,
        entry_key: entry.key.clone(),
        title: entry.title.clone(),
        creators: if creators_str.is_empty() {
            None
        } else {
            Some(creators_str)
        },
        abstract_text,
        item_type: entry.item_type.clone(),
    };

    state
        .search_index
        .index_entry_metadata(&metadata)
        .await
        .map_err(|e| e.to_string())?;

    // Get attachments
    let attachments: Vec<AttachmentRow> = sqlx::query_as(
        r#"
        SELECT a.id, a.file_path, at.name as attachment_type
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id = ? AND a.file_path IS NOT NULL
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for attachment in &attachments {
        // Enqueue OCR extraction job for non-note attachments
        if attachment.file_path.is_some() && attachment.attachment_type != "note" {
            let title = entry.title.as_deref().unwrap_or("attachment");
            if let Err(e) = state.job_queue.enqueue(
                crate::jobs::types::JobType::OcrExtract,
                Some(format!("Re-extract: {}", title)),
                serde_json::json!({ "attachmentId": attachment.id }),
                0,
            ).await {
                tracing::warn!("Failed to enqueue OCR job for attachment {}: {}", attachment.id, e);
            }
        }

        // Index annotations inline (no OCR, just text from DB)
        let annotations: Vec<AnnotationRow> = sqlx::query_as(
            r#"
            SELECT selected_text, comment
            FROM attachment_annotations
            WHERE attachment_id = ?
            "#,
        )
        .bind(attachment.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        if !annotations.is_empty() {
            let selected_texts: Vec<String> = annotations
                .iter()
                .filter_map(|a| a.selected_text.clone())
                .filter(|t| !t.trim().is_empty())
                .collect();
            let comments: Vec<String> = annotations
                .iter()
                .filter_map(|a| a.comment.clone())
                .filter(|c| !c.trim().is_empty())
                .collect();

            if !selected_texts.is_empty() || !comments.is_empty() {
                let annotation_data = crate::search::indexer::AnnotationData {
                    entry_id,
                    entry_key: entry.key.clone(),
                    attachment_id: attachment.id,
                    title: entry.title.clone(),
                    selected_text: if selected_texts.is_empty() {
                        None
                    } else {
                        Some(selected_texts.join("\n"))
                    },
                    comment: if comments.is_empty() {
                        None
                    } else {
                        Some(comments.join("\n"))
                    },
                };

                if let Err(e) = state.search_index.index_annotations(&annotation_data).await {
                    tracing::warn!(
                        "Failed to index annotations for attachment {}: {}",
                        attachment.id,
                        e
                    );
                }
            }
        }
    }

    // Commit metadata and annotation index changes
    state
        .search_index
        .commit()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reindex all entries in the library (background task)
#[tauri::command]
pub async fn reindex_library(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    enable_ocr: Option<bool>,
    force_ocr: Option<bool>,
) -> Result<(), String> {
    use tauri::Emitter;

    let config = ExtractionConfig {
        enable_ocr: enable_ocr.unwrap_or(true),
        force_ocr: force_ocr.unwrap_or(false),
    };

    // Get all entries
    let entries: Vec<EntrySearchRow> = sqlx::query_as(
        r#"
        SELECT e.id, e.key, it.name as item_type, e.title
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 0
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let total = entries.len();
    let _ = app_handle.emit("reindex:start", total);

    let library_path = state.library_path.read().await.clone();

    for (i, entry) in entries.iter().enumerate() {
        // Emit progress
        let _ = app_handle.emit("reindex:progress", (i, total));

        // Delete existing documents for this entry
        let _ = state.search_index.delete_entry(entry.id).await;

        // Get creators
        let creators: Vec<CreatorNamesRow> = sqlx::query_as(
            r#"
        SELECT COALESCE(
            NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
            name
        ) as full_name
        FROM entry_creators WHERE entry_id = ? ORDER BY sort_order
        "#,
        )
        .bind(entry.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let creators_str = creators
            .into_iter()
            .filter_map(|c| c.full_name)
            .collect::<Vec<_>>()
            .join("; ");

        // Get abstract
        let abstract_row: Option<AbstractRow> = sqlx::query_as(
            r#"
        SELECT ef.value FROM entry_fields ef
        JOIN fields f ON ef.field_id = f.id
        WHERE ef.entry_id = ? AND f.name = 'abstractNote'
        "#,
        )
        .bind(entry.id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let abstract_text = abstract_row.and_then(|r| r.value);

        // Index metadata
        let metadata = crate::search::indexer::EntryMetadata {
            entry_id: entry.id,
            entry_key: entry.key.clone(),
            title: entry.title.clone(),
            creators: if creators_str.is_empty() {
                None
            } else {
                Some(creators_str)
            },
            abstract_text,
            item_type: entry.item_type.clone(),
        };

        let _ = state.search_index.index_entry_metadata(&metadata).await;

        // Get attachments
        let attachments: Vec<AttachmentRow> = sqlx::query_as(
            r#"
        SELECT a.id, a.file_path, at.name as attachment_type
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id = ? AND a.file_path IS NOT NULL
        "#,
        )
        .bind(entry.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        for attachment in attachments {
            if let Some(file_path) = attachment.file_path {
                let full_path = library_path.join(&file_path);
                let file_name = full_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                if full_path.exists() {
                    // Emit progress: extracting
                    let _ = app_handle.emit(
                        "reindex:detail",
                        ReindexProgress {
                            current: i,
                            total,
                            entry_title: entry.title.clone(),
                            file_name: Some(file_name.clone()),
                            step: "extracting".to_string(),
                            method: Some("kreuzberg".to_string()),
                            status: "processing".to_string(),
                            message: None,
                        },
                    );

                    let attachment_data = crate::search::indexer::AttachmentData {
                        entry_id: entry.id,
                        entry_key: entry.key.clone(),
                        attachment_id: attachment.id,
                        title: entry.title.clone(),
                        file_path: full_path.to_string_lossy().to_string(),
                        content_source: attachment.attachment_type.clone(),
                    };

                    match state
                        .search_index
                        .index_attachment_content(&attachment_data, &config)
                        .await
                    {
                        Ok(result) => {
                            // Save markdown alongside original if extraction is substantial
                            let worth_saving = result.extracted_text.as_ref().map_or(false, |t| is_worth_saving(t));
                            if worth_saving {
                                if let Some(ref text) = result.extracted_text {
                                    if let Ok(md_path) = save_markdown(&full_path, text) {
                                        let relative_md = md_path
                                            .strip_prefix(&library_path)
                                            .ok()
                                            .map(|p| p.to_string_lossy().to_string());
                                        if let Some(rel) = relative_md {
                                            let _ = sqlx::query(
                                                "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                                            )
                                            .bind(&rel)
                                            .bind(attachment.id)
                                            .execute(&state.db)
                                            .await;
                                        }
                                    }
                                }
                            } else {
                                // Clear stale markdown_path and remove old .md file
                                let stale_md = markdown_path_for(&full_path);
                                let _ = std::fs::remove_file(&stale_md);
                                let _ = sqlx::query(
                                    "UPDATE attachments SET markdown_path = NULL WHERE id = ?",
                                )
                                .bind(attachment.id)
                                .execute(&state.db)
                                .await;
                            }

                            let _ = app_handle.emit(
                                "reindex:detail",
                                ReindexProgress {
                                    current: i,
                                    total,
                                    entry_title: entry.title.clone(),
                                    file_name: Some(file_name.clone()),
                                    step: "indexing".to_string(),
                                    method: Some(result.method.as_str().to_string()),
                                    status: if result.indexed {
                                        "success"
                                    } else {
                                        "skipped"
                                    }
                                    .to_string(),
                                    message: result.message,
                                },
                            );
                        }
                        Err(e) => {
                            let _ = app_handle.emit(
                                "reindex:detail",
                                ReindexProgress {
                                    current: i,
                                    total,
                                    entry_title: entry.title.clone(),
                                    file_name: Some(file_name.clone()),
                                    step: "indexing".to_string(),
                                    method: None,
                                    status: "failed".to_string(),
                                    message: Some(e.to_string()),
                                },
                            );
                        }
                    }
                }
            }

            // Index annotations for this attachment
            let annotations: Vec<AnnotationRow> = sqlx::query_as(
                r#"
                SELECT selected_text, comment
                FROM attachment_annotations
                WHERE attachment_id = ?
                "#,
            )
            .bind(attachment.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            if !annotations.is_empty() {
                let selected_texts: Vec<String> = annotations
                    .iter()
                    .filter_map(|a| a.selected_text.clone())
                    .filter(|t| !t.trim().is_empty())
                    .collect();
                let comments: Vec<String> = annotations
                    .iter()
                    .filter_map(|a| a.comment.clone())
                    .filter(|c| !c.trim().is_empty())
                    .collect();

                if !selected_texts.is_empty() || !comments.is_empty() {
                    let annotation_data = crate::search::indexer::AnnotationData {
                        entry_id: entry.id,
                        entry_key: entry.key.clone(),
                        attachment_id: attachment.id,
                        title: entry.title.clone(),
                        selected_text: if selected_texts.is_empty() {
                            None
                        } else {
                            Some(selected_texts.join("\n"))
                        },
                        comment: if comments.is_empty() {
                            None
                        } else {
                            Some(comments.join("\n"))
                        },
                    };

                    let _ = state
                        .search_index
                        .index_annotations(&annotation_data)
                        .await;
                }
            }
        }

        // Commit every 100 entries
        if (i + 1) % 100 == 0 {
            if let Err(e) = state.search_index.commit().await {
                tracing::error!("Failed to commit search index at batch {}: {}", i + 1, e);
            }
        }
    }

    // Final commit
    state
        .search_index
        .commit()
        .await
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("reindex:complete", total);

    Ok(())
}

// =====================================================
// INLINE TABLE REF TRACKING HELPERS
// =====================================================

/// Expand `<!-- wren-table:UUID -->` placeholders in markdown by fetching the
/// actual table data from the DB and converting to markdown table syntax.
/// The original placeholder line is replaced with the table title + markdown table.
async fn expand_inline_tables(db: &sqlx::SqlitePool, content: &str) -> String {
    use super::inline_tables::InlineTableColumn;
    use sqlx::Row;

    let mut result = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("<!-- wren-table:") {
            if let Some(uuid) = rest.strip_suffix("-->") {
                let uuid = uuid.trim();
                if !uuid.is_empty() {
                    // Fetch table data
                    if let Ok(Some(table_row)) = sqlx::query(
                        "SELECT id, title, columns_json FROM inline_tables WHERE key = ?",
                    )
                    .bind(uuid)
                    .fetch_optional(db)
                    .await
                    {
                        let table_id: i64 = table_row.get("id");
                        let title: String = table_row.get("title");
                        let columns_json: String = table_row.get("columns_json");
                        let columns: Vec<InlineTableColumn> =
                            serde_json::from_str(&columns_json).unwrap_or_default();

                        if !columns.is_empty() {
                            // Fetch rows
                            let rows = sqlx::query(
                                "SELECT data_json FROM inline_table_rows WHERE table_id = ? ORDER BY sort_order",
                            )
                            .bind(table_id)
                            .fetch_all(db)
                            .await
                            .unwrap_or_default();

                            // Build markdown table
                            result.push_str(&title);
                            result.push('\n');

                            // Header
                            let header: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
                            result.push_str(&format!("| {} |", header.join(" | ")));
                            result.push('\n');

                            // Separator
                            let sep: Vec<&str> = columns.iter().map(|_| "---").collect();
                            result.push_str(&format!("| {} |", sep.join(" | ")));
                            result.push('\n');

                            // Data rows
                            for row in &rows {
                                let data_json: String = row.get("data_json");
                                let data: serde_json::Value =
                                    serde_json::from_str(&data_json).unwrap_or_default();
                                let cells: Vec<String> = columns
                                    .iter()
                                    .map(|col| {
                                        data.get(&col.id)
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string()
                                    })
                                    .collect();
                                result.push_str(&format!("| {} |", cells.join(" | ")));
                                result.push('\n');
                            }
                            continue; // Skip appending the original placeholder line
                        }
                    }
                }
            }
        }
        result.push_str(line);
        result.push('\n');
    }
    result
}

/// Extract wren-table UUIDs from markdown content.
/// Looks for `<!-- wren-table:uuid -->` markers.
fn extract_table_uuids(content: &str) -> Vec<String> {
    let mut uuids = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("<!-- wren-table:") {
            if let Some(uuid) = rest.strip_suffix("-->") {
                let uuid = uuid.trim();
                if !uuid.is_empty() {
                    uuids.push(uuid.to_string());
                }
            }
        }
    }
    uuids
}

/// Update inline_table_refs for an attachment, and garbage-collect orphaned tables.
/// Call this after saving/reindexing an attachment's markdown content.
pub async fn update_inline_table_refs(
    db: &sqlx::SqlitePool,
    attachment_id: i64,
    markdown_content: &str,
) {
    // 1. Get old table UUIDs for this attachment
    let old_uuids: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT t.key FROM inline_table_refs r
        JOIN inline_tables t ON r.table_id = t.id
        WHERE r.attachment_id = ?
        "#,
    )
    .bind(attachment_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    // 2. Delete all refs for this attachment
    let _ = sqlx::query("DELETE FROM inline_table_refs WHERE attachment_id = ?")
        .bind(attachment_id)
        .execute(db)
        .await;

    // 3. Extract new table UUIDs from current markdown
    let new_uuids = extract_table_uuids(markdown_content);

    // 4. Insert new refs
    for uuid in &new_uuids {
        let _ = sqlx::query(
            r#"
            INSERT OR IGNORE INTO inline_table_refs (table_id, attachment_id)
            SELECT id, ? FROM inline_tables WHERE key = ?
            "#,
        )
        .bind(attachment_id)
        .bind(uuid)
        .execute(db)
        .await;
    }

    // 5. Find removed UUIDs (were in old set but not in new set)
    let new_set: std::collections::HashSet<&str> = new_uuids.iter().map(|s| s.as_str()).collect();
    let removed_uuids: Vec<&String> = old_uuids
        .iter()
        .filter(|u| !new_set.contains(u.as_str()))
        .collect();

    // 6. For each removed UUID, check if any other refs exist. If not, delete the table.
    for uuid in removed_uuids {
        let ref_count: Option<i64> = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) FROM inline_table_refs r
            JOIN inline_tables t ON r.table_id = t.id
            WHERE t.key = ?
            "#,
        )
        .bind(uuid)
        .fetch_one(db)
        .await
        .unwrap_or(Some(1)); // Default to 1 to avoid accidental deletion

        if ref_count == Some(0) {
            tracing::info!("Garbage collecting orphaned inline table: {}", uuid);
            let _ = sqlx::query("DELETE FROM inline_tables WHERE key = ?")
                .bind(uuid)
                .execute(db)
                .await;
        }
    }
}
