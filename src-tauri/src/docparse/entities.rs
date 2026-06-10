//! Top-level entities returned by the document parser.

use std::time::Duration;

use super::blocks::Block;

/// A single rendered/analyzed page.
#[derive(Debug, Clone)]
pub struct Page {
    /// Whether this page required OCR (always true for image-based analysis).
    pub need_ocr: bool,
}

/// Metadata about a parse run.
#[derive(Debug, Clone)]
pub struct DocMetadata {
    /// Version of the parser that produced this document.
    pub parser_version: String,
    /// Wall-clock time spent parsing.
    pub parsing_duration: Duration,
}

/// A fully parsed document: pages, structured blocks, and metadata.
#[derive(Debug, Clone)]
pub struct ParsedDocument {
    pub pages: Vec<Page>,
    pub blocks: Vec<Block>,
    pub metadata: DocMetadata,
}
