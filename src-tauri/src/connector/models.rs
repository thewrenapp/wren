use serde::{Deserialize, Serialize};

/// A creator from the Zotero translator format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorCreator {
    #[serde(rename = "creatorType", default = "default_creator_type")]
    pub creator_type: String,
    #[serde(rename = "firstName")]
    pub first_name: Option<String>,
    #[serde(rename = "lastName")]
    pub last_name: Option<String>,
    pub name: Option<String>,
}

fn default_creator_type() -> String {
    "author".to_string()
}

/// A tag from the Zotero translator format
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConnectorTag {
    Simple(String),
    Object {
        tag: String,
        #[serde(rename = "type")]
        tag_type: Option<i32>,
    },
}

impl ConnectorTag {
    pub fn value(&self) -> &str {
        match self {
            ConnectorTag::Simple(s) => s,
            ConnectorTag::Object { tag, .. } => tag,
        }
    }
}

/// An attachment from the Zotero translator format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorAttachment {
    pub title: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub snapshot: Option<bool>,
    pub referrer: Option<String>,
}

/// A single item as produced by Zotero translators
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorItem {
    #[serde(rename = "itemType")]
    pub item_type: String,
    pub title: String,
    #[serde(default)]
    pub creators: Vec<ConnectorCreator>,
    pub date: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
    #[serde(rename = "abstractNote")]
    pub abstract_note: Option<String>,
    #[serde(rename = "publicationTitle")]
    pub publication_title: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub pages: Option<String>,
    pub publisher: Option<String>,
    #[serde(rename = "ISBN")]
    pub isbn: Option<String>,
    #[serde(rename = "ISSN")]
    pub issn: Option<String>,
    pub language: Option<String>,
    #[serde(rename = "journalAbbreviation")]
    pub journal_abbreviation: Option<String>,
    #[serde(rename = "bookTitle")]
    pub book_title: Option<String>,
    #[serde(rename = "conferenceName")]
    pub conference_name: Option<String>,
    pub institution: Option<String>,
    pub university: Option<String>,
    #[serde(rename = "archiveID")]
    pub archive_id: Option<String>,
    pub archive: Option<String>,
    #[serde(rename = "accessDate")]
    pub access_date: Option<String>,
    #[serde(default)]
    pub tags: Vec<ConnectorTag>,
    #[serde(default)]
    pub attachments: Vec<ConnectorAttachment>,
    #[serde(default)]
    pub notes: Vec<ConnectorNote>,
}

/// A note from the Zotero translator format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorNote {
    pub note: Option<String>,
}

/// Request body for POST /connector/saveItems
/// Compatible with the Zotero connector protocol format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveItemsRequest {
    pub items: Vec<ConnectorItem>,
    /// Zotero connector protocol fields (accepted but not required)
    #[serde(rename = "sessionID")]
    pub session_id: Option<String>,
    pub uri: Option<String>,
    pub proxy: Option<serde_json::Value>,
    #[serde(rename = "detailedCookies")]
    pub detailed_cookies: Option<String>,
    /// Wren-specific fields
    #[serde(rename = "collectionId")]
    pub collection_id: Option<i64>,
}

/// A saved entry in the response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedEntry {
    pub id: i64,
    pub key: String,
    pub title: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
}

/// Response for POST /connector/saveItems
/// Compatible with the Zotero connector protocol response format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveItemsResponse {
    pub items: Vec<SavedEntry>,
}

/// Response for GET /connector/ping
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResponse {
    pub status: String,
    pub version: String,
    pub name: String,
}

/// Response for GET /connector/collections
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub id: i64,
    pub name: String,
    #[serde(rename = "parentId")]
    pub parent_id: Option<i64>,
}

/// Response for GET /connector/collections
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionsResponse {
    pub collections: Vec<CollectionInfo>,
}
