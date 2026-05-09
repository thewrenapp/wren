use std::fs::File;
use std::io::Read;
use std::path::Path;

use flate2::write::GzEncoder;
use flate2::Compression;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;
use crate::sync::writer::entry_to_json;

use super::archive_types::*;

// ── Shared helper ──────────────────────────────────────────────────

/// Write entries (by ID) into a tar archive, including their attachment files.
/// Returns (entries_written, files_written).
async fn write_entries_to_tar(
    builder: &mut tar::Builder<GzEncoder<File>>,
    pool: &SqlitePool,
    library_path: &Path,
    entry_ids: &[i64],
    app_handle: &AppHandle,
) -> Result<(usize, usize), String> {
    let total = entry_ids.len();
    let mut entries_written = 0usize;
    let mut files_written = 0usize;

    for (i, &entry_id) in entry_ids.iter().enumerate() {
        let entry_json = entry_to_json(pool, entry_id)
            .await
            .map_err(|e| format!("Failed to serialize entry {}: {}", entry_id, e))?;

        let key = &entry_json.key;

        // Emit progress
        let _ = app_handle.emit(
            "archive-export-progress",
            ArchiveProgress {
                current: i + 1,
                total,
                current_entry: entry_json.title.v.clone(),
                step: "writing".into(),
            },
        );

        // Write entry.json into archive
        let json_bytes = serde_json::to_string_pretty(&entry_json)
            .map_err(|e| format!("Failed to serialize entry JSON: {}", e))?;
        let json_data = json_bytes.as_bytes();
        let mut header = tar::Header::new_gnu();
        header.set_size(json_data.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        let archive_path = format!("entries/{}/entry.json", key);
        builder
            .append_data(&mut header, &archive_path, json_data)
            .map_err(|e| format!("Failed to write entry.json to archive: {}", e))?;

        // Copy the entry's attachment files. They live directly in the entry
        // folder (library/entries/{key}/<file>), alongside entry.json and any
        // extracted-text sidecars — entry.json is written from the DB above.
        let entry_dir = library_path.join("library").join("entries").join(key);

        if entry_dir.exists()
            && let Ok(read_dir) = std::fs::read_dir(&entry_dir)
        {
            for dir_entry in read_dir.flatten() {
                let file_path = dir_entry.path();
                if !file_path.is_file() {
                    continue;
                }
                let file_name = match file_path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                // Skip entry.json (written from the DB above) and hidden files.
                if file_name == "entry.json" || file_name.starts_with('.') {
                    continue;
                }

                let mut file = File::open(&file_path).map_err(|e| {
                    format!("Failed to open attachment {}: {}", file_name, e)
                })?;
                let mut contents = Vec::new();
                file.read_to_end(&mut contents).map_err(|e| {
                    format!("Failed to read attachment {}: {}", file_name, e)
                })?;

                let mut header = tar::Header::new_gnu();
                header.set_size(contents.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                let att_archive_path = format!("entries/{}/{}", key, file_name);
                builder
                    .append_data(&mut header, &att_archive_path, contents.as_slice())
                    .map_err(|e| {
                        format!("Failed to write attachment to archive: {}", e)
                    })?;

                files_written += 1;
            }
        }
        entries_written += 1;
    }

    Ok((entries_written, files_written))
}

/// Helper to write a JSON blob into the archive at the given path.
fn write_json_to_tar(
    builder: &mut tar::Builder<GzEncoder<File>>,
    archive_path: &str,
    json: &str,
) -> Result<(), String> {
    let data = json.as_bytes();
    let mut header = tar::Header::new_gnu();
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, archive_path, data)
        .map_err(|e| format!("Failed to write {} to archive: {}", archive_path, e))
}

/// Fetch all non-deleted entry IDs.
async fn all_entry_ids(pool: &SqlitePool) -> Result<Vec<i64>, String> {
    sqlx::query_scalar::<_, i64>("SELECT id FROM entries WHERE is_deleted = 0 ORDER BY id")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to fetch entries: {}", e))
}

/// Build the manifest JSON string.
fn build_manifest(
    format: &str,
    entry_count: usize,
    collection_name: Option<String>,
    collection_key: Option<String>,
) -> String {
    let manifest = ArchiveManifest {
        format: format.into(),
        version: ARCHIVE_FORMAT_VERSION,
        created_at: chrono::Utc::now()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        app_version: env!("CARGO_PKG_VERSION").into(),
        entry_count,
        collection_name,
        collection_key,
    };
    serde_json::to_string_pretty(&manifest).unwrap_or_default()
}

/// Create a tar.gz builder writing to the given output path.
fn create_archive(output_path: &str) -> Result<tar::Builder<GzEncoder<File>>, String> {
    let file =
        File::create(output_path).map_err(|e| format!("Failed to create archive: {}", e))?;
    let encoder = GzEncoder::new(file, Compression::default());
    Ok(tar::Builder::new(encoder))
}

/// Finish the archive and return its size.
fn finish_archive(builder: tar::Builder<GzEncoder<File>>, path: &str) -> Result<u64, String> {
    let encoder = builder
        .into_inner()
        .map_err(|e| format!("Failed to finalize tar: {}", e))?;
    encoder
        .finish()
        .map_err(|e| format!("Failed to finish gzip: {}", e))?;
    let meta =
        std::fs::metadata(path).map_err(|e| format!("Failed to read archive size: {}", e))?;
    Ok(meta.len())
}

// ── Tauri commands ─────────────────────────────────────────────────

/// Export selected entries as a .wrenitem archive.
#[tauri::command]
pub async fn export_entries_archive(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    entry_ids: Vec<i64>,
    output_path: String,
) -> Result<ArchiveExportResult, String> {
    let library_path = state.library_path.read().await.clone();
    let mut builder = create_archive(&output_path)?;

    let manifest = build_manifest("wrenitem", entry_ids.len(), None, None);
    write_json_to_tar(&mut builder, "manifest.json", &manifest)?;

    let (entries_exported, files_exported) =
        write_entries_to_tar(&mut builder, &state.db, &library_path, &entry_ids, &app_handle)
            .await?;

    let archive_size_bytes = finish_archive(builder, &output_path)?;

    Ok(ArchiveExportResult {
        entries_exported,
        files_exported,
        archive_size_bytes,
    })
}

/// Export a collection (with all its entries) as a .wrenitem archive.
#[tauri::command]
pub async fn export_collection_archive(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    collection_id: i64,
    output_path: String,
) -> Result<ArchiveExportResult, String> {
    let library_path = state.library_path.read().await.clone();

    // Fetch collection metadata
    #[derive(sqlx::FromRow)]
    struct CollRow {
        key: String,
        name: String,
        description: Option<String>,
        color: Option<String>,
        icon: Option<String>,
    }

    let coll: CollRow = sqlx::query_as(
        "SELECT key, name, description, color, icon FROM collections WHERE id = ?",
    )
    .bind(collection_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Collection not found: {}", e))?;

    // Fetch entry IDs in this collection
    let entry_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT entry_id FROM collection_entries WHERE collection_id = ?",
    )
    .bind(collection_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("Failed to fetch collection entries: {}", e))?;

    let mut builder = create_archive(&output_path)?;

    let manifest = build_manifest(
        "wrenitem",
        entry_ids.len(),
        Some(coll.name.clone()),
        Some(coll.key.clone()),
    );
    write_json_to_tar(&mut builder, "manifest.json", &manifest)?;

    // Write a minimal collections.json with just this collection
    let coll_json = serde_json::to_string_pretty(&serde_json::json!({
        "schema_version": 1,
        "date_modified": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "collections": [{
            "key": coll.key,
            "name": coll.name,
            "description": coll.description,
            "color": coll.color,
            "icon": coll.icon,
        }]
    }))
    .map_err(|e| format!("Failed to serialize collections: {}", e))?;
    write_json_to_tar(&mut builder, "collections.json", &coll_json)?;

    let (entries_exported, files_exported) =
        write_entries_to_tar(&mut builder, &state.db, &library_path, &entry_ids, &app_handle)
            .await?;

    let archive_size_bytes = finish_archive(builder, &output_path)?;

    Ok(ArchiveExportResult {
        entries_exported,
        files_exported,
        archive_size_bytes,
    })
}

/// Export the entire library as a .wren archive.
#[tauri::command]
pub async fn export_library_archive(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    output_path: String,
) -> Result<ArchiveExportResult, String> {
    let library_path = state.library_path.read().await.clone();
    let pool = &state.db;

    let entry_ids = all_entry_ids(pool).await?;
    let mut builder = create_archive(&output_path)?;

    let manifest = build_manifest("wren", entry_ids.len(), None, None);
    write_json_to_tar(&mut builder, "manifest.json", &manifest)?;

    // Write global JSON files from the sync directory
    let lib_dir = library_path.join("library");
    for filename in &[
        "collections.json",
        "tags.json",
        "saved_searches.json",
        "settings.json",
    ] {
        let path = lib_dir.join(filename);
        if path.exists()
            && let Ok(content) = std::fs::read_to_string(&path)
        {
            write_json_to_tar(&mut builder, filename, &content)?;
        }
    }

    let (entries_exported, files_exported) =
        write_entries_to_tar(&mut builder, pool, &library_path, &entry_ids, &app_handle)
            .await?;

    let archive_size_bytes = finish_archive(builder, &output_path)?;

    Ok(ArchiveExportResult {
        entries_exported,
        files_exported,
        archive_size_bytes,
    })
}
