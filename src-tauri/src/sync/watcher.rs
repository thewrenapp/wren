use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use super::entry_json::EntryJson;
use super::merge::merge_entries;
use super::reader::upsert_entry_from_json;
use super::writer::entry_to_json;

/// Start watching the files/ directory for entry.json changes from other devices.
/// Spawns a background task that processes changes and emits Tauri events.
pub fn start_watcher(
    pool: SqlitePool,
    library_path: Arc<RwLock<PathBuf>>,
    app_handle: tauri::AppHandle,
) {
    tokio::spawn(async move {
        if let Err(e) = run_watcher(pool, library_path, app_handle).await {
            tracing::error!("File watcher failed: {}", e);
        }
    });
}

async fn run_watcher(
    pool: SqlitePool,
    library_path: Arc<RwLock<PathBuf>>,
    app_handle: tauri::AppHandle,
) -> anyhow::Result<()> {
    let lib_path = library_path.read().await.clone();
    let files_dir = lib_path.join("library").join("entries");

    if !files_dir.exists() {
        tracing::info!("Files directory does not exist, skipping watcher");
        return Ok(());
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<PathBuf>>(100);

    // Capture the Tokio runtime handle while still on the async task
    let rt_handle = tokio::runtime::Handle::current();

    // The file watcher runs on a dedicated OS thread (notify uses blocking I/O)
    std::thread::spawn(move || {
        let (notify_tx, notify_rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_secs(2), notify_tx) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("Failed to create file watcher: {}", e);
                return;
            }
        };

        if let Err(e) = debouncer
            .watcher()
            .watch(&files_dir, notify::RecursiveMode::Recursive)
        {
            tracing::error!("Failed to watch {:?}: {}", files_dir, e);
            return;
        }

        tracing::info!("File watcher started on {:?}", files_dir);

        loop {
            match notify_rx.recv() {
                Ok(Ok(events)) => {
                    let entry_json_paths: Vec<PathBuf> = events
                        .into_iter()
                        .filter(|e| e.kind == DebouncedEventKind::Any)
                        .filter_map(|e| {
                            if e.path.file_name().map(|f| f == "entry.json").unwrap_or(false) {
                                Some(e.path)
                            } else {
                                None
                            }
                        })
                        .collect();

                    if !entry_json_paths.is_empty() {
                        let tx = tx.clone();
                        let _ = rt_handle.block_on(tx.send(entry_json_paths));
                    }
                }
                Ok(Err(e)) => {
                    tracing::warn!("File watcher error: {:?}", e);
                }
                Err(_) => break,
            }
        }
    });

    // Process changed entry.json files on the async side
    while let Some(paths) = rx.recv().await {
        for path in paths {
            if let Err(e) = process_changed_entry_json(&pool, &path, &app_handle).await {
                tracing::warn!("Failed to process changed {:?}: {}", path, e);
            }
        }
    }

    Ok(())
}

async fn process_changed_entry_json(
    pool: &SqlitePool,
    path: &Path,
    app_handle: &tauri::AppHandle,
) -> anyhow::Result<()> {
    let entry_dir = path.parent().ok_or_else(|| anyhow::anyhow!("No parent dir"))?;

    // Skip .tmp files (our own atomic writes in progress)
    if path.extension().map(|e| e == "tmp").unwrap_or(false) {
        return Ok(());
    }

    let disk_entry = EntryJson::read_from(entry_dir)?;
    let key = &disk_entry.key;

    let existing_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM entries WHERE key = ?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?;

    match existing_id {
        Some(id) => {
            let local_json = entry_to_json(pool, id).await?;
            let result = merge_entries(&local_json, &disk_entry);
            if result.changed {
                upsert_entry_from_json(pool, &result.merged).await?;
                result.merged.write_atomic(entry_dir)?;
                tracing::debug!("Sync: updated entry {} from disk", key);

                use tauri::Emitter;
                let _ = app_handle.emit("sync:entry-updated", key.as_str());
            }
        }
        None => {
            upsert_entry_from_json(pool, &disk_entry).await?;
            tracing::debug!("Sync: added entry {} from disk", key);

            use tauri::Emitter;
            let _ = app_handle.emit("sync:entry-added", key.as_str());
        }
    }

    Ok(())
}
