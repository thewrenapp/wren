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

/// Import a single PDF file
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

    // Check for duplicate by hash
    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT item_id FROM pdf_items WHERE file_hash = ?"
    )
    .bind(&file_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    if let Some((existing_id,)) = existing {
        // Return existing item info
        let row = sqlx::query(
            "SELECT i.id, i.key, i.title, p.file_path
             FROM items i
             JOIN pdf_items p ON i.id = p.item_id
             WHERE i.id = ?"
        )
        .bind(existing_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        return Ok(ImportResult {
            id: row.get("id"),
            key: row.get("key"),
            title: row.get("title"),
            file_path: row.get("file_path"),
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

    // Generate unique key
    let key = Uuid::new_v4().to_string();

    // Create destination path
    let library_path = state.library_path.read().await;
    let dest_dir = library_path.join("files").join("pdfs").join(&key);

    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_name = source_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.pdf", key));

    let dest_path = dest_dir.join(&file_name);

    // Copy file to library
    fs::copy(source_path, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    let dest_path_str = dest_path.to_string_lossy().to_string();
    let file_size = file_content.len() as i64;

    // Insert into database - items table first
    let result = sqlx::query(
        r#"
        INSERT INTO items (key, item_type_id, title)
        VALUES (?, 1, ?)
        RETURNING id, date_added, date_modified
        "#
    )
    .bind(&key)
    .bind(&title)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to insert item: {}", e))?;

    let item_id: i64 = result.get("id");

    // Insert PDF-specific data
    sqlx::query(
        r#"
        INSERT INTO pdf_items (
            item_id, file_path, file_hash, file_size, page_count,
            author, abstract_text, keywords
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#
    )
    .bind(item_id)
    .bind(&dest_path_str)
    .bind(&file_hash)
    .bind(file_size)
    .bind(metadata.page_count)
    .bind(&metadata.author)
    .bind(&metadata.subject)
    .bind(&metadata.keywords)
    .execute(&state.db)
    .await
    .map_err(|e| format!("Failed to insert PDF data: {}", e))?;

    tracing::info!("Imported PDF: {} ({})", title, key);

    Ok(ImportResult {
        id: item_id,
        key,
        title,
        file_path: dest_path_str,
        success: true,
        error: None,
    })
}
