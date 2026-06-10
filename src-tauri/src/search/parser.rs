use std::collections::BTreeMap;

use crate::docparse::blocks::{BlockType, TableBlock};
use crate::docparse::config::DocParseConfig;
use crate::docparse::DocParser;
use serde::{Deserialize, Serialize};

/// Supported document types for parsing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DocumentType {
    Pdf,
    Docx,
    Xlsx,
    Pptx,
    Markdown,
    Html,
    PlainText,
    Epub,
}

impl DocumentType {
    /// Detect document type from file extension.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "pdf" => Some(Self::Pdf),
            "docx" => Some(Self::Docx),
            "xlsx" => Some(Self::Xlsx),
            "pptx" => Some(Self::Pptx),
            "md" | "markdown" => Some(Self::Markdown),
            "html" | "htm" => Some(Self::Html),
            // Plain text, code, data, and config files
            "txt" | "text" | "log" | "csv" | "tsv" | "json" | "jsonl" | "ndjson"
            | "yaml" | "yml" | "toml" | "xml" | "ini" | "cfg" | "conf" | "env"
            | "properties" | "dockerfile" | "makefile" | "cmake" | "gradle" | "sbt"
            // Markup and documentation formats
            | "rst" | "tex" | "sty" | "cls" | "bib" | "latex"
            | "org" | "adoc" | "asciidoc" | "textile" | "wiki" | "mediawiki"
            | "rtf"
            // Programming languages
            | "rs" | "py" | "pyi" | "pyw" | "js" | "mjs" | "cjs" | "ts" | "mts"
            | "tsx" | "jsx" | "c" | "cpp" | "cc" | "cxx" | "h" | "hpp" | "hxx"
            | "java" | "go" | "rb" | "php" | "swift" | "kt" | "kts"
            | "sh" | "bash" | "zsh" | "fish" | "ps1" | "bat" | "cmd"
            | "sql" | "r" | "rmd" | "lua" | "pl" | "pm" | "perl"
            | "scala" | "zig" | "nim" | "dart" | "v" | "vala"
            | "ex" | "exs" | "erl" | "hrl" | "clj" | "cljs" | "cljc"
            | "hs" | "lhs" | "ml" | "mli" | "fs" | "fsi" | "fsx"
            | "jl" | "m" | "mm" | "d" | "pas" | "pp"
            | "groovy" | "gvy" | "tf" | "hcl"
            // Web and style
            | "vue" | "svelte" | "astro" | "css" | "scss" | "less" | "sass" | "styl"
            | "graphql" | "gql" | "proto" | "thrift" | "avsc"
            // Notebook / data
            | "ipynb"
            => Some(Self::PlainText),
            "epub" => Some(Self::Epub),
            _ => None,
        }
    }

    /// Check if a file extension corresponds to an image.
    pub fn is_image(ext: &str) -> bool {
        matches!(
            ext.to_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico" | "tiff" | "tif"
        )
    }
}

/// A section within a parsed document (page, sheet, slide, heading section, or chapter).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSection {
    /// Page number (1-indexed) for PDFs, slide number for PPTX.
    pub page_number: Option<usize>,
    /// Section name: heading text (DOCX), sheet name (XLSX), slide title (PPTX), chapter (EPUB).
    pub section_name: Option<String>,
    /// The text content of this section.
    pub content: String,
    /// Character offset within the full document text.
    pub start_offset: usize,
    /// Character end offset within the full document text.
    pub end_offset: usize,
}

/// A fully parsed document with structured sections.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedDocument {
    pub id: String,
    pub filename: String,
    pub document_type: DocumentType,
    pub total_chars: usize,
    pub total_pages: Option<usize>,
    pub sections: Vec<DocumentSection>,
    pub metadata: serde_json::Value,
}

/// Parse a document from bytes, dispatching PDFs to the async docparse pipeline
/// and wrapping sync parsers in spawn_blocking.
pub async fn parse_document(
    data: &[u8],
    filename: &str,
    doc_type: DocumentType,
    pdf_parser: &DocParser,
) -> Result<ParsedDocument, String> {
    match doc_type {
        DocumentType::Pdf => parse_pdf(data, filename, pdf_parser).await,
        _ => {
            let data = data.to_vec();
            let filename = filename.to_string();
            tokio::task::spawn_blocking(move || parse_bytes_sync(&data, &filename, doc_type))
                .await
                .map_err(|e| format!("Parse task panicked: {}", e))?
        }
    }
}

/// Synchronous parse for non-PDF document types.
fn parse_bytes_sync(
    data: &[u8],
    filename: &str,
    doc_type: DocumentType,
) -> Result<ParsedDocument, String> {
    match doc_type {
        DocumentType::Pdf => unreachable!("PDFs handled by async docparse path"),
        DocumentType::Docx | DocumentType::Xlsx | DocumentType::Pptx => {
            parse_office_bytes(data, filename, doc_type)
        }
        DocumentType::Markdown | DocumentType::PlainText => {
            let text = String::from_utf8(data.to_vec())
                .map_err(|e| format!("Invalid UTF-8: {}", e))?;
            build_text_document(&text, filename, doc_type)
        }
        DocumentType::Html => {
            let text = String::from_utf8(data.to_vec())
                .map_err(|e| format!("Invalid UTF-8: {}", e))?;
            parse_html_string(&text, filename)
        }
        DocumentType::Epub => parse_epub_bytes(data, filename),
    }
}

// ── PDF Parsing (docparse: layout analysis + OCR + tables) ──

/// Parse PDF using the docparse pipeline (layout analysis, OCR, table detection).
async fn parse_pdf(
    data: &[u8],
    filename: &str,
    parser: &DocParser,
) -> Result<ParsedDocument, String> {
    let config = DocParseConfig;

    let parsed = parser
        .parse_document(data, filename.to_string(), config, None::<fn(usize)>)
        .await
        .map_err(|e| format!("PDF parse error: {}", e))?;

    // Group blocks by page and render to markdown sections
    let sections = convert_blocks_to_sections(&parsed);

    let total_chars: usize = sections.iter().map(|s| s.content.len()).sum();
    let total_pages = parsed.pages.len();

    let metadata = serde_json::json!({
        "parser_version": parsed.metadata.parser_version,
        "parsing_duration_ms": parsed.metadata.parsing_duration.as_millis() as u64,
        "pages_needing_ocr": parsed.pages.iter().filter(|p| p.need_ocr).count(),
    });

    Ok(ParsedDocument {
        id: uuid::Uuid::new_v4().to_string(),
        filename: filename.to_string(),
        document_type: DocumentType::Pdf,
        total_chars,
        total_pages: Some(total_pages),
        sections,
        metadata,
    })
}

/// Convert docparse blocks into DocumentSections grouped by page.
pub(crate) fn convert_blocks_to_sections(
    doc: &crate::docparse::entities::ParsedDocument,
) -> Vec<DocumentSection> {
    // Group blocks by page ID
    let mut page_blocks: BTreeMap<usize, Vec<&crate::docparse::blocks::Block>> = BTreeMap::new();
    for block in &doc.blocks {
        for &page_id in &block.pages_id {
            page_blocks.entry(page_id).or_default().push(block);
        }
    }

    let mut sections = Vec::new();
    let mut offset = 0;

    for (page_id, blocks) in &page_blocks {
        let page_markdown = render_blocks_to_markdown(blocks);
        if page_markdown.trim().is_empty() {
            continue;
        }

        // Use first title block on the page as section name
        let section_name = blocks.iter().find_map(|b| {
            if let BlockType::Title(title) = &b.kind {
                Some(title.text.clone())
            } else {
                None
            }
        });

        let end = offset + page_markdown.len();
        sections.push(DocumentSection {
            page_number: Some(page_id + 1), // page ids are 0-indexed
            section_name,
            content: page_markdown,
            start_offset: offset,
            end_offset: end,
        });
        offset = end;
    }

    sections
}

/// Render a list of docparse blocks to markdown text.
fn render_blocks_to_markdown(blocks: &[&crate::docparse::blocks::Block]) -> String {
    let mut parts = Vec::new();

    for block in blocks {
        match &block.kind {
            BlockType::Title(title) => {
                let prefix = "#".repeat(title.level.clamp(1, 6) as usize);
                parts.push(format!("{} {}", prefix, title.text));
            }
            BlockType::Header(_) | BlockType::Footer(_) => {
                // Skip page headers/footers — they're repetitive page chrome, bad for RAG
            }
            BlockType::TextBlock(text) => {
                parts.push(text.text.clone());
            }
            BlockType::ListBlock(list) => {
                let items: Vec<String> = list.items.iter().map(|i| format!("- {}", i)).collect();
                parts.push(items.join("\n"));
            }
            BlockType::Table(table) => {
                parts.push(render_table_markdown(table));
            }
            BlockType::Image(_) => {
                parts.push("[Image]".to_string());
            }
        }
    }

    parts.join("\n\n")
}

/// Render a docparse TableBlock as a markdown table.
fn render_table_markdown(table: &TableBlock) -> String {
    if table.rows.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();
    let mut separator_added = false;

    for row in &table.rows {
        let cells: Vec<String> = row
            .cells
            .iter()
            .map(|c| c.text.replace('|', "\\|"))
            .collect();
        lines.push(format!("| {} |", cells.join(" | ")));

        // Add header separator after the first header row
        if row.is_header && !separator_added {
            let sep: Vec<&str> = row.cells.iter().map(|_| "---").collect();
            lines.push(format!("| {} |", sep.join(" | ")));
            separator_added = true;
        }
    }

    // If no header row was marked, add separator after first row anyway
    if !separator_added && !table.rows.is_empty() {
        let sep: Vec<&str> = table.rows[0].cells.iter().map(|_| "---").collect();
        lines.insert(1, format!("| {} |", sep.join(" | ")));
    }

    lines.join("\n")
}

// ── Office Parsing (undoc crate) ────────────────────────────────

fn parse_office_bytes(
    data: &[u8],
    filename: &str,
    doc_type: DocumentType,
) -> Result<ParsedDocument, String> {
    let doc = undoc::parse_bytes(data).map_err(|e| format!("Office parse error: {}", e))?;
    build_office_document(&doc, filename, doc_type)
}

fn build_office_document(
    doc: &undoc::Document,
    filename: &str,
    doc_type: DocumentType,
) -> Result<ParsedDocument, String> {
    let mut sections = Vec::new();
    let mut offset = 0;

    for section in &doc.sections {
        let section_text = section_plain_text(section);
        if section_text.trim().is_empty() {
            continue;
        }
        let end = offset + section_text.len();

        let page_number = match doc_type {
            DocumentType::Pptx => Some(section.index + 1),
            _ => None,
        };

        sections.push(DocumentSection {
            page_number,
            section_name: section.name.clone(),
            content: section_text,
            start_offset: offset,
            end_offset: end,
        });
        offset = end;
    }

    let metadata = serde_json::json!({
        "title": doc.metadata.title,
        "author": doc.metadata.author,
        "section_count": doc.sections.len(),
    });

    Ok(ParsedDocument {
        id: uuid::Uuid::new_v4().to_string(),
        filename: filename.to_string(),
        document_type: doc_type,
        total_chars: offset,
        total_pages: None,
        sections,
        metadata,
    })
}

/// Extract plain text from an undoc Section.
fn section_plain_text(section: &undoc::Section) -> String {
    let mut text = String::new();
    for block in &section.content {
        match block {
            undoc::Block::Paragraph(para) => {
                let para_text = para.plain_text();
                if !para_text.is_empty() {
                    text.push_str(&para_text);
                    text.push('\n');
                }
            }
            undoc::Block::Table(table) => {
                for row in &table.rows {
                    let cells: Vec<String> = row
                        .cells
                        .iter()
                        .map(|cell| {
                            cell.content
                                .iter()
                                .map(|p| p.plain_text())
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                        .collect();
                    text.push_str(&cells.join(" | "));
                    text.push('\n');
                }
            }
            _ => {}
        }
    }
    text
}

// ── Plain Text / Markdown Parsing ───────────────────────────────

fn build_text_document(
    text: &str,
    filename: &str,
    doc_type: DocumentType,
) -> Result<ParsedDocument, String> {
    let sections = if doc_type == DocumentType::Markdown {
        split_by_headings(text)
    } else {
        // For plain text/code, treat the whole file as one section
        vec![DocumentSection {
            page_number: None,
            section_name: None,
            content: text.to_string(),
            start_offset: 0,
            end_offset: text.len(),
        }]
    };

    Ok(ParsedDocument {
        id: uuid::Uuid::new_v4().to_string(),
        filename: filename.to_string(),
        document_type: doc_type,
        total_chars: text.len(),
        total_pages: None,
        sections,
        metadata: serde_json::json!({}),
    })
}

/// Split markdown text into sections by headings (# or ##).
fn split_by_headings(text: &str) -> Vec<DocumentSection> {
    let mut sections = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_content = String::new();
    let mut offset = 0;
    let mut section_start = 0;

    for line in text.lines() {
        let is_heading = line.starts_with("# ") || line.starts_with("## ");

        if is_heading && !current_content.trim().is_empty() {
            // Flush previous section
            sections.push(DocumentSection {
                page_number: None,
                section_name: current_name.take(),
                content: current_content.clone(),
                start_offset: section_start,
                end_offset: offset,
            });
            current_content.clear();
            section_start = offset;
        }

        if is_heading {
            current_name = Some(line.trim_start_matches('#').trim().to_string());
        }

        current_content.push_str(line);
        current_content.push('\n');
        offset += line.len() + 1; // +1 for newline
    }

    // Flush last section
    if !current_content.trim().is_empty() {
        sections.push(DocumentSection {
            page_number: None,
            section_name: current_name,
            content: current_content,
            start_offset: section_start,
            end_offset: offset,
        });
    }

    if sections.is_empty() {
        sections.push(DocumentSection {
            page_number: None,
            section_name: None,
            content: text.to_string(),
            start_offset: 0,
            end_offset: text.len(),
        });
    }

    sections
}

// ── HTML Parsing ────────────────────────────────────────────────

fn parse_html_string(html: &str, filename: &str) -> Result<ParsedDocument, String> {
    let text = html2text::from_read(html.as_bytes(), 120);
    build_text_document(&text, filename, DocumentType::Html)
}

// ── EPUB Parsing ────────────────────────────────────────────────

fn parse_epub_bytes(data: &[u8], filename: &str) -> Result<ParsedDocument, String> {
    let cursor = std::io::Cursor::new(data.to_vec());
    let mut book = epub::doc::EpubDoc::from_reader(cursor)
        .map_err(|e| format!("EPUB parse error: {}", e))?;

    let mut sections = Vec::new();
    let mut offset = 0;
    let mut chapter_num = 0;

    // Iterate through the spine (reading order)
    while book.go_next() {
        chapter_num += 1;
        if let Some((content_bytes, _mime)) = book.get_current() {
            let html = String::from_utf8_lossy(&content_bytes);
            let text = html2text::from_read(html.as_bytes(), 120);

            if text.trim().is_empty() {
                continue;
            }

            let end = offset + text.len();
            sections.push(DocumentSection {
                page_number: Some(chapter_num),
                section_name: book.get_current_id().map(|id| id.to_string()),
                content: text,
                start_offset: offset,
                end_offset: end,
            });
            offset = end;
        }
    }

    let title = book.mdata("title").map(|m| m.value.clone());
    let author = book.mdata("creator").map(|m| m.value.clone());

    Ok(ParsedDocument {
        id: uuid::Uuid::new_v4().to_string(),
        filename: filename.to_string(),
        document_type: DocumentType::Epub,
        total_chars: offset,
        total_pages: Some(chapter_num),
        sections,
        metadata: serde_json::json!({
            "title": title,
            "author": author,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_type_from_extension() {
        assert_eq!(DocumentType::from_extension("pdf"), Some(DocumentType::Pdf));
        assert_eq!(DocumentType::from_extension("docx"), Some(DocumentType::Docx));
        assert_eq!(DocumentType::from_extension("md"), Some(DocumentType::Markdown));
        assert_eq!(DocumentType::from_extension("html"), Some(DocumentType::Html));
        assert_eq!(DocumentType::from_extension("rs"), Some(DocumentType::PlainText));
        assert_eq!(DocumentType::from_extension("epub"), Some(DocumentType::Epub));
        assert_eq!(DocumentType::from_extension("xyz"), None);
    }

    #[test]
    fn test_split_by_headings() {
        let text = "# Introduction\nSome text here\n## Details\nMore details\n";
        let sections = split_by_headings(text);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].section_name.as_deref(), Some("Introduction"));
        assert_eq!(sections[1].section_name.as_deref(), Some("Details"));
    }

    #[test]
    fn test_split_by_headings_no_headings() {
        let text = "Just some plain text\nwith no headings\n";
        let sections = split_by_headings(text);
        assert_eq!(sections.len(), 1);
        assert!(sections[0].section_name.is_none());
    }
}
