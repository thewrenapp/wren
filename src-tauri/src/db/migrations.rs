use anyhow::Result;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    tracing::info!("Running database migrations");

    // Create tables
    sqlx::query(SCHEMA)
        .execute(pool)
        .await?;

    // Insert default data
    sqlx::query(SEED_DATA)
        .execute(pool)
        .await?;

    // Run data migration from old schema to new schema (if needed)
    migrate_items_to_entries(pool).await?;

    tracing::info!("Database migrations complete");
    Ok(())
}

/// Migrate existing items (PDFs, notes) to the new entry/attachment schema
/// This is a one-time migration that converts:
/// - Each PDF item → Entry (journal_article) + PDF Attachment
/// - Each Markdown item → Entry (document) + Note Attachment
async fn migrate_items_to_entries(pool: &SqlitePool) -> Result<()> {
    // Check if migration has already been done
    let migration_done: Option<i64> = sqlx::query_scalar(
        "SELECT version FROM schema_migrations WHERE version = 1"
    )
    .fetch_optional(pool)
    .await?;

    if migration_done.is_some() {
        tracing::info!("Item to entry migration already completed");
        return Ok(());
    }

    // Check if there are any old items to migrate
    let item_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM items WHERE is_deleted = 0"
    )
    .fetch_one(pool)
    .await?;

    if item_count == 0 {
        tracing::info!("No items to migrate");
        // Mark migration as done even if no items
        sqlx::query("INSERT INTO schema_migrations (version, name) VALUES (1, 'items_to_entries')")
            .execute(pool)
            .await?;
        return Ok(());
    }

    tracing::info!("Migrating {} items to entries", item_count);

    // Get entry type IDs
    let journal_article_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM entry_types WHERE name = 'journal_article'"
    )
    .fetch_one(pool)
    .await?;

    let document_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM entry_types WHERE name = 'document'"
    )
    .fetch_one(pool)
    .await?;

    // Get attachment type IDs
    let pdf_attachment_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM attachment_types WHERE name = 'pdf'"
    )
    .fetch_one(pool)
    .await?;

    let note_attachment_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM attachment_types WHERE name = 'note'"
    )
    .fetch_one(pool)
    .await?;

    // Migrate PDF items
    let pdf_items = sqlx::query(
        r#"
        SELECT i.id, i.key, i.title, i.date_added, i.date_modified,
               p.file_path, p.file_hash, p.file_size, p.page_count,
               p.author, p.abstract_text, p.doi, p.publication_date,
               p.publisher, p.journal, p.volume, p.issue, p.pages,
               p.text_extracted, p.embedded
        FROM items i
        JOIN pdf_items p ON p.item_id = i.id
        WHERE i.is_deleted = 0
        "#
    )
    .fetch_all(pool)
    .await?;

    for row in pdf_items {
        let old_item_id: i64 = row.get("id");
        let entry_key = Uuid::new_v4().to_string();
        let attachment_key = Uuid::new_v4().to_string();
        let title: String = row.get("title");
        let date_added: String = row.get("date_added");
        let date_modified: String = row.get("date_modified");
        let author: Option<String> = row.get("author");
        let abstract_text: Option<String> = row.get("abstract_text");
        let doi: Option<String> = row.get("doi");
        let publication_date: Option<String> = row.get("publication_date");
        let publisher: Option<String> = row.get("publisher");
        let journal: Option<String> = row.get("journal");
        let volume: Option<String> = row.get("volume");
        let issue: Option<String> = row.get("issue");
        let pages: Option<String> = row.get("pages");

        // Convert author string to JSON array of creators
        let creators_json = author.as_ref().map(|a| {
            let creators: Vec<serde_json::Value> = a.split(';')
                .map(|name| name.trim())
                .filter(|name| !name.is_empty())
                .map(|name| {
                    serde_json::json!({
                        "creatorType": "author",
                        "name": name
                    })
                })
                .collect();
            serde_json::to_string(&creators).unwrap_or_default()
        });

        // Insert entry
        let entry_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO entries (
                key, entry_type_id, title, creators, publication_date,
                doi, publisher, journal, volume, issue, pages, abstract_text,
                date_added, date_modified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&entry_key)
        .bind(journal_article_type_id)
        .bind(&title)
        .bind(&creators_json)
        .bind(&publication_date)
        .bind(&doi)
        .bind(&publisher)
        .bind(&journal)
        .bind(&volume)
        .bind(&issue)
        .bind(&pages)
        .bind(&abstract_text)
        .bind(&date_added)
        .bind(&date_modified)
        .fetch_one(pool)
        .await?;

        // Insert PDF attachment
        let file_path: String = row.get("file_path");
        let file_hash: String = row.get("file_hash");
        let file_size: i64 = row.get("file_size");
        let page_count: Option<i32> = row.get("page_count");
        let text_extracted: i32 = row.get("text_extracted");
        let embedded: i32 = row.get("embedded");

        let attachment_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO attachments (
                key, entry_id, attachment_type_id, title,
                file_path, file_hash, file_size, page_count,
                text_extracted, embedded, date_added, date_modified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&attachment_key)
        .bind(entry_id)
        .bind(pdf_attachment_type_id)
        .bind(&title)
        .bind(&file_path)
        .bind(&file_hash)
        .bind(file_size)
        .bind(page_count)
        .bind(text_extracted)
        .bind(embedded)
        .bind(&date_added)
        .bind(&date_modified)
        .fetch_one(pool)
        .await?;

        // Migrate tags
        sqlx::query(
            r#"
            INSERT INTO entry_tags (entry_id, tag_id)
            SELECT ?, tag_id FROM item_tags WHERE item_id = ?
            "#
        )
        .bind(entry_id)
        .bind(old_item_id)
        .execute(pool)
        .await?;

        // Migrate collections
        sqlx::query(
            r#"
            INSERT INTO collection_entries (collection_id, entry_id, order_index, date_added)
            SELECT collection_id, ?, order_index, date_added
            FROM collection_items WHERE item_id = ?
            "#
        )
        .bind(entry_id)
        .bind(old_item_id)
        .execute(pool)
        .await?;

        // Migrate annotations
        sqlx::query(
            r#"
            INSERT INTO attachment_annotations (
                key, attachment_id, annotation_type_id, page_number,
                position_json, selected_text, comment, color,
                date_added, date_modified, sort_index
            )
            SELECT key, ?, annotation_type_id, page_number,
                   position_json, selected_text, comment, color,
                   date_added, date_modified, sort_index
            FROM annotations WHERE item_id = ?
            "#
        )
        .bind(attachment_id)
        .bind(old_item_id)
        .execute(pool)
        .await?;
    }

    // Migrate Markdown items
    let md_items = sqlx::query(
        r#"
        SELECT i.id, i.key, i.title, i.date_added, i.date_modified,
               m.file_path, m.file_hash, m.frontmatter, m.embedded
        FROM items i
        JOIN markdown_items m ON m.item_id = i.id
        WHERE i.is_deleted = 0
        "#
    )
    .fetch_all(pool)
    .await?;

    for row in md_items {
        let old_item_id: i64 = row.get("id");
        let entry_key = Uuid::new_v4().to_string();
        let attachment_key = Uuid::new_v4().to_string();
        let title: String = row.get("title");
        let date_added: String = row.get("date_added");
        let date_modified: String = row.get("date_modified");

        // Insert entry
        let entry_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO entries (
                key, entry_type_id, title, date_added, date_modified
            ) VALUES (?, ?, ?, ?, ?)
            RETURNING id
            "#
        )
        .bind(&entry_key)
        .bind(document_type_id)
        .bind(&title)
        .bind(&date_added)
        .bind(&date_modified)
        .fetch_one(pool)
        .await?;

        // Insert note attachment
        let file_path: String = row.get("file_path");
        let file_hash: String = row.get("file_hash");
        let frontmatter: Option<String> = row.get("frontmatter");
        let embedded: i32 = row.get("embedded");

        sqlx::query(
            r#"
            INSERT INTO attachments (
                key, entry_id, attachment_type_id, title,
                file_path, file_hash, frontmatter, embedded,
                date_added, date_modified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&attachment_key)
        .bind(entry_id)
        .bind(note_attachment_type_id)
        .bind(&title)
        .bind(&file_path)
        .bind(&file_hash)
        .bind(&frontmatter)
        .bind(embedded)
        .bind(&date_added)
        .bind(&date_modified)
        .execute(pool)
        .await?;

        // Migrate tags
        sqlx::query(
            r#"
            INSERT INTO entry_tags (entry_id, tag_id)
            SELECT ?, tag_id FROM item_tags WHERE item_id = ?
            "#
        )
        .bind(entry_id)
        .bind(old_item_id)
        .execute(pool)
        .await?;

        // Migrate collections
        sqlx::query(
            r#"
            INSERT INTO collection_entries (collection_id, entry_id, order_index, date_added)
            SELECT collection_id, ?, order_index, date_added
            FROM collection_items WHERE item_id = ?
            "#
        )
        .bind(entry_id)
        .bind(old_item_id)
        .execute(pool)
        .await?;
    }

    // Migrate item links to entry links
    sqlx::query(
        r#"
        INSERT INTO entry_links (source_entry_id, target_entry_id, link_type_id, context, date_added)
        SELECT
            (SELECT e.id FROM entries e
             JOIN attachments a ON a.entry_id = e.id
             WHERE a.file_path = (SELECT file_path FROM pdf_items WHERE item_id = il.source_item_id)
             LIMIT 1),
            (SELECT e.id FROM entries e
             JOIN attachments a ON a.entry_id = e.id
             WHERE a.file_path = (SELECT file_path FROM pdf_items WHERE item_id = il.target_item_id)
             LIMIT 1),
            il.link_type_id,
            il.context,
            il.date_added
        FROM item_links il
        WHERE EXISTS (SELECT 1 FROM pdf_items WHERE item_id = il.source_item_id)
          AND EXISTS (SELECT 1 FROM pdf_items WHERE item_id = il.target_item_id)
        "#
    )
    .execute(pool)
    .await
    .ok(); // Ignore errors - links are optional

    // Mark migration as complete
    sqlx::query("INSERT INTO schema_migrations (version, name) VALUES (1, 'items_to_entries')")
        .execute(pool)
        .await?;

    tracing::info!("Migration complete: {} items migrated to entries", item_count);
    Ok(())
}

const SCHEMA: &str = r#"
-- Item types
CREATE TABLE IF NOT EXISTS item_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL
);

-- Core items table
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type_id INTEGER NOT NULL REFERENCES item_types(id),
    key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type_id);
CREATE INDEX IF NOT EXISTS idx_items_date_added ON items(date_added);
CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(is_deleted);

-- PDF-specific data
CREATE TABLE IF NOT EXISTS pdf_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    page_count INTEGER,
    author TEXT,
    abstract_text TEXT,
    doi TEXT,
    publication_date TEXT,
    publisher TEXT,
    journal TEXT,
    volume TEXT,
    issue TEXT,
    pages TEXT,
    keywords TEXT,
    text_extracted INTEGER NOT NULL DEFAULT 0,
    embedded INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pdf_items_hash ON pdf_items(file_hash);
CREATE INDEX IF NOT EXISTS idx_pdf_items_doi ON pdf_items(doi);

-- Markdown notes
CREATE TABLE IF NOT EXISTS markdown_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    frontmatter TEXT,
    embedded INTEGER NOT NULL DEFAULT 0
);

-- Collections (flat)
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Collection items
CREATE TABLE IF NOT EXISTS collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(collection_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_item ON collection_items(item_id);

-- Tags (flat)
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT,
    date_added TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- Item tags
CREATE TABLE IF NOT EXISTS item_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    UNIQUE(item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);

-- Link types
CREATE TABLE IF NOT EXISTS link_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    inverse_name TEXT
);

-- Item links (bidirectional)
CREATE TABLE IF NOT EXISTS item_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    target_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    link_type_id INTEGER NOT NULL REFERENCES link_types(id),
    context TEXT,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_item_id, target_item_id, link_type_id),
    CHECK(source_item_id != target_item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_links_source ON item_links(source_item_id);
CREATE INDEX IF NOT EXISTS idx_item_links_target ON item_links(target_item_id);

-- Annotation types
CREATE TABLE IF NOT EXISTS annotation_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- PDF Annotations (references entries, not items)
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    annotation_type_id INTEGER NOT NULL REFERENCES annotation_types(id),
    page_number INTEGER NOT NULL,
    position_json TEXT NOT NULL,
    selected_text TEXT,
    comment TEXT,
    color TEXT NOT NULL DEFAULT '#FFEB3B',
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now')),
    sort_index TEXT
);

CREATE INDEX IF NOT EXISTS idx_annotations_item ON annotations(item_id);
CREATE INDEX IF NOT EXISTS idx_annotations_page ON annotations(item_id, page_number);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tab state
CREATE TABLE IF NOT EXISTS tab_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    tab_type TEXT NOT NULL,
    tab_data TEXT,
    order_index INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    date_opened TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tab_state_order ON tab_state(order_index);

-- Search index status
CREATE TABLE IF NOT EXISTS search_index_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    fulltext_indexed INTEGER NOT NULL DEFAULT 0,
    fulltext_indexed_at TEXT,
    embedding_indexed INTEGER NOT NULL DEFAULT 0,
    embedding_indexed_at TEXT,
    last_content_hash TEXT
);

-- FTS5 for quick search
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    title,
    content,
    item_id UNINDEXED,
    content='',
    tokenize='porter unicode61'
);

-- =====================================================
-- NEW SCHEMA: Entry-Attachment Model (Zotero-like)
-- =====================================================

-- Entry types (paper, book, thesis, etc.)
CREATE TABLE IF NOT EXISTS entry_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    icon TEXT
);

-- Core entries table (main library entity)
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    entry_type_id INTEGER NOT NULL REFERENCES entry_types(id),
    title TEXT NOT NULL,
    -- Creators (stored as JSON array for multiple authors/editors)
    creators TEXT,
    -- Bibliographic metadata
    publication_date TEXT,
    doi TEXT,
    isbn TEXT,
    issn TEXT,
    url TEXT,
    publisher TEXT,
    journal TEXT,
    volume TEXT,
    issue TEXT,
    pages TEXT,
    abstract_text TEXT,
    -- Repository/Archive info
    repository TEXT,
    archive_id TEXT,
    -- Additional fields
    language TEXT,
    rights TEXT,
    extra TEXT,
    -- Timestamps
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type_id);
CREATE INDEX IF NOT EXISTS idx_entries_date_added ON entries(date_added);
CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(is_deleted);
CREATE INDEX IF NOT EXISTS idx_entries_doi ON entries(doi);
CREATE INDEX IF NOT EXISTS idx_entries_title ON entries(title);

-- Attachment types
CREATE TABLE IF NOT EXISTS attachment_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    icon TEXT
);

-- Attachments (children of entries)
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    attachment_type_id INTEGER NOT NULL REFERENCES attachment_types(id),
    title TEXT,
    -- File attachments (PDF, note, snapshot)
    file_path TEXT,
    file_hash TEXT,
    file_size INTEGER,
    -- URL attachments (weblinks)
    url TEXT,
    -- PDF-specific
    page_count INTEGER,
    -- Note-specific
    frontmatter TEXT,
    -- Thumbnail (path to generated thumbnail image)
    thumbnail_path TEXT,
    -- Processing status
    text_extracted INTEGER NOT NULL DEFAULT 0,
    embedded INTEGER NOT NULL DEFAULT 0,
    -- Timestamps
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);
CREATE INDEX IF NOT EXISTS idx_attachments_type ON attachments(attachment_type_id);
CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(file_hash);

-- Entry tags (link entries to tags)
CREATE TABLE IF NOT EXISTS entry_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    UNIQUE(entry_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

-- Collection entries (link entries to collections)
CREATE TABLE IF NOT EXISTS collection_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(collection_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_entries_collection ON collection_entries(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_entries_entry ON collection_entries(entry_id);

-- Entry links (related entries)
CREATE TABLE IF NOT EXISTS entry_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    target_entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    link_type_id INTEGER NOT NULL REFERENCES link_types(id),
    context TEXT,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_entry_id, target_entry_id, link_type_id),
    CHECK(source_entry_id != target_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_links_source ON entry_links(source_entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_links_target ON entry_links(target_entry_id);

-- Annotations on attachments (PDF annotations)
CREATE TABLE IF NOT EXISTS attachment_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    annotation_type_id INTEGER NOT NULL REFERENCES annotation_types(id),
    page_number INTEGER NOT NULL,
    position_json TEXT NOT NULL,
    selected_text TEXT,
    comment TEXT,
    color TEXT NOT NULL DEFAULT '#FFEB3B',
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now')),
    sort_index TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachment_annotations_attachment ON attachment_annotations(attachment_id);
CREATE INDEX IF NOT EXISTS idx_attachment_annotations_page ON attachment_annotations(attachment_id, page_number);

-- FTS5 for entries search
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    title,
    creators,
    abstract_text,
    entry_id UNINDEXED,
    content='',
    tokenize='porter unicode61'
);

-- Tab state for entries (new system)
CREATE TABLE IF NOT EXISTS entry_tab_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
    attachment_id INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
    tab_type TEXT NOT NULL,
    tab_data TEXT,
    order_index INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    date_opened TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entry_tab_state_order ON entry_tab_state(order_index);

-- Migration status tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

const SEED_DATA: &str = r#"
-- Insert item types if not exists
INSERT OR IGNORE INTO item_types (id, name, display_name) VALUES
    (1, 'pdf', 'PDF Document'),
    (2, 'markdown', 'Markdown Note');

-- Insert link types if not exists
INSERT OR IGNORE INTO link_types (id, name, display_name, inverse_name) VALUES
    (1, 'references', 'References', 'Referenced by'),
    (2, 'cites', 'Cites', 'Cited by'),
    (3, 'summarizes', 'Summarizes', 'Summarized by'),
    (4, 'contradicts', 'Contradicts', 'Contradicted by'),
    (5, 'supports', 'Supports', 'Supported by'),
    (6, 'extends', 'Extends', 'Extended by'),
    (7, 'related', 'Related to', 'Related to');

-- Insert annotation types if not exists
INSERT OR IGNORE INTO annotation_types (id, name) VALUES
    (1, 'highlight'),
    (2, 'underline'),
    (3, 'strikethrough'),
    (4, 'note'),
    (5, 'area');

-- Default settings
INSERT OR IGNORE INTO settings (key, value, value_type) VALUES
    ('theme', 'system', 'string'),
    ('embedding_model', 'all-MiniLM-L6-v2', 'string'),
    ('sidebar_width', '240', 'number'),
    ('right_pane_width', '320', 'number'),
    ('right_pane_visible', 'true', 'boolean');

-- =====================================================
-- NEW SEED DATA: Entry Types & Attachment Types
-- =====================================================

-- Insert entry types (Zotero-compatible set)
INSERT OR IGNORE INTO entry_types (id, name, display_name, icon) VALUES
    (1, 'journal_article', 'Journal Article', 'file-text'),
    (2, 'book', 'Book', 'book'),
    (3, 'book_section', 'Book Section', 'bookmark'),
    (4, 'conference_paper', 'Conference Paper', 'users'),
    (5, 'thesis', 'Thesis', 'graduation-cap'),
    (6, 'report', 'Report', 'file-text'),
    (7, 'patent', 'Patent', 'scroll'),
    (8, 'preprint', 'Preprint', 'file-clock'),
    (9, 'webpage', 'Web Page', 'globe'),
    (10, 'magazine_article', 'Magazine Article', 'newspaper'),
    (11, 'newspaper_article', 'Newspaper Article', 'newspaper'),
    (12, 'presentation', 'Presentation', 'presentation'),
    (13, 'video', 'Video Recording', 'video'),
    (14, 'podcast', 'Podcast', 'headphones'),
    (15, 'software', 'Software', 'code'),
    (16, 'dataset', 'Dataset', 'database'),
    (17, 'standard', 'Standard', 'scale'),
    (18, 'manuscript', 'Manuscript', 'pen-tool'),
    (19, 'letter', 'Letter', 'mail'),
    (20, 'interview', 'Interview', 'mic'),
    (21, 'blog_post', 'Blog Post', 'rss'),
    (22, 'forum_post', 'Forum Post', 'message-circle'),
    (23, 'document', 'Document', 'file'),
    (24, 'generic', 'Generic', 'file');

-- Insert attachment types
INSERT OR IGNORE INTO attachment_types (id, name, display_name, icon) VALUES
    (1, 'pdf', 'PDF Document', 'file-text'),
    (2, 'note', 'Note', 'edit'),
    (3, 'weblink', 'Web Link', 'link'),
    (4, 'snapshot', 'Webpage Snapshot', 'camera'),
    (5, 'image', 'Image', 'image'),
    (6, 'video', 'Video', 'video'),
    (7, 'audio', 'Audio', 'headphones'),
    (8, 'generic', 'File', 'file');
"#;
