use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

use tauri::Emitter;

use super::ConnectorState;
use crate::commands::export::{
    build_bibtex_for_entry, build_citation_for_entry, build_csl_json_for_entry,
};

// =====================================================
// RESPONSE TYPES
// =====================================================

#[derive(Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEntrySummary {
    pub id: i64,
    pub key: String,
    pub item_type: String,
    pub title: String,
    pub creators: String,
    pub year: Option<String>,
    pub date_added: String,
    pub has_pdf: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAttachment {
    pub id: i64,
    pub key: String,
    pub attachment_type: String,
    pub title: Option<String>,
    pub file_path: Option<String>,
    pub url: Option<String>,
    pub page_count: Option<i32>,
    pub file_size: Option<i64>,
    pub markdown_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCollection {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub color: Option<String>,
}

#[derive(Deserialize)]
pub struct PaginationParams {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct AddNoteRequest {
    pub content: String,
    pub title: Option<String>,
    pub filename: Option<String>,
}

// =====================================================
// HELPERS
// =====================================================

/// Resolve an entry UUID key to its numeric ID.
async fn resolve_entry_key(db: &sqlx::SqlitePool, key: &str) -> Result<i64, StatusCode> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id FROM entries WHERE key = ? AND is_deleted = 0",
    )
    .bind(key)
    .fetch_optional(db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)
}

/// Map a row to an ApiEntrySummary.
fn row_to_entry_summary(r: &sqlx::sqlite::SqliteRow) -> ApiEntrySummary {
    let date: Option<String> = r.get("date");
    let year = date.as_deref().and_then(|d| d.split('-').next()).map(String::from);
    ApiEntrySummary {
        id: r.get("id"),
        key: r.get("key"),
        item_type: r.get("item_type"),
        title: r.get("title"),
        creators: r.get("creators_display"),
        year,
        date_added: r.get("date_added"),
        has_pdf: r.get("has_pdf"),
    }
}

// =====================================================
// SINGLE-ITEM ENDPOINTS
// =====================================================

/// GET /api/items/:key/cite — plain text citation
pub async fn get_item_cite(

    State(state): State<Arc<ConnectorState>>,
    Path(key): Path<String>,
) -> Result<Response, StatusCode> {

    let entry_id = resolve_entry_key(&state.db, &key).await?;
    let cite = build_citation_for_entry(&state.db, entry_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        cite,
    ).into_response())
}

/// GET /api/items/:key/bibtex — BibTeX entry
pub async fn get_item_bibtex(

    State(state): State<Arc<ConnectorState>>,
    Path(key): Path<String>,
) -> Result<Response, StatusCode> {

    let entry_id = resolve_entry_key(&state.db, &key).await?;
    let bibtex = build_bibtex_for_entry(&state.db, entry_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        bibtex,
    ).into_response())
}

/// GET /api/items/:key/json — CSL JSON
pub async fn get_item_json(

    State(state): State<Arc<ConnectorState>>,
    Path(key): Path<String>,
) -> Result<Response, StatusCode> {

    let entry_id = resolve_entry_key(&state.db, &key).await?;
    let csl = build_csl_json_for_entry(&state.db, entry_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(csl).into_response())
}

/// GET /api/items/:key/attachments — list attachments for an entry
pub async fn get_item_attachments(

    State(state): State<Arc<ConnectorState>>,
    Path(key): Path<String>,
) -> Result<Json<Vec<ApiAttachment>>, StatusCode> {

    let entry_id = resolve_entry_key(&state.db, &key).await?;

    let rows = sqlx::query(
        r#"
        SELECT a.id, a.key, at.name as attachment_type, a.title, a.file_path, a.url,
               a.page_count, a.file_size, a.markdown_path
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id = ?
        ORDER BY a.id
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let library_path = state.library_path.read().await;
    let attachments = rows
        .iter()
        .map(|r| {
            let file_path: Option<String> = r.get("file_path");
            let markdown_path: Option<String> = r.get("markdown_path");
            ApiAttachment {
                id: r.get("id"),
                key: r.get("key"),
                attachment_type: r.get("attachment_type"),
                title: r.get("title"),
                file_path: file_path.map(|p| crate::utils::resolve_path(&library_path, &p)),
                url: r.get("url"),
                page_count: r.get("page_count"),
                file_size: r.get("file_size"),
                markdown_path: markdown_path.map(|p| crate::utils::resolve_path(&library_path, &p)),
            }
        })
        .collect();

    Ok(Json(attachments))
}

/// POST /api/items/:key/notes — add a markdown note to an entry
pub async fn add_item_note(

    State(state): State<Arc<ConnectorState>>,
    Path(key): Path<String>,
    Json(body): Json<AddNoteRequest>,
) -> Result<Json<ApiAttachment>, StatusCode> {

    let entry_id = resolve_entry_key(&state.db, &key).await?;

    let content = body.content.trim();
    if content.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let library_path = state.library_path.read().await;
    let entry_dir = library_path.join("library").join("entries").join(&key);
    std::fs::create_dir_all(&entry_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Use provided filename, or fall back to Note.md / Note_N.md
    let note_filename = if let Some(ref fname) = body.filename {
        let f = fname.trim();
        if f.ends_with(".md") { f.to_string() } else { format!("{}.md", f) }
    } else {
        let existing_notes: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM attachments a
               JOIN attachment_types at ON a.attachment_type_id = at.id
               WHERE a.entry_id = ? AND at.name = 'note'"#,
        )
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if existing_notes == 0 {
            "Note.md".to_string()
        } else {
            format!("Note_{}.md", existing_notes + 1)
        }
    };

    let note_path = entry_dir.join(&note_filename);

    std::fs::write(&note_path, content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rel_path = crate::utils::to_relative_path(&library_path, &note_path);

    let note_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = 'note'")
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or(2);

    let note_key = Uuid::new_v4().to_string();
    let title = body
        .title
        .unwrap_or_else(|| content.chars().take(100).collect::<String>());

    sqlx::query(
        r#"INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, markdown_path)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&note_key)
    .bind(entry_id)
    .bind(note_type_id)
    .bind(&title)
    .bind(&rel_path)
    .bind(&rel_path)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let att_id: i64 = sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Notify the UI
    let _ = state.app_handle.emit(
        "connector:item-saved",
        serde_json::json!({ "id": entry_id, "key": key, "title": title }),
    );

    let abs_path = crate::utils::resolve_path(&library_path, &rel_path);
    Ok(Json(ApiAttachment {
        id: att_id,
        key: note_key,
        attachment_type: "note".to_string(),
        title: Some(title),
        file_path: Some(abs_path.clone()),
        url: None,
        page_count: None,
        file_size: Some(content.len() as i64),
        markdown_path: Some(abs_path),
    }))
}

// =====================================================
// BROWSING ENDPOINTS
// =====================================================

/// GET /api/items — paginated list of all entries
pub async fn list_items(

    State(state): State<Arc<ConnectorState>>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<ApiEntrySummary>>, StatusCode> {

    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(50).min(200);

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM entries WHERE is_deleted = 0")
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let rows = sqlx::query(
        r#"
        SELECT e.id, e.key, it.name as item_type, e.title, e.date, e.date_added,
               COALESCE(e.creators_sort, '') as creators_display,
               (SELECT COUNT(*) FROM attachments a JOIN attachment_types at ON a.attachment_type_id = at.id
                WHERE a.entry_id = e.id AND at.name = 'pdf') > 0 as has_pdf
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 0
        ORDER BY e.date_added DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let items = rows.iter().map(row_to_entry_summary).collect();
    Ok(Json(PaginatedResponse { items, total, offset, limit }))
}

/// GET /api/search?q=...&limit=...&offset=... — full-text search
pub async fn search_items(

    State(state): State<Arc<ConnectorState>>,
    Query(params): Query<SearchParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {

    let query = params.q.unwrap_or_default();
    if query.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0);

    // Search returns per-attachment hits; deduplicate by entry, keeping best score
    let raw_results = state
        .search_index
        .search(&query, limit * 3, 0) // fetch extra to ensure enough unique entries
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut seen = std::collections::HashMap::new();
    for r in &raw_results {
        let entry = seen.entry(r.entry_id).or_insert(r);
        if r.score > entry.score {
            *entry = r;
        }
    }

    let mut deduped: Vec<_> = seen.into_values().collect();
    deduped.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let total = deduped.len();
    let page: Vec<_> = deduped.into_iter().skip(offset).take(limit).collect();

    Ok(Json(serde_json::json!({
        "query": query,
        "results": page,
        "total": total,
        "offset": offset,
        "limit": limit,
    })))
}

/// GET /api/collections — list all collections
pub async fn list_collections(

    State(state): State<Arc<ConnectorState>>,
) -> Result<Json<Vec<ApiCollection>>, StatusCode> {

    let rows = sqlx::query(
        "SELECT id, name, parent_id, color FROM collections ORDER BY name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let collections = rows
        .iter()
        .map(|r| ApiCollection {
            id: r.get("id"),
            name: r.get("name"),
            parent_id: r.get("parent_id"),
            color: r.get("color"),
        })
        .collect();

    Ok(Json(collections))
}

/// GET /api/collections/:id_or_name/items — paginated entries in a collection (by ID or name)
pub async fn list_collection_items(

    State(state): State<Arc<ConnectorState>>,
    Path(id_or_name): Path<String>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<ApiEntrySummary>>, StatusCode> {

    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(50).min(200);

    // Resolve: try as numeric ID first, then by name
    let collection_id: i64 = if let Ok(id) = id_or_name.parse::<i64>() {
        id
    } else {
        sqlx::query_scalar("SELECT id FROM collections WHERE name = ? COLLATE NOCASE")
            .bind(&id_or_name)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?
    };

    // Count
    let total: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM entries e
           JOIN item_types it ON e.item_type_id = it.id
           JOIN collection_entries ce ON ce.entry_id = e.id
           WHERE e.is_deleted = 0 AND ce.collection_id = ?"#,
    )
    .bind(collection_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Data
    let rows = sqlx::query(
        r#"
        SELECT e.id, e.key, it.name as item_type, e.title, e.date, e.date_added,
               COALESCE(e.creators_sort, '') as creators_display,
               (SELECT COUNT(*) FROM attachments a JOIN attachment_types at ON a.attachment_type_id = at.id
                WHERE a.entry_id = e.id AND at.name = 'pdf') > 0 as has_pdf
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        JOIN collection_entries ce ON ce.entry_id = e.id
        WHERE e.is_deleted = 0 AND ce.collection_id = ?
        ORDER BY e.date_added DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(collection_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let items = rows.iter().map(row_to_entry_summary).collect();
    Ok(Json(PaginatedResponse { items, total, offset, limit }))
}

/// GET /api/tags/:name/items — paginated entries with a given tag
pub async fn list_tag_items(

    State(state): State<Arc<ConnectorState>>,
    Path(tag_name): Path<String>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<ApiEntrySummary>>, StatusCode> {

    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(50).min(200);

    // Resolve tag name to ID
    let tag_id: i64 = sqlx::query_scalar("SELECT id FROM tags WHERE name = ?")
        .bind(&tag_name)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // Count
    let total: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM entries e
           JOIN item_types it ON e.item_type_id = it.id
           JOIN entry_tags et ON et.entry_id = e.id
           WHERE e.is_deleted = 0 AND et.tag_id = ?"#,
    )
    .bind(tag_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Data
    let rows = sqlx::query(
        r#"
        SELECT e.id, e.key, it.name as item_type, e.title, e.date, e.date_added,
               COALESCE(e.creators_sort, '') as creators_display,
               (SELECT COUNT(*) FROM attachments a JOIN attachment_types at ON a.attachment_type_id = at.id
                WHERE a.entry_id = e.id AND at.name = 'pdf') > 0 as has_pdf
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        JOIN entry_tags et ON et.entry_id = e.id
        WHERE e.is_deleted = 0 AND et.tag_id = ?
        ORDER BY e.date_added DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(tag_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let items = rows.iter().map(row_to_entry_summary).collect();
    Ok(Json(PaginatedResponse { items, total, offset, limit }))
}
