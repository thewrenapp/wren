//! Structured content blocks produced by the document parser.
//!
//! These mirror the small surface that `search::parser` consumes, decoupling
//! it from any specific OCR/layout backend.

/// A single title/heading block.
#[derive(Debug, Clone)]
pub struct TitleBlock {
    pub text: String,
    /// Heading level (1 = document title, 2+ = section titles).
    pub level: u8,
}

/// A header/footer block (repetitive page chrome).
#[derive(Debug, Clone)]
pub struct HeaderFooterBlock {
    pub text: String,
}

/// A paragraph / body text block.
#[derive(Debug, Clone)]
pub struct TextBlock {
    pub text: String,
}

/// A bulleted/numbered list block.
#[derive(Debug, Clone)]
pub struct ListBlock {
    pub items: Vec<String>,
}

/// A single cell within a table row.
#[derive(Debug, Clone)]
pub struct TableCell {
    pub text: String,
}

/// A single row within a table.
#[derive(Debug, Clone)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
    pub is_header: bool,
}

/// A table block composed of rows.
#[derive(Debug, Clone)]
pub struct TableBlock {
    pub rows: Vec<TableRow>,
}

/// An image / figure block (no extractable text).
#[derive(Debug, Clone)]
pub struct ImageBlock;

/// The kind of a [`Block`].
#[derive(Debug, Clone)]
pub enum BlockType {
    Title(TitleBlock),
    Header(HeaderFooterBlock),
    Footer(HeaderFooterBlock),
    TextBlock(TextBlock),
    ListBlock(ListBlock),
    Table(TableBlock),
    Image(ImageBlock),
}

/// A positioned block within a parsed document.
#[derive(Debug, Clone)]
pub struct Block {
    /// 0-indexed page id(s) this block belongs to.
    pub pages_id: Vec<usize>,
    pub kind: BlockType,
}
