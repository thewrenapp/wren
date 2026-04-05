use arrow_array::{
    Array, FixedSizeListArray, Float32Array, Int64Array, RecordBatch, RecordBatchIterator,
    StringArray,
};
use arrow_schema::{ArrowError, DataType, Field, Schema};
use lancedb::query::{ExecutableQuery, QueryBase};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const TABLE_NAME: &str = "document_chunks";

/// Validate that a string is a well-formed UUID.
/// Uses the `uuid` crate for strict parsing, preventing injection in LanceDB filter strings.
fn is_valid_uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}

/// Result from a vector similarity search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub chunk_id: String,
    pub document_id: String,
    pub filename: String,
    pub chunk_index: usize,
    pub page_number: Option<usize>,
    pub section_name: Option<String>,
    pub content: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub relevance_score: f32,
    /// 0 = leaf chunk (legacy field, kept for schema compat).
    pub level: usize,
}

/// Vector store backed by LanceDB.
pub struct VectorStore {
    db: lancedb::Connection,
    dimension: usize,
    store_path: std::path::PathBuf,
    /// Guards table creation to prevent TOCTOU races on concurrent upserts.
    table_init: tokio::sync::Mutex<bool>,
}

impl VectorStore {
    /// Create or open a vector store at the given path.
    pub async fn new(store_path: &std::path::Path, dimension: usize) -> Result<Self, String> {
        std::fs::create_dir_all(store_path)
            .map_err(|e| format!("Failed to create vector dir: {}", e))?;

        let store_path_str = store_path
            .to_str()
            .ok_or_else(|| format!("Vector store path contains invalid UTF-8: {:?}", store_path))?;

        let db = lancedb::connect(store_path_str)
            .execute()
            .await
            .map_err(|e| format!("LanceDB connect error: {}", e))?;

        Ok(Self {
            db,
            dimension,
            store_path: store_path.to_path_buf(),
            table_init: tokio::sync::Mutex::new(false),
        })
    }

    /// Build the Arrow schema for the chunks table.
    fn schema(&self) -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("chunk_id", DataType::Utf8, false),
            Field::new("document_id", DataType::Utf8, false),
            Field::new("filename", DataType::Utf8, false),
            Field::new("chunk_index", DataType::Int64, false),
            Field::new("page_number", DataType::Int64, true),
            Field::new("section_name", DataType::Utf8, true),
            Field::new("content", DataType::Utf8, false),
            Field::new("start_offset", DataType::Int64, false),
            Field::new("end_offset", DataType::Int64, false),
            Field::new("level", DataType::Int64, false), // always 0 (kept for schema compat)
            Field::new(
                "vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, true)),
                    self.dimension as i32,
                ),
                false,
            ),
        ]))
    }

    /// Ensure the table exists, creating it with the first batch if needed.
    /// Uses a "try create, ignore already-exists error" pattern instead of
    /// checking table_names() to avoid slow I/O while holding the mutex.
    /// Append data to the table, creating it if it doesn't exist yet.
    async fn ensure_table_and_add(
        &self,
        schema: Arc<Schema>,
        batch: RecordBatch,
    ) -> Result<(), String> {
        let mut initialized = self.table_init.lock().await;

        if !*initialized {
            // Try to create the table with this batch
            let batches: Vec<Result<RecordBatch, ArrowError>> = vec![Ok(batch.clone())];
            let reader = RecordBatchIterator::new(batches, schema.clone());

            match self.db.create_table(TABLE_NAME, reader).execute().await {
                Ok(_) => {
                    *initialized = true;
                    return Ok(());
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    if err_msg.contains("already exists") {
                        *initialized = true;
                        // Fall through to append below — data was consumed by
                        // the failed create_table, so we must re-create the reader.
                    } else {
                        return Err(format!("Failed to create table: {}", err_msg));
                    }
                }
            }
        }

        drop(initialized);

        // Table exists — append the data
        let batches: Vec<Result<RecordBatch, ArrowError>> = vec![Ok(batch)];
        let reader = RecordBatchIterator::new(batches, schema);

        let table = self
            .db
            .open_table(TABLE_NAME)
            .execute()
            .await
            .map_err(|e| format!("Failed to open table: {}", e))?;
        table
            .add(reader)
            .execute()
            .await
            .map_err(|e| format!("Failed to add data: {}", e))?;
        Ok(())
    }

    /// Insert chunks with their embeddings into the vector store.
    pub async fn upsert_chunks(
        &self,
        chunks: &[super::indexer::DocumentChunk],
        embeddings: &[Vec<f32>],
        filename: &str,
    ) -> Result<usize, String> {
        if chunks.len() != embeddings.len() {
            return Err("Chunks and embeddings count mismatch".to_string());
        }
        if chunks.is_empty() {
            return Ok(0);
        }
        // Validate embedding dimensions match the store's expected dimension
        if let Some(first) = embeddings.first()
            && first.len() != self.dimension {
                return Err(format!(
                    "Embedding dimension mismatch: store expects {} but got {} from the model. \
                     This usually means the dimension probe failed and fell back to a wrong default. \
                     Try re-sending the message.",
                    self.dimension, first.len()
                ));
            }

        let schema = self.schema();
        let n = chunks.len();

        // Build arrow arrays
        let chunk_ids: StringArray = chunks.iter().map(|c| Some(c.chunk_id.as_str())).collect();
        let doc_ids: StringArray = chunks
            .iter()
            .map(|c| Some(c.document_id.as_str()))
            .collect();
        let filenames: StringArray = chunks.iter().map(|_| Some(filename)).collect();
        let chunk_indices: Int64Array =
            chunks.iter().map(|c| Some(c.chunk_index as i64)).collect();
        let page_numbers: Int64Array = chunks
            .iter()
            .map(|c| c.page_number.map(|p| p as i64))
            .collect();
        let section_names: StringArray =
            chunks.iter().map(|c| c.section_name.as_deref()).collect();
        let contents: StringArray = chunks.iter().map(|c| Some(c.content.as_str())).collect();
        let start_offsets: Int64Array =
            chunks.iter().map(|c| Some(c.start_offset as i64)).collect();
        let end_offsets: Int64Array =
            chunks.iter().map(|c| Some(c.end_offset as i64)).collect();
        let levels: Int64Array = chunks.iter().map(|_| Some(0i64)).collect(); // leaf chunks = level 0

        // Build vector column (FixedSizeList of Float32)
        let flat_values: Vec<f32> = embeddings.iter().flat_map(|v| v.iter().copied()).collect();
        let values = Float32Array::from(flat_values);
        let field = Arc::new(Field::new("item", DataType::Float32, true));
        let vector_array = FixedSizeListArray::try_new(
            field,
            self.dimension as i32,
            Arc::new(values),
            None,
        )
        .map_err(|e| format!("Failed to build vector array: {}", e))?;

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(chunk_ids),
                Arc::new(doc_ids),
                Arc::new(filenames),
                Arc::new(chunk_indices),
                Arc::new(page_numbers),
                Arc::new(section_names),
                Arc::new(contents),
                Arc::new(start_offsets),
                Arc::new(end_offsets),
                Arc::new(levels),
                Arc::new(vector_array),
            ],
        )
        .map_err(|e| format!("Failed to build RecordBatch: {}", e))?;

        self.ensure_table_and_add(schema, batch).await?;

        Ok(n)
    }

    /// Search for similar chunks using a query embedding.
    pub async fn search(
        &self,
        query_embedding: &[f32],
        top_k: usize,
        document_filter: Option<&[String]>,
    ) -> Result<Vec<SearchResult>, String> {
        let table_names = self
            .db
            .table_names()
            .execute()
            .await
            .map_err(|e| e.to_string())?;
        if !table_names.contains(&TABLE_NAME.to_string()) {
            return Ok(Vec::new());
        }

        let table = self
            .db
            .open_table(TABLE_NAME)
            .execute()
            .await
            .map_err(|e| format!("Failed to open table: {}", e))?;

        let mut query = table
            .query()
            .nearest_to(query_embedding)
            .map_err(|e| format!("Failed to build query: {}", e))?
            .limit(top_k);

        // Apply document filter if provided
        if let Some(doc_ids) = document_filter
            && !doc_ids.is_empty() {
                let valid_ids: Vec<_> = doc_ids
                    .iter()
                    .filter(|id| is_valid_uuid(id))
                    .collect();
                if valid_ids.is_empty() {
                    return Err("All provided document IDs have invalid format".to_string());
                }
                // Safe: each id has been validated as a UUID (hex digits + hyphens only)
                let filter = valid_ids
                    .iter()
                    .map(|id| format!("document_id = '{}'", id))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                query = query.only_if(filter);
            }

        let results = query
            .execute()
            .await
            .map_err(|e| format!("Search failed: {}", e))?;

        use futures::TryStreamExt;
        let batches: Vec<_> = results
            .try_collect()
            .await
            .map_err(|e| format!("Failed to collect results: {}", e))?;

        let mut search_results = Vec::new();
        for batch in &batches {
            let n = batch.num_rows();
            let chunk_ids = batch
                .column_by_name("chunk_id")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let doc_ids = batch
                .column_by_name("document_id")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let filenames = batch
                .column_by_name("filename")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let chunk_indices = batch
                .column_by_name("chunk_index")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>());
            let page_numbers = batch
                .column_by_name("page_number")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>());
            let section_names = batch
                .column_by_name("section_name")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let contents = batch
                .column_by_name("content")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>());
            let start_offsets = batch
                .column_by_name("start_offset")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>());
            let end_offsets = batch
                .column_by_name("end_offset")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>());
            let levels = batch
                .column_by_name("level")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>());
            // LanceDB adds _distance column for vector search results
            let distances = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>());

            for i in 0..n {
                let distance = distances.map(|d| d.value(i)).unwrap_or(1.0);
                // Convert L2 distance to 0-1 relevance score (lower distance = higher relevance)
                let relevance_score = 1.0 / (1.0 + distance);

                search_results.push(SearchResult {
                    chunk_id: chunk_ids
                        .map(|a| a.value(i).to_string())
                        .unwrap_or_default(),
                    document_id: doc_ids
                        .map(|a| a.value(i).to_string())
                        .unwrap_or_default(),
                    filename: filenames
                        .map(|a| a.value(i).to_string())
                        .unwrap_or_default(),
                    chunk_index: chunk_indices.map(|a| a.value(i) as usize).unwrap_or(0),
                    page_number: page_numbers.and_then(|a| {
                        if a.is_null(i) {
                            None
                        } else {
                            Some(a.value(i) as usize)
                        }
                    }),
                    section_name: section_names.and_then(|a| {
                        if a.is_null(i) {
                            None
                        } else {
                            Some(a.value(i).to_string())
                        }
                    }),
                    content: contents
                        .map(|a| a.value(i).to_string())
                        .unwrap_or_default(),
                    start_offset: start_offsets.map(|a| a.value(i) as usize).unwrap_or(0),
                    end_offset: end_offsets.map(|a| a.value(i) as usize).unwrap_or(0),
                    relevance_score,
                    level: levels.map(|a| a.value(i) as usize).unwrap_or(0),
                });
            }
        }

        Ok(search_results)
    }

    /// Delete all chunks for a specific document.
    pub async fn delete_document(&self, document_id: &str) -> Result<(), String> {
        let table_names = self
            .db
            .table_names()
            .execute()
            .await
            .map_err(|e| e.to_string())?;
        if !table_names.contains(&TABLE_NAME.to_string()) {
            return Ok(());
        }

        let table = self
            .db
            .open_table(TABLE_NAME)
            .execute()
            .await
            .map_err(|e| format!("Failed to open table: {}", e))?;

        // Safe: document_id has been validated as a UUID above
        table
            .delete(&format!("document_id = '{}'", document_id))
            .await
            .map_err(|e| format!("Failed to delete document chunks: {}", e))?;

        Ok(())
    }

    /// Drop the entire vector store for this conversation.
    pub async fn drop_store(&self) -> Result<(), String> {
        if self.store_path.exists() {
            std::fs::remove_dir_all(&self.store_path)
                .map_err(|e| format!("Failed to delete vector store: {}", e))?;
        }
        Ok(())
    }

    /// Check if the store has any data.
    pub async fn is_empty(&self) -> bool {
        let table_names = self
            .db
            .table_names()
            .execute()
            .await
            .unwrap_or_default();
        !table_names.contains(&TABLE_NAME.to_string())
    }

    /// Get the embedding dimension this store was created with.
    pub fn dimension(&self) -> usize {
        self.dimension
    }
}
