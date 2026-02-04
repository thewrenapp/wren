use crate::state::AppState;
use biblatex::{Chunk, Entry, EntryType, Person, Spanned};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

// =====================================================
// CSL JSON TYPES (Citation Style Language)
// =====================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct CslJson {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub title: Option<String>,
    pub author: Option<Vec<CslName>>,
    pub editor: Option<Vec<CslName>>,
    pub translator: Option<Vec<CslName>>,
    pub issued: Option<CslDate>,
    #[serde(rename = "container-title")]
    pub container_title: Option<String>,
    pub publisher: Option<String>,
    #[serde(rename = "publisher-place")]
    pub publisher_place: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub page: Option<String>,
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
    #[serde(rename = "ISBN")]
    pub isbn: Option<String>,
    #[serde(rename = "ISSN")]
    pub issn: Option<String>,
    #[serde(rename = "URL")]
    pub url: Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_: Option<String>,
    pub language: Option<String>,
    #[serde(rename = "number-of-pages")]
    pub number_of_pages: Option<String>,
    pub edition: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CslName {
    pub family: Option<String>,
    pub given: Option<String>,
    pub literal: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CslDate {
    #[serde(rename = "date-parts")]
    pub date_parts: Option<Vec<Vec<i32>>>,
    pub raw: Option<String>,
}

// =====================================================
// ITEM TYPE MAPPING (Zotero -> CSL)
// =====================================================

fn item_type_to_csl(item_type: &str) -> &str {
    match item_type {
        "journalArticle" => "article-journal",
        "book" => "book",
        "bookSection" => "chapter",
        "conferencePaper" => "paper-conference",
        "thesis" => "thesis",
        "report" => "report",
        "preprint" => "article",
        "webpage" => "webpage",
        "blogPost" => "post-weblog",
        "magazineArticle" => "article-magazine",
        "newspaperArticle" => "article-newspaper",
        "computerProgram" => "software",
        "document" => "document",
        "dataset" => "dataset",
        "patent" => "patent",
        "artwork" => "graphic",
        "film" => "motion_picture",
        "podcast" => "song",
        "videoRecording" => "motion_picture",
        "audioRecording" => "song",
        "presentation" => "speech",
        "letter" => "personal_communication",
        "email" => "personal_communication",
        "map" => "map",
        "bill" => "bill",
        "case" => "legal_case",
        "statute" => "legislation",
        "hearing" => "hearing",
        "interview" => "interview",
        _ => "document",
    }
}

fn creator_type_to_csl_role(creator_type: &str) -> &str {
    match creator_type {
        "author" => "author",
        "editor" => "editor",
        "translator" => "translator",
        "seriesEditor" => "collection-editor",
        "bookAuthor" => "container-author",
        "composer" => "composer",
        "director" => "director",
        "interviewee" => "author",
        "interviewer" => "interviewer",
        "performer" => "author",
        "podcaster" => "author",
        "presenter" => "author",
        "producer" => "author",
        "programmer" => "author",
        "recipient" => "recipient",
        "reviewedAuthor" => "reviewed-author",
        "scriptwriter" => "author",
        "contributor" => "author",
        _ => "author",
    }
}

// =====================================================
// BIBLATEX CRATE HELPERS FOR EXPORT
// =====================================================

/// Map Wren item type to biblatex EntryType
fn item_type_to_bibtex_entry_type(item_type: &str) -> EntryType {
    match item_type {
        "journalArticle" => EntryType::Article,
        "book" => EntryType::Book,
        "bookSection" => EntryType::InCollection,
        "conferencePaper" => EntryType::InProceedings,
        "thesis" => EntryType::PhdThesis,
        "report" => EntryType::TechReport,
        "preprint" => EntryType::Unpublished,
        "webpage" => EntryType::Online,
        "computerProgram" => EntryType::Software,
        "dataset" => EntryType::Dataset,
        "patent" => EntryType::Patent,
        _ => EntryType::Misc,
    }
}

/// Map Wren item type to biblatex EntryType for BibLaTeX export
fn item_type_to_biblatex_entry_type(item_type: &str) -> EntryType {
    match item_type {
        "journalArticle" => EntryType::Article,
        "book" => EntryType::Book,
        "bookSection" => EntryType::InCollection,
        "conferencePaper" => EntryType::InProceedings,
        "thesis" => EntryType::Thesis,
        "report" => EntryType::Report,
        "preprint" => EntryType::Unpublished,
        "webpage" => EntryType::Online,
        "computerProgram" => EntryType::Software,
        "dataset" => EntryType::Dataset,
        "patent" => EntryType::Patent,
        _ => EntryType::Misc,
    }
}

/// Create a biblatex Person from first/last name or literal name
fn create_person(first_name: Option<String>, last_name: Option<String>, literal_name: Option<String>) -> Option<Person> {
    if let Some(literal) = literal_name {
        // Institution or single-field name
        Some(Person {
            name: literal,
            given_name: String::new(),
            prefix: String::new(),
            suffix: String::new(),
        })
    } else {
        match (last_name, first_name) {
            (Some(ln), Some(fn_)) => Some(Person {
                name: ln,
                given_name: fn_,
                prefix: String::new(),
                suffix: String::new(),
            }),
            (Some(ln), None) => Some(Person {
                name: ln,
                given_name: String::new(),
                prefix: String::new(),
                suffix: String::new(),
            }),
            (None, Some(fn_)) => Some(Person {
                name: fn_,
                given_name: String::new(),
                prefix: String::new(),
                suffix: String::new(),
            }),
            (None, None) => None,
        }
    }
}

/// Create chunks from a string value
fn string_to_chunks(value: &str) -> Vec<Spanned<Chunk>> {
    vec![Spanned::detached(Chunk::Normal(value.to_string()))]
}

// =====================================================
// EXPORT COMMANDS
// =====================================================

/// Export entries to CSL JSON format
#[tauri::command]
pub async fn export_to_csl_json(
    state: State<'_, AppState>,
    entry_ids: Vec<i64>,
) -> Result<String, String> {
    let mut csl_items = Vec::new();

    for entry_id in entry_ids {
        // Get entry
        let entry_row = sqlx::query(
            r#"
            SELECT
                e.id, e.key, it.name as item_type, e.title, e.date, e.url,
                e.access_date, e.date_added, e.date_modified,
                it.display_name as item_type_display
            FROM entries e
            JOIN item_types it ON e.item_type_id = it.id
            WHERE e.id = ? AND e.is_deleted = 0
            "#
        )
        .bind(entry_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let entry_row = match entry_row {
            Some(row) => row,
            None => continue,
        };

        let key: String = entry_row.get("key");
        let item_type: String = entry_row.get("item_type");
        let title: String = entry_row.get("title");
        let date: Option<String> = entry_row.get("date");
        let url: Option<String> = entry_row.get("url");

        // Get fields
        let field_rows: Vec<(String, String)> = sqlx::query_as(
            r#"
            SELECT f.name as field_name, ef.value
            FROM entry_fields ef
            JOIN fields f ON ef.field_id = f.id
            WHERE ef.entry_id = ?
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let mut fields: HashMap<String, String> = HashMap::new();
        for (name, value) in field_rows {
            fields.insert(name, value);
        }

        // Get creators
        let creator_rows: Vec<(String, Option<String>, Option<String>, Option<String>, i32)> = sqlx::query_as(
            r#"
            SELECT ct.name as creator_type, ec.first_name, ec.last_name, ec.name, ec.sort_order
            FROM entry_creators ec
            JOIN creator_types ct ON ec.creator_type_id = ct.id
            WHERE ec.entry_id = ?
            ORDER BY ec.sort_order
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Group creators by role
        let mut authors = Vec::new();
        let mut editors = Vec::new();
        let mut translators = Vec::new();

        for (creator_type, first_name, last_name, name, _) in creator_rows {
            let csl_name = if let Some(literal) = name {
                CslName {
                    family: None,
                    given: None,
                    literal: Some(literal),
                }
            } else {
                CslName {
                    family: last_name,
                    given: first_name,
                    literal: None,
                }
            };

            match creator_type_to_csl_role(&creator_type) {
                "editor" => editors.push(csl_name),
                "translator" => translators.push(csl_name),
                _ => authors.push(csl_name),
            }
        }

        // Parse date
        let issued = date.map(|d| {
            let parts: Vec<&str> = d.split('-').collect();
            let date_parts: Vec<i32> = parts
                .iter()
                .filter_map(|p| p.parse().ok())
                .collect();

            CslDate {
                date_parts: if date_parts.is_empty() {
                    None
                } else {
                    Some(vec![date_parts])
                },
                raw: Some(d),
            }
        });

        let csl_item = CslJson {
            id: key,
            item_type: item_type_to_csl(&item_type).to_string(),
            title: Some(title),
            author: if authors.is_empty() { None } else { Some(authors) },
            editor: if editors.is_empty() { None } else { Some(editors) },
            translator: if translators.is_empty() { None } else { Some(translators) },
            issued,
            container_title: fields.get("publicationTitle").or(fields.get("journalAbbreviation")).cloned(),
            publisher: fields.get("publisher").cloned(),
            publisher_place: fields.get("place").cloned(),
            volume: fields.get("volume").cloned(),
            issue: fields.get("issue").cloned(),
            page: fields.get("pages").cloned(),
            doi: fields.get("DOI").cloned(),
            isbn: fields.get("ISBN").cloned(),
            issn: fields.get("ISSN").cloned(),
            url,
            abstract_: fields.get("abstractNote").cloned(),
            language: fields.get("language").cloned(),
            number_of_pages: fields.get("numPages").cloned(),
            edition: fields.get("edition").cloned(),
            note: fields.get("extra").cloned(),
        };

        csl_items.push(csl_item);
    }

    serde_json::to_string_pretty(&csl_items).map_err(|e| e.to_string())
}

/// Export entries to BibTeX format using the biblatex crate
#[tauri::command]
pub async fn export_to_bibtex(
    state: State<'_, AppState>,
    entry_ids: Vec<i64>,
) -> Result<String, String> {
    let mut bibtex_entries = Vec::new();

    for entry_id in entry_ids {
        // Get entry
        let entry_row = sqlx::query(
            r#"
            SELECT
                e.id, e.key, it.name as item_type, e.title, e.date, e.url,
                e.access_date, e.date_added, e.date_modified
            FROM entries e
            JOIN item_types it ON e.item_type_id = it.id
            WHERE e.id = ? AND e.is_deleted = 0
            "#
        )
        .bind(entry_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let entry_row = match entry_row {
            Some(row) => row,
            None => continue,
        };

        let key: String = entry_row.get("key");
        let item_type: String = entry_row.get("item_type");
        let title: String = entry_row.get("title");
        let date: Option<String> = entry_row.get("date");
        let url: Option<String> = entry_row.get("url");

        // Get fields
        let field_rows: Vec<(String, String)> = sqlx::query_as(
            r#"
            SELECT f.name as field_name, ef.value
            FROM entry_fields ef
            JOIN fields f ON ef.field_id = f.id
            WHERE ef.entry_id = ?
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let mut fields: HashMap<String, String> = HashMap::new();
        for (name, value) in field_rows {
            fields.insert(name, value);
        }

        // Get creators
        let creator_rows: Vec<(String, Option<String>, Option<String>, Option<String>, i32)> = sqlx::query_as(
            r#"
            SELECT ct.name as creator_type, ec.first_name, ec.last_name, ec.name, ec.sort_order
            FROM entry_creators ec
            JOIN creator_types ct ON ec.creator_type_id = ct.id
            WHERE ec.entry_id = ?
            ORDER BY ec.sort_order
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Create biblatex Entry
        let entry_type = item_type_to_bibtex_entry_type(&item_type);
        let mut bib_entry = Entry::new(key, entry_type);

        // Set title
        bib_entry.set("title", string_to_chunks(&title));

        // Set authors and editors using biblatex Person type
        let mut authors: Vec<Person> = Vec::new();
        let mut editors: Vec<Person> = Vec::new();

        for (creator_type, first_name, last_name, name, _) in creator_rows {
            if let Some(person) = create_person(first_name, last_name, name) {
                if creator_type == "editor" {
                    editors.push(person);
                } else {
                    authors.push(person);
                }
            }
        }

        if !authors.is_empty() {
            bib_entry.set_as("author", &authors);
        }
        if !editors.is_empty() {
            bib_entry.set_as("editor", &editors);
        }

        // Set date (biblatex crate handles date->year conversion for BibTeX output)
        if let Some(d) = &date {
            bib_entry.set("date", string_to_chunks(d));
        }

        // Set journal/booktitle based on entry type
        if let Some(journal) = fields.get("publicationTitle") {
            // Use journaltitle for BibLaTeX - the crate converts to journal for BibTeX
            bib_entry.set("journaltitle", string_to_chunks(journal));
        }

        // Set other fields
        if let Some(volume) = fields.get("volume") {
            bib_entry.set("volume", string_to_chunks(volume));
        }
        if let Some(issue) = fields.get("issue") {
            bib_entry.set("number", string_to_chunks(issue));
        }
        if let Some(pages) = fields.get("pages") {
            bib_entry.set("pages", string_to_chunks(pages));
        }
        if let Some(publisher) = fields.get("publisher") {
            bib_entry.set("publisher", string_to_chunks(publisher));
        }
        if let Some(place) = fields.get("place") {
            bib_entry.set("location", string_to_chunks(place));
        }
        if let Some(doi) = fields.get("DOI") {
            bib_entry.set("doi", string_to_chunks(doi));
        }
        if let Some(isbn) = fields.get("ISBN") {
            bib_entry.set("isbn", string_to_chunks(isbn));
        }
        if let Some(u) = &url {
            bib_entry.set("url", string_to_chunks(u));
        }
        if let Some(abstract_) = fields.get("abstractNote") {
            bib_entry.set("abstract", string_to_chunks(abstract_));
        }

        // Serialize to BibTeX format
        match bib_entry.to_bibtex_string() {
            Ok(bibtex) => bibtex_entries.push(bibtex),
            Err(e) => {
                // Fallback: log error and skip this entry
                tracing::warn!("Failed to serialize entry to BibTeX: {:?}", e);
            }
        }
    }

    Ok(bibtex_entries.join("\n\n"))
}

/// Export all entries to CSL JSON
#[tauri::command]
pub async fn export_all_to_csl_json(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let entry_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM entries WHERE is_deleted = 0"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    export_to_csl_json(state, entry_ids).await
}

/// Export all entries to BibTeX
#[tauri::command]
pub async fn export_all_to_bibtex(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let entry_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM entries WHERE is_deleted = 0"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    export_to_bibtex(state, entry_ids).await
}

// =====================================================
// BIBLATEX EXPORT WITH FILES
// =====================================================

#[derive(Debug, Deserialize)]
pub struct ExportOptions {
    pub include_pdfs: bool,
    pub include_notes: bool,
    pub include_weblinks: bool,
    pub include_annotations: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiblatexExportResult {
    pub entries_exported: usize,
    pub files_exported: usize,
    pub notes_exported: usize,
    pub output_path: String,
}

fn get_mimetype_for_attachment(attachment_type: &str, filename: &str) -> &'static str {
    match attachment_type {
        "pdf" => "application/pdf",
        "note" => "text/markdown",
        "weblink" => "text/html",
        "snapshot" => "text/html",
        "image" => {
            let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
            match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "svg" => "image/svg+xml",
                _ => "application/octet-stream",
            }
        }
        _ => "application/octet-stream",
    }
}

/// Export entries to BibLaTeX format with files using the biblatex crate
#[tauri::command]
pub async fn export_to_biblatex_with_files(
    state: State<'_, AppState>,
    entry_ids: Vec<i64>,
    output_dir: String,
    options: ExportOptions,
) -> Result<BiblatexExportResult, String> {
    let output_path = Path::new(&output_dir);
    let files_dir = output_path.join("files");

    // Create output directories
    std::fs::create_dir_all(&files_dir).map_err(|e| format!("Failed to create output directory: {}", e))?;

    let mut biblatex_entries = Vec::new();
    let mut files_exported = 0usize;
    let mut notes_exported = 0usize;

    for entry_id in &entry_ids {
        // Get entry basic info
        let entry_row = sqlx::query(
            r#"
            SELECT
                e.id, e.key, it.name as item_type, e.title, e.date, e.url,
                e.access_date, e.date_added, e.date_modified
            FROM entries e
            JOIN item_types it ON e.item_type_id = it.id
            WHERE e.id = ? AND e.is_deleted = 0
            "#
        )
        .bind(entry_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let entry_row = match entry_row {
            Some(row) => row,
            None => continue,
        };

        let key: String = entry_row.get("key");
        let item_type: String = entry_row.get("item_type");
        let title: String = entry_row.get("title");
        let date: Option<String> = entry_row.get("date");
        let url: Option<String> = entry_row.get("url");

        // Get fields
        let field_rows: Vec<(String, String)> = sqlx::query_as(
            r#"
            SELECT f.name as field_name, ef.value
            FROM entry_fields ef
            JOIN fields f ON ef.field_id = f.id
            WHERE ef.entry_id = ?
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        let mut fields: HashMap<String, String> = HashMap::new();
        for (name, value) in field_rows {
            fields.insert(name, value);
        }

        // Get creators
        let creator_rows: Vec<(String, Option<String>, Option<String>, Option<String>, i32)> = sqlx::query_as(
            r#"
            SELECT ct.name as creator_type, ec.first_name, ec.last_name, ec.name, ec.sort_order
            FROM entry_creators ec
            JOIN creator_types ct ON ec.creator_type_id = ct.id
            WHERE ec.entry_id = ?
            ORDER BY ec.sort_order
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Get tags for keywords
        let tags: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT t.name
            FROM tags t
            JOIN entry_tags et ON t.id = et.tag_id
            WHERE et.entry_id = ?
            ORDER BY t.name
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Get attachments for file field
        let attachments: Vec<(i64, String, String, Option<String>, Option<String>)> = sqlx::query_as(
            r#"
            SELECT a.id, at.name as attachment_type, a.title, a.file_path, a.url
            FROM attachments a
            JOIN attachment_types at ON a.attachment_type_id = at.id
            WHERE a.entry_id = ?
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Create biblatex Entry
        let entry_type = item_type_to_biblatex_entry_type(&item_type);
        let mut bib_entry = Entry::new(key.clone(), entry_type);

        // Set title
        bib_entry.set("title", string_to_chunks(&title));

        // Set authors and editors using biblatex Person type
        let mut authors: Vec<Person> = Vec::new();
        let mut editors: Vec<Person> = Vec::new();

        for (creator_type, first_name, last_name, name, _) in creator_rows {
            if let Some(person) = create_person(first_name, last_name, name) {
                if creator_type == "editor" {
                    editors.push(person);
                } else {
                    authors.push(person);
                }
            }
        }

        if !authors.is_empty() {
            bib_entry.set_as("author", &authors);
        }
        if !editors.is_empty() {
            bib_entry.set_as("editor", &editors);
        }

        // Set date
        if let Some(d) = &date {
            bib_entry.set("date", string_to_chunks(d));
        }

        // Set journal/booktitle
        if let Some(journal) = fields.get("publicationTitle") {
            bib_entry.set("journaltitle", string_to_chunks(journal));
        }

        // Set other fields
        if let Some(volume) = fields.get("volume") {
            bib_entry.set("volume", string_to_chunks(volume));
        }
        if let Some(issue) = fields.get("issue") {
            bib_entry.set("number", string_to_chunks(issue));
        }
        if let Some(pages) = fields.get("pages") {
            bib_entry.set("pages", string_to_chunks(pages));
        }
        if let Some(publisher) = fields.get("publisher") {
            bib_entry.set("publisher", string_to_chunks(publisher));
        }
        if let Some(place) = fields.get("place") {
            bib_entry.set("location", string_to_chunks(place));
        }
        if let Some(doi) = fields.get("DOI") {
            bib_entry.set("doi", string_to_chunks(doi));
        }
        if let Some(isbn) = fields.get("ISBN") {
            bib_entry.set("isbn", string_to_chunks(isbn));
        }
        if let Some(issn) = fields.get("ISSN") {
            bib_entry.set("issn", string_to_chunks(issn));
        }
        if let Some(u) = &url {
            bib_entry.set("url", string_to_chunks(u));
        }
        if let Some(abstract_) = fields.get("abstractNote") {
            bib_entry.set("abstract", string_to_chunks(abstract_));
        }
        if let Some(language) = fields.get("language") {
            bib_entry.set("langid", string_to_chunks(language));
        }

        // Keywords from tags
        if !tags.is_empty() {
            bib_entry.set("keywords", string_to_chunks(&tags.join(", ")));
        }

        // Process attachments and build file field
        let mut file_parts = Vec::new();
        let entry_files_dir = files_dir.join(&key);

        for (_att_id, att_type, att_title, att_path, att_url) in &attachments {
            match att_type.as_str() {
                "pdf" if options.include_pdfs => {
                    if let Some(src_path) = att_path {
                        let src = Path::new(src_path);
                        if src.exists() {
                            // Create entry directory if needed
                            std::fs::create_dir_all(&entry_files_dir)
                                .map_err(|e| format!("Failed to create files directory: {}", e))?;

                            let filename = src.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("document.pdf");
                            let dest = entry_files_dir.join(filename);

                            // Copy the file
                            std::fs::copy(src, &dest)
                                .map_err(|e| format!("Failed to copy PDF: {}", e))?;

                            files_exported += 1;

                            // Add to file field
                            let rel_path = format!("files/{}/{}", key, filename);
                            file_parts.push(format!("{}:{}:application/pdf", att_title, rel_path));
                        }
                    }
                }
                "note" if options.include_notes => {
                    // Export note content from the file referenced by file_path
                    if let Some(note_file_path) = att_path {
                        let note_src = Path::new(note_file_path);
                        if note_src.exists() {
                            // Read the note content from the file
                            let content = std::fs::read_to_string(note_src)
                                .map_err(|e| format!("Failed to read note file: {}", e))?;

                            std::fs::create_dir_all(&entry_files_dir)
                                .map_err(|e| format!("Failed to create files directory: {}", e))?;

                            let note_filename = format!("{}.md", att_title.replace("/", "_").replace("\\", "_"));
                            let note_path = entry_files_dir.join(&note_filename);

                            std::fs::write(&note_path, &content)
                                .map_err(|e| format!("Failed to write note: {}", e))?;

                            notes_exported += 1;

                            let rel_path = format!("files/{}/{}", key, note_filename);
                            file_parts.push(format!("{}:{}:text/markdown", att_title, rel_path));
                        }
                    }
                }
                "weblink" if options.include_weblinks => {
                    // Include weblinks in the file field with their URLs
                    if let Some(link_url) = att_url {
                        file_parts.push(format!("{}:{}:text/html", att_title, link_url));
                    }
                }
                "snapshot" if options.include_pdfs => {
                    // Treat snapshots like PDFs if they have a path
                    if let Some(src_path) = att_path {
                        let src = Path::new(src_path);
                        if src.exists() {
                            std::fs::create_dir_all(&entry_files_dir)
                                .map_err(|e| format!("Failed to create files directory: {}", e))?;

                            let filename = src.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("snapshot.html");
                            let dest = entry_files_dir.join(filename);

                            std::fs::copy(src, &dest)
                                .map_err(|e| format!("Failed to copy snapshot: {}", e))?;

                            files_exported += 1;

                            let rel_path = format!("files/{}/{}", key, filename);
                            let mimetype = get_mimetype_for_attachment("snapshot", filename);
                            file_parts.push(format!("{}:{}:{}", att_title, rel_path, mimetype));
                        }
                    }
                }
                _ => {}
            }
        }

        // Handle annotations if requested
        if options.include_annotations {
            let annotations: Vec<(i64, String, i32, Option<String>, Option<String>, String)> = sqlx::query_as(
                r#"
                SELECT aa.id, at.name as annotation_type, aa.page_number, aa.selected_text, aa.comment, aa.color
                FROM attachment_annotations aa
                JOIN annotation_types at ON aa.annotation_type_id = at.id
                JOIN attachments att ON aa.attachment_id = att.id
                WHERE att.entry_id = ?
                "#
            )
            .bind(entry_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;

            if !annotations.is_empty() {
                std::fs::create_dir_all(&entry_files_dir)
                    .map_err(|e| format!("Failed to create files directory: {}", e))?;

                // Export annotations as a JSON file
                let annotations_data: Vec<serde_json::Value> = annotations
                    .iter()
                    .map(|(id, ann_type, page, text, comment, color)| {
                        serde_json::json!({
                            "id": id,
                            "type": ann_type,
                            "page": page,
                            "text": text,
                            "comment": comment,
                            "color": color,
                        })
                    })
                    .collect();

                let annotations_json = serde_json::to_string_pretty(&annotations_data)
                    .map_err(|e| format!("Failed to serialize annotations: {}", e))?;

                let annotations_filename = format!("{}_annotations.json", key);
                let annotations_path = entry_files_dir.join(&annotations_filename);

                std::fs::write(&annotations_path, &annotations_json)
                    .map_err(|e| format!("Failed to write annotations: {}", e))?;

                let rel_path = format!("files/{}/{}", key, annotations_filename);
                file_parts.push(format!("Annotations:{}:application/json", rel_path));
            }
        }

        // Add file field if we have any files (custom Zotero format)
        if !file_parts.is_empty() {
            bib_entry.set("file", string_to_chunks(&file_parts.join(";")));
        }

        // Extra/Note field
        if let Some(extra) = fields.get("extra") {
            bib_entry.set("note", string_to_chunks(extra));
        }

        // Serialize to BibLaTeX format
        let biblatex = bib_entry.to_biblatex_string();
        biblatex_entries.push(biblatex);
    }

    // Write the BibLaTeX file
    let bib_path = output_path.join("export.bib");
    std::fs::write(&bib_path, biblatex_entries.join("\n\n"))
        .map_err(|e| format!("Failed to write BibLaTeX file: {}", e))?;

    Ok(BiblatexExportResult {
        entries_exported: entry_ids.len(),
        files_exported,
        notes_exported,
        output_path: output_dir,
    })
}

/// Export all entries to BibLaTeX with files
#[tauri::command]
pub async fn export_all_to_biblatex_with_files(
    state: State<'_, AppState>,
    output_dir: String,
    options: ExportOptions,
) -> Result<BiblatexExportResult, String> {
    let entry_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM entries WHERE is_deleted = 0"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    export_to_biblatex_with_files(state, entry_ids, output_dir, options).await
}
