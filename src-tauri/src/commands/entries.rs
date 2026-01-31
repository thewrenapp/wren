use crate::db::models::{
    Attachment, CreateAttachmentInput, CreateEntryInput, Creator, Entry, EntrySummary, Tag,
    UpdateEntryInput,
};
use crate::state::AppState;
use sqlx::{FromRow, Row};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct EntryRow {
    id: i64,
    key: String,
    entry_type: String,
    entry_type_display: String,
    title: String,
    creators: Option<String>,
    publication_date: Option<String>,
    doi: Option<String>,
    isbn: Option<String>,
    issn: Option<String>,
    url: Option<String>,
    publisher: Option<String>,
    journal: Option<String>,
    volume: Option<String>,
    issue: Option<String>,
    pages: Option<String>,
    abstract_text: Option<String>,
    repository: Option<String>,
    archive_id: Option<String>,
    language: Option<String>,
    rights: Option<String>,
    extra: Option<String>,
    date_added: String,
    date_modified: String,
}

#[derive(Debug, FromRow)]
struct EntrySummaryRow {
    id: i64,
    key: String,
    entry_type: String,
    title: String,
    creators: Option<String>,
    publication_date: Option<String>,
    date_added: String,
    attachment_count: i64,
    has_pdf: bool,
    has_note: bool,
    thumbnail_path: Option<String>,
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

/// Get all entries with optional filtering
#[tauri::command]
pub async fn get_entries(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
    tag_id: Option<i64>,
    attachment_type: Option<String>,
    search_query: Option<String>,
) -> Result<Vec<EntrySummary>, String> {
    // Base query
    let base_query = r#"
        SELECT
            e.id, e.key, et.name as entry_type, e.title, e.creators,
            e.publication_date, e.date_added,
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
        JOIN entry_types et ON e.entry_type_id = et.id
        WHERE e.is_deleted = 0
    "#;

    // Execute different queries based on filters
    // This approach avoids lifetime issues with dynamic binding
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
        let query = format!(
            "{} AND (e.title LIKE ? OR e.creators LIKE ? OR e.abstract_text LIKE ? OR e.doi LIKE ?) ORDER BY e.date_added DESC",
            base_query
        );
        let search_pattern = format!("%{}%", search);
        sqlx::query_as::<_, EntrySummaryRow>(&query)
            .bind(&search_pattern)
            .bind(&search_pattern)
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

    let mut result = Vec::new();
    for entry in entries {
        let tags = get_entry_tags(&state, entry.id).await?;
        let creators = parse_creators(&entry.creators);
        let creators_display = format_creators_display(&creators);
        let year = entry
            .publication_date
            .as_ref()
            .map(|d| d.split('-').next().unwrap_or(d).to_string());

        result.push(EntrySummary {
            id: entry.id,
            key: entry.key,
            entry_type: entry.entry_type,
            title: entry.title,
            creators_display,
            year,
            date_added: entry.date_added,
            tags,
            attachment_count: entry.attachment_count,
            has_pdf: entry.has_pdf,
            has_note: entry.has_note,
            thumbnail_path: entry.thumbnail_path,
        });
    }

    Ok(result)
}

/// Get a single entry with full details
#[tauri::command]
pub async fn get_entry(state: State<'_, AppState>, id: i64) -> Result<Entry, String> {
    tracing::info!("get_entry called with id: {}", id);
    let entry: EntryRow = sqlx::query_as::<_, EntryRow>(
        r#"
        SELECT
            e.id, e.key, et.name as entry_type, et.display_name as entry_type_display,
            e.title, e.creators, e.publication_date, e.doi, e.isbn, e.issn, e.url,
            e.publisher, e.journal, e.volume, e.issue, e.pages, e.abstract_text,
            e.repository, e.archive_id, e.language, e.rights, e.extra,
            e.date_added, e.date_modified
        FROM entries e
        JOIN entry_types et ON e.entry_type_id = et.id
        WHERE e.id = ? AND e.is_deleted = 0
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Entry not found".to_string())?;

    let tags = get_entry_tags(&state, entry.id).await?;
    let collections = get_entry_collections(&state, entry.id).await?;
    let attachments = get_entry_attachments_internal(&state, entry.id).await?;
    tracing::info!("Found {} attachments for entry {}", attachments.len(), entry.id);
    let creators = parse_creators(&entry.creators);

    Ok(Entry {
        id: entry.id,
        key: entry.key,
        entry_type: entry.entry_type,
        entry_type_display: entry.entry_type_display,
        title: entry.title,
        creators,
        publication_date: entry.publication_date,
        doi: entry.doi,
        isbn: entry.isbn,
        issn: entry.issn,
        url: entry.url,
        publisher: entry.publisher,
        journal: entry.journal,
        volume: entry.volume,
        issue: entry.issue,
        pages: entry.pages,
        abstract_text: entry.abstract_text,
        repository: entry.repository,
        archive_id: entry.archive_id,
        language: entry.language,
        rights: entry.rights,
        extra: entry.extra,
        date_added: entry.date_added,
        date_modified: entry.date_modified,
        tags,
        collections,
        attachments: attachments.clone(),
        attachment_count: attachments.len() as i64,
    })
}

/// Create a new entry
#[tauri::command]
pub async fn create_entry(
    state: State<'_, AppState>,
    input: CreateEntryInput,
) -> Result<Entry, String> {
    let key = Uuid::new_v4().to_string();

    // Get entry type ID
    let entry_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM entry_types WHERE name = ?",
    )
    .bind(&input.entry_type)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Invalid entry type: {}", input.entry_type))?;

    // Serialize creators to JSON
    let creators_json = input
        .creators
        .as_ref()
        .map(|c| serde_json::to_string(c).unwrap_or_default());

    let result = sqlx::query(
        r#"
        INSERT INTO entries (
            key, entry_type_id, title, creators, publication_date, doi, isbn, issn,
            url, publisher, journal, volume, issue, pages, abstract_text,
            repository, archive_id, language, rights, extra
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, date_added, date_modified
        "#,
    )
    .bind(&key)
    .bind(entry_type_id)
    .bind(&input.title)
    .bind(&creators_json)
    .bind(&input.publication_date)
    .bind(&input.doi)
    .bind(&input.isbn)
    .bind(&input.issn)
    .bind(&input.url)
    .bind(&input.publisher)
    .bind(&input.journal)
    .bind(&input.volume)
    .bind(&input.issue)
    .bind(&input.pages)
    .bind(&input.abstract_text)
    .bind(&input.repository)
    .bind(&input.archive_id)
    .bind(&input.language)
    .bind(&input.rights)
    .bind(&input.extra)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to create entry: {}", e))?;

    let entry_id: i64 = result.get("id");
    get_entry(state, entry_id).await
}

/// Update an entry
#[tauri::command]
pub async fn update_entry(
    state: State<'_, AppState>,
    id: i64,
    input: UpdateEntryInput,
) -> Result<Entry, String> {
    // Handle entry type change if specified
    if let Some(ref entry_type) = input.entry_type {
        let entry_type_id: i64 = sqlx::query_scalar("SELECT id FROM entry_types WHERE name = ?")
            .bind(entry_type)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Invalid entry type: {}", entry_type))?;

        sqlx::query("UPDATE entries SET entry_type_id = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(entry_type_id)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Update each field individually if provided
    // This avoids the complexity of dynamic query building
    if let Some(ref title) = input.title {
        sqlx::query("UPDATE entries SET title = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(title)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref creators) = input.creators {
        let creators_json = serde_json::to_string(creators).unwrap_or_default();
        sqlx::query("UPDATE entries SET creators = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&creators_json)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.publication_date {
        sqlx::query("UPDATE entries SET publication_date = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.doi {
        sqlx::query("UPDATE entries SET doi = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.isbn {
        sqlx::query("UPDATE entries SET isbn = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.issn {
        sqlx::query("UPDATE entries SET issn = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.url {
        sqlx::query("UPDATE entries SET url = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.publisher {
        sqlx::query("UPDATE entries SET publisher = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.journal {
        sqlx::query("UPDATE entries SET journal = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.volume {
        sqlx::query("UPDATE entries SET volume = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.issue {
        sqlx::query("UPDATE entries SET issue = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.pages {
        sqlx::query("UPDATE entries SET pages = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.abstract_text {
        sqlx::query("UPDATE entries SET abstract_text = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.repository {
        sqlx::query("UPDATE entries SET repository = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.archive_id {
        sqlx::query("UPDATE entries SET archive_id = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.language {
        sqlx::query("UPDATE entries SET language = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.rights {
        sqlx::query("UPDATE entries SET rights = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(ref val) = input.extra {
        sqlx::query("UPDATE entries SET extra = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(val)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    get_entry(state, id).await
}

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
    let attachment_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM attachment_types WHERE name = ?",
    )
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

/// Delete an attachment
#[tauri::command]
pub async fn delete_attachment(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM attachments WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Add a PDF file as attachment to an existing entry (no metadata extraction)
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
    let file_content = fs::read(&source_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(&file_content);
    let file_hash = hex::encode(hasher.finalize());
    let file_size = file_content.len() as i64;

    // Create destination path
    let dest_dir = {
        let library_path = state.library_path.read().await;
        library_path.join("files").join("pdfs").join(&entry_key)
    };

    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_name = source_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.pdf", Uuid::new_v4()));

    let dest_path = dest_dir.join(&file_name);

    // Copy file to library
    fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    let dest_path_str = dest_path.to_string_lossy().to_string();

    // Get attachment type ID for pdf
    let attachment_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM attachment_types WHERE name = 'pdf'"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Get title from filename (without extension)
    let title = source_path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "PDF Attachment".to_string());

    // Create attachment record
    let attachment_key = Uuid::new_v4().to_string();
    let result = sqlx::query(
        r#"
        INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, file_hash, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#
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
    tracing::info!("Added PDF attachment {} to entry {}", attachment_id, entry_id);

    get_attachment(state, attachment_id).await
}

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

/// Get entry types
#[tauri::command]
pub async fn get_entry_types(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::models::EntryType>, String> {
    let types = sqlx::query_as::<_, (i64, String, String, Option<String>)>(
        "SELECT id, name, display_name, icon FROM entry_types ORDER BY display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(types
        .into_iter()
        .map(|(id, name, display_name, icon)| crate::db::models::EntryType {
            id,
            name,
            display_name,
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
        "SELECT file_path FROM attachments WHERE entry_id = ? AND file_path IS NOT NULL LIMIT 1"
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

// Helper functions

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

async fn get_entry_collections(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        r#"
        SELECT c.key
        FROM collections c
        JOIN collection_entries ce ON c.id = ce.collection_id
        WHERE ce.entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| r.get("key")).collect())
}

fn parse_creators(creators_json: &Option<String>) -> Vec<Creator> {
    creators_json
        .as_ref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default()
}

fn format_creators_display(creators: &[Creator]) -> String {
    let authors: Vec<&Creator> = creators
        .iter()
        .filter(|c| c.creator_type == "author")
        .collect();

    match authors.len() {
        0 => String::new(),
        1 => authors[0].short_name(),
        2 => format!("{} & {}", authors[0].short_name(), authors[1].short_name()),
        _ => format!("{} et al.", authors[0].short_name()),
    }
}
