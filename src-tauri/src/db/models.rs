use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// =====================================================
// SCHEMA TYPES (Item Types, Fields, Creator Types)
// =====================================================

/// Item type definition (journalArticle, book, thesis, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemType {
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "cslType")]
    pub csl_type: Option<String>,
    pub icon: Option<String>,
}

/// Field definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDefinition {
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "cslField")]
    pub csl_field: Option<String>,
    #[serde(rename = "fieldType")]
    pub field_type: String, // "text", "date", "number", "url", "identifier"
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
    #[serde(rename = "isRequired")]
    pub is_required: bool,
}

/// Creator type definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorType {
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "cslType")]
    pub csl_type: Option<String>,
}

/// Creator type with primary flag for a specific item type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorTypeInfo {
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "isPrimary")]
    pub is_primary: bool,
}

/// Complete item type info with valid fields and creator types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemTypeInfo {
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "cslType")]
    pub csl_type: Option<String>,
    pub icon: Option<String>,
    pub fields: Vec<FieldDefinition>,
    #[serde(rename = "creatorTypes")]
    pub creator_types: Vec<CreatorTypeInfo>,
}

// =====================================================
// ENTRY & CREATOR MODELS
// =====================================================

/// A creator (author, editor, etc.) for an entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Creator {
    pub id: Option<i64>,
    #[serde(rename = "creatorType")]
    pub creator_type: String,
    #[serde(rename = "creatorTypeDisplay")]
    pub creator_type_display: Option<String>,
    #[serde(rename = "firstName")]
    pub first_name: Option<String>,
    #[serde(rename = "lastName")]
    pub last_name: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
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

/// A library entry (paper, book, etc.) with dynamic fields
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub key: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
    #[serde(rename = "itemTypeDisplay")]
    pub item_type_display: String,
    pub title: String,
    pub date: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "accessDate")]
    pub access_date: Option<String>,
    pub creators: Vec<Creator>,
    /// Dynamic fields stored as key-value pairs
    pub fields: HashMap<String, String>,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: String,
    pub tags: Vec<Tag>,
    pub collections: Vec<i64>,
    pub attachments: Vec<Attachment>,
}

impl Entry {
    /// Get the formatted creator string for display
    pub fn creators_display(&self) -> String {
        let primary_creators: Vec<&Creator> = self.creators.iter()
            .filter(|c| c.sort_order == 0 || c.creator_type == "author")
            .collect();

        match primary_creators.len() {
            0 => {
                // Fall back to first creator
                self.creators.first()
                    .map(|c| c.short_name())
                    .unwrap_or_default()
            }
            1 => primary_creators[0].short_name(),
            2 => format!("{} & {}", primary_creators[0].short_name(), primary_creators[1].short_name()),
            _ => format!("{} et al.", primary_creators[0].short_name()),
        }
    }

    /// Get the year from date field
    pub fn year(&self) -> Option<String> {
        self.date.as_ref().map(|d| {
            d.split('-').next().unwrap_or(d).to_string()
        })
    }

    /// Get a field value by name
    pub fn get_field(&self, name: &str) -> Option<&String> {
        self.fields.get(name)
    }
}

/// Summary info for an entry (used in list views)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntrySummary {
    pub id: i64,
    pub key: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
    #[serde(rename = "itemTypeDisplay")]
    pub item_type_display: String,
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
    #[serde(rename = "hasWeblink")]
    pub has_weblink: bool,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: Option<String>,
}

// =====================================================
// ATTACHMENT MODELS
// =====================================================

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
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    #[serde(rename = "fileHash")]
    pub file_hash: Option<String>,
    #[serde(rename = "fileSize")]
    pub file_size: Option<i64>,
    pub url: Option<String>,
    #[serde(rename = "pageCount")]
    pub page_count: Option<i32>,
    pub frontmatter: Option<String>,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: String,
}

// =====================================================
// TAG & COLLECTION MODELS
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    #[serde(rename = "itemCount")]
    pub item_count: i64,
    #[serde(rename = "isImported")]
    pub is_imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<i64>,
    #[serde(rename = "itemCount")]
    pub item_count: i64,
}

// =====================================================
// INPUT TYPES
// =====================================================

/// Input for creating a new entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEntryInput {
    #[serde(rename = "itemType")]
    pub item_type: String,
    pub title: String,
    pub date: Option<String>,
    pub url: Option<String>,
    pub creators: Option<Vec<CreatorInput>>,
    pub fields: Option<HashMap<String, String>>,
}

/// Input for updating an entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEntryInput {
    #[serde(rename = "itemType")]
    pub item_type: Option<String>,
    pub title: Option<String>,
    pub date: Option<String>,
    pub url: Option<String>,
    pub creators: Option<Vec<CreatorInput>>,
    pub fields: Option<HashMap<String, String>>,
}

/// Input for creating/updating a creator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorInput {
    #[serde(rename = "creatorType")]
    pub creator_type: String,
    #[serde(rename = "firstName")]
    pub first_name: Option<String>,
    #[serde(rename = "lastName")]
    pub last_name: Option<String>,
    pub name: Option<String>,
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

/// Input for creating a collection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCollectionInput {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<i64>,
}

// =====================================================
// LINK MODELS
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryLink {
    pub id: i64,
    #[serde(rename = "sourceEntryId")]
    pub source_entry_id: i64,
    #[serde(rename = "targetEntryId")]
    pub target_entry_id: i64,
    #[serde(rename = "linkType")]
    pub link_type: String,
    #[serde(rename = "linkTypeDisplay")]
    pub link_type_display: String,
    pub context: Option<String>,
}

// =====================================================
// SETTINGS
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
    #[serde(rename = "valueType")]
    pub value_type: String,
}

// =====================================================
// SAVED SEARCH MODELS (Smart Filters)
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSearchCriterion {
    pub field: String,
    pub operator: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSearch {
    pub id: i64,
    pub name: String,
    #[serde(rename = "matchMode")]
    pub match_mode: String,
    pub criteria: Vec<SavedSearchCriterion>,
    pub scope: String,
    #[serde(rename = "collectionId")]
    pub collection_id: Option<i64>,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSavedSearchInput {
    pub name: String,
    #[serde(rename = "matchMode")]
    pub match_mode: String,
    pub criteria: Vec<SavedSearchCriterion>,
    pub scope: String,
    #[serde(rename = "collectionId")]
    pub collection_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSavedSearchInput {
    pub name: Option<String>,
    #[serde(rename = "matchMode")]
    pub match_mode: Option<String>,
    pub criteria: Option<Vec<SavedSearchCriterion>>,
    pub scope: Option<String>,
    #[serde(rename = "collectionId")]
    pub collection_id: Option<i64>,
}
