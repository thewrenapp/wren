use crate::db::models::Setting;
use crate::state::AppState;
use sqlx::FromRow;
use tauri::State;

#[derive(Debug, FromRow)]
struct SettingRow {
    key: String,
    value: String,
    value_type: String,
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Vec<Setting>, String> {
    let settings: Vec<SettingRow> = sqlx::query_as::<_, SettingRow>(
        "SELECT key, value, value_type FROM settings"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(settings
        .into_iter()
        .map(|s| Setting {
            key: s.key,
            value: s.value,
            value_type: s.value_type,
        })
        .collect())
}

#[tauri::command]
pub async fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO settings (key, value, date_modified)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            date_modified = datetime('now')
        "#
    )
    .bind(key)
    .bind(value)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let lib = state.library_path.read().await;
    crate::sync::globals::sync_settings_json(&state.db, &lib).await;

    Ok(())
}

#[tauri::command]
pub async fn get_library_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.get_library_path_string().await)
}

/// Get a single setting value by key
#[tauri::command]
pub async fn get_setting_value_cmd(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    Ok(get_setting_value(&state.db, &key).await)
}

/// Set up sync by symlinking library/ to a cloud-synced folder.
/// 1. Creates the sync folder if needed
/// 2. Moves library/ contents to sync folder
/// 3. Replaces library/ with a symlink
#[tauri::command]
pub async fn setup_sync_folder(state: State<'_, AppState>, sync_folder: String) -> Result<(), String> {
    use std::fs;

    let library_path = state.library_path.read().await;
    let library_dir = library_path.join("library");
    let sync_path = std::path::PathBuf::from(&sync_folder);

    // Create sync folder if it doesn't exist
    fs::create_dir_all(&sync_path).map_err(|e| format!("Failed to create sync folder: {}", e))?;

    // Determine where current data lives
    let old_source = if library_dir.is_symlink() {
        // Switching from one sync folder to another — data is in the old target
        let old_target = fs::read_link(&library_dir)
            .map_err(|e| format!("Failed to read old symlink: {}", e))?;
        fs::remove_file(&library_dir)
            .map_err(|e| format!("Failed to remove old symlink: {}", e))?;
        old_target
    } else if library_dir.exists() {
        // First-time setup — data is in the real library/ directory
        library_dir.clone()
    } else {
        // No data yet — just create the symlink
        std::path::PathBuf::new()
    };

    // Move data from old source to new sync folder
    if old_source.exists() && old_source != sync_path {
        // Move entries/
        let src_entries = old_source.join("entries");
        let dst_entries = sync_path.join("entries");
        if src_entries.exists() {
            fs::create_dir_all(&dst_entries).ok();
            if let Ok(dirs) = fs::read_dir(&src_entries) {
                for entry in dirs.flatten() {
                    let dst = dst_entries.join(entry.file_name());
                    if !dst.exists() {
                        if let Err(e) = fs::rename(entry.path(), &dst) {
                            // rename fails across filesystems — fall back to copy + delete
                            tracing::warn!("rename failed, trying copy: {}", e);
                            if entry.path().is_dir() {
                                let _ = copy_dir_all(&entry.path(), &dst);
                            } else {
                                let _ = fs::copy(entry.path(), &dst);
                            }
                            let _ = fs::remove_dir_all(entry.path());
                        }
                    }
                }
            }
            let _ = fs::remove_dir(&src_entries);
        }

        // Move global metadata files
        for file in &["collections.json", "tags.json", "saved_searches.json", "settings.json"] {
            let src = old_source.join(file);
            let dst = sync_path.join(file);
            if src.exists() && !dst.exists() {
                let _ = fs::rename(&src, &dst);
            }
        }

        // Clean up old source if it was the local library/ dir (not another sync folder)
        if old_source == library_dir {
            let _ = fs::remove_dir_all(&library_dir);
        }
    }

    // Create symlink: library/ → sync folder
    #[cfg(unix)]
    std::os::unix::fs::symlink(&sync_path, &library_dir)
        .map_err(|e| format!("Failed to create symlink: {}", e))?;

    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&sync_path, &library_dir)
        .map_err(|e| format!("Failed to create symlink: {}", e))?;

    // Save setting
    sqlx::query(
        "INSERT INTO settings (key, value, value_type) VALUES ('sync_folder', ?, 'string') \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .bind(&sync_folder)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!("Sync folder set up: {:?} → {:?}", library_dir, sync_path);

    Ok(())
}

/// Remove sync symlink and copy files back to local library/.
#[tauri::command]
pub async fn disable_sync(state: State<'_, AppState>) -> Result<(), String> {
    use std::fs;

    let library_path = state.library_path.read().await;
    let library_dir = library_path.join("library");

    if !library_dir.is_symlink() {
        return Ok(()); // Not synced, nothing to do
    }

    // Read where symlink points
    let sync_target = fs::read_link(&library_dir)
        .map_err(|e| format!("Failed to read symlink: {}", e))?;

    // Remove symlink
    fs::remove_file(&library_dir)
        .map_err(|e| format!("Failed to remove symlink: {}", e))?;

    // Create real directory and copy contents back
    fs::create_dir_all(&library_dir)
        .map_err(|e| format!("Failed to create library dir: {}", e))?;

    // Copy entries/ back
    let src_entries = sync_target.join("entries");
    let dst_entries = library_dir.join("entries");
    if src_entries.exists() {
        // Try rename first, fall back to per-entry move
        if fs::rename(&src_entries, &dst_entries).is_err() {
            fs::create_dir_all(&dst_entries).ok();
            if let Ok(dirs) = fs::read_dir(&src_entries) {
                for entry in dirs.flatten() {
                    let dst = dst_entries.join(entry.file_name());
                    let _ = fs::rename(entry.path(), &dst);
                }
            }
        }
    }

    // Move global metadata files back
    for file in &["collections.json", "tags.json", "saved_searches.json", "settings.json"] {
        let src = sync_target.join(file);
        let dst = library_dir.join(file);
        if src.exists() {
            let _ = fs::rename(&src, &dst);
        }
    }

    // Clean up the old sync folder (now empty or nearly empty)
    if sync_target.exists()
        && let Err(e) = fs::remove_dir_all(&sync_target) {
            tracing::warn!("Failed to clean up old sync folder {:?}: {}", sync_target, e);
        }

    // Clear setting
    sqlx::query("DELETE FROM settings WHERE key = 'sync_folder'")
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!("Sync disabled, files moved back to {:?}, old sync folder removed", library_dir);

    Ok(())
}

/// Recursively copy a directory (fallback when rename fails across filesystems).
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    use std::fs;
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let dst_path = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), &dst_path)?;
        }
    }
    Ok(())
}

/// Helper function to get a setting value by key (internal use, not a tauri command)
pub async fn get_setting_value(pool: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

/// Helper function to check if a boolean setting is enabled
pub async fn is_setting_enabled(pool: &sqlx::SqlitePool, key: &str) -> bool {
    get_setting_value(pool, key)
        .await
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}
