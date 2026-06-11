use anyhow::Result;
use sqlx::{SqlitePool, Row};
use crate::db::models::Creator;
use crate::commands::entries::format_creators_display;

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    tracing::info!("Running database migrations");

    // Create tables
    sqlx::query(SCHEMA)
        .execute(pool)
        .await?;

    // Insert seed data
    sqlx::query(SEED_ITEM_TYPES)
        .execute(pool)
        .await?;

    sqlx::query(SEED_CREATOR_TYPES)
        .execute(pool)
        .await?;

    sqlx::query(SEED_FIELDS)
        .execute(pool)
        .await?;

    sqlx::query(SEED_ITEM_TYPE_FIELDS)
        .execute(pool)
        .await?;

    sqlx::query(SEED_ITEM_TYPE_CREATOR_TYPES)
        .execute(pool)
        .await?;

    sqlx::query(SEED_OTHER)
        .execute(pool)
        .await?;

    // Run incremental migrations for existing databases
    run_incremental_migrations(pool).await?;

    tracing::info!("Database migrations complete");
    Ok(())
}

/// Run incremental migrations for schema updates
async fn run_incremental_migrations(pool: &SqlitePool) -> Result<()> {
    // Migration: Add is_imported column to tags table (if not exists)
    // This is safe to run multiple times
    let _ = sqlx::query("ALTER TABLE tags ADD COLUMN is_imported INTEGER NOT NULL DEFAULT 0")
        .execute(pool)
        .await;
    // Ignore error if column already exists

    // Migration: Add creators_sort column to entries table (if not exists)
    let _ = sqlx::query("ALTER TABLE entries ADD COLUMN creators_sort TEXT")
        .execute(pool)
        .await;

    // Backfill creators_sort for existing entries
    let entry_ids: Vec<i64> = sqlx::query("SELECT id FROM entries WHERE creators_sort IS NULL OR creators_sort = ''")
        .fetch_all(pool)
        .await
        .map(|rows| rows.iter().map(|r| r.get::<i64, _>("id")).collect())
        .unwrap_or_default();

    for entry_id in entry_ids {
        let creator_rows = sqlx::query(
            r#"
            SELECT ec.first_name, ec.last_name, ec.name, ct.name as creator_type, ec.sort_order
            FROM entry_creators ec
            JOIN creator_types ct ON ec.creator_type_id = ct.id
            WHERE ec.entry_id = ?
            ORDER BY ec.sort_order
            "#
        )
        .bind(entry_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        let creators: Vec<Creator> = creator_rows
            .iter()
            .map(|row| Creator {
                id: None,
                creator_type: row.get("creator_type"),
                creator_type_display: None,
                first_name: row.get("first_name"),
                last_name: row.get("last_name"),
                name: row.get("name"),
                sort_order: row.get("sort_order"),
            })
            .collect();

        let creators_sort = format_creators_display(&creators);
        let _ = sqlx::query("UPDATE entries SET creators_sort = ? WHERE id = ?")
            .bind(&creators_sort)
            .bind(entry_id)
            .execute(pool)
            .await;
    }

    // Backfill entries_fts for existing entries
    let entries = sqlx::query(
        r#"
        SELECT
            e.id,
            e.title,
            (
                SELECT ef.value
                FROM entry_fields ef
                JOIN fields f ON ef.field_id = f.id
                WHERE ef.entry_id = e.id AND f.name = 'abstractNote'
                LIMIT 1
            ) AS abstract_note
        FROM entries e
        "#
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for row in entries {
        let entry_id: i64 = row.get("id");
        let title: String = row.get("title");
        let abstract_note: Option<String> = row.get("abstract_note");
        let _ = sqlx::query(
            "INSERT OR REPLACE INTO entries_fts (rowid, title, abstract_note, entry_id) VALUES (?, ?, ?, ?)"
        )
        .bind(entry_id)
        .bind(&title)
        .bind(&abstract_note)
        .bind(entry_id)
        .execute(pool)
        .await;
    }

    // Migration: Add new annotation types for PDF viewer
    // These types are used by the frontend: text, freetext, drawing, shape
    let _ = sqlx::query("INSERT OR IGNORE INTO annotation_types (id, name) VALUES (6, 'text')")
        .execute(pool)
        .await;
    let _ = sqlx::query("INSERT OR IGNORE INTO annotation_types (id, name) VALUES (7, 'freetext')")
        .execute(pool)
        .await;
    let _ = sqlx::query("INSERT OR IGNORE INTO annotation_types (id, name) VALUES (8, 'drawing')")
        .execute(pool)
        .await;
    let _ = sqlx::query("INSERT OR IGNORE INTO annotation_types (id, name) VALUES (9, 'shape')")
        .execute(pool)
        .await;
    let _ = sqlx::query("INSERT OR IGNORE INTO annotation_types (id, name) VALUES (10, 'comment')")
        .execute(pool)
        .await;

    // Migration: Add saved_searches table for Smart Filters
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS saved_searches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            match_mode TEXT NOT NULL DEFAULT 'all',
            criteria_json TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'all',
            collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
            sort_order INTEGER DEFAULT 0,
            date_added TEXT NOT NULL DEFAULT (datetime('now')),
            date_modified TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_saved_searches_sort ON saved_searches(sort_order)")
        .execute(pool)
        .await;

    // Migration: Add markdown_path column to attachments table
    let _ = sqlx::query("ALTER TABLE attachments ADD COLUMN markdown_path TEXT")
        .execute(pool)
        .await;

    // Migration: Inline tables (database-backed interactive tables)
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS inline_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL DEFAULT 'Untitled Table',
            columns_json TEXT NOT NULL DEFAULT '[]',
            date_added TEXT NOT NULL DEFAULT (datetime('now')),
            date_modified TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS inline_table_rows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id INTEGER NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}',
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (table_id) REFERENCES inline_tables(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_inline_table_rows_table ON inline_table_rows(table_id, sort_order)"
    )
    .execute(pool)
    .await;

    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS inline_table_refs (
            table_id INTEGER NOT NULL,
            attachment_id INTEGER NOT NULL,
            PRIMARY KEY (table_id, attachment_id),
            FOREIGN KEY (table_id) REFERENCES inline_tables(id) ON DELETE CASCADE,
            FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await;

    // Migration: Job queue table for background task persistence
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            title TEXT,
            payload_json TEXT NOT NULL DEFAULT '{}',
            result_json TEXT,
            error_message TEXT,
            progress_current INTEGER DEFAULT 0,
            progress_total INTEGER DEFAULT 0,
            progress_message TEXT,
            priority INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 1,
            retry_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            started_at TEXT,
            completed_at TEXT
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at)")
        .execute(pool)
        .await;

    // Migration: Parsed content table for LLM-powered document parsing
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS parsed_content (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            document_type TEXT,
            language TEXT DEFAULT 'en',
            sections_json TEXT,
            structured_markdown TEXT,
            model_used TEXT NOT NULL,
            provider TEXT NOT NULL,
            total_tokens_used INTEGER DEFAULT 0,
            discovery_chunks INTEGER DEFAULT 0,
            sections_count INTEGER DEFAULT 0,
            pipeline_stages_json TEXT,
            checkpoint_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            date_started TEXT NOT NULL,
            date_completed TEXT,
            UNIQUE(attachment_id)
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_parsed_content_entry ON parsed_content(entry_id)")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_parsed_content_attachment ON parsed_content(attachment_id)")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_parsed_content_status ON parsed_content(status)")
        .execute(pool)
        .await;

    // Seed default LLM settings
    let _ = sqlx::query(
        r#"
        INSERT OR IGNORE INTO settings (key, value, value_type) VALUES
            ('llm_enabled', 'false', 'boolean'),
            ('llm_provider', 'openai', 'string'),
            ('llm_model', 'gpt-4o-mini', 'string'),
            ('llm_base_url', 'https://api.openai.com/v1', 'string'),
            ('llm_api_key', '', 'string'),
            ('llm_token_budget', '200000', 'number'),
            ('llm_concurrent_extractions', '3', 'number'),
            ('llm_auto_parse', 'false', 'boolean')
        "#
    )
    .execute(pool)
    .await;

    // ─── Knowledge Graph Tables ──────────────────────────────────────

    // Entities — shared knowledge atoms (concepts, methods, etc.)
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS entities (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            name_normalized TEXT NOT NULL,
            description TEXT,
            category TEXT NOT NULL,
            parent_entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
            date_added TEXT DEFAULT (datetime('now')),
            UNIQUE(name_normalized, category)
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_entities_normalized ON entities(name_normalized)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_entities_parent ON entities(parent_entity_id)")
        .execute(pool)
        .await;

    // Claims — per-attachment assertions with provenance
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS claims (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
            statement TEXT NOT NULL,
            evidence_text TEXT,
            section_name TEXT,
            claim_type TEXT NOT NULL,
            confidence REAL DEFAULT 0.8,
            date_added TEXT DEFAULT (datetime('now'))
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_claims_entry ON claims(entry_id)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_claims_attachment ON claims(attachment_id)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(claim_type)")
        .execute(pool)
        .await;

    // Entry-Entity edges — typed relationships with per-attachment provenance
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS entry_entities (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
            entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            relation_type TEXT NOT NULL DEFAULT 'discusses',
            weight REAL DEFAULT 0.5,
            evidence_text TEXT,
            section_name TEXT,
            confidence REAL DEFAULT 0.8,
            UNIQUE(entry_id, attachment_id, entity_id, relation_type)
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_ee_entry ON entry_entities(entry_id)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_ee_attachment ON entry_entities(attachment_id)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_ee_entity ON entry_entities(entity_id)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_ee_relation ON entry_entities(relation_type)")
        .execute(pool)
        .await;

    // Entity-Entity edges — structural relationships
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS entity_relations (
            id INTEGER PRIMARY KEY,
            source_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            target_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
            relation_type TEXT NOT NULL,
            confidence REAL DEFAULT 0.8,
            source_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
            evidence_text TEXT,
            UNIQUE(source_entity_id, target_entity_id, relation_type),
            CHECK(source_entity_id != target_entity_id)
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_er_source ON entity_relations(source_entity_id)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_er_target ON entity_relations(target_entity_id)")
        .execute(pool)
        .await;

    // Claim-Claim edges — cross-paper reasoning
    let _ = sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS claim_relations (
            id INTEGER PRIMARY KEY,
            source_claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
            target_claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
            relation_type TEXT NOT NULL,
            confidence REAL DEFAULT 0.8,
            reasoning TEXT,
            UNIQUE(source_claim_id, target_claim_id, relation_type),
            CHECK(source_claim_id != target_claim_id)
        )
        "#
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_cr_source ON claim_relations(source_claim_id)")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_cr_target ON claim_relations(target_claim_id)")
        .execute(pool)
        .await;

    // Graph indexing tracking on parsed_content
    let _ = sqlx::query("ALTER TABLE parsed_content ADD COLUMN graph_indexed INTEGER DEFAULT 0")
        .execute(pool)
        .await;
    let _ = sqlx::query("ALTER TABLE parsed_content ADD COLUMN graph_indexed_at TEXT")
        .execute(pool)
        .await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_parsed_content_graph ON parsed_content(graph_indexed, status)")
        .execute(pool)
        .await;

    // Track when each entry was last processed by the relate job (for incremental runs)
    let _ = sqlx::query("ALTER TABLE parsed_content ADD COLUMN graph_related_at TEXT")
        .execute(pool)
        .await;

    // Seed default graph settings
    let _ = sqlx::query(
        r#"
        INSERT OR IGNORE INTO settings (key, value, value_type) VALUES
            ('graph_auto_index', 'true', 'boolean'),
            ('graph_embedding_provider', 'local', 'string')
        "#
    )
    .execute(pool)
    .await;

    // Seed "related" link type if not already present (used by auto-relate)
    let _ = sqlx::query(
        "INSERT OR IGNORE INTO link_types (id, name, display_name, inverse_name) VALUES (7, 'related', 'Related to', 'Related to')"
    )
    .execute(pool)
    .await;

    // RAG indexing tracking on parsed_content (replaces graph_indexed)
    let _ = sqlx::query("ALTER TABLE parsed_content ADD COLUMN rag_indexed INTEGER DEFAULT 0")
        .execute(pool)
        .await;
    let _ = sqlx::query("ALTER TABLE parsed_content ADD COLUMN rag_indexed_at TEXT")
        .execute(pool)
        .await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_parsed_content_rag ON parsed_content(rag_indexed, status)")
        .execute(pool)
        .await;

    // Migrate lmstudio → omlx in settings
    let _ = sqlx::query("UPDATE settings SET value = 'omlx' WHERE key = 'llm_provider' AND value = 'lmstudio'")
        .execute(pool)
        .await;

    // RAG indexed flag on entries table (not parsed_content which may not exist)
    let _ = sqlx::query("ALTER TABLE entries ADD COLUMN rag_indexed INTEGER DEFAULT 0")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE entries ADD COLUMN rag_indexed_at TEXT")
        .execute(pool).await;

    // Seed RAG settings
    let _ = sqlx::query(
        r#"INSERT OR IGNORE INTO settings (key, value, value_type) VALUES
            ('rag_auto_index', 'true', 'boolean')
        "#
    )
    .execute(pool)
    .await;

    Ok(())
}

const SCHEMA: &str = r#"
-- =====================================================
-- ITEM TYPES (40 Zotero-compatible types)
-- =====================================================
CREATE TABLE IF NOT EXISTS item_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    csl_type TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0
);

-- =====================================================
-- FIELD DEFINITIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS fields (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    csl_field TEXT,
    field_type TEXT DEFAULT 'text',
    description TEXT
);

-- =====================================================
-- ITEM TYPE TO FIELD MAPPINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS item_type_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type_id INTEGER NOT NULL REFERENCES item_types(id),
    field_id INTEGER NOT NULL REFERENCES fields(id),
    sort_order INTEGER DEFAULT 0,
    is_required INTEGER DEFAULT 0,
    UNIQUE(item_type_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_item_type_fields_type ON item_type_fields(item_type_id);

-- =====================================================
-- CREATOR TYPES (47 Zotero creator types)
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    csl_type TEXT
);

-- =====================================================
-- ITEM TYPE TO CREATOR TYPE MAPPINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS item_type_creator_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type_id INTEGER NOT NULL REFERENCES item_types(id),
    creator_type_id INTEGER NOT NULL REFERENCES creator_types(id),
    is_primary INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(item_type_id, creator_type_id)
);

CREATE INDEX IF NOT EXISTS idx_item_type_creator_types_type ON item_type_creator_types(item_type_id);

-- =====================================================
-- ENTRIES (core entry table - common fields only)
-- =====================================================
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    item_type_id INTEGER NOT NULL REFERENCES item_types(id),
    title TEXT NOT NULL,
    creators_sort TEXT,
    date TEXT,
    url TEXT,
    access_date TEXT,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(item_type_id);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_date_added ON entries(date_added);
CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(is_deleted);
CREATE INDEX IF NOT EXISTS idx_entries_title ON entries(title);

-- =====================================================
-- ENTRY FIELDS (EAV for type-specific fields)
-- =====================================================
CREATE TABLE IF NOT EXISTS entry_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES fields(id),
    value TEXT,
    UNIQUE(entry_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_fields_entry ON entry_fields(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_fields_field ON entry_fields(field_id);
CREATE INDEX IF NOT EXISTS idx_entry_fields_value ON entry_fields(value);

-- =====================================================
-- ENTRY CREATORS (normalized creator storage)
-- =====================================================
CREATE TABLE IF NOT EXISTS entry_creators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    creator_type_id INTEGER NOT NULL REFERENCES creator_types(id),
    first_name TEXT,
    last_name TEXT,
    name TEXT,
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entry_creators_entry ON entry_creators(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_creators_type ON entry_creators(creator_type_id);
CREATE INDEX IF NOT EXISTS idx_entry_creators_name ON entry_creators(last_name, first_name);

-- =====================================================
-- ATTACHMENT TYPES
-- =====================================================
CREATE TABLE IF NOT EXISTS attachment_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    icon TEXT
);

-- =====================================================
-- ATTACHMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    attachment_type_id INTEGER NOT NULL REFERENCES attachment_types(id),
    title TEXT,
    file_path TEXT,
    file_hash TEXT,
    file_size INTEGER,
    url TEXT,
    page_count INTEGER,
    frontmatter TEXT,
    thumbnail_path TEXT,
    text_extracted INTEGER NOT NULL DEFAULT 0,
    embedded INTEGER NOT NULL DEFAULT 0,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);
CREATE INDEX IF NOT EXISTS idx_attachments_type ON attachments(attachment_type_id);
CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(file_hash);

-- =====================================================
-- TAGS
-- =====================================================
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT,
    is_imported INTEGER NOT NULL DEFAULT 0,
    date_added TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- =====================================================
-- ENTRY TAGS
-- =====================================================
CREATE TABLE IF NOT EXISTS entry_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    UNIQUE(entry_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

-- =====================================================
-- COLLECTIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    parent_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    date_added TEXT NOT NULL DEFAULT (datetime('now')),
    date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================
-- COLLECTION ENTRIES
-- =====================================================
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

-- =====================================================
-- LINK TYPES
-- =====================================================
CREATE TABLE IF NOT EXISTS link_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    inverse_name TEXT
);

-- =====================================================
-- ENTRY LINKS
-- =====================================================
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

-- =====================================================
-- ANNOTATION TYPES
-- =====================================================
CREATE TABLE IF NOT EXISTS annotation_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- =====================================================
-- ATTACHMENT ANNOTATIONS
-- =====================================================
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

-- =====================================================
-- SETTINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================
-- TAB STATE
-- =====================================================
CREATE TABLE IF NOT EXISTS tab_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
    attachment_id INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
    tab_type TEXT NOT NULL,
    tab_data TEXT,
    order_index INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    date_opened TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tab_state_order ON tab_state(order_index);

-- =====================================================
-- FTS5 SEARCH
-- =====================================================
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    title,
    abstract_note,
    entry_id UNINDEXED,
    content='',
    tokenize='porter unicode61'
);

-- =====================================================
-- SCHEMA MIGRATIONS TRACKING
-- =====================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

// =====================================================
// SEED DATA: 40 Item Types
// =====================================================
const SEED_ITEM_TYPES: &str = r#"
INSERT OR IGNORE INTO item_types (id, name, display_name, csl_type, icon, sort_order) VALUES
    (1, 'journalArticle', 'Journal Article', 'article-journal', 'file-text', 1),
    (2, 'book', 'Book', 'book', 'book', 2),
    (3, 'bookSection', 'Book Section', 'chapter', 'bookmark', 3),
    (4, 'conferencePaper', 'Conference Paper', 'paper-conference', 'users', 4),
    (5, 'thesis', 'Thesis', 'thesis', 'graduation-cap', 5),
    (6, 'preprint', 'Preprint', 'article', 'file-clock', 6),
    (7, 'report', 'Report', 'report', 'file-text', 7),
    (8, 'dataset', 'Dataset', 'dataset', 'database', 8),
    (9, 'standard', 'Standard', 'standard', 'scale', 9),
    (10, 'manuscript', 'Manuscript', 'manuscript', 'pen-tool', 10),
    (11, 'patent', 'Patent', 'patent', 'scroll', 11),
    (12, 'case', 'Case', 'legal_case', 'gavel', 12),
    (13, 'statute', 'Statute', 'legislation', 'landmark', 13),
    (14, 'bill', 'Bill', 'bill', 'file-text', 14),
    (15, 'hearing', 'Hearing', 'hearing', 'mic', 15),
    (16, 'artwork', 'Artwork', 'graphic', 'palette', 16),
    (17, 'film', 'Film', 'motion_picture', 'film', 17),
    (18, 'videoRecording', 'Video Recording', 'motion_picture', 'video', 18),
    (19, 'audioRecording', 'Audio Recording', 'song', 'music', 19),
    (20, 'tvBroadcast', 'TV Broadcast', 'broadcast', 'tv', 20),
    (21, 'radioBroadcast', 'Radio Broadcast', 'broadcast', 'radio', 21),
    (22, 'podcast', 'Podcast', 'broadcast', 'headphones', 22),
    (23, 'webpage', 'Web Page', 'webpage', 'globe', 23),
    (24, 'blogPost', 'Blog Post', 'post-weblog', 'rss', 24),
    (25, 'forumPost', 'Forum Post', 'post', 'message-circle', 25),
    (26, 'encyclopediaArticle', 'Encyclopedia Article', 'entry-encyclopedia', 'book-open', 26),
    (27, 'dictionaryEntry', 'Dictionary Entry', 'entry-dictionary', 'book-a', 27),
    (28, 'interview', 'Interview', 'interview', 'mic', 28),
    (29, 'letter', 'Letter', 'personal_communication', 'mail', 29),
    (30, 'email', 'E-mail', 'personal_communication', 'at-sign', 30),
    (31, 'instantMessage', 'Instant Message', 'personal_communication', 'message-square', 31),
    (32, 'map', 'Map', 'map', 'map', 32),
    (33, 'presentation', 'Presentation', 'speech', 'presentation', 33),
    (34, 'computerProgram', 'Software', 'software', 'code', 34),
    (35, 'document', 'Document', 'document', 'file', 35),
    (36, 'newspaperArticle', 'Newspaper Article', 'article-newspaper', 'newspaper', 36),
    (37, 'magazineArticle', 'Magazine Article', 'article-magazine', 'book-open', 37),
    (38, 'note', 'Note', 'document', 'sticky-note', 38),
    (39, 'attachment', 'Attachment', 'document', 'paperclip', 39),
    (40, 'annotation', 'Annotation', 'document', 'highlighter', 40);
"#;

// =====================================================
// SEED DATA: 47 Creator Types
// =====================================================
const SEED_CREATOR_TYPES: &str = r#"
INSERT OR IGNORE INTO creator_types (id, name, display_name, csl_type) VALUES
    (1, 'author', 'Author', 'author'),
    (2, 'contributor', 'Contributor', 'contributor'),
    (3, 'editor', 'Editor', 'editor'),
    (4, 'translator', 'Translator', 'translator'),
    (5, 'seriesEditor', 'Series Editor', 'collection-editor'),
    (6, 'bookAuthor', 'Book Author', 'container-author'),
    (7, 'reviewedAuthor', 'Reviewed Author', 'reviewed-author'),
    (8, 'recipient', 'Recipient', 'recipient'),
    (9, 'performer', 'Performer', 'performer'),
    (10, 'composer', 'Composer', 'composer'),
    (11, 'artist', 'Artist', 'author'),
    (12, 'cosponsor', 'Cosponsor', 'author'),
    (13, 'podcaster', 'Podcaster', 'host'),
    (14, 'cartographer', 'Cartographer', 'author'),
    (15, 'presenter', 'Presenter', 'author'),
    (16, 'counsel', 'Counsel', 'author'),
    (17, 'interviewee', 'Interview With', 'author'),
    (18, 'interviewer', 'Interviewer', 'interviewer'),
    (19, 'director', 'Director', 'director'),
    (20, 'producer', 'Producer', 'producer'),
    (21, 'scriptwriter', 'Scriptwriter', 'script-writer'),
    (22, 'castMember', 'Cast Member', 'performer'),
    (23, 'sponsor', 'Sponsor', 'author'),
    (24, 'guest', 'Guest', 'guest'),
    (25, 'wordsBy', 'Words By', 'author'),
    (26, 'commenter', 'Commenter', 'author'),
    (27, 'programmer', 'Programmer', 'author'),
    (28, 'inventor', 'Inventor', 'author'),
    (29, 'attorneyAgent', 'Attorney/Agent', 'author'),
    (30, 'host', 'Host', 'host'),
    (31, 'narrator', 'Narrator', 'narrator'),
    (32, 'executiveProducer', 'Executive Producer', 'executive-producer'),
    (33, 'seriesCreator', 'Series Creator', 'series-creator'),
    (34, 'creator', 'Creator', 'author'),
    (35, 'originalCreator', 'Original Creator', 'original-author'),
    (36, 'organizer', 'Organizer', 'organizer'),
    (37, 'chair', 'Chair', 'chair');
"#;

// =====================================================
// SEED DATA: Field Definitions (90+ fields)
// =====================================================
const SEED_FIELDS: &str = r#"
INSERT OR IGNORE INTO fields (id, name, display_name, csl_field, field_type) VALUES
    -- Identifiers
    (1, 'DOI', 'DOI', 'DOI', 'identifier'),
    (2, 'ISBN', 'ISBN', 'ISBN', 'identifier'),
    (3, 'ISSN', 'ISSN', 'ISSN', 'identifier'),
    (4, 'PMID', 'PubMed ID', 'PMID', 'identifier'),
    (5, 'PMCID', 'PMC ID', 'PMCID', 'identifier'),
    (6, 'citationKey', 'Citation Key', 'citation-key', 'text'),
    (7, 'callNumber', 'Call Number', 'call-number', 'text'),

    -- Publication info
    (10, 'abstractNote', 'Abstract', 'abstract', 'text'),
    (11, 'publicationTitle', 'Publication', 'container-title', 'text'),
    (12, 'journalAbbreviation', 'Journal Abbr', 'journalAbbreviation', 'text'),
    (13, 'volume', 'Volume', 'volume', 'text'),
    (14, 'issue', 'Issue', 'issue', 'text'),
    (15, 'pages', 'Pages', 'page', 'text'),
    (16, 'numPages', 'Num Pages', 'number-of-pages', 'number'),
    (17, 'section', 'Section', 'section', 'text'),
    (18, 'series', 'Series', 'collection-title', 'text'),
    (19, 'seriesNumber', 'Series Number', 'collection-number', 'text'),
    (20, 'seriesTitle', 'Series Title', 'collection-title', 'text'),
    (21, 'seriesText', 'Series Text', NULL, 'text'),

    -- Publisher info
    (25, 'publisher', 'Publisher', 'publisher', 'text'),
    (26, 'place', 'Place', 'publisher-place', 'text'),
    (27, 'edition', 'Edition', 'edition', 'text'),
    (28, 'numberOfVolumes', 'Num Volumes', 'number-of-volumes', 'number'),

    -- Dates
    (30, 'date', 'Date', 'issued', 'date'),
    (31, 'accessDate', 'Accessed', 'accessed', 'date'),
    (32, 'originalDate', 'Original Date', 'original-date', 'date'),
    (33, 'filingDate', 'Filing Date', 'submitted', 'date'),
    (34, 'issueDate', 'Issue Date', 'issued', 'date'),
    (35, 'dateDecided', 'Date Decided', 'issued', 'date'),
    (36, 'dateEnacted', 'Date Enacted', 'issued', 'date'),

    -- Archive/Library
    (40, 'archive', 'Archive', 'archive', 'text'),
    (41, 'archiveLocation', 'Archive Location', 'archive_location', 'text'),
    (42, 'libraryCatalog', 'Library Catalog', 'source', 'text'),

    -- Other metadata
    (45, 'shortTitle', 'Short Title', 'title-short', 'text'),
    (46, 'language', 'Language', 'language', 'text'),
    (47, 'rights', 'Rights', 'license', 'text'),
    (48, 'extra', 'Extra', 'note', 'text'),

    -- Thesis specific
    (50, 'thesisType', 'Type', 'genre', 'text'),
    (51, 'university', 'University', 'publisher', 'text'),

    -- Patent specific
    (55, 'patentNumber', 'Patent Number', 'number', 'text'),
    (56, 'applicationNumber', 'Application Number', 'call-number', 'text'),
    (57, 'priorityNumbers', 'Priority Numbers', NULL, 'text'),
    (58, 'assignee', 'Assignee', NULL, 'text'),
    (59, 'issuingAuthority', 'Issuing Authority', 'authority', 'text'),
    (60, 'country', 'Country', 'jurisdiction', 'text'),
    (61, 'legalStatus', 'Legal Status', NULL, 'text'),
    (62, 'references', 'References', 'references', 'text'),

    -- Legal specific
    (65, 'court', 'Court', 'authority', 'text'),
    (66, 'reporter', 'Reporter', 'container-title', 'text'),
    (67, 'reporterVolume', 'Reporter Volume', 'volume', 'text'),
    (68, 'firstPage', 'First Page', 'page-first', 'text'),
    (69, 'docketNumber', 'Docket Number', 'number', 'text'),
    (70, 'caseName', 'Case Name', 'title', 'text'),
    (71, 'history', 'History', NULL, 'text'),
    (72, 'nameOfAct', 'Name of Act', 'title', 'text'),
    (73, 'billNumber', 'Bill Number', 'number', 'text'),
    (74, 'code', 'Code', 'container-title', 'text'),
    (75, 'codeNumber', 'Code Number', 'volume', 'text'),
    (76, 'codeVolume', 'Code Volume', 'volume', 'text'),
    (77, 'codePages', 'Code Pages', 'page', 'text'),
    (78, 'session', 'Session', NULL, 'text'),
    (79, 'legislativeBody', 'Legislative Body', 'authority', 'text'),
    (80, 'publicLawNumber', 'Public Law Number', 'number', 'text'),
    (81, 'committee', 'Committee', 'section', 'text'),
    (82, 'documentNumber', 'Document Number', 'number', 'text'),

    -- Conference/Meeting
    (85, 'conferenceName', 'Conference', 'event-title', 'text'),
    (86, 'proceedingsTitle', 'Proceedings Title', 'container-title', 'text'),
    (87, 'meetingName', 'Meeting Name', 'event-title', 'text'),

    -- Media specific
    (90, 'runningTime', 'Running Time', 'dimensions', 'text'),
    (91, 'format', 'Format', 'medium', 'text'),
    (92, 'artworkSize', 'Artwork Size', 'dimensions', 'text'),
    (93, 'artworkMedium', 'Medium', 'medium', 'text'),
    (94, 'audioFileType', 'File Type', 'medium', 'text'),
    (95, 'videoFileType', 'File Type', 'medium', 'text'),
    (96, 'label', 'Label', 'publisher', 'text'),
    (97, 'studio', 'Studio', 'publisher', 'text'),
    (98, 'network', 'Network', 'publisher', 'text'),
    (99, 'distributor', 'Distributor', 'publisher', 'text'),
    (100, 'genre', 'Genre', 'genre', 'text'),
    (101, 'episodeNumber', 'Episode', 'number', 'text'),

    -- Software specific
    (105, 'system', 'System', 'medium', 'text'),
    (106, 'programmingLanguage', 'Programming Language', 'genre', 'text'),
    (107, 'company', 'Company', 'publisher', 'text'),
    (108, 'versionNumber', 'Version', 'version', 'text'),

    -- Map specific
    (110, 'scale', 'Scale', 'scale', 'text'),
    (111, 'mapType', 'Type', 'genre', 'text'),

    -- Web/Blog specific
    (115, 'websiteTitle', 'Website Title', 'container-title', 'text'),
    (116, 'websiteType', 'Website Type', 'genre', 'text'),
    (117, 'blogTitle', 'Blog Title', 'container-title', 'text'),
    (118, 'forumTitle', 'Forum Title', 'container-title', 'text'),
    (119, 'postType', 'Post Type', 'genre', 'text'),

    -- Other
    (120, 'presentationType', 'Type', 'genre', 'text'),
    (121, 'interviewMedium', 'Medium', 'medium', 'text'),
    (122, 'letterType', 'Type', 'genre', 'text'),
    (123, 'manuscriptType', 'Type', 'genre', 'text'),
    (124, 'reportNumber', 'Report Number', 'number', 'text'),
    (125, 'reportType', 'Report Type', 'genre', 'text'),
    (126, 'institution', 'Institution', 'publisher', 'text'),
    (127, 'medium', 'Medium', 'medium', 'text'),
    (128, 'type', 'Type', 'genre', 'text'),

    -- Book specific
    (130, 'bookTitle', 'Book Title', 'container-title', 'text'),
    (131, 'originalPublisher', 'Original Publisher', 'original-publisher', 'text'),
    (132, 'originalPlace', 'Original Place', 'original-publisher-place', 'text'),

    -- Encyclopedia/Dictionary
    (135, 'encyclopediaTitle', 'Encyclopedia Title', 'container-title', 'text'),
    (136, 'dictionaryTitle', 'Dictionary Title', 'container-title', 'text');
"#;

// =====================================================
// SEED DATA: Item Type to Field Mappings
// =====================================================
const SEED_ITEM_TYPE_FIELDS: &str = r#"
-- journalArticle fields
INSERT OR IGNORE INTO item_type_fields (item_type_id, field_id, sort_order, is_required) VALUES
    (1, 10, 1, 0),  -- abstractNote
    (1, 11, 2, 0),  -- publicationTitle
    (1, 13, 3, 0),  -- volume
    (1, 14, 4, 0),  -- issue
    (1, 15, 5, 0),  -- pages
    (1, 30, 6, 0),  -- date
    (1, 18, 7, 0),  -- series
    (1, 20, 8, 0),  -- seriesTitle
    (1, 21, 9, 0),  -- seriesText
    (1, 12, 10, 0), -- journalAbbreviation
    (1, 1, 11, 0),  -- DOI
    (1, 6, 12, 0),  -- citationKey
    (1, 4, 13, 0),  -- PMID
    (1, 5, 14, 0),  -- PMCID
    (1, 3, 15, 0),  -- ISSN
    (1, 45, 16, 0), -- shortTitle
    (1, 46, 17, 0), -- language
    (1, 40, 18, 0), -- archive
    (1, 41, 19, 0), -- archiveLocation
    (1, 42, 20, 0), -- libraryCatalog
    (1, 7, 21, 0),  -- callNumber
    (1, 47, 22, 0), -- rights
    (1, 48, 23, 0); -- extra

-- book fields
INSERT OR IGNORE INTO item_type_fields (item_type_id, field_id, sort_order, is_required) VALUES
    (2, 10, 1, 0),  -- abstractNote
    (2, 18, 2, 0),  -- series
    (2, 19, 3, 0),  -- seriesNumber
    (2, 13, 4, 0),  -- volume
    (2, 28, 5, 0),  -- numberOfVolumes
    (2, 27, 6, 0),  -- edition
    (2, 26, 7, 0),  -- place
    (2, 25, 8, 0),  -- publisher
    (2, 30, 9, 0),  -- date
    (2, 16, 10, 0), -- numPages
    (2, 46, 11, 0), -- language
    (2, 2, 12, 0),  -- ISBN
    (2, 45, 13, 0), -- shortTitle
    (2, 40, 14, 0), -- archive
    (2, 41, 15, 0), -- archiveLocation
    (2, 42, 16, 0), -- libraryCatalog
    (2, 7, 17, 0),  -- callNumber
    (2, 47, 18, 0), -- rights
    (2, 48, 19, 0); -- extra

-- bookSection fields
INSERT OR IGNORE INTO item_type_fields (item_type_id, field_id, sort_order, is_required) VALUES
    (3, 10, 1, 0),  -- abstractNote
    (3, 130, 2, 0), -- bookTitle
    (3, 18, 3, 0),  -- series
    (3, 19, 4, 0),  -- seriesNumber
    (3, 13, 5, 0),  -- volume
    (3, 28, 6, 0),  -- numberOfVolumes
    (3, 27, 7, 0),  -- edition
    (3, 26, 8, 0),  -- place
    (3, 25, 9, 0),  -- publisher
    (3, 30, 10, 0), -- date
    (3, 15, 11, 0), -- pages
    (3, 46, 12, 0), -- language
    (3, 2, 13, 0),  -- ISBN
    (3, 45, 14, 0), -- shortTitle
    (3, 40, 15, 0), -- archive
    (3, 41, 16, 0), -- archiveLocation
    (3, 42, 17, 0), -- libraryCatalog
    (3, 7, 18, 0),  -- callNumber
    (3, 47, 19, 0), -- rights
    (3, 48, 20, 0); -- extra

-- conferencePaper fields
INSERT OR IGNORE INTO item_type_fields (item_type_id, field_id, sort_order, is_required) VALUES
    (4, 10, 1, 0),  -- abstractNote
    (4, 30, 2, 0),  -- date
    (4, 86, 3, 0),  -- proceedingsTitle
    (4, 85, 4, 0),  -- conferenceName
    (4, 26, 5, 0),  -- place
    (4, 25, 6, 0),  -- publisher
    (4, 13, 7, 0),  -- volume
    (4, 15, 8, 0),  -- pages
    (4, 18, 9, 0),  -- series
    (4, 46, 10, 0), -- language
    (4, 1, 11, 0),  -- DOI
    (4, 2, 12, 0),  -- ISBN
    (4, 45, 13, 0), -- shortTitle
    (4, 40, 14, 0), -- archive
    (4, 41, 15, 0), -- archiveLocation
    (4, 42, 16, 0), -- libraryCatalog
    (4, 7, 17, 0),  -- callNumber
    (4, 47, 18, 0), -- rights
    (4, 48, 19, 0); -- extra

-- thesis fields
INSERT OR IGNORE INTO item_type_fields (item_type_id, field_id, sort_order, is_required) VALUES
    (5, 10, 1, 0),  -- abstractNote
    (5, 50, 2, 0),  -- thesisType
    (5, 51, 3, 0),  -- university
    (5, 26, 4, 0),  -- place
    (5, 30, 5, 0),  -- date
    (5, 16, 6, 0),  -- numPages
    (5, 46, 7, 0),  -- language
    (5, 45, 8, 0),  -- shortTitle
    (5, 40, 9, 0),  -- archive
    (5, 41, 10, 0), -- archiveLocation
    (5, 42, 11, 0), -- libraryCatalog
    (5, 7, 12, 0),  -- callNumber
    (5, 47, 13, 0), -- rights
    (5, 48, 14, 0); -- extra

-- webpage fields
INSERT OR IGNORE INTO item_type_fields (item_type_id, field_id, sort_order, is_required) VALUES
    (23, 10, 1, 0),  -- abstractNote
    (23, 115, 2, 0), -- websiteTitle
    (23, 116, 3, 0), -- websiteType
    (23, 30, 4, 0),  -- date
    (23, 45, 5, 0),  -- shortTitle
    (23, 46, 6, 0),  -- language
    (23, 47, 7, 0),  -- rights
    (23, 48, 8, 0);  -- extra

-- patent fields
INSERT OR IGNORE INTO item_type_fields (item_type_id, field_id, sort_order, is_required) VALUES
    (11, 10, 1, 0),  -- abstractNote
    (11, 60, 2, 0),  -- country
    (11, 59, 3, 0),  -- issuingAuthority
    (11, 55, 4, 0),  -- patentNumber
    (11, 33, 5, 0),  -- filingDate
    (11, 15, 6, 0),  -- pages
    (11, 56, 7, 0),  -- applicationNumber
    (11, 57, 8, 0),  -- priorityNumbers
    (11, 34, 9, 0),  -- issueDate
    (11, 62, 10, 0), -- references
    (11, 61, 11, 0), -- legalStatus
    (11, 46, 12, 0), -- language
    (11, 45, 13, 0), -- shortTitle
    (11, 58, 14, 0), -- assignee
    (11, 47, 15, 0), -- rights
    (11, 48, 16, 0); -- extra
"#;

// =====================================================
// SEED DATA: Item Type to Creator Type Mappings
// =====================================================
const SEED_ITEM_TYPE_CREATOR_TYPES: &str = r#"
-- journalArticle creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (1, 1, 1, 1),  -- author (primary)
    (1, 2, 0, 2),  -- contributor
    (1, 3, 0, 3),  -- editor
    (1, 4, 0, 4),  -- translator
    (1, 7, 0, 5);  -- reviewedAuthor

-- book creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (2, 1, 1, 1),  -- author (primary)
    (2, 2, 0, 2),  -- contributor
    (2, 3, 0, 3),  -- editor
    (2, 4, 0, 4),  -- translator
    (2, 5, 0, 5);  -- seriesEditor

-- bookSection creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (3, 1, 1, 1),  -- author (primary)
    (3, 6, 0, 2),  -- bookAuthor
    (3, 2, 0, 3),  -- contributor
    (3, 3, 0, 4),  -- editor
    (3, 4, 0, 5),  -- translator
    (3, 5, 0, 6);  -- seriesEditor

-- conferencePaper creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (4, 1, 1, 1),  -- author (primary)
    (4, 2, 0, 2),  -- contributor
    (4, 3, 0, 3),  -- editor
    (4, 4, 0, 4),  -- translator
    (4, 5, 0, 5);  -- seriesEditor

-- thesis creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (5, 1, 1, 1),  -- author (primary)
    (5, 2, 0, 2);  -- contributor

-- patent creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (11, 28, 1, 1), -- inventor (primary)
    (11, 29, 0, 2), -- attorneyAgent
    (11, 2, 0, 3);  -- contributor

-- film creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (17, 19, 1, 1), -- director (primary)
    (17, 2, 0, 2),  -- contributor
    (17, 20, 0, 3), -- producer
    (17, 21, 0, 4), -- scriptwriter
    (17, 22, 0, 5); -- castMember

-- podcast creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (22, 13, 1, 1), -- podcaster (primary)
    (22, 2, 0, 2),  -- contributor
    (22, 24, 0, 3); -- guest

-- webpage creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (23, 1, 1, 1),  -- author (primary)
    (23, 2, 0, 2),  -- contributor
    (23, 4, 0, 3);  -- translator

-- interview creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (28, 17, 1, 1), -- interviewee (primary)
    (28, 18, 0, 2), -- interviewer
    (28, 2, 0, 3),  -- contributor
    (28, 4, 0, 4);  -- translator

-- presentation creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (33, 15, 1, 1), -- presenter (primary)
    (33, 2, 0, 2);  -- contributor

-- software creator types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order) VALUES
    (34, 27, 1, 1), -- programmer (primary)
    (34, 2, 0, 2);  -- contributor

-- Add default author type for remaining item types
INSERT OR IGNORE INTO item_type_creator_types (item_type_id, creator_type_id, is_primary, sort_order)
SELECT id, 1, 1, 1 FROM item_types WHERE id NOT IN (1, 2, 3, 4, 5, 11, 17, 22, 23, 28, 33, 34);
"#;

// =====================================================
// SEED DATA: Other (attachment types, link types, etc.)
// =====================================================
const SEED_OTHER: &str = r#"
-- Attachment types
INSERT OR IGNORE INTO attachment_types (id, name, display_name, icon) VALUES
    (1, 'pdf', 'PDF Document', 'file-text'),
    (2, 'note', 'Note', 'edit'),
    (3, 'weblink', 'Web Link', 'link'),
    (4, 'snapshot', 'Webpage Snapshot', 'camera'),
    (5, 'image', 'Image', 'image'),
    (6, 'video', 'Video', 'video'),
    (7, 'audio', 'Audio', 'headphones'),
    (8, 'generic', 'File', 'file'),
    (9, 'epub', 'EPUB Document', 'book-open');

-- Link types
INSERT OR IGNORE INTO link_types (id, name, display_name, inverse_name) VALUES
    (1, 'references', 'References', 'Referenced by'),
    (2, 'cites', 'Cites', 'Cited by'),
    (3, 'summarizes', 'Summarizes', 'Summarized by'),
    (4, 'contradicts', 'Contradicts', 'Contradicted by'),
    (5, 'supports', 'Supports', 'Supported by'),
    (6, 'extends', 'Extends', 'Extended by'),
    (7, 'related', 'Related to', 'Related to');

-- Annotation types
INSERT OR IGNORE INTO annotation_types (id, name) VALUES
    (1, 'highlight'),
    (2, 'underline'),
    (3, 'strikethrough'),
    (4, 'note'),
    (5, 'area'),
    (6, 'text'),
    (7, 'freetext'),
    (8, 'drawing'),
    (9, 'shape');

-- Default settings
INSERT OR IGNORE INTO settings (key, value, value_type) VALUES
    ('theme', 'system', 'string'),
    ('embedding_model', 'all-MiniLM-L6-v2', 'string'),
    ('sidebar_width', '240', 'number'),
    ('right_pane_width', '320', 'number'),
    ('right_pane_visible', 'true', 'boolean'),
    ('auto_rename_files', 'true', 'boolean');
"#;
