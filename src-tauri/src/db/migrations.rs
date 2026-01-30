use anyhow::Result;
use sqlx::SqlitePool;

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

    tracing::info!("Database migrations complete");
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

-- PDF Annotations
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
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
"#;
