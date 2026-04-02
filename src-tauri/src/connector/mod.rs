pub mod handlers;
pub mod models;
pub mod server;

use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{watch, Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::jobs::queue::JobQueue;
use crate::search::SearchIndex;

/// Shared state for the connector HTTP server
pub struct ConnectorState {
    pub token: String,
    pub db: SqlitePool,
    pub library_path: Arc<RwLock<PathBuf>>,
    pub search_index: Arc<SearchIndex>,
    pub job_queue: Arc<JobQueue>,
    pub app_handle: tauri::AppHandle,
    /// Maps sessionID → list of entry IDs saved in that session
    pub sessions: Mutex<HashMap<String, Vec<i64>>>,
}

/// Manages the lifecycle of the connector HTTP server
pub struct ConnectorServer {
    shutdown_tx: watch::Sender<bool>,
    handle: JoinHandle<()>,
    pub port: u16,
}

impl ConnectorServer {
    /// Start the connector server on the given port
    pub async fn start(
        port: u16,
        token: String,
        db: SqlitePool,
        library_path: Arc<RwLock<PathBuf>>,
        search_index: Arc<SearchIndex>,
        job_queue: Arc<JobQueue>,
        app_handle: tauri::AppHandle,
    ) -> anyhow::Result<Self> {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let state = Arc::new(ConnectorState {
            token,
            db,
            library_path,
            search_index,
            job_queue,
            app_handle,
            sessions: Mutex::new(HashMap::new()),
        });

        let handle = tokio::spawn(async move {
            if let Err(e) = server::start_server(state, port, shutdown_rx).await {
                tracing::error!("Connector server error: {}", e);
            }
        });

        Ok(Self {
            shutdown_tx,
            handle,
            port,
        })
    }

    /// Stop the connector server gracefully
    pub async fn stop(self) {
        let _ = self.shutdown_tx.send(true);
        let _ = self.handle.await;
        tracing::info!("Connector server stopped");
    }
}
