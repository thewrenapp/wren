pub mod chunker;
pub mod doc_types;
pub mod embeddings;
pub mod knowledge;
pub mod relate;
pub mod search;
pub mod sync;
pub mod vectors;

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use sqlx::SqlitePool;

use embeddings::EmbeddingService;
use vectors::VectorStore;

/// Central service managing the knowledge graph (SQLite) and vector store (LanceDB).
pub struct GraphService {
    pub db: SqlitePool,
    pub vector_store: VectorStore,
    pub embedding_service: Arc<EmbeddingService>,
}

impl GraphService {
    /// Create a new GraphService.
    /// `cloud_config`: if Some, use cloud embeddings with (provider, model, api_key, base_url, dims).
    pub async fn new(
        db: SqlitePool,
        data_dir: &Path,
        local_embedding_model: &str,
        cloud_config: Option<&(String, String, String, String, usize)>,
    ) -> Result<Self> {
        let lance_dir = data_dir.join("lance_db");
        std::fs::create_dir_all(&lance_dir)?;

        let embedding_service = if let Some((provider, model, api_key, base_url, dims)) = cloud_config {
            Arc::new(EmbeddingService::new_cloud(
                provider.clone(),
                model.clone(),
                api_key.clone(),
                base_url.clone(),
                *dims,
            )?)
        } else {
            Arc::new(EmbeddingService::new_local(local_embedding_model)?)
        };

        let vector_store = VectorStore::new(&lance_dir, embedding_service.dimensions()).await?;

        Ok(Self {
            db,
            vector_store,
            embedding_service,
        })
    }

    /// Reconfigure the embedding service (e.g. switch between local and cloud).
    pub fn update_embedding_service(&mut self, service: EmbeddingService) {
        self.embedding_service = Arc::new(service);
    }
}
