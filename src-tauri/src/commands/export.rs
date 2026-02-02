use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
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

/// Export entries to BibTeX format
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

        // Format authors
        let mut authors = Vec::new();
        let mut editors = Vec::new();

        for (creator_type, first_name, last_name, name, _) in creator_rows {
            let formatted = if let Some(literal) = name {
                format!("{{{}}}", literal)
            } else {
                match (last_name, first_name) {
                    (Some(ln), Some(fn_)) => format!("{}, {}", ln, fn_),
                    (Some(ln), None) => ln,
                    (None, Some(fn_)) => fn_,
                    (None, None) => continue,
                }
            };

            if creator_type == "editor" {
                editors.push(formatted);
            } else {
                authors.push(formatted);
            }
        }

        // Determine BibTeX entry type
        let bibtex_type = match item_type.as_str() {
            "journalArticle" => "article",
            "book" => "book",
            "bookSection" => "incollection",
            "conferencePaper" => "inproceedings",
            "thesis" => "phdthesis",
            "report" => "techreport",
            "preprint" => "unpublished",
            "webpage" => "misc",
            "computerProgram" => "software",
            _ => "misc",
        };

        // Build BibTeX entry
        let mut bibtex = format!("@{}{{{},\n", bibtex_type, key);

        // Title
        bibtex.push_str(&format!("  title = {{{}}},\n", escape_bibtex(&title)));

        // Authors
        if !authors.is_empty() {
            bibtex.push_str(&format!("  author = {{{}}},\n", authors.join(" and ")));
        }

        // Editors
        if !editors.is_empty() {
            bibtex.push_str(&format!("  editor = {{{}}},\n", editors.join(" and ")));
        }

        // Year
        if let Some(d) = &date {
            if let Some(year) = d.split('-').next() {
                bibtex.push_str(&format!("  year = {{{}}},\n", year));
            }
        }

        // Journal/Book title
        if let Some(journal) = fields.get("publicationTitle") {
            let field_name = match bibtex_type {
                "article" => "journal",
                "incollection" | "inproceedings" => "booktitle",
                _ => "journal",
            };
            bibtex.push_str(&format!("  {} = {{{}}},\n", field_name, escape_bibtex(journal)));
        }

        // Volume
        if let Some(volume) = fields.get("volume") {
            bibtex.push_str(&format!("  volume = {{{}}},\n", volume));
        }

        // Number/Issue
        if let Some(issue) = fields.get("issue") {
            bibtex.push_str(&format!("  number = {{{}}},\n", issue));
        }

        // Pages
        if let Some(pages) = fields.get("pages") {
            bibtex.push_str(&format!("  pages = {{{}}},\n", pages.replace("-", "--")));
        }

        // Publisher
        if let Some(publisher) = fields.get("publisher") {
            bibtex.push_str(&format!("  publisher = {{{}}},\n", escape_bibtex(publisher)));
        }

        // Address/Place
        if let Some(place) = fields.get("place") {
            bibtex.push_str(&format!("  address = {{{}}},\n", escape_bibtex(place)));
        }

        // DOI
        if let Some(doi) = fields.get("DOI") {
            bibtex.push_str(&format!("  doi = {{{}}},\n", doi));
        }

        // ISBN
        if let Some(isbn) = fields.get("ISBN") {
            bibtex.push_str(&format!("  isbn = {{{}}},\n", isbn));
        }

        // URL
        if let Some(u) = &url {
            bibtex.push_str(&format!("  url = {{{}}},\n", u));
        }

        // Abstract
        if let Some(abstract_) = fields.get("abstractNote") {
            bibtex.push_str(&format!("  abstract = {{{}}},\n", escape_bibtex(abstract_)));
        }

        // Close entry
        bibtex.push_str("}\n");

        bibtex_entries.push(bibtex);
    }

    Ok(bibtex_entries.join("\n"))
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

// Helper function to escape special BibTeX characters
fn escape_bibtex(s: &str) -> String {
    s.replace('&', r"\&")
     .replace('%', r"\%")
     .replace('$', r"\$")
     .replace('#', r"\#")
     .replace('_', r"\_")
     .replace('{', r"\{")
     .replace('}', r"\}")
     .replace('~', r"\textasciitilde{}")
     .replace('^', r"\textasciicircum{}")
}
