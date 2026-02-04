use tantivy::schema::{Schema, STORED, TEXT, FAST, STRING};

/// Field names for the full-text search index
pub struct SearchFields {
    pub entry_id: tantivy::schema::Field,
    pub entry_key: tantivy::schema::Field,
    pub attachment_id: tantivy::schema::Field,
    pub title: tantivy::schema::Field,
    pub creators: tantivy::schema::Field,
    pub abstract_text: tantivy::schema::Field,
    pub content: tantivy::schema::Field,
    pub item_type: tantivy::schema::Field,
    pub file_path: tantivy::schema::Field,
    pub content_source: tantivy::schema::Field,
}

impl SearchFields {
    pub fn new(schema: &Schema) -> Self {
        Self {
            entry_id: schema.get_field("entry_id").unwrap(),
            entry_key: schema.get_field("entry_key").unwrap(),
            attachment_id: schema.get_field("attachment_id").unwrap(),
            title: schema.get_field("title").unwrap(),
            creators: schema.get_field("creators").unwrap(),
            abstract_text: schema.get_field("abstract_text").unwrap(),
            content: schema.get_field("content").unwrap(),
            item_type: schema.get_field("item_type").unwrap(),
            file_path: schema.get_field("file_path").unwrap(),
            content_source: schema.get_field("content_source").unwrap(),
        }
    }
}

/// Build the Tantivy schema for full-text search
pub fn build_schema() -> Schema {
    let mut schema_builder = Schema::builder();

    // Entry identification - stored and fast for filtering/joining
    schema_builder.add_i64_field("entry_id", STORED | FAST);
    schema_builder.add_text_field("entry_key", STRING | STORED);

    // Attachment identification (optional, 0 if metadata-only)
    schema_builder.add_i64_field("attachment_id", STORED | FAST);

    // Searchable metadata fields - TEXT for full-text search, STORED for retrieval
    schema_builder.add_text_field("title", TEXT | STORED);
    schema_builder.add_text_field("creators", TEXT | STORED);
    schema_builder.add_text_field("abstract_text", TEXT | STORED);

    // Main content - TEXT only (not stored, too large)
    schema_builder.add_text_field("content", TEXT);

    // Classification fields
    schema_builder.add_text_field("item_type", STRING | STORED);
    schema_builder.add_text_field("file_path", STRING | STORED);

    // Content source: "metadata", "pdf", "note", "html", "markdown"
    schema_builder.add_text_field("content_source", STRING | STORED);

    schema_builder.build()
}
