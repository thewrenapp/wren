use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: i64,
    pub key: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub title: String,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: String,
    pub tags: Vec<Tag>,
    pub collections: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfItemDetails {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "pageCount")]
    pub page_count: Option<i32>,
    pub author: Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub doi: Option<String>,
    #[serde(rename = "publicationDate")]
    pub publication_date: Option<String>,
    pub publisher: Option<String>,
    pub journal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownItemDetails {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub frontmatter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    #[serde(rename = "itemCount")]
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    #[serde(rename = "itemCount")]
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemLink {
    pub id: i64,
    #[serde(rename = "sourceItemId")]
    pub source_item_id: i64,
    #[serde(rename = "targetItemId")]
    pub target_item_id: i64,
    #[serde(rename = "linkType")]
    pub link_type: String,
    #[serde(rename = "linkTypeDisplay")]
    pub link_type_display: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateItemInput {
    pub title: String,
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateItemInput {
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCollectionInput {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
    #[serde(rename = "valueType")]
    pub value_type: String,
}

// =====================================================
// NEW MODELS: Entry-Attachment System
// =====================================================

/// A creator (author, editor, etc.) for an entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Creator {
    #[serde(rename = "creatorType")]
    pub creator_type: String, // "author", "editor", "translator", etc.
    #[serde(rename = "firstName")]
    pub first_name: Option<String>,
    #[serde(rename = "lastName")]
    pub last_name: Option<String>,
    pub name: Option<String>, // For single-field names (institutions, etc.)
}

impl Creator {
    pub fn display_name(&self) -> String {
        if let Some(name) = &self.name {
            name.clone()
        } else {
            match (&self.first_name, &self.last_name) {
                (Some(first), Some(last)) => format!("{} {}", first, last),
                (None, Some(last)) => last.clone(),
                (Some(first), None) => first.clone(),
                (None, None) => String::new(),
            }
        }
    }

    pub fn short_name(&self) -> String {
        if let Some(name) = &self.name {
            name.clone()
        } else if let Some(last) = &self.last_name {
            last.clone()
        } else if let Some(first) = &self.first_name {
            first.clone()
        } else {
            String::new()
        }
    }
}

/// Entry type information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryType {
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub icon: Option<String>,
}

/// A library entry (paper, book, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub key: String,
    #[serde(rename = "entryType")]
    pub entry_type: String,
    #[serde(rename = "entryTypeDisplay")]
    pub entry_type_display: String,
    pub title: String,
    pub creators: Vec<Creator>,
    // Bibliographic metadata
    #[serde(rename = "publicationDate")]
    pub publication_date: Option<String>,
    pub doi: Option<String>,
    pub isbn: Option<String>,
    pub issn: Option<String>,
    pub url: Option<String>,
    pub publisher: Option<String>,
    pub journal: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub pages: Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    // Repository/Archive
    pub repository: Option<String>,
    #[serde(rename = "archiveId")]
    pub archive_id: Option<String>,
    // Additional
    pub language: Option<String>,
    pub rights: Option<String>,
    pub extra: Option<String>,
    // Timestamps
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: String,
    // Related data
    pub tags: Vec<Tag>,
    pub collections: Vec<String>,
    pub attachments: Vec<Attachment>,
    #[serde(rename = "attachmentCount")]
    pub attachment_count: i64,
}

impl Entry {
    /// Get the formatted creator string for display (e.g., "Smith et al." or "Smith & Jones")
    pub fn creators_display(&self) -> String {
        let authors: Vec<&Creator> = self.creators.iter()
            .filter(|c| c.creator_type == "author")
            .collect();

        match authors.len() {
            0 => String::new(),
            1 => authors[0].short_name(),
            2 => format!("{} & {}", authors[0].short_name(), authors[1].short_name()),
            _ => format!("{} et al.", authors[0].short_name()),
        }
    }

    /// Get the year from publication_date
    pub fn year(&self) -> Option<String> {
        self.publication_date.as_ref().map(|d| {
            d.split('-').next().unwrap_or(d).to_string()
        })
    }
}

/// Attachment type information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentType {
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub icon: Option<String>,
}

/// An attachment (PDF, note, weblink, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: i64,
    pub key: String,
    #[serde(rename = "entryId")]
    pub entry_id: i64,
    #[serde(rename = "attachmentType")]
    pub attachment_type: String,
    #[serde(rename = "attachmentTypeDisplay")]
    pub attachment_type_display: String,
    pub title: Option<String>,
    // File attachments
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    #[serde(rename = "fileHash")]
    pub file_hash: Option<String>,
    #[serde(rename = "fileSize")]
    pub file_size: Option<i64>,
    // URL attachments
    pub url: Option<String>,
    // PDF-specific
    #[serde(rename = "pageCount")]
    pub page_count: Option<i32>,
    // Note-specific
    pub frontmatter: Option<String>,
    // Thumbnail
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: Option<String>,
    // Timestamps
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: String,
}

/// Input for creating a new entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEntryInput {
    #[serde(rename = "entryType")]
    pub entry_type: String,
    pub title: String,
    pub creators: Option<Vec<Creator>>,
    #[serde(rename = "publicationDate")]
    pub publication_date: Option<String>,
    pub doi: Option<String>,
    pub isbn: Option<String>,
    pub issn: Option<String>,
    pub url: Option<String>,
    pub publisher: Option<String>,
    pub journal: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub pages: Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub repository: Option<String>,
    #[serde(rename = "archiveId")]
    pub archive_id: Option<String>,
    pub language: Option<String>,
    pub rights: Option<String>,
    pub extra: Option<String>,
}

/// Input for updating an entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEntryInput {
    #[serde(rename = "entryType")]
    pub entry_type: Option<String>,
    pub title: Option<String>,
    pub creators: Option<Vec<Creator>>,
    #[serde(rename = "publicationDate")]
    pub publication_date: Option<String>,
    pub doi: Option<String>,
    pub isbn: Option<String>,
    pub issn: Option<String>,
    pub url: Option<String>,
    pub publisher: Option<String>,
    pub journal: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub pages: Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub repository: Option<String>,
    #[serde(rename = "archiveId")]
    pub archive_id: Option<String>,
    pub language: Option<String>,
    pub rights: Option<String>,
    pub extra: Option<String>,
}

/// Input for creating an attachment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAttachmentInput {
    #[serde(rename = "entryId")]
    pub entry_id: i64,
    #[serde(rename = "attachmentType")]
    pub attachment_type: String,
    pub title: Option<String>,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    pub url: Option<String>,
}

/// Summary info for an entry (used in list views)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntrySummary {
    pub id: i64,
    pub key: String,
    #[serde(rename = "entryType")]
    pub entry_type: String,
    pub title: String,
    #[serde(rename = "creatorsDisplay")]
    pub creators_display: String,
    pub year: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: Option<String>,
    pub tags: Vec<Tag>,
    #[serde(rename = "attachmentCount")]
    pub attachment_count: i64,
    #[serde(rename = "hasPdf")]
    pub has_pdf: bool,
    #[serde(rename = "hasNote")]
    pub has_note: bool,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: Option<String>,
}
