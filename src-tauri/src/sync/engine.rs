use anyhow::Result;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use super::entry_json::EntryJson;
use super::merge::merge_entries;
use super::reader::upsert_entry_from_json;
use super::writer::entry_to_json;
use crate::search::SearchIndex;

/// Startup sync: reconcile entry.json files on disk with local SQLite.
/// - New entry.json files → insert into SQLite
/// - Changed entry.json files → merge with SQLite, update both
/// - Missing entry.json files → write from SQLite (local changes not yet persisted)
/// - Missing directories → entry was deleted on another device
pub async fn reconcile_on_startup(
    pool: &SqlitePool,
    library_path: &Path,
    search_index: Option<&Arc<SearchIndex>>,
) -> Result<SyncStats> {
    let files_dir = library_path.join("library").join("entries");
    if !files_dir.exists() {
        return Ok(SyncStats::default());
    }

    let mut stats = SyncStats::default();
    let mut changed_keys: Vec<String> = Vec::new();

    // Step 1: Build manifest of what SQLite knows
    let db_entries = get_db_entry_manifest(pool).await?;

    // Step 2: Scan disk for entry.json files
    let disk_entries = scan_entry_json_files(&files_dir)?;

    // Step 3: Process entries found on disk
    for (key, disk_entry) in &disk_entries {
        match db_entries.get(key) {
            Some(db_info) => {
                // Both exist — check if disk version is newer
                let db_modified = &db_info.date_modified;
                let disk_modified = get_entry_json_modified(disk_entry);

                if disk_modified > *db_modified {
                    // Disk is newer — merge and update SQLite
                    match entry_to_json(pool, db_info.id).await {
                        Ok(local_json) => {
                            let result = merge_entries(&local_json, disk_entry);
                            // Store any conflicts in DB for user review
                            for conflict in &result.conflicts {
                                let _ = sqlx::query(
                                    "INSERT INTO sync_conflicts (entry_key, field_name, local_value, remote_value, \
                                     local_timestamp, remote_timestamp) VALUES (?, ?, ?, ?, ?, ?)"
                                )
                                .bind(key)
                                .bind(&conflict.field_name)
                                .bind(&conflict.local_value)
                                .bind(&conflict.remote_value)
                                .bind(&conflict.local_timestamp)
                                .bind(&conflict.remote_timestamp)
                                .execute(pool)
                                .await;
                            }
                            if result.changed {
                                match upsert_entry_from_json(pool, &result.merged).await {
                                    Ok(_) => {
                                        result.merged.write_atomic(
                                            &files_dir.join(&result.merged.key),
                                        )?;
                                        stats.updated += 1;
                                        changed_keys.push(key.clone());
                                    }
                                    Err(e) => {
                                        tracing::warn!("Failed to upsert merged entry {}: {}", key, e);
                                    }
                                }
                            }
                            stats.conflicts += result.conflicts.len();
                        }
                        Err(e) => {
                            tracing::warn!("Failed to read entry {} from DB for merge: {}", key, e);
                        }
                    }
                }
            }
            None => {
                // New entry on disk, not in SQLite — insert
                match upsert_entry_from_json(pool, disk_entry).await {
                    Ok(_) => {
                        stats.added += 1;
                        changed_keys.push(key.clone());
                    }
                    Err(e) => {
                        tracing::warn!("Failed to insert new entry {} from disk: {}", key, e);
                    }
                }
            }
        }
    }

    // Step 4: Entries in SQLite but not on disk — write entry.json from SQLite
    for (key, db_info) in &db_entries {
        if !disk_entries.contains_key(key) {
            let entry_dir = files_dir.join(key);
            if entry_dir.exists() {
                // Directory exists but no entry.json — write it (crash recovery)
                match entry_to_json(pool, db_info.id).await {
                    Ok(json) => {
                        if let Err(e) = json.write_atomic(&entry_dir) {
                            tracing::warn!("Failed to write entry.json for {}: {}", key, e);
                        } else {
                            stats.written += 1;
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to build entry.json for {}: {}", key, e);
                    }
                }
            }
            // If directory doesn't exist at all, the entry was deleted on another device.
            // For now, we don't auto-delete from SQLite on startup — that requires
            // the deletion detection logic (tombstones) to be fully implemented.
        }
    }

    // Step 5: Garbage-collect old tombstones (>90 days)
    let gc_count = gc_tombstones(&files_dir, 90)?;
    if gc_count > 0 {
        tracing::info!("Tombstone GC: cleaned {} old tombstones", gc_count);
    }

    // Step 6: Rebuild search indices for changed entries
    if !changed_keys.is_empty() {
        // Rebuild Tantivy for synced entries
        if let Some(idx) = search_index {
            for key in &changed_keys {
                if let Ok(entry_id) = get_entry_id_by_key(pool, key).await {
                    reindex_entry_in_tantivy(pool, idx, entry_id).await;
                }
            }
            if let Err(e) = idx.commit().await {
                tracing::warn!("Failed to commit search index after sync: {}", e);
            }
        }

        // Mark synced entries as needing RAG re-indexing
        for key in &changed_keys {
            let _ = sqlx::query(
                "UPDATE entries SET rag_indexed = 0, rag_indexed_at = NULL WHERE key = ?",
            )
            .bind(key)
            .execute(pool)
            .await;
        }

        tracing::info!(
            "Rebuilt search index for {} synced entries, marked for RAG re-indexing",
            changed_keys.len()
        );
    }

    tracing::info!(
        "Sync reconciliation: {} added, {} updated, {} written, {} conflicts",
        stats.added, stats.updated, stats.written, stats.conflicts
    );

    Ok(stats)
}

// ── Types ───────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct SyncStats {
    pub added: usize,
    pub updated: usize,
    pub written: usize,
    pub conflicts: usize,
}

struct DbEntryInfo {
    id: i64,
    date_modified: String,
}

// ── Helpers ─────────────────────────────────────────────────────────

async fn get_db_entry_manifest(pool: &SqlitePool) -> Result<HashMap<String, DbEntryInfo>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        key: String,
        date_modified: String,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, key, date_modified FROM entries WHERE is_deleted = 0",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| (r.key.clone(), DbEntryInfo { id: r.id, date_modified: r.date_modified }))
        .collect())
}

fn scan_entry_json_files(files_dir: &Path) -> Result<HashMap<String, EntryJson>> {
    let mut entries = HashMap::new();

    let read_dir = match std::fs::read_dir(files_dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(entries),
    };

    for dir_entry in read_dir.flatten() {
        if !dir_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let entry_json_path = dir_entry.path().join("entry.json");
        if !entry_json_path.exists() {
            continue;
        }
        match EntryJson::read_from(&dir_entry.path()) {
            Ok(entry) => {
                entries.insert(entry.key.clone(), entry);
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to read {:?}: {}",
                    entry_json_path, e
                );
            }
        }
    }

    Ok(entries)
}

/// Remove tombstones older than `max_age_days` from entry.json files.
fn gc_tombstones(files_dir: &Path, max_age_days: i64) -> Result<usize> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age_days);
    let cutoff_str = cutoff.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut cleaned = 0;

    let entries = scan_entry_json_files(files_dir)?;
    for entry in entries.values() {
        let old_len = entry.tombstones.len();
        let mut updated = entry.clone();
        updated
            .tombstones
            .retain(|t| t.deleted_at > cutoff_str);

        if updated.tombstones.len() < old_len {
            let dir = files_dir.join(&updated.key);
            if let Err(e) = updated.write_atomic(&dir) {
                tracing::warn!("Failed to write GC'd entry.json for {}: {}", updated.key, e);
            } else {
                cleaned += old_len - updated.tombstones.len();
            }
        }
    }

    Ok(cleaned)
}

async fn get_entry_id_by_key(pool: &SqlitePool, key: &str) -> Result<i64> {
    let id: i64 = sqlx::query_scalar("SELECT id FROM entries WHERE key = ?")
        .bind(key)
        .fetch_one(pool)
        .await?;
    Ok(id)
}

/// Reindex a single entry in Tantivy (metadata + content).
async fn reindex_entry_in_tantivy(pool: &SqlitePool, search_index: &SearchIndex, entry_id: i64) {
    use crate::search::indexer::EntryMetadata;

    #[derive(sqlx::FromRow)]
    struct MetaRow {
        key: String,
        title: Option<String>,
        item_type: String,
        creators_sort: Option<String>,
    }

    let meta = sqlx::query_as::<_, MetaRow>(
        "SELECT e.key, e.title, it.name as item_type, e.creators_sort \
         FROM entries e JOIN item_types it ON e.item_type_id = it.id WHERE e.id = ?",
    )
    .bind(entry_id)
    .fetch_optional(pool)
    .await;

    if let Ok(Some(m)) = meta {
        let abstract_text: Option<String> = sqlx::query_scalar(
            "SELECT ef.value FROM entry_fields ef JOIN fields f ON ef.field_id = f.id \
             WHERE ef.entry_id = ? AND f.name = 'abstractNote'",
        )
        .bind(entry_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let entry_metadata = EntryMetadata {
            entry_id,
            entry_key: m.key,
            title: m.title,
            creators: m.creators_sort,
            abstract_text,
            item_type: m.item_type,
        };

        if let Err(e) = search_index.index_entry_metadata(&entry_metadata).await {
            tracing::warn!("Failed to reindex entry {} in Tantivy: {}", entry_id, e);
        }
    }
}

/// Get the effective modification timestamp from an EntryJson.
/// Uses the latest timestamp across all fields.
fn get_entry_json_modified(entry: &EntryJson) -> String {
    let mut latest = entry.title.t.clone();

    if entry.item_type.t > latest {
        latest = entry.item_type.t.clone();
    }
    if entry.date.t > latest {
        latest = entry.date.t.clone();
    }
    for field in entry.fields.values() {
        if field.t > latest {
            latest = field.t.clone();
        }
    }
    if entry.creators.t > latest {
        latest = entry.creators.t.clone();
    }
    for ann in &entry.annotations {
        if ann.comment.t > latest {
            latest = ann.comment.t.clone();
        }
        if ann.color.t > latest {
            latest = ann.color.t.clone();
        }
    }
    if let Some(ref pc) = entry.parsed_content
        && pc.t > latest {
            latest = pc.t.clone();
        }

    latest
}
