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

// =====================================================
// BibTeX Import
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibtexImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// Parse a BibTeX entry from content
fn parse_bibtex_entry(content: &str) -> Option<(String, String, std::collections::HashMap<String, String>)> {
    // Find entry type and key: @article{key,
    let content = content.trim();
    if !content.starts_with('@') {
        return None;
    }

    // Find the entry type
    let brace_pos = content.find('{')?;
    let entry_type = content[1..brace_pos].trim().to_lowercase();

    // Find the key (ends at first comma or newline)
    let after_brace = &content[brace_pos + 1..];
    let key_end = after_brace.find(|c| c == ',' || c == '\n')?;
    let key = after_brace[..key_end].trim().to_string();

    // Parse fields
    let mut fields = std::collections::HashMap::new();
    let fields_section = &after_brace[key_end + 1..];

    // Simple field parser: field = {value} or field = "value" or field = value
    let mut remaining = fields_section;
    while !remaining.is_empty() {
        remaining = remaining.trim_start();
        if remaining.starts_with('}') {
            break;
        }

        // Find field name
        if let Some(eq_pos) = remaining.find('=') {
            let field_name = remaining[..eq_pos].trim().to_lowercase();
            remaining = remaining[eq_pos + 1..].trim_start();

            // Parse value
            let (value, rest) = if remaining.starts_with('{') {
                parse_braced_value(&remaining[1..])
            } else if remaining.starts_with('"') {
                parse_quoted_value(&remaining[1..])
            } else {
                parse_bare_value(remaining)
            };

            if !field_name.is_empty() && !value.is_empty() {
                fields.insert(field_name, value);
            }
            remaining = rest.trim_start();

            // Skip comma
            if remaining.starts_with(',') {
                remaining = &remaining[1..];
            }
        } else {
            break;
        }
    }

    Some((entry_type, key, fields))
}

fn parse_braced_value(s: &str) -> (String, &str) {
    let mut depth = 1;
    let mut end = 0;
    let chars: Vec<char> = s.chars().collect();

    while end < chars.len() && depth > 0 {
        if chars[end] == '{' {
            depth += 1;
        } else if chars[end] == '}' {
            depth -= 1;
        }
        if depth > 0 {
            end += 1;
        }
    }

    let value: String = chars[..end].iter().collect();
    let rest: String = chars[end + 1..].iter().collect();
    (value.trim().to_string(), Box::leak(rest.into_boxed_str()))
}

fn parse_quoted_value(s: &str) -> (String, &str) {
    let mut end = 0;
    let chars: Vec<char> = s.chars().collect();

    while end < chars.len() && chars[end] != '"' {
        if chars[end] == '\\' && end + 1 < chars.len() {
            end += 2;
        } else {
            end += 1;
        }
    }

    let value: String = chars[..end].iter().collect();
    let rest: String = chars[end + 1..].iter().collect();
    (value.trim().to_string(), Box::leak(rest.into_boxed_str()))
}

fn parse_bare_value(s: &str) -> (String, &str) {
    let end = s.find(|c| c == ',' || c == '}' || c == '\n').unwrap_or(s.len());
    let value = s[..end].trim().to_string();
    (value, &s[end..])
}

/// Map BibTeX entry type to Wren item type
fn bibtex_type_to_item_type(entry_type: &str) -> &'static str {
    match entry_type {
        "article" => "journalArticle",
        "book" => "book",
        "inbook" | "incollection" => "bookSection",
        "inproceedings" | "conference" => "conferencePaper",
        "phdthesis" | "mastersthesis" => "thesis",
        "techreport" => "report",
        "misc" | "unpublished" => "document",
        "manual" => "document",
        "proceedings" => "book",
        "booklet" => "document",
        _ => "document",
    }
}

/// Import BibTeX content
#[tauri::command]
pub async fn import_bibtex(
    state: State<'_, AppState>,
    content: String,
) -> Result<BibtexImportResult, String> {
    let mut imported = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    // Split content into entries (each starts with @)
    let entries: Vec<&str> = content.split("\n@")
        .enumerate()
        .map(|(i, s)| if i == 0 && s.starts_with('@') { s } else if i > 0 { &s[..] } else { s })
        .filter(|s| !s.trim().is_empty())
        .collect();

    for (idx, entry_str) in entries.iter().enumerate() {
        let entry_content = if idx == 0 {
            entry_str.to_string()
        } else {
            format!("@{}", entry_str)
        };

        let parsed = match parse_bibtex_entry(&entry_content) {
            Some(p) => p,
            None => {
                skipped += 1;
                continue;
            }
        };

        let (entry_type, _bibtex_key, fields) = parsed;

        // Get title
        let title = fields.get("title")
            .cloned()
            .unwrap_or_else(|| "Untitled".to_string());

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

        // Map to item type
        let item_type = bibtex_type_to_item_type(&entry_type);

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

        // Extract date/year
        let date = fields.get("year").cloned();
        let url = fields.get("url").cloned();

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

        // Insert authors
        if let Some(authors_str) = fields.get("author") {
            let author_creator_type_id: i64 = sqlx::query_scalar(
                "SELECT id FROM creator_types WHERE name = 'author'"
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(1);

            // Parse authors (split by " and ")
            let authors: Vec<&str> = authors_str.split(" and ")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();

            for (i, author) in authors.iter().enumerate() {
                // Try to parse "Last, First" format
                let (first_name, last_name) = if author.contains(',') {
                    let parts: Vec<&str> = author.splitn(2, ',').collect();
                    (parts.get(1).map(|s| s.trim().to_string()), parts.first().map(|s| s.trim().to_string()))
                } else {
                    // "First Last" format
                    let parts: Vec<&str> = author.rsplitn(2, ' ').collect();
                    if parts.len() == 2 {
                        (Some(parts[1].to_string()), Some(parts[0].to_string()))
                    } else {
                        (None, Some(author.to_string()))
                    }
                };

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

        // Insert additional fields
        let field_mappings = [
            ("journal", "publicationTitle"),
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
            if let Some(value) = fields.get(bibtex_field) {
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
                    .bind(value)
                    .execute(&state.db)
                    .await;
                }
            }
        }

        imported += 1;
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

/// Map CSL JSON type to Wren item type
fn csl_type_to_item_type(csl_type: &str) -> &'static str {
    match csl_type {
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
        _ => "document",
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

        // Map to item type
        let item_type = item.item_type.as_deref()
            .map(csl_type_to_item_type)
            .unwrap_or("document");

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

        imported += 1;
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

    // Split content into entries
    let raw_entries: Vec<&str> = content.split("\n@")
        .enumerate()
        .map(|(i, s)| if i == 0 && s.starts_with('@') { s } else if i > 0 { &s[..] } else { s })
        .filter(|s| !s.trim().is_empty())
        .collect();

    for (idx, entry_str) in raw_entries.iter().enumerate() {
        let entry_content = if idx == 0 {
            entry_str.to_string()
        } else {
            format!("@{}", entry_str)
        };

        let parsed = match parse_bibtex_entry(&entry_content) {
            Some(p) => p,
            None => continue,
        };

        let (entry_type, bibtex_key, fields) = parsed;

        // Get title
        let title = fields.get("title")
            .cloned()
            .unwrap_or_else(|| "Untitled".to_string())
            .replace("\\textbackslash", "\\")
            .replace("\\{", "{")
            .replace("\\}", "}")
            .replace("\\$", "$");

        // Map to item type
        let item_type = biblatex_type_to_item_type(&entry_type);

        // Get year
        let year = fields.get("year").or_else(|| fields.get("date")).cloned();

        // Parse creators
        let mut creators = Vec::new();
        if let Some(author) = fields.get("author") {
            for name in author.split(" and ") {
                let name = name.trim();
                if !name.is_empty() {
                    // Simple name formatting - last name first if comma present
                    let formatted = if name.contains(',') {
                        name.split(',').next().unwrap_or(name).trim().to_string()
                    } else {
                        name.split_whitespace().last().unwrap_or(name).to_string()
                    };
                    creators.push(formatted);
                }
            }
        }

        // Parse tags/keywords
        let mut entry_tags = Vec::new();
        if let Some(keywords) = fields.get("keywords") {
            for keyword in keywords.split(',') {
                let tag = keyword.trim().to_string();
                if !tag.is_empty() {
                    all_tags.insert(tag.clone());
                    entry_tags.push(tag);
                }
            }
        }

        // Parse files
        let mut files = Vec::new();
        if let Some(file_field) = fields.get("file") {
            let parsed_files = parse_biblatex_file_field(file_field);
            for (file_title, file_path, mimetype) in parsed_files {
                let attachment_type = get_attachment_type_from_mimetype(&mimetype, &file_path);

                // Check if file exists
                let full_path = base_path.join("files").join(&file_path);
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
    } else if mimetype_lower.contains("text") || path_lower.ends_with(".md") || path_lower.ends_with(".txt") {
        "note"
    } else {
        "generic"
    }
}

/// Map BibLaTeX entry type to Wren item type (extended from bibtex)
/// Handles standard BibTeX, BibLaTeX, and Zotero-specific types
fn biblatex_type_to_item_type(entry_type: &str) -> &'static str {
    // Normalize to lowercase for matching
    let entry_type_lower = entry_type.to_lowercase();
    match entry_type_lower.as_str() {
        // Journal/Article types
        "article" | "periodical" => "journalArticle",

        // Book types
        "book" | "mvbook" | "collection" | "mvcollection" | "reference" | "mvreference" => "book",

        // Book section types
        "inbook" | "incollection" | "inreference" | "bookinbook" | "suppbook" => "bookSection",

        // Conference/Proceedings
        "inproceedings" | "conference" | "proceedings" | "mvproceedings" => "conferencePaper",

        // Thesis types
        "phdthesis" | "mastersthesis" | "thesis" => "thesis",

        // Report types
        "techreport" | "report" => "report",

        // Web/Online types
        "online" | "electronic" | "www" => "webpage",

        // Software
        "software" | "misc" if entry_type_lower.contains("software") => "computerProgram",

        // Dataset
        "dataset" | "data" => "dataset",

        // Patent
        "patent" => "patent",

        // Media types
        "video" | "movie" | "film" => "film",
        "audio" | "music" => "audioRecording",

        // News/Magazine
        "newspaper" | "news" => "newspaperArticle",
        "magazine" => "magazineArticle",

        // Legal
        "legislation" | "legal" => "statute",
        "jurisdiction" | "case" => "case",

        // Letter/Communication
        "letter" => "letter",

        // Preprint
        "preprint" | "unpublished" => "preprint",

        // Manual/Documentation
        "manual" | "booklet" => "document",

        // Misc - default
        "misc" | "other" => "document",

        // Fallback - log unknown types for debugging
        _ => {
            eprintln!("Unknown BibLaTeX entry type: '{}', defaulting to 'document'", entry_type);
            "document"
        }
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
#[tauri::command]
pub async fn import_biblatex_with_files(
    state: State<'_, AppState>,
    biblatex_path: String,
    files_base_path: Option<String>,
    selected_keys: Option<Vec<String>>,
    import_tags: Option<bool>,
) -> Result<BiblatexImportResult, String> {
    let selected_keys_set: Option<std::collections::HashSet<String>> = selected_keys
        .map(|keys| keys.into_iter().collect());
    let should_import_tags = import_tags.unwrap_or(true);
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

    // Split content into entries (each starts with @)
    let entries: Vec<&str> = content.split("\n@")
        .enumerate()
        .map(|(i, s)| if i == 0 && s.starts_with('@') { s } else if i > 0 { &s[..] } else { s })
        .filter(|s| !s.trim().is_empty())
        .collect();

    for (idx, entry_str) in entries.iter().enumerate() {
        let entry_content = if idx == 0 {
            entry_str.to_string()
        } else {
            format!("@{}", entry_str)
        };

        let parsed = match parse_bibtex_entry(&entry_content) {
            Some(p) => p,
            None => {
                skipped += 1;
                continue;
            }
        };

        let (entry_type, bibtex_key, fields) = parsed;

        // If selected_keys is provided, skip entries not in the set
        if let Some(ref keys_set) = selected_keys_set {
            if !keys_set.contains(&bibtex_key) {
                skipped += 1;
                continue;
            }
        }

        // Get title
        let title = fields.get("title")
            .cloned()
            .unwrap_or_else(|| "Untitled".to_string())
            // Clean up LaTeX escapes
            .replace("\\textbackslash", "\\")
            .replace("\\{", "{")
            .replace("\\}", "}")
            .replace("\\$", "$");

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

        // Map to item type
        let item_type = biblatex_type_to_item_type(&entry_type);

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

        // Generate key (use BibTeX key if clean, otherwise UUID)
        let entry_key = if bibtex_key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
            bibtex_key.clone()
        } else {
            Uuid::new_v4().to_string()
        };

        // Extract date (BibLaTeX uses 'date' field, fallback to 'year')
        let date = fields.get("date")
            .or_else(|| fields.get("year"))
            .cloned();
        let url = fields.get("url").cloned();

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

        // Insert authors
        if let Some(authors_str) = fields.get("author") {
            let author_creator_type_id: i64 = sqlx::query_scalar(
                "SELECT id FROM creator_types WHERE name = 'author'"
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(1);

            // Parse authors (split by " and ")
            let authors: Vec<&str> = authors_str.split(" and ")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();

            for (i, author) in authors.iter().enumerate() {
                // Try to parse "Last, First" format
                let (first_name, last_name) = if author.contains(',') {
                    let parts: Vec<&str> = author.splitn(2, ',').collect();
                    (parts.get(1).map(|s| s.trim().to_string()), parts.first().map(|s| s.trim().to_string()))
                } else {
                    // "First Last" format
                    let parts: Vec<&str> = author.rsplitn(2, ' ').collect();
                    if parts.len() == 2 {
                        (Some(parts[1].to_string()), Some(parts[0].to_string()))
                    } else {
                        (None, Some(author.to_string()))
                    }
                };

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

        // Insert additional fields (BibLaTeX field names)
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
            if let Some(value) = fields.get(bibtex_field) {
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
                    .bind(value)
                    .execute(&state.db)
                    .await;
                }
            }
        }

        // Handle keywords field - create tags (if enabled)
        if should_import_tags {
            if let Some(keywords_str) = fields.get("keywords") {
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
        if let Some(file_field) = fields.get("file") {
            let files = parse_biblatex_file_field(file_field);

            for (file_title, file_path, mimetype) in files {
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

                // Create destination directory
                let dest_subdir = if attachment_type == "pdf" { "pdfs" } else { "attachments" };
                let dest_dir = library_path.join("files").join(dest_subdir).join(&entry_key);

                if let Err(e) = fs::create_dir_all(&dest_dir) {
                    errors.push(format!("Failed to create directory: {}", e));
                    continue;
                }

                // Get original filename
                let file_name = source_file.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("attachment_{}", Uuid::new_v4()));

                let dest_path = dest_dir.join(&file_name);

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

                // Generate attachment key
                let attachment_key = Uuid::new_v4().to_string();
                let dest_path_str = dest_path.to_string_lossy().to_string();

                // Insert attachment
                let attachment_title = if file_title.is_empty() {
                    file_name.clone()
                } else {
                    file_title
                };

                let _ = sqlx::query(
                    r#"
                    INSERT INTO attachments (
                        key, entry_id, attachment_type_id, title,
                        file_path, file_hash, file_size, page_count
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    "#
                )
                .bind(&attachment_key)
                .bind(entry_id)
                .bind(attachment_type_id)
                .bind(&attachment_title)
                .bind(&dest_path_str)
                .bind(&file_hash)
                .bind(file_size)
                .bind(page_count)
                .execute(&state.db)
                .await;

                files_imported += 1;
            }
        }

        imported += 1;
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
