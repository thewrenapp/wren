use crate::filename;
use crate::pdf;
use crate::search::indexer::EntryMetadata;
use crate::state::AppState;
use crate::commands::settings::is_setting_enabled;
use biblatex::{Bibliography, Chunk, Entry, EntryType, Spanned, Type};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub id: i64,
    pub key: String,
    pub title: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "entryId")]
    pub entry_id: i64,
    #[serde(rename = "attachmentId")]
    pub attachment_id: i64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    #[serde(rename = "currentFile")]
    pub current_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiblatexImportProgress {
    pub current: usize,
    pub total: usize,
    pub current_key: String,
    pub current_title: String,
}

/// Detailed progress event for import operations (file extraction)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDetailProgress {
    /// File name being processed
    pub file_name: String,
    /// Current step: "extracting", "indexing"
    pub step: String,
    /// Method being used: "pdf-extract → ollama → ocr", "direct", etc.
    pub method: Option<String>,
    /// Status: "processing", "success", "skipped", "failed"
    pub status: String,
    /// Optional message
    pub message: Option<String>,
}

/// Import a single PDF file
#[tauri::command]
pub async fn import_pdf(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<ImportResult, String> {
    let source_path = PathBuf::from(&file_path);

    if !source_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    import_single_pdf(&state, &source_path).await
}

/// Import multiple PDF files
#[tauri::command]
pub async fn import_pdfs(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    file_paths: Vec<String>,
) -> Result<Vec<ImportResult>, String> {
    let mut results = Vec::new();

    for path_str in file_paths {
        let source_path = PathBuf::from(&path_str);

        if !source_path.exists() {
            results.push(ImportResult {
                id: 0,
                key: String::new(),
                title: path_str.clone(),
                file_path: path_str,
                entry_id: 0,
                attachment_id: 0,
                success: false,
                error: Some("File not found".to_string()),
            });
            continue;
        }

        match import_single_pdf_with_handle(&state, &source_path, Some(&app_handle)).await {
            Ok(result) => results.push(result),
            Err(e) => results.push(ImportResult {
                id: 0,
                key: String::new(),
                title: source_path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                file_path: path_str,
                entry_id: 0,
                attachment_id: 0,
                success: false,
                error: Some(e),
            }),
        }
    }

    Ok(results)
}

/// Import all PDFs from a folder
#[tauri::command]
pub async fn import_folder(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    folder_path: String,
) -> Result<Vec<ImportResult>, String> {
    let folder = PathBuf::from(&folder_path);

    if !folder.exists() || !folder.is_dir() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    let mut pdf_paths = Vec::new();
    collect_pdfs(&folder, &mut pdf_paths);

    let mut results = Vec::new();
    for path in pdf_paths {
        match import_single_pdf_with_handle(&state, &path, Some(&app_handle)).await {
            Ok(result) => results.push(result),
            Err(e) => results.push(ImportResult {
                id: 0,
                key: String::new(),
                title: path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                file_path: path.to_string_lossy().to_string(),
                entry_id: 0,
                attachment_id: 0,
                success: false,
                error: Some(e),
            }),
        }
    }

    Ok(results)
}

/// Recursively collect PDF files from a folder
fn collect_pdfs(folder: &Path, paths: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_pdfs(&path, paths);
            } else if path.extension().map(|e| e.to_ascii_lowercase()) == Some("pdf".into()) {
                paths.push(path);
            }
        }
    }
}

/// Import a single PDF file into the new entry/attachment model
async fn import_single_pdf(
    state: &State<'_, AppState>,
    source_path: &Path,
) -> Result<ImportResult, String> {
    import_single_pdf_with_handle(state, source_path, None).await
}

/// Import a single PDF file with optional app handle for progress events
async fn import_single_pdf_with_handle(
    state: &State<'_, AppState>,
    source_path: &Path,
    app_handle: Option<&AppHandle>,
) -> Result<ImportResult, String> {
    // Check file size before reading (reject files > 500MB)
    const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;
    let metadata = fs::metadata(source_path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.0} MB). Maximum supported size is 500 MB.",
            metadata.len() as f64 / (1024.0 * 1024.0)
        ));
    }

    // Calculate file hash
    let file_content = fs::read(source_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(&file_content);
    let file_hash = hex::encode(hasher.finalize());

    // Check for duplicate by hash in new attachments table
    let existing: Option<(i64, i64)> = sqlx::query_as(
        "SELECT id, entry_id FROM attachments WHERE file_hash = ?"
    )
    .bind(&file_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    if let Some((attachment_id, entry_id)) = existing {
        // Return existing entry/attachment info
        let row = sqlx::query(
            "SELECT e.id, e.key, e.title, a.file_path
             FROM entries e
             JOIN attachments a ON a.entry_id = e.id
             WHERE a.id = ?"
        )
        .bind(attachment_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        return Ok(ImportResult {
            id: row.get("id"),
            key: row.get("key"),
            title: row.get("title"),
            file_path: row.get("file_path"),
            entry_id,
            attachment_id,
            success: true,
            error: Some("File already exists in library".to_string()),
        });
    }

    // Extract metadata
    let metadata = pdf::extract_metadata(source_path)
        .map_err(|e| format!("Failed to extract metadata: {}", e))?;

    // Determine title from metadata or filename
    let title = metadata.title
        .clone()
        .or_else(|| {
            source_path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "Untitled".to_string());

    // Generate unique keys for entry and attachment
    let entry_key = Uuid::new_v4().to_string();
    let attachment_key = Uuid::new_v4().to_string();

    // Create destination path
    let library_path = state.library_path.read().await;
    let dest_dir = library_path.join("files").join(&entry_key);

    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_name = source_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.pdf", entry_key));

    let dest_path = dest_dir.join(&file_name);

    // Copy file to library
    fs::copy(source_path, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    let file_size = file_content.len() as i64;

    // Parse authors from metadata
    // Handle multiple separators: semicolon, " and ", or comma (when names appear to be separated)
    let authors: Vec<String> = metadata.author.as_ref()
        .map(|author| {
            // First try semicolon
            let mut names: Vec<String> = author
                .split(';')
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .collect();

            // If only one name and it contains " and " or comma-separated patterns, try splitting further
            if names.len() == 1 {
                let single = &names[0];

                // Try splitting by " and " first
                if single.contains(" and ") {
                    names = single
                        .split(" and ")
                        .map(|name| name.trim().to_string())
                        .filter(|name| !name.is_empty())
                        .collect();
                } else if single.contains(',') {
                    // Check if this looks like comma-separated full names (e.g., "John Smith, Jane Doe")
                    // vs a single name with comma (e.g., "Smith, John")
                    let comma_parts: Vec<&str> = single.split(',').collect();

                    // If we have more than 2 parts, likely comma-separated names
                    // Or if parts don't look like "LastName, FirstName" format
                    if comma_parts.len() > 2 ||
                       (comma_parts.len() == 2 && comma_parts.iter().all(|p| p.trim().contains(' '))) {
                        names = single
                            .split(',')
                            .map(|name| name.trim().to_string())
                            .filter(|name| !name.is_empty())
                            .collect();
                    }
                }
            }

            names
        })
        .unwrap_or_default();

    // Get item type ID for journalArticle (default for PDFs)
    let item_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM item_types WHERE name = 'journalArticle'"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Get attachment type ID for pdf
    let attachment_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM attachment_types WHERE name = 'pdf'"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Get author creator type ID
    let author_creator_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM creator_types WHERE name = 'author'"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Insert entry
    let entry_result = sqlx::query(
        r#"
        INSERT INTO entries (key, item_type_id, title)
        VALUES (?, ?, ?)
        RETURNING id, date_added, date_modified
        "#
    )
    .bind(&entry_key)
    .bind(item_type_id)
    .bind(&title)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to insert entry: {}", e))?;

    let entry_id: i64 = entry_result.get("id");

    // Insert creators into entry_creators table
    for (sort_order, author_name) in authors.iter().enumerate() {
        // Try to split name into first/last if possible
        let parts: Vec<&str> = author_name.rsplitn(2, ' ').collect();
        let (first_name, last_name, name) = if parts.len() == 2 {
            (Some(parts[1].to_string()), Some(parts[0].to_string()), None)
        } else {
            // Single name - treat as institution or single-field name
            (None, None, Some(author_name.clone()))
        };

        sqlx::query(
            r#"
            INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(entry_id)
        .bind(author_creator_type_id)
        .bind(&first_name)
        .bind(&last_name)
        .bind(&name)
        .bind(sort_order as i32)
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to insert creator: {}", e))?;
    }
    if let Err(e) = crate::commands::entries::refresh_entry_creators_sort(&state.db, entry_id).await {
        tracing::warn!("Failed to refresh creators_sort for entry {}: {}", entry_id, e);
    }

    // Insert abstract into entry_fields if present
    if let Some(abstract_text) = &metadata.subject {
        // Get abstractNote field ID
        let abstract_field_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM fields WHERE name = 'abstractNote'"
        )
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        if let Some(field_id) = abstract_field_id {
            sqlx::query(
                r#"
                INSERT INTO entry_fields (entry_id, field_id, value)
                VALUES (?, ?, ?)
                "#
            )
            .bind(entry_id)
            .bind(field_id)
            .bind(abstract_text)
            .execute(&state.db)
            .await
            .map_err(|e| format!("Failed to insert abstract: {}", e))?;
        }
    }

    if let Err(e) = crate::commands::entries::refresh_entry_fts(&state.db, entry_id).await {
        tracing::warn!("Failed to refresh entries_fts for entry {}: {}", entry_id, e);
    }

    // Auto-rename file if setting is enabled
    let auto_rename = is_setting_enabled(&state.db, "auto_rename_files").await;
    let (final_dest_path, final_title) = if auto_rename {
        // Build Creator structs from parsed authors
        let creators: Vec<crate::db::models::Creator> = authors
            .iter()
            .enumerate()
            .map(|(sort_order, author_name)| {
                let parts: Vec<&str> = author_name.rsplitn(2, ' ').collect();
                let (first_name, last_name, name) = if parts.len() == 2 {
                    (Some(parts[1].to_string()), Some(parts[0].to_string()), None)
                } else {
                    (None, None, Some(author_name.clone()))
                };
                crate::db::models::Creator {
                    id: None,
                    creator_type: "author".to_string(),
                    creator_type_display: None,
                    first_name,
                    last_name,
                    name,
                    sort_order: sort_order as i32,
                }
            })
            .collect();

        // Note: PDF metadata doesn't include date, so year will be None
        // The filename will be generated as "{firstCreator} - {title}.pdf"
        let year: Option<String> = None;

        // Get file extension
        let extension = source_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "pdf".to_string());

        // Generate new filename
        let generated = filename::generate_filename(
            &title,
            &creators,
            year.as_deref(),
            &extension,
        );

        if !generated.is_empty() && generated != dest_path.file_name().unwrap_or_default().to_string_lossy() {
            // Rename the file
            let new_dest_path = filename::resolve_conflict(&dest_dir, &generated);
            if let Err(e) = fs::rename(&dest_path, &new_dest_path) {
                tracing::warn!("Failed to rename file during import: {}", e);
                // Keep original path if rename fails
                (dest_path, title.clone())
            } else {
                let new_title = new_dest_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| title.clone());
                (new_dest_path, new_title)
            }
        } else {
            (dest_path, title.clone())
        }
    } else {
        (dest_path, title.clone())
    };

    let final_dest_path_str = final_dest_path.to_string_lossy().to_string();

    // Insert PDF attachment
    let attachment_result = sqlx::query(
        r#"
        INSERT INTO attachments (
            key, entry_id, attachment_type_id, title,
            file_path, file_hash, file_size, page_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#
    )
    .bind(&attachment_key)
    .bind(entry_id)
    .bind(attachment_type_id)
    .bind(&final_title)
    .bind(&final_dest_path_str)
    .bind(&file_hash)
    .bind(file_size)
    .bind(metadata.page_count)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to insert attachment: {}", e))?;

    let attachment_id: i64 = attachment_result.get("id");

    tracing::info!("Imported PDF: {} (entry: {}, attachment: {})", final_title, entry_key, attachment_key);

    // Index entry metadata for full-text search
    let creators_str = authors.join("; ");
    let abstract_text = metadata.subject.clone();

    let entry_metadata = EntryMetadata {
        entry_id,
        entry_key: entry_key.clone(),
        title: Some(final_title.clone()),
        creators: if creators_str.is_empty() { None } else { Some(creators_str) },
        abstract_text,
        item_type: "journalArticle".to_string(),
    };

    if let Err(e) = state.search_index.index_entry_metadata(&entry_metadata).await {
        tracing::warn!("Failed to index entry metadata: {}", e);
    }

    // Enqueue background OCR extraction job (non-blocking)
    let file_name = final_dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    if let Err(e) = state.job_queue.enqueue(
        crate::jobs::types::JobType::OcrExtract,
        Some(format!("Extract: {}", file_name)),
        serde_json::json!({ "attachmentId": attachment_id }),
        0,
    ).await {
        tracing::warn!("Failed to enqueue OCR job for attachment {}: {}", attachment_id, e);
    }

    if let Some(handle) = app_handle {
        let _ = handle.emit(
            "import:detail",
            ImportDetailProgress {
                file_name: file_name.clone(),
                step: "extracting".to_string(),
                method: Some("background".to_string()),
                status: "queued".to_string(),
                message: Some("Text extraction queued as background task".to_string()),
            },
        );
    }

    // Commit metadata index changes
    if let Err(e) = state.search_index.commit().await {
        tracing::error!("Failed to commit search index: {}", e);
    }

    Ok(ImportResult {
        id: entry_id,
        key: entry_key,
        title: final_title,
        file_path: final_dest_path_str,
        entry_id,
        attachment_id,
        success: true,
        error: None,
    })
}

// =====================================================
// BibTeX Import (using biblatex crate)
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibtexImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

// =====================================================
// Helper functions for biblatex crate
// =====================================================

/// Convert biblatex Spanned<Chunk> to a plain string
fn chunks_to_string(chunks: &[Spanned<Chunk>]) -> String {
    chunks.iter().map(|c| c.v.get()).collect::<Vec<_>>().join("")
}

/// Check if an entry is an arXiv preprint based on various fields
fn is_arxiv_entry(entry: &Entry) -> bool {
    // Check eprint field (returns String directly)
    if let Ok(eprint) = entry.eprint() {
        if eprint.contains("arxiv") || eprint.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return true;
        }
    }

    // Check eprint_type field
    if let Ok(eprinttype) = entry.eprint_type() {
        let eprinttype_str = chunks_to_string(eprinttype);
        if eprinttype_str.to_lowercase().contains("arxiv") {
            return true;
        }
    }

    // Check URL field
    if let Ok(url) = entry.url() {
        if url.contains("arxiv.org") {
            return true;
        }
    }

    // Check DOI field
    if let Ok(doi) = entry.doi() {
        if doi.to_lowercase().contains("arxiv") {
            return true;
        }
    }

    // Check publisher field - returns Vec<Vec<Spanned<Chunk>>>
    if let Ok(publishers) = entry.publisher() {
        for pub_chunks in publishers {
            let publisher_str = chunks_to_string(&pub_chunks);
            if publisher_str.to_lowercase().contains("arxiv") {
                return true;
            }
        }
    }

    false
}

/// Map biblatex EntryType to Wren item type string
fn entry_type_to_item_type(entry: &Entry) -> &'static str {
    // Special handling for misc/other types - check if it's actually arXiv
    match entry.entry_type {
        EntryType::Misc | EntryType::Online | EntryType::Unknown(_) => {
            if is_arxiv_entry(entry) {
                return "journalArticle";
            }
            "document"
        }
        EntryType::Article | EntryType::Periodical => "journalArticle",
        EntryType::Book | EntryType::MvBook | EntryType::Collection | EntryType::MvCollection |
        EntryType::Reference | EntryType::MvReference | EntryType::Proceedings | EntryType::MvProceedings => "book",
        EntryType::InBook | EntryType::InCollection | EntryType::InReference |
        EntryType::BookInBook | EntryType::SuppBook | EntryType::SuppCollection => "bookSection",
        EntryType::InProceedings | EntryType::SuppPeriodical => "conferencePaper",
        EntryType::Thesis | EntryType::PhdThesis | EntryType::MastersThesis => "thesis",
        EntryType::Report | EntryType::TechReport => "report",
        EntryType::Patent => "patent",
        EntryType::Software => "computerProgram",
        EntryType::Dataset => "dataset",
        EntryType::Manual | EntryType::Booklet | EntryType::Unpublished => {
            // Check if unpublished is actually an arXiv preprint
            if is_arxiv_entry(entry) {
                return "journalArticle";
            }
            "document"
        }
        _ => "document",
    }
}

/// Get a field value as a string from an entry using the raw chunks
fn get_field_string(entry: &Entry, field: &str) -> Option<String> {
    entry.get(field).and_then(|chunks| {
        let s = chunks_to_string(chunks);
        if s.is_empty() { None } else { Some(s) }
    })
}


/// Import BibTeX content using the biblatex crate for proper parsing
#[tauri::command]
pub async fn import_bibtex(
    state: State<'_, AppState>,
    content: String,
) -> Result<BibtexImportResult, String> {
    let mut imported = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    // Parse the BibTeX content using the biblatex crate
    let bibliography = match Bibliography::parse(&content) {
        Ok(bib) => bib,
        Err(e) => {
            return Err(format!("Failed to parse BibTeX: {:?}", e));
        }
    };

    for entry in bibliography.iter() {
        // Get title - the biblatex crate handles brace stripping automatically
        let title = match entry.title() {
            Ok(chunks) => chunks_to_string(chunks),
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        if title.is_empty() {
            skipped += 1;
            continue;
        }

        // Check for duplicate by title
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM entries WHERE title = ? AND is_deleted = 0"
        )
        .bind(&title)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        if existing.is_some() {
            skipped += 1;
            continue;
        }

        // Map entry type to Wren item type (with arXiv detection)
        let item_type = entry_type_to_item_type(entry);

        // Get item type ID
        let item_type_id: i64 = match sqlx::query_scalar::<_, i64>(
            "SELECT id FROM item_types WHERE name = ?"
        )
        .bind(item_type)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(id)) => id,
            _ => {
                errors.push(format!("Unknown item type: {}", item_type));
                continue;
            }
        };

        // Generate key
        let entry_key = Uuid::new_v4().to_string();

        // Extract date/year using the biblatex crate's date parsing
        let date = entry.date().ok()
            .map(|d| {
                let chunks = d.to_chunks();
                chunks.iter().map(|c: &Spanned<Chunk>| c.v.get()).collect::<String>()
            })
            .or_else(|| get_field_string(entry, "year"));

        // Get URL
        let url = entry.url().ok();

        // Insert entry
        let entry_result = match sqlx::query(
            r#"
            INSERT INTO entries (key, item_type_id, title, date, url)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&entry_key)
        .bind(item_type_id)
        .bind(&title)
        .bind(&date)
        .bind(&url)
        .fetch_one(&state.db)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("Failed to insert entry '{}': {}", title, e));
                continue;
            }
        };

        let entry_id: i64 = entry_result.get("id");

        // Insert authors using the biblatex crate's Person parsing
        if let Ok(authors) = entry.author() {
            let author_creator_type_id: i64 = sqlx::query_scalar(
                "SELECT id FROM creator_types WHERE name = 'author'"
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(1);

            for (i, person) in authors.iter().enumerate() {
                let first_name = if person.given_name.is_empty() { None } else { Some(person.given_name.clone()) };
                let last_name = if person.name.is_empty() { None } else { Some(person.name.clone()) };

                let _ = sqlx::query(
                    r#"
                    INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    "#
                )
                .bind(entry_id)
                .bind(author_creator_type_id)
                .bind(&first_name)
                .bind(&last_name)
                .bind(i as i32)
                .execute(&state.db)
                .await;
            }
        }
        if let Err(e) = crate::commands::entries::refresh_entry_creators_sort(&state.db, entry_id).await {
            tracing::warn!("Failed to refresh creators_sort for entry {}: {}", entry_id, e);
        }
        if let Err(e) = crate::commands::entries::refresh_entry_creators_sort(&state.db, entry_id).await {
            tracing::warn!("Failed to refresh creators_sort for entry {}: {}", entry_id, e);
        }

        // Insert additional fields - biblatex crate handles brace stripping
        let field_mappings = [
            ("journal", "publicationTitle"),
            ("journaltitle", "publicationTitle"),
            ("booktitle", "bookTitle"),
            ("publisher", "publisher"),
            ("volume", "volume"),
            ("number", "issue"),
            ("pages", "pages"),
            ("doi", "DOI"),
            ("isbn", "ISBN"),
            ("issn", "ISSN"),
            ("abstract", "abstractNote"),
            ("keywords", "tags"),
            ("note", "extra"),
        ];

        for (bibtex_field, wren_field) in field_mappings {
            if let Some(value) = get_field_string(entry, bibtex_field) {
                if let Ok(Some(field_id)) = sqlx::query_scalar::<_, i64>(
                    "SELECT id FROM fields WHERE name = ?"
                )
                .bind(wren_field)
                .fetch_optional(&state.db)
                .await
                {
                    let _ = sqlx::query(
                        "INSERT OR REPLACE INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)"
                    )
                    .bind(entry_id)
                    .bind(field_id)
                    .bind(&value)
                    .execute(&state.db)
                    .await;
                }
            }
        }

        // Index entry metadata for full-text search
        let creators_str: String = entry.author()
            .ok()
            .map(|authors| {
                authors.iter()
                    .map(|p| {
                        if !p.name.is_empty() && !p.given_name.is_empty() {
                            format!("{} {}", p.given_name, p.name)
                        } else if !p.name.is_empty() {
                            p.name.clone()
                        } else {
                            p.given_name.clone()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_default();

        let abstract_text = get_field_string(entry, "abstract");

        let entry_metadata = EntryMetadata {
            entry_id,
            entry_key: entry_key.clone(),
            title: Some(title.clone()),
            creators: if creators_str.is_empty() { None } else { Some(creators_str) },
            abstract_text,
            item_type: item_type.to_string(),
        };

        if let Err(e) = state.search_index.index_entry_metadata(&entry_metadata).await {
            tracing::warn!("Failed to index entry metadata for {}: {}", entry_key, e);
        }

        imported += 1;
    }

    // Commit search index changes
    if let Err(e) = state.search_index.commit().await {
        tracing::error!("Failed to commit search index: {}", e);
    }

    Ok(BibtexImportResult {
        imported,
        skipped,
        errors,
    })
}

// =====================================================
// CSL JSON Import
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CslJsonImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// CSL JSON item structure (partial)
#[derive(Debug, Clone, Deserialize)]
struct CslJsonItem {
    #[serde(rename = "type")]
    item_type: Option<String>,
    title: Option<String>,
    author: Option<Vec<CslJsonName>>,
    editor: Option<Vec<CslJsonName>>,
    issued: Option<CslJsonDate>,
    #[serde(rename = "DOI")]
    doi: Option<String>,
    #[serde(rename = "URL")]
    url: Option<String>,
    #[serde(rename = "container-title")]
    container_title: Option<String>,
    publisher: Option<String>,
    volume: Option<StringOrNumber>,
    issue: Option<StringOrNumber>,
    page: Option<String>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
    #[serde(rename = "ISBN")]
    isbn: Option<String>,
    #[serde(rename = "ISSN")]
    issn: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CslJsonName {
    family: Option<String>,
    given: Option<String>,
    literal: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CslJsonDate {
    #[serde(rename = "date-parts")]
    date_parts: Option<Vec<Vec<i32>>>,
    raw: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum StringOrNumber {
    String(String),
    Number(i64),
}

impl StringOrNumber {
    fn to_string(&self) -> String {
        match self {
            StringOrNumber::String(s) => s.clone(),
            StringOrNumber::Number(n) => n.to_string(),
        }
    }
}

/// Map CSL JSON type to Wren item type (with optional item for arXiv detection)
fn csl_type_to_item_type_with_item(csl_type: &str, item: Option<&CslJsonItem>) -> &'static str {
    let csl_type_lower = csl_type.to_lowercase();

    // For unknown/misc types, check if it's actually an arXiv paper
    if csl_type_lower == "document" || csl_type_lower == "misc" || csl_type_lower == "manuscript" || csl_type_lower.is_empty() {
        if let Some(i) = item {
            let is_arxiv = i.url.as_ref().map(|v| v.contains("arxiv.org")).unwrap_or(false)
                || i.doi.as_ref().map(|v| v.contains("arXiv") || v.contains("arxiv")).unwrap_or(false)
                || i.publisher.as_ref().map(|v| v.to_lowercase().contains("arxiv")).unwrap_or(false);

            if is_arxiv {
                return "journalArticle";  // Treat arXiv preprints as journal articles
            }
        }
        return "document";
    }

    match csl_type_lower.as_str() {
        "article-journal" | "article" => "journalArticle",
        "book" => "book",
        "chapter" => "bookSection",
        "paper-conference" => "conferencePaper",
        "thesis" => "thesis",
        "report" => "report",
        "webpage" => "webpage",
        "article-newspaper" => "newspaperArticle",
        "article-magazine" => "magazineArticle",
        "patent" => "patent",
        "legislation" => "statute",
        "legal_case" => "case",
        _ => {
            // For any other unknown type, also check for arXiv
            if let Some(i) = item {
                let is_arxiv = i.url.as_ref().map(|v| v.contains("arxiv.org")).unwrap_or(false)
                    || i.doi.as_ref().map(|v| v.contains("arXiv") || v.contains("arxiv")).unwrap_or(false)
                    || i.publisher.as_ref().map(|v| v.to_lowercase().contains("arxiv")).unwrap_or(false);

                if is_arxiv {
                    return "journalArticle";
                }
            }
            "document"
        }
    }
}

/// Import CSL JSON content
#[tauri::command]
pub async fn import_csl_json(
    state: State<'_, AppState>,
    content: String,
) -> Result<CslJsonImportResult, String> {
    let mut imported = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    // Parse JSON - can be array or single object
    let items: Vec<CslJsonItem> = if content.trim().starts_with('[') {
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse CSL JSON: {}", e))?
    } else {
        let item: CslJsonItem = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse CSL JSON: {}", e))?;
        vec![item]
    };

    for item in items {
        // Get title
        let title = match &item.title {
            Some(t) if !t.is_empty() => t.clone(),
            _ => {
                skipped += 1;
                continue;
            }
        };

        // Check for duplicate by title
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM entries WHERE title = ? AND is_deleted = 0"
        )
        .bind(&title)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        if existing.is_some() {
            skipped += 1;
            continue;
        }

        // Map to item type (with arXiv detection)
        let item_type = item.item_type.as_deref()
            .map(|t| csl_type_to_item_type_with_item(t, Some(&item)))
            .unwrap_or_else(|| csl_type_to_item_type_with_item("", Some(&item)));

        // Get item type ID
        let item_type_id: i64 = match sqlx::query_scalar::<_, i64>(
            "SELECT id FROM item_types WHERE name = ?"
        )
        .bind(item_type)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(id)) => id,
            _ => {
                // Fallback to document
                sqlx::query_scalar::<_, i64>(
                    "SELECT id FROM item_types WHERE name = 'document'"
                )
                .fetch_one(&state.db)
                .await
                .map_err(|e| e.to_string())?
            }
        };

        // Generate key
        let entry_key = Uuid::new_v4().to_string();

        // Extract date from issued
        let date = item.issued.as_ref().and_then(|d| {
            if let Some(parts) = &d.date_parts {
                if let Some(first) = parts.first() {
                    return Some(match first.len() {
                        1 => first[0].to_string(),
                        2 => format!("{}-{:02}", first[0], first[1]),
                        _ => format!("{}-{:02}-{:02}", first[0], first.get(1).unwrap_or(&1), first.get(2).unwrap_or(&1)),
                    });
                }
            }
            d.raw.clone()
        });

        // Insert entry
        let entry_result = match sqlx::query(
            r#"
            INSERT INTO entries (key, item_type_id, title, date, url)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&entry_key)
        .bind(item_type_id)
        .bind(&title)
        .bind(&date)
        .bind(&item.url)
        .fetch_one(&state.db)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("Failed to insert entry '{}': {}", title, e));
                continue;
            }
        };

        let entry_id: i64 = entry_result.get("id");

        // Insert authors
        if let Some(authors) = &item.author {
            let author_creator_type_id: i64 = sqlx::query_scalar(
                "SELECT id FROM creator_types WHERE name = 'author'"
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(1);

            for (i, author) in authors.iter().enumerate() {
                let (first_name, last_name, name) = if let Some(literal) = &author.literal {
                    (None, None, Some(literal.clone()))
                } else {
                    (author.given.clone(), author.family.clone(), None)
                };

                let _ = sqlx::query(
                    r#"
                    INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    "#
                )
                .bind(entry_id)
                .bind(author_creator_type_id)
                .bind(&first_name)
                .bind(&last_name)
                .bind(&name)
                .bind(i as i32)
                .execute(&state.db)
                .await;
            }
        }

        // Insert editors
        if let Some(editors) = &item.editor {
            let editor_creator_type_id: i64 = sqlx::query_scalar(
                "SELECT id FROM creator_types WHERE name = 'editor'"
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(2);

            let start_order = item.author.as_ref().map(|a| a.len()).unwrap_or(0);
            for (i, editor) in editors.iter().enumerate() {
                let (first_name, last_name, name) = if let Some(literal) = &editor.literal {
                    (None, None, Some(literal.clone()))
                } else {
                    (editor.given.clone(), editor.family.clone(), None)
                };

                let _ = sqlx::query(
                    r#"
                    INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    "#
                )
                .bind(entry_id)
                .bind(editor_creator_type_id)
                .bind(&first_name)
                .bind(&last_name)
                .bind(&name)
                .bind((start_order + i) as i32)
                .execute(&state.db)
                .await;
            }
        }
        if let Err(e) = crate::commands::entries::refresh_entry_creators_sort(&state.db, entry_id).await {
            tracing::warn!("Failed to refresh creators_sort for entry {}: {}", entry_id, e);
        }

        // Insert additional fields
        let field_values: Vec<(&str, Option<String>)> = vec![
            ("publicationTitle", item.container_title.clone()),
            ("publisher", item.publisher.clone()),
            ("volume", item.volume.as_ref().map(|v| v.to_string())),
            ("issue", item.issue.as_ref().map(|i| i.to_string())),
            ("pages", item.page.clone()),
            ("DOI", item.doi.clone()),
            ("abstractNote", item.abstract_text.clone()),
            ("ISBN", item.isbn.clone()),
            ("ISSN", item.issn.clone()),
        ];

        for (field_name, value) in field_values {
            if let Some(val) = value {
                if !val.is_empty() {
                    if let Ok(Some(field_id)) = sqlx::query_scalar::<_, i64>(
                        "SELECT id FROM fields WHERE name = ?"
                    )
                    .bind(field_name)
                    .fetch_optional(&state.db)
                    .await
                    {
                        let _ = sqlx::query(
                            "INSERT OR REPLACE INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)"
                        )
                        .bind(entry_id)
                        .bind(field_id)
                        .bind(&val)
                        .execute(&state.db)
                        .await;
                    }
                }
            }
        }

        if let Err(e) = crate::commands::entries::refresh_entry_fts(&state.db, entry_id).await {
            tracing::warn!("Failed to refresh entries_fts for entry {}: {}", entry_id, e);
        }

        // Index entry metadata for full-text search
        let creators_str: String = item.author.as_ref()
            .map(|authors| {
                authors.iter()
                    .filter_map(|a| {
                        if let Some(lit) = &a.literal {
                            Some(lit.clone())
                        } else {
                            match (&a.given, &a.family) {
                                (Some(g), Some(f)) => Some(format!("{} {}", g, f)),
                                (None, Some(f)) => Some(f.clone()),
                                (Some(g), None) => Some(g.clone()),
                                _ => None,
                            }
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_default();

        let entry_metadata = EntryMetadata {
            entry_id,
            entry_key: entry_key.clone(),
            title: Some(title.clone()),
            creators: if creators_str.is_empty() { None } else { Some(creators_str) },
            abstract_text: item.abstract_text.clone(),
            item_type: item_type.to_string(),
        };

        if let Err(e) = state.search_index.index_entry_metadata(&entry_metadata).await {
            tracing::warn!("Failed to index entry metadata for {}: {}", entry_key, e);
        }

        imported += 1;
    }

    // Commit search index changes
    if let Err(e) = state.search_index.commit().await {
        tracing::error!("Failed to commit search index: {}", e);
    }

    Ok(CslJsonImportResult {
        imported,
        skipped,
        errors,
    })
}

// =====================================================
// BibLaTeX Import with Files (Zotero format)
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiblatexImportResult {
    pub imported: usize,
    pub skipped: usize,
    #[serde(rename = "filesImported")]
    pub files_imported: usize,
    #[serde(rename = "tagsCreated")]
    pub tags_created: usize,
    pub errors: Vec<String>,
}

// =====================================================
// BibLaTeX Preview (parse without importing)
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiblatexPreviewFile {
    pub title: String,
    pub path: String,
    pub mimetype: String,
    #[serde(rename = "attachmentType")]
    pub attachment_type: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiblatexPreviewEntry {
    #[serde(rename = "bibtexKey")]
    pub bibtex_key: String,
    pub title: String,
    #[serde(rename = "entryType")]
    pub entry_type: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
    pub creators: Vec<String>,
    pub year: Option<String>,
    pub tags: Vec<String>,
    pub files: Vec<BiblatexPreviewFile>,
    #[serde(rename = "isDuplicate")]
    pub is_duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiblatexPreviewResult {
    pub entries: Vec<BiblatexPreviewEntry>,
    #[serde(rename = "totalEntries")]
    pub total_entries: usize,
    #[serde(rename = "totalFiles")]
    pub total_files: usize,
    #[serde(rename = "duplicateCount")]
    pub duplicate_count: usize,
    #[serde(rename = "uniqueTags")]
    pub unique_tags: Vec<String>,
}

/// Preview BibLaTeX import without actually importing
/// Returns parsed entries with file info and duplicate detection
#[tauri::command]
pub async fn preview_biblatex_import(
    state: State<'_, AppState>,
    biblatex_path: String,
) -> Result<BiblatexPreviewResult, String> {
    let input_path = PathBuf::from(&biblatex_path);

    if !input_path.exists() {
        return Err(format!("Path not found: {}", biblatex_path));
    }

    // If input is a directory, find the .bib file inside it
    let bib_path = if input_path.is_dir() {
        let bib_files: Vec<PathBuf> = fs::read_dir(&input_path)
            .map_err(|e| format!("Failed to read directory: {}", e))?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase() == "bib")
                    .unwrap_or(false)
            })
            .collect();

        match bib_files.len() {
            0 => return Err("No .bib file found in the selected folder".to_string()),
            1 => bib_files.into_iter().next().unwrap(),
            _ => {
                let folder_name = input_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                bib_files.iter()
                    .find(|p| {
                        p.file_stem()
                            .and_then(|s| s.to_str())
                            .map(|s| s == "export" || s == folder_name)
                            .unwrap_or(false)
                    })
                    .cloned()
                    .or_else(|| bib_files.into_iter().next())
                    .ok_or_else(|| "Could not select .bib file".to_string())?
            }
        }
    } else {
        input_path.clone()
    };

    // Determine files base path
    let base_path = bib_path.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Could not determine base path".to_string())?;

    // Read the BibLaTeX file
    let content = fs::read_to_string(&bib_path)
        .map_err(|e| format!("Failed to read BibLaTeX file: {}", e))?;

    let mut entries = Vec::new();
    let mut all_tags = std::collections::HashSet::new();
    let mut total_files = 0;
    let mut duplicate_count = 0;

    // Parse the BibTeX content using the biblatex crate
    let bibliography = match Bibliography::parse(&content) {
        Ok(bib) => bib,
        Err(e) => {
            return Err(format!("Failed to parse BibLaTeX: {:?}", e));
        }
    };

    for entry in bibliography.iter() {
        let bibtex_key = entry.key.clone();

        // Get title - biblatex crate handles brace stripping
        let title = match entry.title() {
            Ok(chunks) => chunks_to_string(chunks),
            Err(_) => "Untitled".to_string(),
        };

        // Map to item type (with arXiv detection)
        let item_type = entry_type_to_item_type(entry);
        let entry_type = format!("{:?}", entry.entry_type).to_lowercase();
        tracing::info!("BibLaTeX preview: '{}' -> entry_type='{}' -> item_type='{}'", bibtex_key, entry_type, item_type);

        // Get year from date
        let year = entry.date().ok()
            .map(|d| {
                let chunks = d.to_chunks();
                chunks.iter().map(|c: &Spanned<Chunk>| c.v.get()).collect::<String>()
            })
            .or_else(|| get_field_string(entry, "year"));

        // Parse creators using biblatex crate's Person parsing
        let mut creators = Vec::new();
        if let Ok(authors) = entry.author() {
            for person in authors {
                // Just use the last name for preview display
                if !person.name.is_empty() {
                    creators.push(person.name.clone());
                } else if !person.given_name.is_empty() {
                    creators.push(person.given_name.clone());
                }
            }
        }

        // Parse tags/keywords
        let mut entry_tags = Vec::new();
        if let Some(keywords) = get_field_string(entry, "keywords") {
            for keyword in keywords.split(',') {
                let tag = keyword.trim().to_string();
                if !tag.is_empty() {
                    all_tags.insert(tag.clone());
                    entry_tags.push(tag);
                }
            }
        }

        // Parse files - get raw field value
        let mut files = Vec::new();
        if let Some(file_field) = get_field_string(entry, "file") {
            let parsed_files = parse_biblatex_file_field(&file_field);
            for (file_title, file_path, mimetype) in parsed_files {
                let attachment_type = get_attachment_type_from_mimetype(&mimetype, &file_path);

                // Check if file exists
                let full_path = base_path.join(&file_path);
                let exists = full_path.exists();

                files.push(BiblatexPreviewFile {
                    title: file_title,
                    path: file_path,
                    mimetype,
                    attachment_type: attachment_type.to_string(),
                    exists,
                });
                total_files += 1;
            }
        }

        // Check for duplicate by title
        let is_duplicate: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM entries WHERE title = ? AND is_deleted = 0"
        )
        .bind(&title)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

        if is_duplicate {
            duplicate_count += 1;
        }

        entries.push(BiblatexPreviewEntry {
            bibtex_key,
            title,
            entry_type,
            item_type: item_type.to_string(),
            creators,
            year,
            tags: entry_tags,
            files,
            is_duplicate,
        });
    }

    let mut unique_tags: Vec<String> = all_tags.into_iter().collect();
    unique_tags.sort();

    Ok(BiblatexPreviewResult {
        total_entries: entries.len(),
        total_files,
        duplicate_count,
        unique_tags,
        entries,
    })
}

/// Parse file field from BibLaTeX/Zotero format
/// Format: {title}:{path}:{mimetype};{title2}:{path2}:{mimetype2}
fn parse_biblatex_file_field(file_field: &str) -> Vec<(String, String, String)> {
    let mut files = Vec::new();

    // Split by semicolon for multiple files
    for file_entry in file_field.split(';') {
        let file_entry = file_entry.trim();
        if file_entry.is_empty() {
            continue;
        }

        // Split by colon - format is title:path:mimetype
        let parts: Vec<&str> = file_entry.splitn(3, ':').collect();
        if parts.len() >= 2 {
            let title = parts[0].trim().to_string();
            let path = parts[1].trim().to_string();
            let mimetype = parts.get(2).map(|s| s.trim().to_string()).unwrap_or_default();

            if !path.is_empty() {
                files.push((title, path, mimetype));
            }
        }
    }

    files
}

/// Determine attachment type from mimetype or file extension
fn get_attachment_type_from_mimetype(mimetype: &str, path: &str) -> &'static str {
    let mimetype_lower = mimetype.to_lowercase();
    let path_lower = path.to_lowercase();

    if mimetype_lower.contains("pdf") || path_lower.ends_with(".pdf") {
        "pdf"
    } else if mimetype_lower.contains("html") || path_lower.ends_with(".html") || path_lower.ends_with(".htm") {
        "snapshot"
    } else if mimetype_lower.contains("image") || path_lower.ends_with(".png") || path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg") {
        "image"
    } else if mimetype_lower.contains("epub") || path_lower.ends_with(".epub") {
        "epub"
    } else if mimetype_lower.contains("text") || path_lower.ends_with(".md") || path_lower.ends_with(".txt") {
        "note"
    } else {
        "generic"
    }
}

/// Import BibLaTeX with files (Zotero export format)
///
/// The `biblatex_path` can be either:
/// - A direct path to a .bib file
/// - A folder path containing a .bib file (will auto-detect)
///
/// Optional parameters:
/// - `selected_keys`: If provided, only import entries with these bibtex keys
/// - `import_tags`: Whether to import tags (default true)
/// - `excluded_files`: Map from bibtex key to list of file indices to exclude
/// - `collection_id`: Optional collection to add imported entries to
#[tauri::command]
pub async fn import_biblatex_with_files(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    biblatex_path: String,
    files_base_path: Option<String>,
    selected_keys: Option<Vec<String>>,
    import_tags: Option<bool>,
    excluded_files: Option<std::collections::HashMap<String, Vec<usize>>>,
    collection_id: Option<i64>,
) -> Result<BiblatexImportResult, String> {
    let selected_keys_set: Option<std::collections::HashSet<String>> = selected_keys
        .map(|keys| keys.into_iter().collect());
    let should_import_tags = import_tags.unwrap_or(true);
    let excluded_files_map = excluded_files.unwrap_or_default();
    let input_path = PathBuf::from(&biblatex_path);

    if !input_path.exists() {
        return Err(format!("Path not found: {}", biblatex_path));
    }

    // If input is a directory, find the .bib file inside it
    let bib_path = if input_path.is_dir() {
        // Look for .bib files in the directory
        let bib_files: Vec<PathBuf> = fs::read_dir(&input_path)
            .map_err(|e| format!("Failed to read directory: {}", e))?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase() == "bib")
                    .unwrap_or(false)
            })
            .collect();

        match bib_files.len() {
            0 => return Err("No .bib file found in the selected folder".to_string()),
            1 => bib_files.into_iter().next().unwrap(),
            _ => {
                // If multiple .bib files, prefer one named "export.bib" or the one matching folder name
                let folder_name = input_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                bib_files.iter()
                    .find(|p| {
                        p.file_stem()
                            .and_then(|s| s.to_str())
                            .map(|s| s == "export" || s == folder_name)
                            .unwrap_or(false)
                    })
                    .cloned()
                    .or_else(|| bib_files.into_iter().next())
                    .ok_or_else(|| "Could not select .bib file".to_string())?
            }
        }
    } else {
        input_path.clone()
    };

    // Read the BibLaTeX file
    let content = fs::read_to_string(&bib_path)
        .map_err(|e| format!("Failed to read BibLaTeX file: {}", e))?;

    // Determine files base path (directory containing .bib file or provided path)
    let base_path = files_base_path
        .map(PathBuf::from)
        .or_else(|| bib_path.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "Could not determine base path for files".to_string())?;

    let mut imported = 0;
    let mut skipped = 0;
    let mut files_imported = 0;
    let mut tags_created = 0;
    let mut errors = Vec::new();

    // Get library path
    let library_path = state.library_path.read().await;

    // Parse the BibTeX content using the biblatex crate
    let bibliography = match Bibliography::parse(&content) {
        Ok(bib) => bib,
        Err(e) => {
            return Err(format!("Failed to parse BibLaTeX: {:?}", e));
        }
    };

    let entries: Vec<_> = bibliography.iter().collect();
    let total_entries = if let Some(ref keys_set) = selected_keys_set {
        entries.iter().filter(|e| keys_set.contains(&e.key)).count()
    } else {
        entries.len()
    };
    let mut progress_index = 0usize;

    for entry in entries {
        let bibtex_key = entry.key.clone();

        // Map to item type (with arXiv detection)
        let item_type = entry_type_to_item_type(entry);
        let entry_type_str = format!("{:?}", entry.entry_type).to_lowercase();
        tracing::info!("BibLaTeX import: '{}' -> entry_type='{}' -> item_type='{}'", bibtex_key, entry_type_str, item_type);

        // If selected_keys is provided, skip entries not in the set
        if let Some(ref keys_set) = selected_keys_set {
            if !keys_set.contains(&bibtex_key) {
                skipped += 1;
                continue;
            }
        }

        // Get title - biblatex crate handles brace stripping automatically
        let title = match entry.title() {
            Ok(chunks) => chunks_to_string(chunks),
            Err(_) => "Untitled".to_string(),
        };

        progress_index += 1;
        let _ = app_handle.emit(
            "import:biblatex:progress",
            BiblatexImportProgress {
                current: progress_index,
                total: total_entries,
                current_key: bibtex_key.clone(),
                current_title: title.clone(),
            },
        );

        // Check for duplicate by title (simple dedup)
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM entries WHERE title = ? AND is_deleted = 0"
        )
        .bind(&title)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        if existing.is_some() {
            skipped += 1;
            continue;
        }

        // Get item type ID (item_type was already mapped above with arXiv detection)
        let item_type_id: i64 = match sqlx::query_scalar::<_, i64>(
            "SELECT id FROM item_types WHERE name = ?"
        )
        .bind(item_type)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(id)) => id,
            _ => {
                errors.push(format!("Unknown item type: {}", item_type));
                continue;
            }
        };

        // Generate key (use BibTeX key if clean, otherwise UUID)
        let entry_key = if bibtex_key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
            bibtex_key.clone()
        } else {
            Uuid::new_v4().to_string()
        };

        // Extract date using biblatex crate's date parsing
        let date = entry.date().ok()
            .map(|d| {
                let chunks = d.to_chunks();
                chunks.iter().map(|c: &Spanned<Chunk>| c.v.get()).collect::<String>()
            })
            .or_else(|| get_field_string(entry, "year"));
        let url = entry.url().ok();

        // Insert entry
        let entry_result = match sqlx::query(
            r#"
            INSERT INTO entries (key, item_type_id, title, date, url)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&entry_key)
        .bind(item_type_id)
        .bind(&title)
        .bind(&date)
        .bind(&url)
        .fetch_one(&state.db)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("Failed to insert entry '{}': {}", title, e));
                continue;
            }
        };

        let entry_id: i64 = entry_result.get("id");

        // Insert authors using biblatex crate's Person parsing
        if let Ok(authors) = entry.author() {
            let author_creator_type_id: i64 = sqlx::query_scalar(
                "SELECT id FROM creator_types WHERE name = 'author'"
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(1);

            for (i, person) in authors.iter().enumerate() {
                let first_name = if person.given_name.is_empty() { None } else { Some(person.given_name.clone()) };
                let last_name = if person.name.is_empty() { None } else { Some(person.name.clone()) };

                let _ = sqlx::query(
                    r#"
                    INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    "#
                )
                .bind(entry_id)
                .bind(author_creator_type_id)
                .bind(&first_name)
                .bind(&last_name)
                .bind(i as i32)
                .execute(&state.db)
                .await;
            }
        }

        // Insert additional fields - biblatex crate handles brace stripping
        let field_mappings = [
            ("journaltitle", "publicationTitle"),
            ("journal", "publicationTitle"),
            ("booktitle", "bookTitle"),
            ("publisher", "publisher"),
            ("volume", "volume"),
            ("number", "issue"),
            ("issue", "issue"),
            ("pages", "pages"),
            ("doi", "DOI"),
            ("isbn", "ISBN"),
            ("issn", "ISSN"),
            ("abstract", "abstractNote"),
            ("note", "extra"),
            ("eprint", "archiveID"),
            ("eprinttype", "archive"),
            ("location", "place"),
            ("edition", "edition"),
            ("series", "series"),
            ("shorttitle", "shortTitle"),
        ];

        for (bibtex_field, wren_field) in field_mappings {
            if let Some(value) = get_field_string(entry, bibtex_field) {
                // Get field ID
                if let Ok(Some(field_id)) = sqlx::query_scalar::<_, i64>(
                    "SELECT id FROM fields WHERE name = ?"
                )
                .bind(wren_field)
                .fetch_optional(&state.db)
                .await
                {
                    let _ = sqlx::query(
                        "INSERT OR REPLACE INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)"
                    )
                    .bind(entry_id)
                    .bind(field_id)
                    .bind(&value)
                    .execute(&state.db)
                    .await;
                }
            }
        }

        if let Err(e) = crate::commands::entries::refresh_entry_fts(&state.db, entry_id).await {
            tracing::warn!("Failed to refresh entries_fts for entry {}: {}", entry_id, e);
        }

        // Index entry metadata for full-text search
        let creators_str: String = entry.author()
            .ok()
            .map(|authors| {
                authors.iter()
                    .map(|p| {
                        if !p.name.is_empty() && !p.given_name.is_empty() {
                            format!("{} {}", p.given_name, p.name)
                        } else if !p.name.is_empty() {
                            p.name.clone()
                        } else {
                            p.given_name.clone()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_default();

        let abstract_text = get_field_string(entry, "abstract");

        let entry_metadata = EntryMetadata {
            entry_id,
            entry_key: entry_key.clone(),
            title: Some(title.clone()),
            creators: if creators_str.is_empty() { None } else { Some(creators_str) },
            abstract_text,
            item_type: item_type.to_string(),
        };

        if let Err(e) = state.search_index.index_entry_metadata(&entry_metadata).await {
            tracing::warn!("Failed to index entry metadata for {}: {}", entry_key, e);
        }

        // Handle keywords field - create tags (if enabled)
        if should_import_tags {
            if let Some(keywords_str) = get_field_string(entry, "keywords") {
                let keywords: Vec<&str> = keywords_str.split(',')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect();

                for keyword in keywords {
                    // Get or create tag (marking as imported)
                    let tag_id: i64 = match sqlx::query_scalar::<_, i64>(
                        "SELECT id FROM tags WHERE name = ? COLLATE NOCASE"
                    )
                    .bind(keyword)
                    .fetch_optional(&state.db)
                    .await
                    {
                        Ok(Some(id)) => {
                            // Mark existing tag as imported if it wasn't already
                            let _ = sqlx::query(
                                "UPDATE tags SET is_imported = 1 WHERE id = ? AND is_imported = 0"
                            )
                            .bind(id)
                            .execute(&state.db)
                            .await;
                            id
                        }
                        Ok(None) => {
                            // Create new tag (mark as imported)
                            let result = sqlx::query(
                                "INSERT INTO tags (name, is_imported) VALUES (?, 1) RETURNING id"
                            )
                            .bind(keyword)
                            .fetch_one(&state.db)
                            .await;

                            match result {
                                Ok(row) => {
                                    tags_created += 1;
                                    row.get("id")
                                }
                                Err(_) => continue,
                            }
                        }
                        Err(_) => continue,
                    };

                    // Link tag to entry
                    let _ = sqlx::query(
                        "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)"
                    )
                    .bind(entry_id)
                    .bind(tag_id)
                    .execute(&state.db)
                    .await;
                }
            }
        }

        // Handle file field - import associated files
        if let Some(file_field) = get_field_string(entry, "file") {
            let files = parse_biblatex_file_field(&file_field);
            let excluded_indices = excluded_files_map.get(&bibtex_key);

            // Check auto-rename setting once for all files
            let auto_rename = is_setting_enabled(&state.db, "auto_rename_files").await;
            let (rename_creators, rename_year) = if auto_rename {
                let creator_rows = sqlx::query(
                    r#"
                    SELECT ec.first_name, ec.last_name, ec.name, ct.name as creator_type, ec.sort_order
                    FROM entry_creators ec
                    JOIN creator_types ct ON ec.creator_type_id = ct.id
                    WHERE ec.entry_id = ?
                    ORDER BY ec.sort_order
                    "#
                )
                .bind(entry_id)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default();

                let creators: Vec<crate::db::models::Creator> = creator_rows
                    .iter()
                    .map(|row| crate::db::models::Creator {
                        id: None,
                        creator_type: row.get("creator_type"),
                        creator_type_display: None,
                        first_name: row.get("first_name"),
                        last_name: row.get("last_name"),
                        name: row.get("name"),
                        sort_order: row.get("sort_order"),
                    })
                    .collect();

                let year = date.as_ref().and_then(|d| filename::extract_year(d));
                (creators, year)
            } else {
                (Vec::new(), None)
            };

            for (file_index, (file_title, file_path, mimetype)) in files.into_iter().enumerate() {
                // Skip excluded files
                if let Some(indices) = excluded_indices {
                    if indices.contains(&file_index) {
                        continue;
                    }
                }
                // Resolve file path relative to base path
                let source_file = base_path.join(&file_path);

                if !source_file.exists() {
                    errors.push(format!("File not found: {} (for entry '{}')", file_path, title));
                    continue;
                }

                // Determine attachment type
                let attachment_type = get_attachment_type_from_mimetype(&mimetype, &file_path);

                // Get attachment type ID
                let attachment_type_id: i64 = match sqlx::query_scalar::<_, i64>(
                    "SELECT id FROM attachment_types WHERE name = ?"
                )
                .bind(attachment_type)
                .fetch_optional(&state.db)
                .await
                {
                    Ok(Some(id)) => id,
                    _ => continue,
                };

                // Create destination directory (all attachments go under files/{entry_key}/)
                let dest_dir = library_path.join("files").join(&entry_key);

                if let Err(e) = fs::create_dir_all(&dest_dir) {
                    errors.push(format!("Failed to create directory: {}", e));
                    continue;
                }

                // Get original filename
                let original_file_name = source_file.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("attachment_{}", Uuid::new_v4()));

                let dest_path = dest_dir.join(&original_file_name);

                // Copy file
                if let Err(e) = fs::copy(&source_file, &dest_path) {
                    errors.push(format!("Failed to copy file {}: {}", file_path, e));
                    continue;
                }

                // Calculate file hash and size
                let file_content = match fs::read(&dest_path) {
                    Ok(content) => content,
                    Err(e) => {
                        errors.push(format!("Failed to read copied file: {}", e));
                        continue;
                    }
                };

                let mut hasher = Sha256::new();
                hasher.update(&file_content);
                let file_hash = hex::encode(hasher.finalize());
                let file_size = file_content.len() as i64;

                // Get page count for PDFs
                let page_count: Option<i32> = if attachment_type == "pdf" {
                    pdf::extract_metadata(&dest_path).ok().map(|m| m.page_count)
                } else {
                    None
                };

                // Auto-rename file if setting is enabled
                let final_dest_path = if auto_rename {
                    let extension = source_file
                        .extension()
                        .map(|e| e.to_string_lossy().to_string())
                        .unwrap_or_else(|| "pdf".to_string());

                    let generated = filename::generate_filename(
                        &title,
                        &rename_creators,
                        rename_year.as_deref(),
                        &extension,
                    );

                    if !generated.is_empty() && generated != original_file_name {
                        let new_dest_path = filename::resolve_conflict(&dest_dir, &generated);
                        match fs::rename(&dest_path, &new_dest_path) {
                            Ok(_) => new_dest_path,
                            Err(e) => {
                                tracing::warn!("Failed to rename file during BibLaTeX import: {}", e);
                                dest_path
                            }
                        }
                    } else {
                        dest_path
                    }
                } else {
                    dest_path
                };

                // Generate attachment key
                let attachment_key = Uuid::new_v4().to_string();
                let final_dest_path_str = final_dest_path.to_string_lossy().to_string();

                // Insert attachment - use renamed filename as title if file was renamed
                let attachment_title = if auto_rename {
                    final_dest_path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| original_file_name.clone())
                } else if file_title.is_empty() {
                    original_file_name.clone()
                } else {
                    file_title
                };

                let attachment_result = sqlx::query(
                    r#"
                    INSERT INTO attachments (
                        key, entry_id, attachment_type_id, title,
                        file_path, file_hash, file_size, page_count
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    RETURNING id
                    "#
                )
                .bind(&attachment_key)
                .bind(entry_id)
                .bind(attachment_type_id)
                .bind(&attachment_title)
                .bind(&final_dest_path_str)
                .bind(&file_hash)
                .bind(file_size)
                .bind(page_count)
                .fetch_one(&state.db)
                .await;

                if let Ok(row) = attachment_result {
                    let attachment_id: i64 = row.get("id");

                    // Enqueue background OCR extraction job
                    let progress_file_name = final_dest_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();

                    if let Err(e) = state.job_queue.enqueue(
                        crate::jobs::types::JobType::OcrExtract,
                        Some(format!("Extract: {}", progress_file_name)),
                        serde_json::json!({ "attachmentId": attachment_id }),
                        0,
                    ).await {
                        tracing::warn!("Failed to enqueue OCR job for attachment {}: {}", attachment_id, e);
                    }

                    let _ = app_handle.emit(
                        "import:detail",
                        ImportDetailProgress {
                            file_name: progress_file_name.clone(),
                            step: "extracting".to_string(),
                            method: Some("background".to_string()),
                            status: "queued".to_string(),
                            message: Some("Text extraction queued as background task".to_string()),
                        },
                    );

                    files_imported += 1;
                }
            }
        }

        // Add entry to collection if specified
        if let Some(coll_id) = collection_id {
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO collection_entries (entry_id, collection_id) VALUES (?, ?)"
            )
            .bind(entry_id)
            .bind(coll_id)
            .execute(&state.db)
            .await;
        }

        imported += 1;
    }

    // Commit search index changes
    if let Err(e) = state.search_index.commit().await {
        tracing::error!("Failed to commit search index: {}", e);
    }

    tracing::info!(
        "BibLaTeX import complete: {} entries, {} files, {} tags, {} skipped",
        imported, files_imported, tags_created, skipped
    );

    Ok(BiblatexImportResult {
        imported,
        skipped,
        files_imported,
        tags_created,
        errors,
    })
}
