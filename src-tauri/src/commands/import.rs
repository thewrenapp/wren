use crate::pdf;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
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

        match import_single_pdf(&state, &source_path).await {
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
        match import_single_pdf(&state, &path).await {
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
    let dest_dir = library_path.join("files").join("pdfs").join(&entry_key);

    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_name = source_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.pdf", entry_key));

    let dest_path = dest_dir.join(&file_name);

    // Copy file to library
    fs::copy(source_path, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    let dest_path_str = dest_path.to_string_lossy().to_string();
    let file_size = file_content.len() as i64;

    // Convert author to JSON creators array
    let creators_json = metadata.author.as_ref().map(|author| {
        let creators: Vec<serde_json::Value> = author
            .split(';')
            .map(|name| name.trim())
            .filter(|name| !name.is_empty())
            .map(|name| {
                serde_json::json!({
                    "creatorType": "author",
                    "name": name
                })
            })
            .collect();
        serde_json::to_string(&creators).unwrap_or_default()
    });

    // Get entry type ID for journal_article (default for PDFs)
    let entry_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM entry_types WHERE name = 'journal_article'"
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

    // Insert entry
    let entry_result = sqlx::query(
        r#"
        INSERT INTO entries (key, entry_type_id, title, creators, abstract_text)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id, date_added, date_modified
        "#
    )
    .bind(&entry_key)
    .bind(entry_type_id)
    .bind(&title)
    .bind(&creators_json)
    .bind(&metadata.subject)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to insert entry: {}", e))?;

    let entry_id: i64 = entry_result.get("id");

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
    .bind(&title)
    .bind(&dest_path_str)
    .bind(&file_hash)
    .bind(file_size)
    .bind(metadata.page_count)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to insert attachment: {}", e))?;

    let attachment_id: i64 = attachment_result.get("id");

    tracing::info!("Imported PDF: {} (entry: {}, attachment: {})", title, entry_key, attachment_key);

    Ok(ImportResult {
        id: entry_id,
        key: entry_key,
        title,
        file_path: dest_path_str,
        entry_id,
        attachment_id,
        success: true,
        error: None,
    })
}
