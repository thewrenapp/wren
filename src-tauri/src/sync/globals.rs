use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::Path;

// ── JSON schemas for global sync files ──────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionsJson {
    pub schema_version: u32,
    pub date_modified: String,
    pub collections: Vec<CollectionSync>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionSync {
    pub key: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TagsJson {
    pub schema_version: u32,
    pub date_modified: String,
    pub tags: Vec<TagSync>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TagSync {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SavedSearchesJson {
    pub schema_version: u32,
    pub date_modified: String,
    pub saved_searches: Vec<SavedSearchSync>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SavedSearchSync {
    pub name: String,
    pub match_mode: String,
    pub criteria_json: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection_key: Option<String>,
    pub sort_order: i32,
}

// ── Row types ───────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct CollRow {
    key: String,
    name: String,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    parent_key: Option<String>,
}

#[derive(sqlx::FromRow)]
struct TagRow {
    name: String,
    color: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SearchRow {
    name: String,
    match_mode: String,
    criteria_json: String,
    scope: String,
    collection_key: Option<String>,
    sort_order: i32,
}

// ── Atomic write helper ─────────────────────────────────────────────

fn write_json_atomic(dir: &Path, filename: &str, json: &str) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{}.tmp", filename));
    let final_path = dir.join(filename);
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &final_path)?;
    Ok(())
}

// ── Public sync functions ───────────────────────────────────────────

/// Write collections.json to the .sync/ directory.
pub async fn sync_collections_json(pool: &SqlitePool, library_path: &Path) {
    if let Err(e) = write_collections(pool, library_path).await {
        tracing::warn!("Failed to write collections.json: {}", e);
    }
}

async fn write_collections(pool: &SqlitePool, library_path: &Path) -> Result<()> {
    let rows: Vec<CollRow> = sqlx::query_as(
        "SELECT c.key, c.name, c.description, c.color, c.icon, \
         p.key as parent_key \
         FROM collections c \
         LEFT JOIN collections p ON c.parent_id = p.id \
         ORDER BY c.name",
    )
    .fetch_all(pool)
    .await?;

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let data = CollectionsJson {
        schema_version: 1,
        date_modified: now,
        collections: rows
            .into_iter()
            .map(|r| CollectionSync {
                key: r.key,
                name: r.name,
                description: r.description,
                color: r.color,
                icon: r.icon,
                parent_key: r.parent_key,
            })
            .collect(),
    };

    let json = serde_json::to_string_pretty(&data)?;
    write_json_atomic(&library_path.join("library"), "collections.json", &json)
}

/// Write tags.json to the .sync/ directory (only tags with custom colors).
pub async fn sync_tags_json(pool: &SqlitePool, library_path: &Path) {
    if let Err(e) = write_tags(pool, library_path).await {
        tracing::warn!("Failed to write tags.json: {}", e);
    }
}

async fn write_tags(pool: &SqlitePool, library_path: &Path) -> Result<()> {
    let rows: Vec<TagRow> = sqlx::query_as(
        "SELECT name, color FROM tags WHERE color IS NOT NULL ORDER BY name",
    )
    .fetch_all(pool)
    .await?;

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let data = TagsJson {
        schema_version: 1,
        date_modified: now,
        tags: rows
            .into_iter()
            .map(|r| TagSync {
                name: r.name,
                color: r.color,
            })
            .collect(),
    };

    let json = serde_json::to_string_pretty(&data)?;
    write_json_atomic(&library_path.join("library"), "tags.json", &json)
}

/// Write saved_searches.json to the .sync/ directory.
pub async fn sync_saved_searches_json(pool: &SqlitePool, library_path: &Path) {
    if let Err(e) = write_saved_searches(pool, library_path).await {
        tracing::warn!("Failed to write saved_searches.json: {}", e);
    }
}

async fn write_saved_searches(pool: &SqlitePool, library_path: &Path) -> Result<()> {
    let rows: Vec<SearchRow> = sqlx::query_as(
        "SELECT ss.name, ss.match_mode, ss.criteria_json, ss.scope, \
         c.key as collection_key, ss.sort_order \
         FROM saved_searches ss \
         LEFT JOIN collections c ON ss.collection_id = c.id \
         ORDER BY ss.sort_order, ss.name",
    )
    .fetch_all(pool)
    .await?;

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let data = SavedSearchesJson {
        schema_version: 1,
        date_modified: now,
        saved_searches: rows
            .into_iter()
            .map(|r| SavedSearchSync {
                name: r.name,
                match_mode: r.match_mode,
                criteria_json: r.criteria_json,
                scope: r.scope,
                collection_key: r.collection_key,
                sort_order: r.sort_order,
            })
            .collect(),
    };

    let json = serde_json::to_string_pretty(&data)?;
    write_json_atomic(&library_path.join("library"), "saved_searches.json", &json)
}

// ── Settings sync ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SettingsJson {
    pub schema_version: u32,
    pub date_modified: String,
    pub settings: std::collections::HashMap<String, String>,
}

/// Settings that are safe to sync across devices.
/// API keys, local paths, connector tokens, and sync config are excluded.
const SYNC_SAFE_SETTINGS: &[&str] = &[
    "theme",
    "auto_rename_files",
    "llm_enabled",
    "llm_provider",
    "llm_model",
    "llm_base_url",
    "llm_token_budget",
    "llm_concurrent_extractions",
    "llm_auto_parse",
    "llm_context_window",
    "embedding_provider",
    "embedding_model",
    "embedding_source",
    "cloud_embedding_model",
    "rag_auto_index",
    "reranker_provider",
    "reranker_model",
    "graph_auto_index",
    "graph_embedding_provider",
];

/// Write settings.json to the library/ directory (sync-safe settings only).
pub async fn sync_settings_json(pool: &SqlitePool, library_path: &Path) {
    if let Err(e) = write_settings(pool, library_path).await {
        tracing::warn!("Failed to write settings.json: {}", e);
    }
}

async fn write_settings(pool: &SqlitePool, library_path: &Path) -> Result<()> {
    #[derive(sqlx::FromRow)]
    struct Row {
        key: String,
        value: String,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT key, value FROM settings ORDER BY key",
    )
    .fetch_all(pool)
    .await?;

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let settings: std::collections::HashMap<String, String> = rows
        .into_iter()
        .filter(|r| SYNC_SAFE_SETTINGS.contains(&r.key.as_str()))
        .map(|r| (r.key, r.value))
        .collect();

    let data = SettingsJson {
        schema_version: 1,
        date_modified: now,
        settings,
    };

    let json = serde_json::to_string_pretty(&data)?;
    write_json_atomic(&library_path.join("library"), "settings.json", &json)
}
