use anyhow::Result;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

/// Maximum text size to extract (10MB)
pub const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

/// Minimum characters for extracted text to be worth saving as a markdown file.
/// Extractions shorter than this (e.g. OCR artifacts, stray words from images)
/// are still indexed for search but don't get a companion .md file.
pub const MIN_MARKDOWN_CHARS: usize = 100;

/// Configuration for text extraction
#[derive(Clone, Debug)]
pub struct ExtractionConfig {
    /// Whether to enable OCR for scanned documents and images
    pub enable_ocr: bool,
    /// Force OCR even for searchable PDFs (useful when pdfium text extraction is incomplete)
    pub force_ocr: bool,
}

impl Default for ExtractionConfig {
    fn default() -> Self {
        Self {
            enable_ocr: true,
            force_ocr: false,
        }
    }
}

/// Result of text extraction with method info
#[derive(Clone, Debug)]
pub struct ExtractionResult {
    /// Extracted text content
    pub text: String,
    /// Method used for extraction
    pub method: ExtractionMethod,
    /// Optional message (e.g., why a method failed)
    pub message: Option<String>,
}

/// Method used for text extraction
#[derive(Clone, Debug, PartialEq)]
pub enum ExtractionMethod {
    /// Extracted via kreuzberg (PDF, EPUB, HTML, DOCX, images, etc.)
    Kreuzberg,
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
            ExtractionMethod::Kreuzberg => "kreuzberg",
            ExtractionMethod::DirectRead => "direct",
            ExtractionMethod::Skipped => "skipped",
            ExtractionMethod::None => "none",
        }
    }
}

/// Extract text content from a file using kreuzberg
pub async fn extract_text(path: &Path, config: &ExtractionConfig) -> Result<ExtractionResult> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // For plain text and markdown files, read directly (no need for kreuzberg)
    if matches!(ext.as_str(), "md" | "txt" | "markdown" | "text") {
        let text = std::fs::read_to_string(path).unwrap_or_default();
        return Ok(ExtractionResult {
            text: truncate_text(text),
            method: ExtractionMethod::DirectRead,
            message: None,
        });
    }

    // Use kreuzberg for all other supported formats
    let result = extract_with_kreuzberg(path, config).await;

    match result {
        Ok(extraction) => Ok(ExtractionResult {
            text: truncate_text(extraction.text),
            ..extraction
        }),
        Err(e) => {
            warn!("Kreuzberg extraction failed for {}: {}", path.display(), e);
            Ok(ExtractionResult {
                text: String::new(),
                method: ExtractionMethod::None,
                message: Some(format!("Extraction failed: {}", e)),
            })
        }
    }
}

/// Extract text using kreuzberg library
async fn extract_with_kreuzberg(path: &Path, config: &ExtractionConfig) -> Result<ExtractionResult> {
    let kreuzberg_config = kreuzberg::ExtractionConfig {
        ocr: if config.enable_ocr {
            Some(kreuzberg::OcrConfig::default())
        } else {
            Option::None
        },
        force_ocr: config.force_ocr,
        output_format: kreuzberg::OutputFormat::Markdown,
        ..Default::default()
    };

    info!("Extracting text with kreuzberg: {}", path.display());
    let result = kreuzberg::extract_file(path, Option::<&str>::None, &kreuzberg_config).await?;

    let text = result.content;

    if text.trim().is_empty() {
        info!("Kreuzberg returned empty text for: {}", path.display());
        return Ok(ExtractionResult {
            text: String::new(),
            method: ExtractionMethod::Kreuzberg,
            message: Some("No text content extracted".to_string()),
        });
    }

    info!(
        "Kreuzberg extracted {} chars from: {}",
        text.len(),
        path.display()
    );

    Ok(ExtractionResult {
        text,
        method: ExtractionMethod::Kreuzberg,
        message: None,
    })
}

/// Returns true if the extracted text has enough substance to be worth saving
/// as a standalone markdown file.
pub fn is_worth_saving(text: &str) -> bool {
    text.trim().len() >= MIN_MARKDOWN_CHARS
}

/// Save extracted text as a markdown file alongside the original.
/// Uses `filename.pdf.md` naming (appends `.md`) so each attachment gets its own markdown
/// and files with the same stem but different extensions don't overwrite each other.
pub fn save_markdown(attachment_path: &Path, content: &str) -> Result<PathBuf> {
    let md_path = markdown_path_for(attachment_path);
    std::fs::write(&md_path, content)?;
    info!("Saved markdown to: {}", md_path.display());
    Ok(md_path)
}

/// Compute the expected markdown path for a given attachment file path.
/// e.g. `paper.pdf` → `paper.pdf.md`, `page.html` → `page.html.md`
pub fn markdown_path_for(attachment_path: &Path) -> PathBuf {
    let mut md_name = attachment_path
        .file_name()
        .unwrap_or_default()
        .to_os_string();
    md_name.push(".md");
    attachment_path.with_file_name(md_name)
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
        assert_eq!(ExtractionMethod::Kreuzberg.as_str(), "kreuzberg");
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
}
