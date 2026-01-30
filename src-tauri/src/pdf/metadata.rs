use anyhow::{Context, Result};
use lopdf::Document;
use std::path::Path;

/// Extracted PDF metadata
#[derive(Debug, Clone, Default)]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub page_count: i32,
}

/// Extract metadata from a PDF file using lopdf
pub fn extract_metadata(path: &Path) -> Result<PdfMetadata> {
    let doc = Document::load(path)
        .with_context(|| format!("Failed to load PDF: {}", path.display()))?;

    let page_count = doc.get_pages().len() as i32;

    // Try to get document info dictionary
    let mut metadata = PdfMetadata {
        page_count,
        ..Default::default()
    };

    // Get trailer reference to info dictionary
    if let Ok(info_ref) = doc.trailer.get(b"Info") {
        if let Ok(info_ref) = info_ref.as_reference() {
            if let Ok(info) = doc.get_dictionary(info_ref) {
                metadata.title = get_text_string(info, b"Title");
                metadata.author = get_text_string(info, b"Author");
                metadata.subject = get_text_string(info, b"Subject");
                metadata.keywords = get_text_string(info, b"Keywords");
                metadata.creator = get_text_string(info, b"Creator");
                metadata.producer = get_text_string(info, b"Producer");
            }
        }
    }

    Ok(metadata)
}

/// Helper to extract a text string from a PDF dictionary
fn get_text_string(dict: &lopdf::Dictionary, key: &[u8]) -> Option<String> {
    dict.get(key)
        .ok()
        .and_then(|obj| {
            match obj {
                lopdf::Object::String(bytes, _) => {
                    // Try UTF-16BE first (starts with BOM)
                    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
                        decode_utf16be(&bytes[2..])
                    } else {
                        // Try as Latin-1/Windows-1252
                        Some(bytes.iter().map(|&b| b as char).collect::<String>())
                    }
                }
                lopdf::Object::Name(name) => String::from_utf8(name.clone()).ok(),
                _ => None,
            }
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Decode UTF-16BE bytes to a String
fn decode_utf16be(bytes: &[u8]) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }

    let chars: Vec<u16> = bytes
        .chunks(2)
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect();

    String::from_utf16(&chars).ok()
}

/// Extract text content from PDF for indexing
/// This is a basic implementation - full text extraction can be slow for large PDFs
pub fn extract_text(path: &Path) -> Result<String> {
    let output = pdf_extract::extract_text(path)
        .with_context(|| format!("Failed to extract text from PDF: {}", path.display()))?;

    Ok(output)
}
