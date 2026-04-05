use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A timestamped value for field-level merge (LWW register).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Timestamped<T> {
    /// The value.
    pub v: T,
    /// ISO 8601 timestamp of last modification.
    pub t: String,
}

impl<T> Timestamped<T> {
    pub fn new(v: T, t: String) -> Self {
        Self { v, t }
    }

    pub fn now(v: T) -> Self {
        Self {
            v,
            t: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }
    }
}

/// Metadata about creation and deletion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryMeta {
    pub created_at: String,
    pub created_by_device: Option<String>,
    pub deleted_at: Option<String>,
    pub deleted_by_device: Option<String>,
}

/// A creator within the entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryJsonCreator {
    pub key: String,
    pub creator_type: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    /// For institutional/organizational creators.
    pub name: Option<String>,
    pub sort_order: i32,
}

/// Tag entry in the add-wins set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagEntry {
    pub added: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<String>,
}

/// Collection membership in the add-wins set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionEntry {
    pub added: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<String>,
}

/// An attachment record (PDF, note, weblink, document).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentJson {
    pub key: String,
    #[serde(rename = "type")]
    pub attachment_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmatter: Option<String>,
    pub created_at: String,
}

/// An annotation on a PDF attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationJson {
    pub key: String,
    pub attachment_key: String,
    #[serde(rename = "type")]
    pub annotation_type: String,
    pub page_number: i32,
    pub position_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    pub comment: Timestamped<Option<String>>,
    pub color: Timestamped<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_index: Option<String>,
    pub created_at: String,
}

/// A link to another entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryLinkJson {
    pub target_entry_key: String,
    pub link_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    pub created_at: String,
}

/// Parsed content from LLM extraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedContentJson {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_used: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// An inline table embedded in a note.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineTableJson {
    pub key: String,
    pub title: String,
    pub columns_json: String,
    pub rows: Vec<InlineTableRowJson>,
    pub created_at: String,
    pub modified_at: String,
}

/// A row in an inline table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineTableRowJson {
    pub data_json: String,
    pub sort_order: i64,
}

/// Sharing metadata (present only on shared copies).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharingInfo {
    pub share_id: String,
    pub origin_user_id: String,
    pub origin_entry_key: String,
    pub role: String,
    pub received_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_remote_sync: Option<String>,
    #[serde(default)]
    pub detached: bool,
}

/// Private per-user data that never syncs to collaborators.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PrivateData {
    #[serde(default)]
    pub tags: HashMap<String, TagEntry>,
    #[serde(default)]
    pub collections: HashMap<String, CollectionEntry>,
}

/// Tombstone for a deleted sub-entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tombstone {
    #[serde(rename = "type")]
    pub tombstone_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub deleted_at: String,
}

/// The canonical entry.json format.
///
/// This is the source of truth for sync. SQLite is rebuilt from these files.
/// Field-level timestamps enable fine-grained merge across devices and users.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryJson {
    pub schema_version: u32,
    pub key: String,

    pub _meta: EntryMeta,

    // Core scalar fields with per-field timestamps
    pub item_type: Timestamped<String>,
    pub title: Timestamped<String>,
    pub date: Timestamped<Option<String>>,
    pub url: Timestamped<Option<String>>,
    pub access_date: Timestamped<Option<String>>,

    /// Dynamic EAV fields (DOI, abstractNote, volume, etc.)
    #[serde(default)]
    pub fields: HashMap<String, Timestamped<String>>,

    /// Creators as an atomic list (whole-list LWW)
    pub creators: Timestamped<Vec<EntryJsonCreator>>,

    /// Tags: add-wins set keyed by tag name
    #[serde(default)]
    pub tags: HashMap<String, TagEntry>,

    /// Collections: add-wins set keyed by collection UUID
    #[serde(default)]
    pub collections: HashMap<String, CollectionEntry>,

    /// Attachments (merged by key)
    #[serde(default)]
    pub attachments: Vec<AttachmentJson>,

    /// Annotations on attachments (merged by key)
    #[serde(default)]
    pub annotations: Vec<AnnotationJson>,

    /// Links to other entries (merged by target_key + link_type)
    #[serde(default)]
    pub links: Vec<EntryLinkJson>,

    /// Inline tables embedded in notes (merged by key)
    #[serde(default)]
    pub inline_tables: Vec<InlineTableJson>,

    /// LLM-parsed content (whole-block LWW)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_content: Option<Timestamped<ParsedContentJson>>,

    /// Sharing info (null for personal entries)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sharing: Option<SharingInfo>,

    /// Per-user private data (never shared)
    #[serde(default)]
    pub private: PrivateData,

    /// Tombstones for deleted sub-entities
    #[serde(default)]
    pub tombstones: Vec<Tombstone>,
}

pub const SCHEMA_VERSION: u32 = 2;

impl EntryJson {
    /// Write entry.json atomically (write to tmp, then rename).
    pub fn write_atomic(&self, dir: &std::path::Path) -> anyhow::Result<()> {
        std::fs::create_dir_all(dir)?;
        let tmp_path = dir.join(".entry.json.tmp");
        let final_path = dir.join("entry.json");
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&tmp_path, json)?;
        std::fs::rename(&tmp_path, &final_path)?;
        Ok(())
    }

    /// Read entry.json from a directory.
    pub fn read_from(dir: &std::path::Path) -> anyhow::Result<Self> {
        let path = dir.join("entry.json");
        let data = std::fs::read_to_string(&path)?;
        let entry: Self = serde_json::from_str(&data)?;
        Ok(entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let now = chrono::Utc::now()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let entry = EntryJson {
            schema_version: SCHEMA_VERSION,
            key: "test-uuid".to_string(),
            _meta: EntryMeta {
                created_at: now.clone(),
                created_by_device: Some("test-device".to_string()),
                deleted_at: None,
                deleted_by_device: None,
            },
            item_type: Timestamped::new("journalArticle".to_string(), now.clone()),
            title: Timestamped::new("Test Paper".to_string(), now.clone()),
            date: Timestamped::new(Some("2024-01-15".to_string()), now.clone()),
            url: Timestamped::new(None, now.clone()),
            access_date: Timestamped::new(None, now.clone()),
            fields: {
                let mut m = HashMap::new();
                m.insert(
                    "abstractNote".to_string(),
                    Timestamped::new("An abstract".to_string(), now.clone()),
                );
                m.insert(
                    "DOI".to_string(),
                    Timestamped::new("10.1234/test".to_string(), now.clone()),
                );
                m
            },
            creators: Timestamped::new(
                vec![EntryJsonCreator {
                    key: "cr-uuid".to_string(),
                    creator_type: "author".to_string(),
                    first_name: Some("Jane".to_string()),
                    last_name: Some("Doe".to_string()),
                    name: None,
                    sort_order: 0,
                }],
                now.clone(),
            ),
            tags: {
                let mut m = HashMap::new();
                m.insert(
                    "machine-learning".to_string(),
                    TagEntry {
                        added: now.clone(),
                        color: Some("#4CAF50".to_string()),
                        removed: None,
                    },
                );
                m
            },
            collections: HashMap::new(),
            attachments: vec![AttachmentJson {
                key: "att-uuid".to_string(),
                attachment_type: "pdf".to_string(),
                title: Some("Full Text".to_string()),
                file_name: Some("Doe - 2024 - Test Paper.pdf".to_string()),
                file_hash: Some("sha256:abc".to_string()),
                file_size: Some(1048576),
                url: None,
                page_count: Some(12),
                frontmatter: None,
                created_at: now.clone(),
            }],
            annotations: vec![AnnotationJson {
                key: "ann-uuid".to_string(),
                attachment_key: "att-uuid".to_string(),
                annotation_type: "highlight".to_string(),
                page_number: 3,
                position_json: "{}".to_string(),
                selected_text: Some("important text".to_string()),
                comment: Timestamped::new(Some("Key finding".to_string()), now.clone()),
                color: Timestamped::new("#FFEB3B".to_string(), now.clone()),
                sort_index: None,
                created_at: now.clone(),
            }],
            links: vec![],
            inline_tables: vec![],
            parsed_content: None,
            sharing: None,
            private: PrivateData::default(),
            tombstones: vec![],
        };

        let json = serde_json::to_string_pretty(&entry).unwrap();
        let parsed: EntryJson = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.key, "test-uuid");
        assert_eq!(parsed.title.v, "Test Paper");
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
        assert_eq!(parsed.annotations.len(), 1);
        assert_eq!(parsed.tags.len(), 1);
        assert!(parsed.tags.contains_key("machine-learning"));
    }
}
