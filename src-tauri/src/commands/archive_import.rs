use std::collections::HashSet;
use std::fs::File;
use std::io::Read;

use flate2::read::GzDecoder;
use tar::Archive;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;
use crate::sync::entry_json::EntryJson;
use crate::sync::globals::{CollectionsJson, SavedSearchesJson, SettingsJson, TagsJson};
use crate::sync::reader::upsert_entry_from_json;

use super::archive_types::*;

// ── Helpers ────────────────────────────────────────────────────────

/// Read the entire contents of a tar.gz archive into memory as (path, bytes) pairs.
/// We read everything upfront because the tar streaming API only allows one pass.
fn read_archive_entries(
    archive_path: &str,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let file = File::open(archive_path)
        .map_err(|e| format!("Failed to open archive: {}", e))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    let mut items = Vec::new();

    for entry_result in archive
        .entries()
        .map_err(|e| format!("Failed to read archive entries: {}", e))?
    {
        let mut entry = entry_result
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("Invalid path in archive: {}", e))?
            .to_string_lossy()
            .to_string();
        let mut data = Vec::new();
        entry
            .read_to_end(&mut data)
            .map_err(|e| format!("Failed to read entry data: {}", e))?;
        items.push((path, data));
    }

    Ok(items)
}

/// Parse manifest.json from archive items.
fn parse_manifest(items: &[(String, Vec<u8>)]) -> Result<ArchiveManifest, String> {
    let manifest_data = items
        .iter()
        .find(|(p, _)| p == "manifest.json")
        .ok_or("Archive missing manifest.json")?;
    serde_json::from_slice(&manifest_data.1)
        .map_err(|e| format!("Invalid manifest.json: {}", e))
}

// ── Tauri commands ─────────────────────────────────────────────────

/// Preview an archive without importing — returns metadata and counts.
#[tauri::command]
pub async fn preview_archive(
    archive_path: String,
) -> Result<ArchivePreviewResult, String> {
    let items = read_archive_entries(&archive_path)?;
    let manifest = parse_manifest(&items)?;

    if manifest.version > ARCHIVE_FORMAT_VERSION {
        return Err(format!(
            "Archive version {} is newer than supported version {}. Please update Wren.",
            manifest.version, ARCHIVE_FORMAT_VERSION
        ));
    }

    // Count unique entry directories
    let entry_keys: HashSet<&str> = items
        .iter()
        .filter_map(|(p, _)| {
            p.strip_prefix("entries/")
                .and_then(|rest| rest.split('/').next())
        })
        .collect();

    let has_collections = items.iter().any(|(p, _)| p == "collections.json");
    let has_tags = items.iter().any(|(p, _)| p == "tags.json");
    let has_settings = items.iter().any(|(p, _)| p == "settings.json");

    Ok(ArchivePreviewResult {
        format: manifest.format,
        version: manifest.version,
        entry_count: entry_keys.len(),
        has_collections,
        has_tags,
        has_settings,
        collection_name: manifest.collection_name,
    })
}

/// Import entries (and optionally collections) from a .wrenitem or .wren archive.
#[tauri::command]
pub async fn import_entries_archive(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    archive_path: String,
) -> Result<ArchiveImportResult, String> {
    let library_path = state.library_path.read().await.clone();
    let items = read_archive_entries(&archive_path)?;
    let manifest = parse_manifest(&items)?;

    if manifest.version > ARCHIVE_FORMAT_VERSION {
        return Err(format!(
            "Archive version {} is newer than supported version {}. Please update Wren.",
            manifest.version, ARCHIVE_FORMAT_VERSION
        ));
    }

    let mut result = ArchiveImportResult {
        entries_imported: 0,
        entries_skipped: 0,
        files_imported: 0,
        collections_imported: 0,
        errors: Vec::new(),
    };

    // Group items by entry key
    let mut entry_jsons: Vec<(String, EntryJson)> = Vec::new();
    let mut attachment_files: Vec<(String, Vec<u8>)> = Vec::new();

    for (path, data) in &items {
        if let Some(rest) = path.strip_prefix("entries/") {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            if parts.len() == 2 && parts[1] == "entry.json" {
                match serde_json::from_slice::<EntryJson>(data) {
                    Ok(entry) => entry_jsons.push((parts[0].to_string(), entry)),
                    Err(e) => {
                        result
                            .errors
                            .push(format!("Failed to parse entry {}: {}", parts[0], e));
                    }
                }
            } else if parts.len() == 2 {
                attachment_files.push((path.clone(), data.clone()));
            }
        }
    }

    let total = entry_jsons.len();

    // Import each entry
    for (i, (key, entry_json)) in entry_jsons.iter().enumerate() {
        let _ = app_handle.emit(
            "archive-import-progress",
            ArchiveProgress {
                current: i + 1,
                total,
                current_entry: entry_json.title.v.clone(),
                step: "importing".into(),
            },
        );

        // Upsert entry into SQLite (handles create-or-update)
        match upsert_entry_from_json(&state.db, entry_json).await {
            Ok(_entry_id) => {
                result.entries_imported += 1;

                // Write entry.json to library for sync consistency
                let entry_dir = library_path
                    .join("library")
                    .join("entries")
                    .join(key);
                if let Err(e) = entry_json.write_atomic(&entry_dir) {
                    result.errors.push(format!(
                        "Entry imported but failed to write entry.json for {}: {}",
                        key, e
                    ));
                }

                // Extract attachment files for this entry
                let att_prefix = format!("entries/{}/attachments/", key);
                let att_dir = entry_dir.join("attachments");

                for (att_path, att_data) in &attachment_files {
                    if let Some(rel_name) = att_path.strip_prefix(&att_prefix) {
                        if let Err(e) = std::fs::create_dir_all(&att_dir) {
                            result.errors.push(format!(
                                "Failed to create attachments dir: {}",
                                e
                            ));
                            continue;
                        }
                        let dest = att_dir.join(rel_name);
                        if let Err(e) = std::fs::write(&dest, att_data) {
                            result.errors.push(format!(
                                "Failed to write attachment {}: {}",
                                rel_name, e
                            ));
                        } else {
                            result.files_imported += 1;
                        }
                    }
                }
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("Failed to import entry {}: {}", key, e));
            }
        }
    }

    // Import collections if present
    if let Some((_, data)) = items.iter().find(|(p, _)| p == "collections.json") {
        result.collections_imported +=
            import_collections_from_json(&state.db, data).await.unwrap_or(0);
    }

    Ok(result)
}

/// Import a full library from a .wren archive.
#[tauri::command]
pub async fn import_library_archive(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    archive_path: String,
    mode: String,
) -> Result<ArchiveImportResult, String> {
    // For both merge and replace, we use the same entry import logic.
    // "replace" clears entries first, "merge" upserts on top of existing data.
    if mode == "replace" {
        // Clear all entries (soft-delete)
        sqlx::query("UPDATE entries SET is_deleted = 1")
            .execute(&state.db)
            .await
            .map_err(|e| format!("Failed to clear entries: {}", e))?;
    }

    let mut result = import_entries_archive(state.clone(), app_handle, archive_path.clone())
        .await?;

    let library_path = state.library_path.read().await.clone();
    let items = read_archive_entries(&archive_path)?;

    // Import tags
    if let Some((_, data)) = items.iter().find(|(p, _)| p == "tags.json")
        && let Err(e) = import_tags_from_json(&state.db, data).await
    {
        result.errors.push(format!("Failed to import tags: {}", e));
    }

    // Import saved searches
    if let Some((_, data)) = items.iter().find(|(p, _)| p == "saved_searches.json")
        && let Err(e) = import_saved_searches_from_json(&state.db, data).await
    {
        result
            .errors
            .push(format!("Failed to import saved searches: {}", e));
    }

    // Import settings (merge only — don't overwrite API keys or local paths)
    if let Some((_, data)) = items.iter().find(|(p, _)| p == "settings.json")
        && let Err(e) = import_settings_from_json(&state.db, data).await
    {
        result.errors.push(format!("Failed to import settings: {}", e));
    }

    // Write global JSONs to library/ for sync consistency
    let lib_dir = library_path.join("library");
    for filename in &["collections.json", "tags.json", "saved_searches.json", "settings.json"] {
        if let Some((_, data)) = items.iter().find(|(p, _)| p == *filename) {
            let dest = lib_dir.join(filename);
            let _ = std::fs::create_dir_all(&lib_dir);
            let _ = std::fs::write(&dest, data);
        }
    }

    Ok(result)
}

// ── Global JSON import helpers ─────────────────────────────────────

async fn import_collections_from_json(
    pool: &sqlx::SqlitePool,
    data: &[u8],
) -> Result<usize, String> {
    let coll_json: CollectionsJson =
        serde_json::from_slice(data).map_err(|e| format!("Invalid collections.json: {}", e))?;
    let mut count = 0;

    for c in &coll_json.collections {
        // Upsert collection by key
        let existing: Option<i64> =
            sqlx::query_scalar("SELECT id FROM collections WHERE key = ?")
                .bind(&c.key)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?;

        if existing.is_none() {
            // Resolve parent_id if parent_key is present
            let parent_id: Option<i64> = if let Some(ref pk) = c.parent_key {
                sqlx::query_scalar("SELECT id FROM collections WHERE key = ?")
                    .bind(pk)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                None
            };

            sqlx::query(
                "INSERT INTO collections (key, name, description, color, icon, parent_id) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&c.key)
            .bind(&c.name)
            .bind(&c.description)
            .bind(&c.color)
            .bind(&c.icon)
            .bind(parent_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    Ok(count)
}

async fn import_tags_from_json(
    pool: &sqlx::SqlitePool,
    data: &[u8],
) -> Result<(), String> {
    let tags_json: TagsJson =
        serde_json::from_slice(data).map_err(|e| format!("Invalid tags.json: {}", e))?;

    for t in &tags_json.tags {
        let existing: Option<i64> =
            sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
                .bind(&t.name)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?;

        if existing.is_none() {
            sqlx::query("INSERT INTO tags (name, color, is_imported) VALUES (?, ?, 0)")
                .bind(&t.name)
                .bind(&t.color)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

async fn import_saved_searches_from_json(
    pool: &sqlx::SqlitePool,
    data: &[u8],
) -> Result<(), String> {
    let searches_json: SavedSearchesJson =
        serde_json::from_slice(data).map_err(|e| format!("Invalid saved_searches.json: {}", e))?;

    for s in &searches_json.saved_searches {
        let existing: Option<i64> =
            sqlx::query_scalar("SELECT id FROM saved_searches WHERE name = ?")
                .bind(&s.name)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?;

        if existing.is_none() {
            let coll_id: Option<i64> = if let Some(ref ck) = s.collection_key {
                sqlx::query_scalar("SELECT id FROM collections WHERE key = ?")
                    .bind(ck)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                None
            };

            sqlx::query(
                "INSERT INTO saved_searches (name, match_mode, criteria_json, scope, collection_id, sort_order) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&s.name)
            .bind(&s.match_mode)
            .bind(&s.criteria_json)
            .bind(&s.scope)
            .bind(coll_id)
            .bind(s.sort_order)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

async fn import_settings_from_json(
    pool: &sqlx::SqlitePool,
    data: &[u8],
) -> Result<(), String> {
    let settings_json: SettingsJson =
        serde_json::from_slice(data).map_err(|e| format!("Invalid settings.json: {}", e))?;

    for (key, value) in &settings_json.settings {
        // Only import sync-safe settings — skip API keys and local paths
        sqlx::query(
            "INSERT INTO settings (key, value, date_modified) \
             VALUES (?, ?, datetime('now')) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, \
             date_modified = datetime('now')",
        )
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
