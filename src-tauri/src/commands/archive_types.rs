use serde::{Deserialize, Serialize};

pub const ARCHIVE_FORMAT_VERSION: u32 = 1;

/// Manifest stored at the root of every .wren / .wrenitem archive.
#[derive(Debug, Serialize, Deserialize)]
pub struct ArchiveManifest {
    /// "wren" for full library, "wrenitem" for entries/collections.
    pub format: String,
    /// Archive format version (currently 1).
    pub version: u32,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// Wren app version that created the archive.
    pub app_version: String,
    /// Number of entries in the archive.
    pub entry_count: usize,
    /// Collection name (only for collection exports).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection_name: Option<String>,
    /// Collection key (only for collection exports).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExportResult {
    pub entries_exported: usize,
    pub files_exported: usize,
    pub archive_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveImportResult {
    pub entries_imported: usize,
    pub entries_skipped: usize,
    pub files_imported: usize,
    pub collections_imported: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreviewResult {
    pub format: String,
    pub version: u32,
    pub entry_count: usize,
    pub has_collections: bool,
    pub has_tags: bool,
    pub has_settings: bool,
    pub collection_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveProgress {
    pub current: usize,
    pub total: usize,
    pub current_entry: String,
    pub step: String,
}
