use anyhow::Result;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

use super::parser::{parse_document, DocumentType, ParsedDocument};
use ferrules_core::FerrulesParser;

/// Maximum text size to extract (10MB)
pub const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

/// Minimum characters for extracted text to be worth saving as a markdown file.
/// Extractions shorter than this (e.g. OCR artifacts, stray words from images)
/// are still indexed for search but don't get a companion .md file.
pub const MIN_MARKDOWN_CHARS: usize = 100;

/// Configuration for text extraction.
/// OCR is handled automatically by ferrules — no user-facing settings needed.
#[derive(Clone, Debug, Default)]
pub struct ExtractionConfig;

/// Result of text extraction with method info
#[derive(Clone, Debug)]
pub struct ExtractionResult {
    /// Extracted text content
    pub text: String,
    /// Method used for extraction
    pub method: ExtractionMethod,
    /// Optional message (e.g., why a method failed)
    pub message: Option<String>,
    /// Structured parsed document (available for ferrules/parser-based extraction)
    pub parsed_document: Option<ParsedDocument>,
}

/// Method used for text extraction
#[derive(Clone, Debug, PartialEq)]
pub enum ExtractionMethod {
    /// Extracted via ferrules (PDF with layout analysis, OCR, tables)
    Ferrules,
    /// Extracted via parser (HTML, EPUB, DOCX, XLSX, PPTX)
    Parser,
    /// Direct file read (markdown, text)
    DirectRead,
    /// Extraction skipped (file type not supported or disabled)
    Skipped,
    /// No extraction performed
    None,
}

impl ExtractionMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExtractionMethod::Ferrules => "ferrules",
            ExtractionMethod::Parser => "parser",
            ExtractionMethod::DirectRead => "direct",
            ExtractionMethod::Skipped => "skipped",
            ExtractionMethod::None => "none",
        }
    }
}

/// Extract text content from a file using ferrules (PDF) or format-specific parsers.
/// Safety: `path` is constructed from DB values (file_path column) that were validated
/// at import/creation time. Callers are responsible for ensuring path integrity.
pub async fn extract_text(
    path: &Path,
    _config: &ExtractionConfig,
    pdf_parser: Option<&FerrulesParser>,
) -> Result<ExtractionResult> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // For plain text and markdown files, read directly
    if matches!(ext.as_str(), "md" | "txt" | "markdown" | "text") {
        let text = std::fs::read_to_string(path).unwrap_or_default();
        return Ok(ExtractionResult {
            text: truncate_text(text),
            method: ExtractionMethod::DirectRead,
            message: None,
            parsed_document: None,
        });
    }

    // Detect document type
    let doc_type = match DocumentType::from_extension(&ext) {
        Some(dt) => dt,
        None => {
            // Unsupported file type
            return Ok(ExtractionResult {
                text: String::new(),
                method: ExtractionMethod::Skipped,
                message: Some(format!("Unsupported file type: .{}", ext)),
                parsed_document: None,
            });
        }
    };

    // Read file bytes
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(e) => {
            warn!("Failed to read file {}: {}", path.display(), e);
            return Ok(ExtractionResult {
                text: String::new(),
                method: ExtractionMethod::None,
                message: Some(format!("Failed to read file: {}", e)),
                parsed_document: None,
            });
        }
    };

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    // For PDFs, require ferrules parser
    if doc_type == DocumentType::Pdf {
        let parser = match pdf_parser {
            Some(p) => p,
            None => {
                warn!("PDF parser not available for {}", path.display());
                return Ok(ExtractionResult {
                    text: String::new(),
                    method: ExtractionMethod::None,
                    message: Some("PDF parser not initialized".to_string()),
                    parsed_document: None,
                });
            }
        };

        match parse_document(&data, filename, doc_type, parser).await {
            Ok(parsed) => {
                let text: String = parsed
                    .sections
                    .iter()
                    .map(|s| s.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n");

                info!(
                    "Ferrules extracted {} chars ({} pages) from: {}",
                    text.len(),
                    parsed.total_pages.unwrap_or(0),
                    path.display()
                );

                return Ok(ExtractionResult {
                    text: truncate_text(sanitize_extracted_text(&text)),
                    method: ExtractionMethod::Ferrules,
                    message: None,
                    parsed_document: Some(parsed),
                });
            }
            Err(e) => {
                warn!("Ferrules extraction failed for {}: {}", path.display(), e);
                return Ok(ExtractionResult {
                    text: String::new(),
                    method: ExtractionMethod::None,
                    message: Some(format!("PDF extraction failed: {}", e)),
                    parsed_document: None,
                });
            }
        }
    }

    // For non-PDF formats, use the parser (no ferrules needed)
    // We need a dummy parser ref for the function signature, but non-PDF paths
    // never use it. Use a stub via parse_bytes_sync path inside parse_document.
    // Since parse_document requires a FerrulesParser ref for signature but non-PDF
    // types don't use it, we need to handle this differently.
    let result = {
        let data = data.clone();
        let filename = filename.to_string();
        let dt = doc_type.clone();
        tokio::task::spawn_blocking(move || {
            // Call the sync parser directly for non-PDF types
            parse_non_pdf_sync(&data, &filename, dt)
        })
        .await
        .map_err(|e| anyhow::anyhow!("Parse task panicked: {}", e))?
    };

    match result {
        Ok(parsed) => {
            let text: String = parsed
                .sections
                .iter()
                .map(|s| s.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");

            if text.trim().is_empty() {
                info!("Parser returned empty text for: {}", path.display());
                return Ok(ExtractionResult {
                    text: String::new(),
                    method: ExtractionMethod::Parser,
                    message: Some("No text content extracted".to_string()),
                    parsed_document: Some(parsed),
                });
            }

            info!("Parser extracted {} chars from: {}", text.len(), path.display());

            Ok(ExtractionResult {
                text: truncate_text(sanitize_extracted_text(&text)),
                method: ExtractionMethod::Parser,
                message: None,
                parsed_document: Some(parsed),
            })
        }
        Err(e) => {
            warn!("Parser extraction failed for {}: {}", path.display(), e);
            Ok(ExtractionResult {
                text: String::new(),
                method: ExtractionMethod::None,
                message: Some(format!("Extraction failed: {}", e)),
                parsed_document: None,
            })
        }
    }
}

/// Sync parser for non-PDF document types (called from spawn_blocking).
fn parse_non_pdf_sync(
    data: &[u8],
    filename: &str,
    doc_type: DocumentType,
) -> Result<ParsedDocument, String> {
    match doc_type {
        DocumentType::Pdf => unreachable!("PDFs handled by async ferrules path"),
        DocumentType::Docx | DocumentType::Xlsx | DocumentType::Pptx => {
            let doc = undoc::parse_bytes(data).map_err(|e| format!("Office parse error: {}", e))?;
            build_office_document(&doc, filename, doc_type)
        }
        DocumentType::Markdown | DocumentType::PlainText => {
            let text = String::from_utf8(data.to_vec())
                .map_err(|e| format!("Invalid UTF-8: {}", e))?;
            build_text_document(&text, filename, doc_type)
        }
        DocumentType::Html => {
            let text = String::from_utf8(data.to_vec())
                .map_err(|e| format!("Invalid UTF-8: {}", e))?;
            let converted = html2text::from_read(text.as_bytes(), 120);
            build_text_document(&converted, filename, DocumentType::Html)
        }
        DocumentType::Epub => parse_epub_sync(data, filename),
    }
}

fn build_office_document(
    doc: &undoc::Document,
    filename: &str,
    doc_type: DocumentType,
) -> Result<ParsedDocument, String> {
    use super::parser::DocumentSection;
    let mut sections = Vec::new();
    let mut offset = 0;

    for section in &doc.sections {
        let section_text = office_section_text(section);
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

    Ok(ParsedDocument {
        id: uuid::Uuid::new_v4().to_string(),
        filename: filename.to_string(),
        document_type: doc_type,
        total_chars: offset,
        total_pages: None,
        sections,
        metadata: serde_json::json!({
            "title": doc.metadata.title,
            "author": doc.metadata.author,
        }),
    })
}

fn office_section_text(section: &undoc::Section) -> String {
    let mut text = String::new();
    for block in &section.content {
        match block {
            undoc::Block::Paragraph(para) => {
                let pt = para.plain_text();
                if !pt.is_empty() {
                    text.push_str(&pt);
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

fn build_text_document(
    text: &str,
    filename: &str,
    doc_type: DocumentType,
) -> Result<ParsedDocument, String> {
    use super::parser::DocumentSection;
    let sections = vec![DocumentSection {
        page_number: None,
        section_name: None,
        content: text.to_string(),
        start_offset: 0,
        end_offset: text.len(),
    }];

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

fn parse_epub_sync(data: &[u8], filename: &str) -> Result<ParsedDocument, String> {
    use super::parser::DocumentSection;
    let cursor = std::io::Cursor::new(data.to_vec());
    let mut book = epub::doc::EpubDoc::from_reader(cursor)
        .map_err(|e| format!("EPUB parse error: {}", e))?;

    let mut sections = Vec::new();
    let mut offset = 0;
    let mut chapter_num = 0;

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

    Ok(ParsedDocument {
        id: uuid::Uuid::new_v4().to_string(),
        filename: filename.to_string(),
        document_type: DocumentType::Epub,
        total_chars: offset,
        total_pages: Some(chapter_num),
        sections,
        metadata: serde_json::json!({
            "title": book.mdata("title").map(|m| m.value.clone()),
            "author": book.mdata("creator").map(|m| m.value.clone()),
        }),
    })
}

/// Returns true if the extracted text has enough substance to be worth saving
/// as a standalone markdown file.
pub fn is_worth_saving(text: &str) -> bool {
    text.trim().len() >= MIN_MARKDOWN_CHARS
}

/// Save extracted text as a markdown file alongside the original.
pub fn save_markdown(attachment_path: &Path, content: &str) -> Result<PathBuf> {
    let md_path = markdown_path_for(attachment_path);
    std::fs::write(&md_path, content)?;
    info!("Saved markdown to: {}", md_path.display());
    Ok(md_path)
}

/// Compute the expected markdown path for a given attachment file path.
pub fn markdown_path_for(attachment_path: &Path) -> PathBuf {
    let mut md_name = attachment_path
        .file_name()
        .unwrap_or_default()
        .to_os_string();
    md_name.push(".md");
    attachment_path.with_file_name(md_name)
}

/// Strip control characters that PDF/OCR extraction leaves behind.
pub fn sanitize_extracted_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        let cp = ch as u32;
        match cp {
            // Keep tab, newline, carriage return
            0x09 | 0x0A | 0x0D => out.push(ch),
            // Strip all other ASCII control chars (U+0000–U+001F)
            0x00..=0x1F => {}
            // Strip BOM / zero-width no-break space
            0xFEFF => {}
            // Strip replacement character
            0xFFFD => {}
            // Strip soft hyphen (invisible, breaks word display)
            0x00AD => {}
            // Keep everything else
            _ => out.push(ch),
        }
    }
    out
}

/// Truncate text to MAX_TEXT_BYTES if needed
fn truncate_text(text: String) -> String {
    if text.len() > MAX_TEXT_BYTES {
        text[..MAX_TEXT_BYTES].to_string()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extraction_method_as_str() {
        assert_eq!(ExtractionMethod::Ferrules.as_str(), "ferrules");
        assert_eq!(ExtractionMethod::Parser.as_str(), "parser");
        assert_eq!(ExtractionMethod::DirectRead.as_str(), "direct");
        assert_eq!(ExtractionMethod::Skipped.as_str(), "skipped");
        assert_eq!(ExtractionMethod::None.as_str(), "none");
    }

    #[test]
    fn test_truncate_text() {
        let short = "hello".to_string();
        assert_eq!(truncate_text(short.clone()), short);

        let long = "a".repeat(MAX_TEXT_BYTES + 100);
        assert_eq!(truncate_text(long).len(), MAX_TEXT_BYTES);
    }

    #[test]
    fn test_sanitize_extracted_text_stx_midword() {
        let text = "probabilistic multi\x02horizon forecasting";
        assert_eq!(sanitize_extracted_text(text), "probabilistic multihorizon forecasting");
    }

    #[test]
    fn test_sanitize_extracted_text_preserves_whitespace() {
        let text = "Line one\nLine two\r\nLine three\tTabbed";
        assert_eq!(sanitize_extracted_text(text), text);
    }

    #[test]
    fn test_sanitize_extracted_text_strips_bom_and_replacement() {
        let text = "\u{FEFF}Hello \u{FFFD}world\u{00AD}test";
        assert_eq!(sanitize_extracted_text(text), "Hello worldtest");
    }
}
