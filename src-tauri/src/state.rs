use anyhow::Result;
use ferrules_core::layout::model::ORTConfig;
use ferrules_core::FerrulesParser;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{OnceCell, RwLock};

use crate::db;
use crate::jobs::queue::JobQueue;
use crate::search::SearchIndex;

pub struct AppState {
    pub db: SqlitePool,
    pub library_path: Arc<RwLock<PathBuf>>,
    pub search_index: Arc<SearchIndex>,
    pub job_queue: Arc<JobQueue>,
    /// Ferrules PDF parser (lazy-initialized on first PDF upload).
    pdf_parser: Arc<OnceCell<FerrulesParser>>,
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

        // Backfill note content into parsed_content table
        Self::backfill_note_parsed_content(&db, &library_path).await;

        // Initialize full-text search index
        let index_path = library_path.join(".wren").join("tantivy_index");
        let search_index = SearchIndex::open_or_create(&index_path)?;
        tracing::info!("Search index initialized at {:?}", index_path);

        let search_index = Arc::new(search_index);

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

        Ok(Self {
            db,
            library_path,
            search_index,
            job_queue,
            pdf_parser,
        })
    }

    /// Get or lazily initialize the PDF parser (first call loads ONNX models).
    pub async fn get_pdf_parser(&self) -> Result<&FerrulesParser> {
        self.pdf_parser
            .get_or_try_init(|| async {
                tracing::info!("Lazily initializing Ferrules PDF parser (ONNX + CoreML)...");
                let parser = tokio::task::spawn_blocking(|| {
                    let ort_config = ORTConfig::default();
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        FerrulesParser::new(ort_config)
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
                    })
                })
                .await
                .map_err(|e| anyhow::anyhow!("PDF parser init task failed: {}", e))??;

                tracing::info!("Ferrules PDF parser initialized successfully");
                Ok(parser)
            })
            .await
    }

    /// Get a cloneable reference to the PDF parser cell.
    pub fn pdf_parser_ref(&self) -> Arc<OnceCell<FerrulesParser>> {
        self.pdf_parser.clone()
    }

    fn get_library_path() -> Result<PathBuf> {
        let home = directories::UserDirs::new()
            .ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;
        Ok(home.home_dir().join("Wren"))
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
                if needs_markdown_path_fix {
                    if let Ok(relative) = full_path.strip_prefix(library_path) {
                        let rel_str = relative.to_string_lossy().to_string();
                        let _ = sqlx::query(
                            "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                        )
                        .bind(&rel_str)
                        .bind(note.id)
                        .execute(pool)
                        .await;
                    }
                }

                let _ = sqlx::query(
                    r#"INSERT INTO parsed_content (attachment_id, entry_id, structured_markdown, model_used, provider, status, date_started, date_completed)
                       VALUES (?, ?, ?, 'user', 'manual', 'success', datetime('now'), datetime('now'))"#,
                )
                .bind(note.id)
                .bind(note.entry_id)
                .bind(&content)
                .execute(pool)
                .await;
            }
        }
    }
}
