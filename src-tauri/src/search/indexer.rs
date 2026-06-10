use anyhow::Result;
use std::path::Path;
use tantivy::{doc, IndexWriter, Term};
use tracing::info;

use super::extractor::{extract_text, ExtractionConfig, ExtractionMethod};
use crate::docparse::DocParser;
use super::schema::SearchFields;

/// Result of indexing an attachment
pub struct IndexingResult {
    /// Whether content was indexed
    pub indexed: bool,
    /// Extraction method used
    pub method: ExtractionMethod,
    /// Optional message
    pub message: Option<String>,
    /// Extracted text content (so callers can save markdown without re-extracting)
    pub extracted_text: Option<String>,
}

/// Data for indexing an entry's metadata
pub struct EntryMetadata {
    pub entry_id: i64,
    pub entry_key: String,
    pub title: Option<String>,
    pub creators: Option<String>,
    pub abstract_text: Option<String>,
    pub item_type: String,
}

/// Data for indexing an attachment's content
pub struct AttachmentData {
    pub entry_id: i64,
    pub entry_key: String,
    pub attachment_id: i64,
    pub title: Option<String>,
    pub file_path: String,
    pub content_source: String,
}

/// Data for indexing annotations (highlights, notes, comments)
pub struct AnnotationData {
    pub entry_id: i64,
    pub entry_key: String,
    pub attachment_id: i64,
    pub title: Option<String>,
    pub selected_text: Option<String>,
    pub comment: Option<String>,
}

/// Index an entry's metadata (without file content)
pub fn index_entry_metadata(
    writer: &IndexWriter,
    fields: &SearchFields,
    metadata: &EntryMetadata,
) -> Result<()> {
    let doc = doc!(
        fields.entry_id => metadata.entry_id,
        fields.entry_key => metadata.entry_key.clone(),
        fields.attachment_id => 0i64,
        fields.title => metadata.title.clone().unwrap_or_default(),
        fields.creators => metadata.creators.clone().unwrap_or_default(),
        fields.abstract_text => metadata.abstract_text.clone().unwrap_or_default(),
        fields.content => "",
        fields.item_type => metadata.item_type.clone(),
        fields.file_path => "",
        fields.content_source => "metadata",
    );

    writer.add_document(doc)?;
    info!("Indexed entry metadata: {} ({})", metadata.entry_key, metadata.entry_id);
    Ok(())
}

/// Index pre-extracted text content for an attachment (e.g. notes with expanded inline tables)
pub fn index_text_content(
    writer: &IndexWriter,
    fields: &SearchFields,
    attachment: &AttachmentData,
    text: &str,
) -> Result<IndexingResult> {
    if text.trim().is_empty() {
        return Ok(IndexingResult {
            indexed: false,
            method: ExtractionMethod::DirectRead,
            message: Some("No text content".to_string()),
            extracted_text: None,
        });
    }

    let doc = doc!(
        fields.entry_id => attachment.entry_id,
        fields.entry_key => attachment.entry_key.clone(),
        fields.attachment_id => attachment.attachment_id,
        fields.title => attachment.title.clone().unwrap_or_default(),
        fields.creators => "",
        fields.abstract_text => "",
        fields.content => text,
        fields.item_type => "",
        fields.file_path => attachment.file_path.clone(),
        fields.content_source => attachment.content_source.clone(),
    );

    writer.add_document(doc)?;
    info!(
        "Indexed pre-extracted text: {} ({}) - {} chars",
        attachment.file_path, attachment.attachment_id, text.len()
    );
    Ok(IndexingResult {
        indexed: true,
        method: ExtractionMethod::DirectRead,
        message: None,
        extracted_text: Some(text.to_string()),
    })
}

/// Index an attachment's content (PDF, markdown, HTML, etc.)
pub async fn index_attachment_content(
    writer: &IndexWriter,
    fields: &SearchFields,
    attachment: &AttachmentData,
    config: &ExtractionConfig,
    pdf_parser: Option<&DocParser>,
) -> Result<IndexingResult> {
    let path = Path::new(&attachment.file_path);

    // Extract text content
    let extraction = extract_text(path, config, pdf_parser).await?;

    if extraction.text.trim().is_empty() {
        info!(
            "No content extracted from attachment: {} ({}) - method: {}",
            attachment.file_path, attachment.attachment_id, extraction.method.as_str()
        );
        return Ok(IndexingResult {
            indexed: false,
            method: extraction.method,
            message: extraction.message.or(Some("No text content".to_string())),
            extracted_text: None,
        });
    }

    // Keep a copy of the text for callers (e.g., to save as markdown)
    let text_for_caller = extraction.text.clone();

    let doc = doc!(
        fields.entry_id => attachment.entry_id,
        fields.entry_key => attachment.entry_key.clone(),
        fields.attachment_id => attachment.attachment_id,
        fields.title => attachment.title.clone().unwrap_or_default(),
        fields.creators => "",
        fields.abstract_text => "",
        fields.content => extraction.text,
        fields.item_type => "",
        fields.file_path => attachment.file_path.clone(),
        fields.content_source => attachment.content_source.clone(),
    );

    writer.add_document(doc)?;
    info!(
        "Indexed attachment content: {} ({}) - method: {}",
        attachment.file_path, attachment.attachment_id, extraction.method.as_str()
    );
    Ok(IndexingResult {
        indexed: true,
        method: extraction.method,
        message: extraction.message,
        extracted_text: Some(text_for_caller),
    })
}

/// Index annotations (selected text + comments) for an attachment
pub fn index_annotations(
    writer: &IndexWriter,
    fields: &SearchFields,
    data: &AnnotationData,
) -> Result<()> {
    // Combine selected text and comments into searchable content
    let mut content_parts = Vec::new();
    if let Some(ref text) = data.selected_text
        && !text.trim().is_empty() {
            content_parts.push(text.clone());
        }
    if let Some(ref comment) = data.comment
        && !comment.trim().is_empty() {
            content_parts.push(comment.clone());
        }

    if content_parts.is_empty() {
        return Ok(());
    }

    let content = content_parts.join("\n");

    let doc = doc!(
        fields.entry_id => data.entry_id,
        fields.entry_key => data.entry_key.clone(),
        fields.attachment_id => data.attachment_id,
        fields.title => data.title.clone().unwrap_or_default(),
        fields.creators => "",
        fields.abstract_text => "",
        fields.content => content,
        fields.item_type => "",
        fields.file_path => "",
        fields.content_source => "annotation",
    );

    writer.add_document(doc)?;
    info!(
        "Indexed annotations for attachment: {} (entry: {})",
        data.attachment_id, data.entry_id
    );
    Ok(())
}

/// Delete all documents for an entry (metadata + attachments)
pub fn delete_entry(writer: &IndexWriter, fields: &SearchFields, entry_id: i64) -> Result<()> {
    let term = Term::from_field_i64(fields.entry_id, entry_id);
    writer.delete_term(term);
    info!("Deleted index documents for entry: {}", entry_id);
    Ok(())
}

/// Delete a specific attachment document
pub fn delete_attachment(
    writer: &IndexWriter,
    fields: &SearchFields,
    attachment_id: i64,
) -> Result<()> {
    let term = Term::from_field_i64(fields.attachment_id, attachment_id);
    writer.delete_term(term);
    info!("Deleted index document for attachment: {}", attachment_id);
    Ok(())
}
