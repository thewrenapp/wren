use anyhow::Result;
use crate::docparse::config::OrtConfig;
use crate::docparse::DocParser;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{OnceCell, RwLock};

use crate::connector::ConnectorServer;
use crate::db;
use crate::jobs::queue::JobQueue;
use crate::search::SearchIndex;

pub struct AppState {
    pub db: SqlitePool,
    pub library_path: Arc<RwLock<PathBuf>>,
    pub search_index: Arc<SearchIndex>,
    pub job_queue: Arc<JobQueue>,
    /// Document PDF parser (lazy-initialized on first PDF upload).
    pdf_parser: Arc<OnceCell<DocParser>>,
    /// Connector HTTP server for browser extension
    pub connector_server: Arc<RwLock<Option<ConnectorServer>>>,
}

impl AppState {
    pub async fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let library_path = Self::get_library_path()?;

        // Ensure library directory exists
        std::fs::create_dir_all(&library_path)?;
        std::fs::create_dir_all(library_path.join("library").join("entries"))?;

        // Migrate old directory layouts (one-time, idempotent)
        Self::migrate_local_dir(&library_path);
        Self::migrate_files_to_library(&library_path);

        std::fs::create_dir_all(library_path.join(".local.nosync"))?;

        // Initialize database
        let db_path = library_path.join(".local.nosync").join("wren.db");
        let db = db::connection::create_pool(&db_path).await?;

        // Run migrations
        db::migrations::run_migrations(&db).await?;

        tracing::info!("Database initialized at {:?}", db_path);

        // Backfill note content into parsed_content table
        Self::backfill_note_parsed_content(&db, &library_path).await;

        // Migrate absolute file paths to relative (one-time, idempotent)
        Self::migrate_paths_to_relative(&db, &library_path).await;

        // Initialize full-text search index (before sync so sync can reindex)
        let index_path = library_path.join(".local.nosync").join("tantivy_index");
        let search_index = SearchIndex::open_or_create(&index_path)?;
        tracing::info!("Search index initialized at {:?}", index_path);

        let search_index = Arc::new(search_index);

        // Sync: reconcile entry.json files with SQLite + rebuild indices
        if let Err(e) = crate::sync::engine::reconcile_on_startup(
            &db, &library_path, Some(&search_index),
        ).await {
            tracing::warn!("Startup sync reconciliation failed: {}", e);
        }

        // Write global metadata files (collections.json, tags.json, saved_searches.json)
        crate::sync::globals::sync_collections_json(&db, &library_path).await;
        crate::sync::globals::sync_tags_json(&db, &library_path).await;
        crate::sync::globals::sync_saved_searches_json(&db, &library_path).await;
        crate::sync::globals::sync_settings_json(&db, &library_path).await;

        let library_path = Arc::new(RwLock::new(library_path));

        let pdf_parser = Arc::new(OnceCell::const_new());

        // Initialize job queue
        let job_queue = Arc::new(JobQueue::new(
            db.clone(),
            app_handle.clone(),
            search_index.clone(),
            library_path.clone(),
            pdf_parser.clone(),
            1, // max concurrent jobs (safe for local models like oMLX)
        ));

        // Recover jobs that were interrupted by app shutdown
        if let Err(e) = job_queue.recover_interrupted_jobs().await {
            tracing::warn!("Failed to recover interrupted jobs: {}", e);
        }

        // Start the background job scheduler
        job_queue.start_scheduler();
        tracing::info!("Job queue initialized");

        // Start file watcher for sync (watches library/entries/ for entry.json changes)
        crate::sync::watcher::start_watcher(
            db.clone(),
            library_path.clone(),
            app_handle.clone(),
        );

        // Start connector server if enabled
        let connector_server = Arc::new(RwLock::new(None));
        {
            let connector_enabled = crate::commands::settings::is_setting_enabled(&db, "connector_enabled").await;
            if connector_enabled {
                let port_str = crate::commands::settings::get_setting_value(&db, "connector_port")
                    .await
                    .unwrap_or_else(|| "1289".to_string());
                let port: u16 = port_str.parse().unwrap_or(1289);

                match ConnectorServer::start(
                    port,
                    db.clone(),
                    library_path.clone(),
                    search_index.clone(),
                    job_queue.clone(),
                    app_handle.clone(),
                )
                .await
                {
                    Ok(server) => {
                        *connector_server.write().await = Some(server);
                        tracing::info!("Connector server started on port {}", port);
                    }
                    Err(e) => {
                        tracing::error!("Failed to start connector server: {}", e);
                    }
                }
            }
        }

        Ok(Self {
            db,
            library_path,
            search_index,
            job_queue,
            pdf_parser,
            connector_server,
        })
    }

    /// Get or lazily initialize the PDF parser (first call loads ONNX models).
    pub async fn get_pdf_parser(&self) -> Result<&DocParser> {
        self.pdf_parser
            .get_or_try_init(|| async {
                tracing::info!("Lazily initializing PDF parser (ONNX + CoreML)...");
                let parser = tokio::task::spawn_blocking(|| {
                    let ort_config = OrtConfig::default();
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        DocParser::new(ort_config)
                    }))
                    .map_err(|panic| {
                        let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                            s.to_string()
                        } else if let Some(s) = panic.downcast_ref::<String>() {
                            s.clone()
                        } else {
                            "unknown panic during ONNX model loading".to_string()
                        };
                        anyhow::anyhow!("PDF parser init panicked: {}", msg)
                    })?
                })
                .await
                .map_err(|e| anyhow::anyhow!("PDF parser init task failed: {}", e))??;

                tracing::info!("PDF parser initialized successfully");
                Ok(parser)
            })
            .await
    }

    /// Get a cloneable reference to the PDF parser cell.
    pub fn pdf_parser_ref(&self) -> Arc<OnceCell<DocParser>> {
        self.pdf_parser.clone()
    }

    /// One-time migration: move old files/ directory to library/entries/
    fn migrate_files_to_library(library_path: &std::path::Path) {
        let old_dir = library_path.join("files");
        let new_dir = library_path.join("library").join("entries");

        // Skip if old dir doesn't exist or is a symlink, or new dir already has content
        if !old_dir.exists() || old_dir.is_symlink() {
            return;
        }

        // Check if new dir already has entry folders
        if new_dir.exists()
            && let Ok(mut entries) = std::fs::read_dir(&new_dir)
                && entries.next().is_some() {
                    return; // Already migrated
                }

        tracing::info!("Migrating {:?} → {:?}", old_dir, new_dir);

        if let Err(e) = std::fs::create_dir_all(&new_dir) {
            tracing::error!("Failed to create {:?}: {}", new_dir, e);
            return;
        }

        // Move each entry folder from files/ to library/entries/
        if let Ok(entries) = std::fs::read_dir(&old_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let src = entry.path();
                    let dst = new_dir.join(entry.file_name());
                    if let Err(e) = std::fs::rename(&src, &dst) {
                        tracing::warn!("Failed to move {:?} → {:?}: {}", src, dst, e);
                    }
                }
            }
        }

        // Remove old files/ if empty
        let _ = std::fs::remove_dir(&old_dir);
    }

    /// One-time migration: move old .wren/ directory to .local.nosync/
    /// Handles the rename from the pre-sync layout.
    fn migrate_local_dir(library_path: &std::path::Path) {
        let old_dir = library_path.join(".wren");
        let new_dir = library_path.join(".local.nosync");

        if !old_dir.exists() {
            return;
        }

        if let Err(e) = std::fs::create_dir_all(&new_dir) {
            tracing::error!("Failed to create {:?}: {}", new_dir, e);
            return;
        }

        // Move known items (handle both old and new names)
        let items_to_move = [
            "wren.db", "wren.db-wal", "wren.db-shm",
            "tantivy_index", "rag_vectors", "lance_db",
        ];
        for item in &items_to_move {
            let src = old_dir.join(item);
            let dst = new_dir.join(item);
            if src.exists() && !dst.exists() {
                if let Err(e) = std::fs::rename(&src, &dst) {
                    tracing::warn!("Failed to move {:?} → {:?}: {}", src, dst, e);
                } else {
                    tracing::info!("Migrated {:?} to .local.nosync/", item);
                }
            }
        }

        // Remove old .wren/ completely (it's all local-only data, safe to nuke)
        if old_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&old_dir) {
                tracing::warn!("Failed to remove old {:?}: {}", old_dir, e);
            } else {
                tracing::info!("Removed old .wren/ directory");
            }
        }
    }

    /// One-time migration: convert absolute file_path values to relative.
    /// Safe to run multiple times — only updates paths that start with the library prefix.
    async fn migrate_paths_to_relative(pool: &SqlitePool, library_path: &std::path::Path) {
        // Collect all prefixes to strip: current library path + any old known paths
        let current_prefix = format!("{}/", library_path.display());
        let home = directories::UserDirs::new()
            .map(|u| u.home_dir().to_path_buf());

        let mut prefixes = vec![current_prefix];
        if let Some(ref home_dir) = home {
            // Old layout: ~/Wren/
            prefixes.push(format!("{}/", home_dir.join("Wren").display()));
            // Any other possible old paths
            prefixes.push(format!("{}/", home_dir.join(".wren").display()));
        }
        prefixes.dedup();

        for col in &["file_path", "markdown_path", "thumbnail_path"] {
            for prefix in &prefixes {
                let query = format!(
                    "UPDATE attachments SET {} = SUBSTR({}, ?) WHERE {} LIKE ?",
                    col, col, col
                );
                let like_pattern = format!("{}%", prefix);
                let offset = prefix.len() as i32 + 1;

                if let Ok(result) = sqlx::query(&query)
                    .bind(offset)
                    .bind(&like_pattern)
                    .execute(pool)
                    .await
                    && result.rows_affected() > 0 {
                        tracing::info!(
                            "Stripped prefix '{}' from {} ({} rows)",
                            prefix, col, result.rows_affected()
                        );
                    }
            }
        }

        // Rename files/ → library/entries/ in stored paths
        for col in &["file_path", "markdown_path", "thumbnail_path"] {
            let query = format!(
                "UPDATE attachments SET {} = 'library/entries/' || SUBSTR({}, 7) WHERE {} LIKE 'files/%'",
                col, col, col
            );
            if let Ok(result) = sqlx::query(&query).execute(pool).await
                && result.rows_affected() > 0 {
                    tracing::info!(
                        "Renamed {} paths from files/ to library/entries/ ({} rows)",
                        col, result.rows_affected()
                    );
                }
        }
    }

    fn get_library_path() -> Result<PathBuf> {
        let home = directories::UserDirs::new()
            .ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;
        Ok(home.home_dir().join(".wren"))
    }

    pub async fn get_library_path_string(&self) -> String {
        let path = self.library_path.read().await;
        path.to_string_lossy().to_string()
    }

    /// Backfill existing notes into parsed_content table.
    async fn backfill_note_parsed_content(pool: &SqlitePool, library_path: &std::path::Path) {
        #[derive(sqlx::FromRow)]
        struct NoteRow {
            id: i64,
            entry_id: i64,
            file_path: Option<String>,
            markdown_path: Option<String>,
        }

        let rows: Vec<NoteRow> = sqlx::query_as(
            r#"SELECT a.id, a.entry_id, a.file_path, a.markdown_path FROM attachments a
               JOIN attachment_types at ON a.attachment_type_id = at.id
               LEFT JOIN parsed_content pc ON pc.attachment_id = a.id
               WHERE at.name = 'note'
                 AND (a.markdown_path IS NOT NULL OR a.file_path IS NOT NULL)
                 AND pc.id IS NULL"#,
        )
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        if rows.is_empty() {
            return;
        }

        tracing::info!("Backfilling {} note(s) into parsed_content", rows.len());

        for note in rows {
            let (full_path, needs_markdown_path_fix) = if let Some(ref md) = note.markdown_path {
                (library_path.join(md), false)
            } else if let Some(ref fp) = note.file_path {
                let fp_path = std::path::PathBuf::from(fp);
                if fp_path.is_absolute() {
                    (fp_path, true)
                } else {
                    (library_path.join(fp), true)
                }
            } else {
                continue;
            };

            if let Ok(content) = std::fs::read_to_string(&full_path) {
                if needs_markdown_path_fix
                    && let Ok(relative) = full_path.strip_prefix(library_path) {
                        let rel_str = relative.to_string_lossy().to_string();
                        if let Err(e) = sqlx::query(
                            "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                        )
                        .bind(&rel_str)
                        .bind(note.id)
                        .execute(pool)
                        .await
                        {
                            tracing::error!("Failed to update markdown_path for attachment {}: {}", note.id, e);
                        }
                    }

                if let Err(e) = sqlx::query(
                    r#"INSERT INTO parsed_content (attachment_id, entry_id, structured_markdown, model_used, provider, status, date_started, date_completed)
                       VALUES (?, ?, ?, 'user', 'manual', 'success', datetime('now'), datetime('now'))"#,
                )
                .bind(note.id)
                .bind(note.entry_id)
                .bind(&content)
                .execute(pool)
                .await
                {
                    tracing::error!("Failed to backfill parsed_content for note {}: {}", note.id, e);
                }
            }
        }
    }
}
