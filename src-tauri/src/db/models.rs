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
