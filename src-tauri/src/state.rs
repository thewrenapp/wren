use anyhow::Result;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::db;
use crate::jobs::queue::JobQueue;
use crate::search::SearchIndex;

pub struct AppState {
    pub db: SqlitePool,
    pub library_path: Arc<RwLock<PathBuf>>,
    pub search_index: Arc<SearchIndex>,
    pub job_queue: Arc<JobQueue>,
}

impl AppState {
    pub async fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let library_path = Self::get_library_path()?;

        // Ensure library directory exists
        std::fs::create_dir_all(&library_path)?;
        std::fs::create_dir_all(library_path.join("files"))?;
        std::fs::create_dir_all(library_path.join(".wren"))?;

        // Initialize database
        let db_path = library_path.join(".wren").join("wren.db");
        let db = db::connection::create_pool(&db_path).await?;

        // Run migrations
        db::migrations::run_migrations(&db).await?;

        tracing::info!("Database initialized at {:?}", db_path);

        // Initialize full-text search index
        let index_path = library_path.join(".wren").join("tantivy_index");
        let search_index = SearchIndex::open_or_create(&index_path)?;
        tracing::info!("Search index initialized at {:?}", index_path);

        let search_index = Arc::new(search_index);
        let library_path = Arc::new(RwLock::new(library_path));

        // Initialize job queue
        let job_queue = Arc::new(JobQueue::new(
            db.clone(),
            app_handle.clone(),
            search_index.clone(),
            library_path.clone(),
            2, // max concurrent jobs
        ));

        // Recover jobs that were interrupted by app shutdown
        if let Err(e) = job_queue.recover_interrupted_jobs().await {
            tracing::warn!("Failed to recover interrupted jobs: {}", e);
        }

        // Start the background job scheduler
        job_queue.start_scheduler();
        tracing::info!("Job queue initialized");

        Ok(Self {
            db,
            library_path,
            search_index,
            job_queue,
        })
    }

    fn get_library_path() -> Result<PathBuf> {
        // Default to ~/Wren
        let home = directories::UserDirs::new()
            .ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;

        Ok(home.home_dir().join("Wren"))
    }

    pub async fn get_library_path_string(&self) -> String {
        let path = self.library_path.read().await;
        path.to_string_lossy().to_string()
    }
}
