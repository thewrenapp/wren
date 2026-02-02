use crate::db::models::{
    Attachment, CreateAttachmentInput, CreateEntryInput, Creator, CreatorInput, Entry,
    EntrySummary, Tag, UpdateEntryInput,
};
use crate::state::AppState;
use sqlx::{FromRow, Row};
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

// =====================================================
// ROW TYPES (for sqlx queries)
// =====================================================

#[derive(Debug, FromRow)]
struct EntryRow {
    id: i64,
    key: String,
    item_type: String,
    item_type_display: String,
    title: String,
    date: Option<String>,
    url: Option<String>,
    access_date: Option<String>,
    date_added: String,
    date_modified: String,
}

#[derive(Debug, FromRow)]
struct EntrySummaryRow {
    id: i64,
    key: String,
    item_type: String,
    item_type_display: String,
    title: String,
    date: Option<String>,
    date_added: String,
    date_modified: Option<String>,
    attachment_count: i64,
    has_pdf: bool,
    has_note: bool,
    thumbnail_path: Option<String>,
}

#[derive(Debug, FromRow)]
struct CreatorRow {
    id: i64,
    creator_type: String,
    creator_type_display: String,
    first_name: Option<String>,
    last_name: Option<String>,
    name: Option<String>,
    sort_order: i32,
}

#[derive(Debug, FromRow)]
struct FieldRow {
    field_name: String,
    value: String,
}

#[derive(Debug, FromRow)]
struct AttachmentRow {
    id: i64,
    key: String,
    entry_id: i64,
    attachment_type: String,
    attachment_type_display: String,
    title: Option<String>,
    file_path: Option<String>,
    file_hash: Option<String>,
    file_size: Option<i64>,
    url: Option<String>,
    page_count: Option<i32>,
    frontmatter: Option<String>,
    thumbnail_path: Option<String>,
    date_added: String,
    date_modified: String,
}

#[derive(Debug, FromRow)]
struct TagRow {
    id: i64,
    name: String,
    color: Option<String>,
}

// =====================================================
// GET ENTRIES (List View)
// =====================================================

/// Get all entries with optional filtering
#[tauri::command]
pub async fn get_entries(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
    tag_id: Option<i64>,
    attachment_type: Option<String>,
    search_query: Option<String>,
) -> Result<Vec<EntrySummary>, String> {
    let base_query = r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.date_added, e.date_modified,
            (SELECT COUNT(*) FROM attachments WHERE entry_id = e.id) as attachment_count,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'pdf') as has_pdf,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'note') as has_note,
            (SELECT a.thumbnail_path FROM attachments a
             JOIN attachment_types at ON a.attachment_type_id = at.id
             WHERE a.entry_id = e.id AND at.name = 'pdf'
             LIMIT 1) as thumbnail_path
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 0
    "#;

    let entries: Vec<EntrySummaryRow> = if let Some(coll_id) = collection_id {
        let query = format!(
            "{} AND e.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ?) ORDER BY e.date_added DESC",
            base_query
        );
        sqlx::query_as::<_, EntrySummaryRow>(&query)
            .bind(coll_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?
    } else if let Some(t_id) = tag_id {
        let query = format!(
            "{} AND e.id IN (SELECT entry_id FROM entry_tags WHERE tag_id = ?) ORDER BY e.date_added DESC",
            base_query
        );
        sqlx::query_as::<_, EntrySummaryRow>(&query)
            .bind(t_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?
    } else if let Some(att_type) = attachment_type {
        let query = format!(
            "{} AND e.id IN (SELECT a.entry_id FROM attachments a JOIN attachment_types at ON a.attachment_type_id = at.id WHERE at.name = ?) ORDER BY e.date_added DESC",
            base_query
        );
        sqlx::query_as::<_, EntrySummaryRow>(&query)
            .bind(att_type)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?
    } else if let Some(search) = search_query {
        // Search in title and abstractNote field
        let query = format!(
            "{} AND (e.title LIKE ? OR e.id IN (
                SELECT ef.entry_id FROM entry_fields ef
                JOIN fields f ON ef.field_id = f.id
                WHERE f.name = 'abstractNote' AND ef.value LIKE ?
            )) ORDER BY e.date_added DESC",
            base_query
        );
        let search_pattern = format!("%{}%", search);
        sqlx::query_as::<_, EntrySummaryRow>(&query)
            .bind(&search_pattern)
            .bind(&search_pattern)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?
    } else {
        let query = format!("{} ORDER BY e.date_added DESC", base_query);
        sqlx::query_as::<_, EntrySummaryRow>(&query)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?
    };

    // Collect all entry IDs for batch queries
    let entry_ids: Vec<i64> = entries.iter().map(|e| e.id).collect();

    if entry_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Batch fetch all tags for all entries in ONE query
    let tags_map = batch_get_entry_tags(&state, &entry_ids).await?;

    // Batch fetch all creators for all entries in ONE query
    let creators_map = batch_get_entry_creators(&state, &entry_ids).await?;

    let mut result = Vec::new();
    for entry in entries {
        let tags = tags_map.get(&entry.id).cloned().unwrap_or_default();
        let creators = creators_map.get(&entry.id).cloned().unwrap_or_default();
        let creators_display = format_creators_display(&creators);
        let year = entry
            .date
            .as_ref()
            .map(|d| d.split('-').next().unwrap_or(d).to_string());

        result.push(EntrySummary {
            id: entry.id,
            key: entry.key,
            item_type: entry.item_type,
            item_type_display: entry.item_type_display,
            title: entry.title,
            creators_display,
            year,
            date_added: entry.date_added,
            date_modified: entry.date_modified,
            tags,
            attachment_count: entry.attachment_count,
            has_pdf: entry.has_pdf,
            has_note: entry.has_note,
            thumbnail_path: entry.thumbnail_path,
        });
    }

    Ok(result)
}

// =====================================================
// GET ENTRY (Full Detail with EAV fields)
// =====================================================

/// Get a single entry with full details including dynamic fields
#[tauri::command]
pub async fn get_entry(
    state: State<'_, AppState>,
    id: i64,
    include_deleted: Option<bool>,
) -> Result<Entry, String> {
    tracing::info!("get_entry called with id: {}", id);

    // Build query based on whether to include deleted entries
    let query = if include_deleted.unwrap_or(false) {
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.url, e.access_date, e.date_added, e.date_modified
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ?
        "#
    } else {
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.url, e.access_date, e.date_added, e.date_modified
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ? AND e.is_deleted = 0
        "#
    };

    // Get core entry data
    let entry: EntryRow = sqlx::query_as::<_, EntryRow>(query)
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    // Get dynamic fields from EAV table
    let fields = get_entry_fields(&state, id).await?;

    // Get creators
    let creators = get_entry_creators(&state, id).await?;

    // Get tags, collections, attachments
    let tags = get_entry_tags(&state, id).await?;
    let collections = get_entry_collections(&state, id).await?;
    let attachments = get_entry_attachments_internal(&state, id).await?;

    tracing::info!(
        "Found {} fields, {} creators, {} attachments for entry {}",
        fields.len(),
        creators.len(),
        attachments.len(),
        id
    );

    Ok(Entry {
        id: entry.id,
        key: entry.key,
        item_type: entry.item_type,
        item_type_display: entry.item_type_display,
        title: entry.title,
        date: entry.date,
        url: entry.url,
        access_date: entry.access_date,
        creators,
        fields,
        date_added: entry.date_added,
        date_modified: entry.date_modified,
        tags,
        collections,
        attachments,
    })
}

// =====================================================
// CREATE ENTRY
// =====================================================

/// Create a new entry with dynamic fields
#[tauri::command]
pub async fn create_entry(
    state: State<'_, AppState>,
    input: CreateEntryInput,
) -> Result<Entry, String> {
    let key = Uuid::new_v4().to_string();

    // Start transaction for atomic operation
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // Get item type ID
    let item_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
            .bind(&input.item_type)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Invalid item type: {}", input.item_type))?;

    // Insert core entry
    let result = sqlx::query(
        r#"
        INSERT INTO entries (key, item_type_id, title, date, url)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id, date_added, date_modified
        "#,
    )
    .bind(&key)
    .bind(item_type_id)
    .bind(&input.title)
    .bind(&input.date)
    .bind(&input.url)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create entry: {}", e))?;

    let entry_id: i64 = result.get("id");

    // Insert dynamic fields
    if let Some(ref fields) = input.fields {
        insert_entry_fields_tx(&mut tx, entry_id, fields).await?;
    }

    // Insert creators
    if let Some(ref creators) = input.creators {
        insert_entry_creators_tx(&mut tx, entry_id, creators).await?;
    }

    // Commit transaction
    tx.commit().await.map_err(|e| e.to_string())?;

    get_entry(state, entry_id, None).await
}

// =====================================================
// UPDATE ENTRY
// =====================================================

/// Update an entry with dynamic fields
#[tauri::command]
pub async fn update_entry(
    state: State<'_, AppState>,
    id: i64,
    input: UpdateEntryInput,
) -> Result<Entry, String> {
    // Start transaction for atomic operation
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // Build dynamic UPDATE query for core fields (single query instead of multiple)
    let mut set_clauses: Vec<String> = vec![];
    let mut needs_update = false;

    // Resolve item_type_id if changing
    let item_type_id: Option<i64> = if let Some(ref item_type) = input.item_type {
        let type_id: i64 = sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
            .bind(item_type)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Invalid item type: {}", item_type))?;
        set_clauses.push("item_type_id = ?".to_string());
        needs_update = true;
        Some(type_id)
    } else {
        None
    };

    if input.title.is_some() {
        set_clauses.push("title = ?".to_string());
        needs_update = true;
    }
    if input.date.is_some() {
        set_clauses.push("date = ?".to_string());
        needs_update = true;
    }
    if input.url.is_some() {
        set_clauses.push("url = ?".to_string());
        needs_update = true;
    }

    // Execute single UPDATE for core fields if any changed
    if needs_update {
        set_clauses.push("date_modified = datetime('now')".to_string());
        let query_str = format!("UPDATE entries SET {} WHERE id = ?", set_clauses.join(", "));

        let mut query = sqlx::query(&query_str);

        // Bind values in same order as set_clauses
        if let Some(type_id) = item_type_id {
            query = query.bind(type_id);
        }
        if let Some(ref title) = input.title {
            query = query.bind(title);
        }
        if let Some(ref date) = input.date {
            query = query.bind(date);
        }
        if let Some(ref url) = input.url {
            query = query.bind(url);
        }
        query = query.bind(id);

        query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }

    // Update dynamic fields (replace all)
    if let Some(ref fields) = input.fields {
        // Delete existing fields and insert new ones
        sqlx::query("DELETE FROM entry_fields WHERE entry_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        insert_entry_fields_tx(&mut tx, id, fields).await?;

        // Update modified timestamp if core fields weren't already updated
        if !needs_update {
            sqlx::query("UPDATE entries SET date_modified = datetime('now') WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Update creators (replace all)
    if let Some(ref creators) = input.creators {
        // Delete existing creators and insert new ones
        sqlx::query("DELETE FROM entry_creators WHERE entry_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        insert_entry_creators_tx(&mut tx, id, creators).await?;

        // Update modified timestamp if not already updated
        if !needs_update && input.fields.is_none() {
            sqlx::query("UPDATE entries SET date_modified = datetime('now') WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Commit transaction
    tx.commit().await.map_err(|e| e.to_string())?;

    get_entry(state, id, None).await
}

// =====================================================
// DELETE / TRASH OPERATIONS
// =====================================================

/// Delete an entry (soft delete)
#[tauri::command]
pub async fn delete_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query(
        "UPDATE entries SET is_deleted = 1, date_modified = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get trashed entries
#[tauri::command]
pub async fn get_trashed_entries(state: State<'_, AppState>) -> Result<Vec<EntrySummary>, String> {
    let entries: Vec<EntrySummaryRow> = sqlx::query_as::<_, EntrySummaryRow>(
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.date_added, e.date_modified,
            (SELECT COUNT(*) FROM attachments WHERE entry_id = e.id) as attachment_count,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'pdf') as has_pdf,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'note') as has_note,
            (SELECT a.thumbnail_path FROM attachments a
             JOIN attachment_types at ON a.attachment_type_id = at.id
             WHERE a.entry_id = e.id AND at.name = 'pdf'
             LIMIT 1) as thumbnail_path
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 1
        ORDER BY e.date_modified DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Collect all entry IDs for batch queries
    let entry_ids: Vec<i64> = entries.iter().map(|e| e.id).collect();

    if entry_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Batch fetch all tags and creators
    let tags_map = batch_get_entry_tags(&state, &entry_ids).await?;
    let creators_map = batch_get_entry_creators(&state, &entry_ids).await?;

    let mut result = Vec::new();
    for entry in entries {
        let tags = tags_map.get(&entry.id).cloned().unwrap_or_default();
        let creators = creators_map.get(&entry.id).cloned().unwrap_or_default();
        let creators_display = format_creators_display(&creators);
        let year = entry
            .date
            .as_ref()
            .map(|d| d.split('-').next().unwrap_or(d).to_string());

        result.push(EntrySummary {
            id: entry.id,
            key: entry.key,
            item_type: entry.item_type,
            item_type_display: entry.item_type_display,
            title: entry.title,
            creators_display,
            year,
            date_added: entry.date_added,
            date_modified: entry.date_modified,
            tags,
            attachment_count: entry.attachment_count,
            has_pdf: entry.has_pdf,
            has_note: entry.has_note,
            thumbnail_path: entry.thumbnail_path,
        });
    }

    Ok(result)
}

/// Get trash count
#[tauri::command]
pub async fn get_trash_count(state: State<'_, AppState>) -> Result<i64, String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM entries WHERE is_deleted = 1")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(count)
}

/// Restore an entry from trash
#[tauri::command]
pub async fn restore_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("UPDATE entries SET is_deleted = 0, date_modified = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Permanently delete entry (removes from DB AND files from disk)
#[tauri::command]
pub async fn permanent_delete_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    use std::fs;

    // Get entry key for folder path
    let entry_key: Option<String> = sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let entry_key = entry_key.ok_or("Entry not found")?;

    // Get all attachment file paths before deletion
    let file_paths: Vec<Option<String>> =
        sqlx::query_scalar("SELECT file_path FROM attachments WHERE entry_id = ?")
            .bind(id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    // Delete entry from DB (CASCADE will delete fields, creators, attachments, etc.)
    sqlx::query("DELETE FROM entries WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Delete individual files from disk
    for path in file_paths.into_iter().flatten() {
        if let Err(e) = fs::remove_file(&path) {
            tracing::warn!("Failed to delete file {}: {}", path, e);
        }
    }

    // Delete entry folder
    let library_path = state.library_path.read().await;
    let pdf_folder = library_path.join("files").join("pdfs").join(&entry_key);
    if pdf_folder.exists() {
        if let Err(e) = fs::remove_dir_all(&pdf_folder) {
            tracing::warn!("Failed to delete folder {:?}: {}", pdf_folder, e);
        }
    }

    Ok(())
}

/// Empty trash - permanently delete all trashed entries
#[tauri::command]
pub async fn empty_trash(state: State<'_, AppState>) -> Result<i64, String> {
    use std::fs;

    // Get all trashed entry IDs and keys
    let trashed: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, key FROM entries WHERE is_deleted = 1")
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let count = trashed.len() as i64;

    for (id, entry_key) in trashed {
        // Get file paths for this entry
        let file_paths: Vec<Option<String>> =
            sqlx::query_scalar("SELECT file_path FROM attachments WHERE entry_id = ?")
                .bind(id)
                .fetch_all(&state.db)
                .await
                .map_err(|e| e.to_string())?;

        // Delete entry from DB
        sqlx::query("DELETE FROM entries WHERE id = ?")
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;

        // Delete files
        for path in file_paths.into_iter().flatten() {
            if let Err(e) = fs::remove_file(&path) {
                tracing::warn!("Failed to delete file {}: {}", path, e);
            }
        }

        // Delete entry folder
        let library_path = state.library_path.read().await;
        let pdf_folder = library_path.join("files").join("pdfs").join(&entry_key);
        if pdf_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&pdf_folder) {
                tracing::warn!("Failed to delete folder {:?}: {}", pdf_folder, e);
            }
        }
    }

    Ok(count)
}

// =====================================================
// ATTACHMENT OPERATIONS
// =====================================================

/// Get attachments for an entry
#[tauri::command]
pub async fn get_entry_attachments(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<Attachment>, String> {
    get_entry_attachments_internal(&state, entry_id).await
}

async fn get_entry_attachments_internal(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<Attachment>, String> {
    let attachments: Vec<AttachmentRow> = sqlx::query_as::<_, AttachmentRow>(
        r#"
        SELECT
            a.id, a.key, a.entry_id, at.name as attachment_type,
            at.display_name as attachment_type_display,
            a.title, a.file_path, a.file_hash, a.file_size, a.url,
            a.page_count, a.frontmatter, a.thumbnail_path,
            a.date_added, a.date_modified
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id = ?
        ORDER BY a.date_added ASC
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(attachments
        .into_iter()
        .map(|a| Attachment {
            id: a.id,
            key: a.key,
            entry_id: a.entry_id,
            attachment_type: a.attachment_type,
            attachment_type_display: a.attachment_type_display,
            title: a.title,
            file_path: a.file_path,
            file_hash: a.file_hash,
            file_size: a.file_size,
            url: a.url,
            page_count: a.page_count,
            frontmatter: a.frontmatter,
            thumbnail_path: a.thumbnail_path,
            date_added: a.date_added,
            date_modified: a.date_modified,
        })
        .collect())
}

/// Get a single attachment
#[tauri::command]
pub async fn get_attachment(state: State<'_, AppState>, id: i64) -> Result<Attachment, String> {
    let attachment: AttachmentRow = sqlx::query_as::<_, AttachmentRow>(
        r#"
        SELECT
            a.id, a.key, a.entry_id, at.name as attachment_type,
            at.display_name as attachment_type_display,
            a.title, a.file_path, a.file_hash, a.file_size, a.url,
            a.page_count, a.frontmatter, a.thumbnail_path,
            a.date_added, a.date_modified
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Attachment not found".to_string())?;

    Ok(Attachment {
        id: attachment.id,
        key: attachment.key,
        entry_id: attachment.entry_id,
        attachment_type: attachment.attachment_type,
        attachment_type_display: attachment.attachment_type_display,
        title: attachment.title,
        file_path: attachment.file_path,
        file_hash: attachment.file_hash,
        file_size: attachment.file_size,
        url: attachment.url,
        page_count: attachment.page_count,
        frontmatter: attachment.frontmatter,
        thumbnail_path: attachment.thumbnail_path,
        date_added: attachment.date_added,
        date_modified: attachment.date_modified,
    })
}

/// Create a new attachment for an entry
#[tauri::command]
pub async fn create_attachment(
    state: State<'_, AppState>,
    input: CreateAttachmentInput,
) -> Result<Attachment, String> {
    let key = Uuid::new_v4().to_string();

    // Get attachment type ID
    let attachment_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = ?")
            .bind(&input.attachment_type)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Invalid attachment type: {}", input.attachment_type))?;

    let result = sqlx::query(
        r#"
        INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, url)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(&key)
    .bind(input.entry_id)
    .bind(attachment_type_id)
    .bind(&input.title)
    .bind(&input.file_path)
    .bind(&input.url)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to create attachment: {}", e))?;

    let attachment_id: i64 = result.get("id");
    get_attachment(state, attachment_id).await
}

/// Delete an attachment (DB record + file from disk)
#[tauri::command]
pub async fn delete_attachment(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    use std::fs;

    // Get file path before deletion
    let file_path: Option<String> =
        sqlx::query_scalar("SELECT file_path FROM attachments WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    // Delete from DB
    sqlx::query("DELETE FROM attachments WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Delete file from disk if it exists
    if let Some(path) = file_path {
        if let Err(e) = fs::remove_file(&path) {
            tracing::warn!("Failed to delete attachment file {}: {}", path, e);
        }
    }

    Ok(())
}

/// Add a PDF file as attachment to an existing entry
#[tauri::command]
pub async fn add_pdf_attachment(
    state: State<'_, AppState>,
    entry_id: i64,
    file_path: String,
) -> Result<Attachment, String> {
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    let source_path = PathBuf::from(&file_path);
    if !source_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Get entry key for folder structure
    let entry_key: String = sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| format!("Entry not found: {}", e))?;

    // Read file and calculate hash
    let file_content =
        fs::read(&source_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(&file_content);
    let file_hash = hex::encode(hasher.finalize());
    let file_size = file_content.len() as i64;

    // Create destination path
    let dest_dir = {
        let library_path = state.library_path.read().await;
        library_path.join("files").join("pdfs").join(&entry_key)
    };

    fs::create_dir_all(&dest_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.pdf", Uuid::new_v4()));

    let dest_path = dest_dir.join(&file_name);

    // Copy file to library
    fs::copy(&source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let dest_path_str = dest_path.to_string_lossy().to_string();

    // Get attachment type ID for pdf
    let attachment_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = 'pdf'")
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    // Get title from filename (without extension)
    let title = source_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "PDF Attachment".to_string());

    // Create attachment record
    let attachment_key = Uuid::new_v4().to_string();
    let result = sqlx::query(
        r#"
        INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, file_hash, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(&attachment_key)
    .bind(entry_id)
    .bind(attachment_type_id)
    .bind(&title)
    .bind(&dest_path_str)
    .bind(&file_hash)
    .bind(file_size)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to create attachment: {}", e))?;

    let attachment_id: i64 = result.get("id");
    tracing::info!(
        "Added PDF attachment {} to entry {}",
        attachment_id,
        entry_id
    );

    get_attachment(state, attachment_id).await
}

// =====================================================
// TAG / COLLECTION OPERATIONS
// =====================================================

/// Add a tag to an entry
#[tauri::command]
pub async fn add_entry_tag(
    state: State<'_, AppState>,
    entry_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
        .bind(entry_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove a tag from an entry
#[tauri::command]
pub async fn remove_entry_tag(
    state: State<'_, AppState>,
    entry_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?")
        .bind(entry_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Add an entry to a collection
#[tauri::command]
pub async fn add_entry_to_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO collection_entries (entry_id, collection_id, order_index)
         VALUES (?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM collection_entries WHERE collection_id = ?))",
    )
    .bind(entry_id)
    .bind(collection_id)
    .bind(collection_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove an entry from a collection
#[tauri::command]
pub async fn remove_entry_from_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_entries WHERE entry_id = ? AND collection_id = ?")
        .bind(entry_id)
        .bind(collection_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// =====================================================
// TYPE QUERIES
// =====================================================

/// Get item types (renamed from entry_types for Zotero compatibility)
#[tauri::command]
pub async fn get_item_types(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::models::ItemType>, String> {
    let types = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>)>(
        "SELECT id, name, display_name, csl_type, icon FROM item_types ORDER BY sort_order, display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(types
        .into_iter()
        .map(|(id, name, display_name, csl_type, icon)| crate::db::models::ItemType {
            id,
            name,
            display_name,
            csl_type,
            icon,
        })
        .collect())
}

/// Get attachment types
#[tauri::command]
pub async fn get_attachment_types(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::models::AttachmentType>, String> {
    let types = sqlx::query_as::<_, (i64, String, String, Option<String>)>(
        "SELECT id, name, display_name, icon FROM attachment_types ORDER BY display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(types
        .into_iter()
        .map(|(id, name, display_name, icon)| crate::db::models::AttachmentType {
            id,
            name,
            display_name,
            icon,
        })
        .collect())
}

/// Show entry's attachment in Finder/Explorer
#[tauri::command]
pub async fn show_entry_in_finder(state: State<'_, AppState>, entry_id: i64) -> Result<(), String> {
    // Get the first attachment with a file path
    let file_path: Option<String> = sqlx::query_scalar(
        "SELECT file_path FROM attachments WHERE entry_id = ? AND file_path IS NOT NULL LIMIT 1",
    )
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let path = file_path.ok_or_else(|| "No file attachment found for this entry".to_string())?;

    // Reveal file in Finder (macOS) or Explorer (Windows)
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open on the parent directory
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open file manager: {}", e))?;
        }
    }

    Ok(())
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/// Get entry fields from EAV table
async fn get_entry_fields(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<HashMap<String, String>, String> {
    let fields: Vec<FieldRow> = sqlx::query_as::<_, FieldRow>(
        r#"
        SELECT f.name as field_name, ef.value
        FROM entry_fields ef
        JOIN fields f ON ef.field_id = f.id
        WHERE ef.entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(fields
        .into_iter()
        .map(|f| (f.field_name, f.value))
        .collect())
}

/// Get entry creators
async fn get_entry_creators(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<Creator>, String> {
    let creators: Vec<CreatorRow> = sqlx::query_as::<_, CreatorRow>(
        r#"
        SELECT
            ec.id, ct.name as creator_type, ct.display_name as creator_type_display,
            ec.first_name, ec.last_name, ec.name, ec.sort_order
        FROM entry_creators ec
        JOIN creator_types ct ON ec.creator_type_id = ct.id
        WHERE ec.entry_id = ?
        ORDER BY ec.sort_order
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(creators
        .into_iter()
        .map(|c| Creator {
            id: Some(c.id),
            creator_type: c.creator_type,
            creator_type_display: Some(c.creator_type_display),
            first_name: c.first_name,
            last_name: c.last_name,
            name: c.name,
            sort_order: c.sort_order,
        })
        .collect())
}

/// Get entry tags
async fn get_entry_tags(state: &State<'_, AppState>, entry_id: i64) -> Result<Vec<Tag>, String> {
    let tags: Vec<TagRow> = sqlx::query_as::<_, TagRow>(
        r#"
        SELECT t.id, t.name, t.color
        FROM tags t
        JOIN entry_tags et ON t.id = et.tag_id
        WHERE et.entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(tags
        .into_iter()
        .map(|t| Tag {
            id: t.id,
            name: t.name,
            color: t.color,
            item_count: 0,
        })
        .collect())
}

/// Get entry collections (returns collection IDs)
async fn get_entry_collections(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<i64>, String> {
    let rows = sqlx::query(
        r#"
        SELECT c.id
        FROM collections c
        JOIN collection_entries ce ON c.id = ce.collection_id
        WHERE ce.entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| r.get("id")).collect())
}

/// Insert entry fields into EAV table (transaction version)
async fn insert_entry_fields_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    entry_id: i64,
    fields: &HashMap<String, String>,
) -> Result<(), String> {
    for (field_name, value) in fields {
        if value.is_empty() {
            continue;
        }

        // Get field ID
        let field_id: Option<i64> = sqlx::query_scalar("SELECT id FROM fields WHERE name = ?")
            .bind(field_name)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;

        if let Some(fid) = field_id {
            sqlx::query(
                "INSERT OR REPLACE INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)",
            )
            .bind(entry_id)
            .bind(fid)
            .bind(value)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        } else {
            tracing::warn!("Unknown field name: {}", field_name);
        }
    }
    Ok(())
}

/// Insert entry creators (transaction version)
async fn insert_entry_creators_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    entry_id: i64,
    creators: &[CreatorInput],
) -> Result<(), String> {
    for (sort_order, creator) in creators.iter().enumerate() {
        // Get creator type ID
        let creator_type_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM creator_types WHERE name = ?")
                .bind(&creator.creator_type)
                .fetch_optional(&mut **tx)
                .await
                .map_err(|e| e.to_string())?;

        if let Some(ctid) = creator_type_id {
            sqlx::query(
                r#"
                INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(entry_id)
            .bind(ctid)
            .bind(&creator.first_name)
            .bind(&creator.last_name)
            .bind(&creator.name)
            .bind(sort_order as i32)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        } else {
            tracing::warn!("Unknown creator type: {}", creator.creator_type);
        }
    }
    Ok(())
}

/// Format creators for display (e.g., "Wu" or "Wu & Green" or "Wu et al.")
fn format_creators_display(creators: &[Creator]) -> String {
    // Find primary creators (usually authors)
    let primary: Vec<&Creator> = creators
        .iter()
        .filter(|c| c.creator_type == "author")
        .collect();

    let display_creators = if primary.is_empty() {
        creators.iter().collect::<Vec<_>>()
    } else {
        primary
    };

    match display_creators.len() {
        0 => String::new(),
        1 => display_creators[0].short_name(),
        2 => format!(
            "{} & {}",
            display_creators[0].short_name(),
            display_creators[1].short_name()
        ),
        _ => format!("{} et al.", display_creators[0].short_name()),
    }
}

// =====================================================
// BATCH HELPER FUNCTIONS (for N+1 query optimization)
// =====================================================

/// Row type for batch tag query
#[derive(Debug, FromRow)]
struct BatchTagRow {
    entry_id: i64,
    tag_id: i64,
    tag_name: String,
    tag_color: Option<String>,
}

/// Row type for batch creator query
#[derive(Debug, FromRow)]
struct BatchCreatorRow {
    entry_id: i64,
    id: i64,
    creator_type: String,
    creator_type_display: String,
    first_name: Option<String>,
    last_name: Option<String>,
    name: Option<String>,
    sort_order: i32,
}

/// Batch fetch tags for multiple entries in ONE query
async fn batch_get_entry_tags(
    state: &State<'_, AppState>,
    entry_ids: &[i64],
) -> Result<HashMap<i64, Vec<Tag>>, String> {
    if entry_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        r#"
        SELECT et.entry_id, t.id as tag_id, t.name as tag_name, t.color as tag_color
        FROM entry_tags et
        JOIN tags t ON et.tag_id = t.id
        WHERE et.entry_id IN ({})
        "#,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, BatchTagRow>(&query);
    for id in entry_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Group by entry_id
    let mut result: HashMap<i64, Vec<Tag>> = HashMap::new();
    for row in rows {
        result.entry(row.entry_id).or_default().push(Tag {
            id: row.tag_id,
            name: row.tag_name,
            color: row.tag_color,
            item_count: 0,
        });
    }

    Ok(result)
}

/// Batch fetch creators for multiple entries in ONE query
async fn batch_get_entry_creators(
    state: &State<'_, AppState>,
    entry_ids: &[i64],
) -> Result<HashMap<i64, Vec<Creator>>, String> {
    if entry_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        r#"
        SELECT
            ec.entry_id, ec.id, ct.name as creator_type, ct.display_name as creator_type_display,
            ec.first_name, ec.last_name, ec.name, ec.sort_order
        FROM entry_creators ec
        JOIN creator_types ct ON ec.creator_type_id = ct.id
        WHERE ec.entry_id IN ({})
        ORDER BY ec.entry_id, ec.sort_order
        "#,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, BatchCreatorRow>(&query);
    for id in entry_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Group by entry_id
    let mut result: HashMap<i64, Vec<Creator>> = HashMap::new();
    for row in rows {
        result.entry(row.entry_id).or_default().push(Creator {
            id: Some(row.id),
            creator_type: row.creator_type,
            creator_type_display: Some(row.creator_type_display),
            first_name: row.first_name,
            last_name: row.last_name,
            name: row.name,
            sort_order: row.sort_order,
        });
    }

    Ok(result)
}

/// Batch fetch attachments for multiple entries in ONE query
#[tauri::command]
pub async fn get_entries_attachments(
    state: State<'_, AppState>,
    entry_ids: Vec<i64>,
) -> Result<HashMap<i64, Vec<Attachment>>, String> {
    if entry_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        r#"
        SELECT
            a.id, a.key, a.entry_id, at.name as attachment_type,
            at.display_name as attachment_type_display,
            a.title, a.file_path, a.file_hash, a.file_size, a.url,
            a.page_count, a.frontmatter, a.thumbnail_path,
            a.date_added, a.date_modified
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id IN ({})
        ORDER BY a.entry_id, a.date_added ASC
        "#,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, AttachmentRow>(&query);
    for id in &entry_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Group by entry_id
    let mut result: HashMap<i64, Vec<Attachment>> = HashMap::new();
    for a in rows {
        result.entry(a.entry_id).or_default().push(Attachment {
            id: a.id,
            key: a.key,
            entry_id: a.entry_id,
            attachment_type: a.attachment_type,
            attachment_type_display: a.attachment_type_display,
            title: a.title,
            file_path: a.file_path,
            file_hash: a.file_hash,
            file_size: a.file_size,
            url: a.url,
            page_count: a.page_count,
            frontmatter: a.frontmatter,
            thumbnail_path: a.thumbnail_path,
            date_added: a.date_added,
            date_modified: a.date_modified,
        });
    }

    Ok(result)
}

// =====================================================
// DUPLICATE ENTRY
// =====================================================

/// Duplicate an entry (copies metadata, creators, fields, tags, and collections)
#[tauri::command]
pub async fn duplicate_entry(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Entry, String> {
    let key = Uuid::new_v4().to_string();

    // Start transaction
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // Get original entry
    let original: EntryRow = sqlx::query_as::<_, EntryRow>(
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.url, e.access_date, e.date_added, e.date_modified
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ?
        "#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Entry not found: {}", e))?;

    // Get item type ID
    let item_type_id: i64 = sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
        .bind(&original.item_type)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Insert new entry with "(Copy)" suffix
    let new_title = format!("{} (Copy)", original.title);
    let result = sqlx::query(
        r#"
        INSERT INTO entries (key, item_type_id, title, date, url, access_date)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(&key)
    .bind(item_type_id)
    .bind(&new_title)
    .bind(&original.date)
    .bind(&original.url)
    .bind(&original.access_date)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create duplicate: {}", e))?;

    let new_id: i64 = result.get("id");

    // Copy fields
    sqlx::query(
        r#"
        INSERT INTO entry_fields (entry_id, field_id, value)
        SELECT ?, field_id, value
        FROM entry_fields
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Copy creators
    sqlx::query(
        r#"
        INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
        SELECT ?, creator_type_id, first_name, last_name, name, sort_order
        FROM entry_creators
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Copy tags
    sqlx::query(
        r#"
        INSERT INTO entry_tags (entry_id, tag_id)
        SELECT ?, tag_id
        FROM entry_tags
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Copy collection memberships
    sqlx::query(
        r#"
        INSERT INTO collection_entries (collection_id, entry_id)
        SELECT collection_id, ?
        FROM collection_entries
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Commit transaction
    tx.commit().await.map_err(|e| e.to_string())?;

    // Return the new entry
    get_entry(state, new_id, None).await
}
