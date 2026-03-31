use anyhow::Result;
use arrow::array::{
    Float32Builder, Int32Builder, Int64Builder, RecordBatchIterator, StringBuilder,
    FixedSizeListBuilder,
};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use futures::TryStreamExt;
use lancedb::connect;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::Connection;
use std::path::Path;
use std::sync::Arc;

/// LanceDB vector store managing three tables:
/// - `paper_chunks`: section-aware document chunks for RAG retrieval
/// - `entity_vectors`: entity embeddings for concept search
/// - `claim_vectors`: claim embeddings for finding related claims
pub struct VectorStore {
    conn: Connection,
    dims: usize,
}

// ── Data types for inserts / queries ─────────────────────────────────

pub struct ChunkRecord {
    pub entry_id: i64,
    pub attachment_id: i64,
    pub attachment_title: String,
    pub section_name: String,
    pub section_level: i32,
    pub chunk_index: i32,
    pub chunk_text: String,
    pub vector: Vec<f32>,
}

pub struct EntityVectorRecord {
    pub entity_id: i64,
    pub name: String,
    pub description: String,
    pub category: String,
    pub vector: Vec<f32>,
}

pub struct ClaimVectorRecord {
    pub claim_id: i64,
    pub entry_id: i64,
    pub statement: String,
    pub claim_type: String,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct VectorSearchResult {
    pub id: i64,
    pub text: String,
    pub score: f32,
    pub extra: std::collections::HashMap<String, String>,
}

impl VectorStore {
    pub async fn new(data_dir: &Path, dims: usize) -> Result<Self> {
        let conn = connect(data_dir.to_str().unwrap())
            .execute()
            .await?;

        let store = Self { conn, dims };
        store.ensure_tables().await?;
        Ok(store)
    }

    /// Create LanceDB tables if they don't already exist.
    async fn ensure_tables(&self) -> Result<()> {
        let tables = self.conn.table_names().execute().await?;

        if !tables.contains(&"paper_chunks".to_string()) {
            self.conn
                .create_empty_table("paper_chunks", self.chunk_schema())
                .execute()
                .await?;
        }
        if !tables.contains(&"entity_vectors".to_string()) {
            self.conn
                .create_empty_table("entity_vectors", self.entity_schema())
                .execute()
                .await?;
        }
        if !tables.contains(&"claim_vectors".to_string()) {
            self.conn
                .create_empty_table("claim_vectors", self.claim_schema())
                .execute()
                .await?;
        }

        Ok(())
    }

    // ── Batch inserts ────────────────────────────────────────────────

    /// Insert paper chunks into LanceDB.
    pub async fn insert_chunks(&self, records: &[ChunkRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        let mut entry_ids = Int64Builder::new();
        let mut attachment_ids = Int64Builder::new();
        let mut titles = StringBuilder::new();
        let mut section_names = StringBuilder::new();
        let mut section_levels = Int32Builder::new();
        let mut chunk_indices = Int32Builder::new();
        let mut chunk_texts = StringBuilder::new();
        let mut vectors = FixedSizeListBuilder::new(
            Float32Builder::new(),
            self.dims as i32,
        );

        for r in records {
            entry_ids.append_value(r.entry_id);
            attachment_ids.append_value(r.attachment_id);
            titles.append_value(&r.attachment_title);
            section_names.append_value(&r.section_name);
            section_levels.append_value(r.section_level);
            chunk_indices.append_value(r.chunk_index);
            chunk_texts.append_value(&r.chunk_text);

            let values = vectors.values();
            for &v in &r.vector {
                values.append_value(v);
            }
            vectors.append(true);
        }

        let batch = RecordBatch::try_new(
            self.chunk_schema(),
            vec![
                Arc::new(entry_ids.finish()),
                Arc::new(attachment_ids.finish()),
                Arc::new(titles.finish()),
                Arc::new(section_names.finish()),
                Arc::new(section_levels.finish()),
                Arc::new(chunk_indices.finish()),
                Arc::new(chunk_texts.finish()),
                Arc::new(vectors.finish()),
            ],
        )?;

        let table = self.conn.open_table("paper_chunks").execute().await?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(())
    }

    /// Insert entity vectors into LanceDB.
    pub async fn insert_entity_vectors(&self, records: &[EntityVectorRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        let mut entity_ids = Int64Builder::new();
        let mut names = StringBuilder::new();
        let mut descriptions = StringBuilder::new();
        let mut categories = StringBuilder::new();
        let mut vectors = FixedSizeListBuilder::new(
            Float32Builder::new(),
            self.dims as i32,
        );

        for r in records {
            entity_ids.append_value(r.entity_id);
            names.append_value(&r.name);
            descriptions.append_value(&r.description);
            categories.append_value(&r.category);

            let values = vectors.values();
            for &v in &r.vector {
                values.append_value(v);
            }
            vectors.append(true);
        }

        let batch = RecordBatch::try_new(
            self.entity_schema(),
            vec![
                Arc::new(entity_ids.finish()),
                Arc::new(names.finish()),
                Arc::new(descriptions.finish()),
                Arc::new(categories.finish()),
                Arc::new(vectors.finish()),
            ],
        )?;

        let table = self.conn.open_table("entity_vectors").execute().await?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(())
    }

    /// Insert claim vectors into LanceDB.
    pub async fn insert_claim_vectors(&self, records: &[ClaimVectorRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        let mut claim_ids = Int64Builder::new();
        let mut entry_ids = Int64Builder::new();
        let mut statements = StringBuilder::new();
        let mut claim_types = StringBuilder::new();
        let mut vectors = FixedSizeListBuilder::new(
            Float32Builder::new(),
            self.dims as i32,
        );

        for r in records {
            claim_ids.append_value(r.claim_id);
            entry_ids.append_value(r.entry_id);
            statements.append_value(&r.statement);
            claim_types.append_value(&r.claim_type);

            let values = vectors.values();
            for &v in &r.vector {
                values.append_value(v);
            }
            vectors.append(true);
        }

        let batch = RecordBatch::try_new(
            self.claim_schema(),
            vec![
                Arc::new(claim_ids.finish()),
                Arc::new(entry_ids.finish()),
                Arc::new(statements.finish()),
                Arc::new(claim_types.finish()),
                Arc::new(vectors.finish()),
            ],
        )?;

        let table = self.conn.open_table("claim_vectors").execute().await?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(())
    }

    // ── Vector search ────────────────────────────────────────────────

    /// Search paper_chunks by vector similarity.
    pub async fn search_chunks(
        &self,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<VectorSearchResult>> {
        let table = self.conn.open_table("paper_chunks").execute().await?;
        let batches: Vec<RecordBatch> = table
            .vector_search(query_vector)?
            .limit(limit)
            .execute()
            .await?
            .try_collect()
            .await?;

        Ok(Self::parse_chunk_results(&batches))
    }

    /// Search entity_vectors by vector similarity.
    pub async fn search_entities(
        &self,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<VectorSearchResult>> {
        let table = self.conn.open_table("entity_vectors").execute().await?;
        let batches: Vec<RecordBatch> = table
            .vector_search(query_vector)?
            .limit(limit)
            .execute()
            .await?
            .try_collect()
            .await?;

        Ok(Self::parse_entity_results(&batches))
    }

    /// Search claim_vectors by vector similarity.
    pub async fn search_claims(
        &self,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<VectorSearchResult>> {
        let table = self.conn.open_table("claim_vectors").execute().await?;
        let batches: Vec<RecordBatch> = table
            .vector_search(query_vector)?
            .limit(limit)
            .execute()
            .await?
            .try_collect()
            .await?;

        Ok(Self::parse_claim_results(&batches))
    }

    // ── Deletion ─────────────────────────────────────────────────────

    /// Delete all vectors for a specific attachment (used during re-indexing).
    pub async fn delete_attachment_vectors(&self, attachment_id: i64) -> Result<()> {
        let filter = format!("attachment_id = {attachment_id}");

        let chunks_table = self.conn.open_table("paper_chunks").execute().await?;
        chunks_table.delete(&filter).await?;

        Ok(())
    }

    /// Delete all vectors for a specific entry.
    pub async fn delete_entry_vectors(&self, entry_id: i64) -> Result<()> {
        let filter = format!("entry_id = {entry_id}");

        let chunks_table = self.conn.open_table("paper_chunks").execute().await?;
        chunks_table.delete(&filter).await?;

        let claims_table = self.conn.open_table("claim_vectors").execute().await?;
        claims_table.delete(&filter).await?;

        Ok(())
    }

    /// Delete entity vectors by entity_id.
    pub async fn delete_entity_vector(&self, entity_id: i64) -> Result<()> {
        let filter = format!("entity_id = {entity_id}");
        let table = self.conn.open_table("entity_vectors").execute().await?;
        table.delete(&filter).await?;
        Ok(())
    }

    // ── Stats ────────────────────────────────────────────────────────

    /// Count rows in a table.
    pub async fn count_rows(&self, table_name: &str) -> Result<usize> {
        let table = self.conn.open_table(table_name).execute().await?;
        let count = table.count_rows(None).await?;
        Ok(count)
    }

    /// Drop all vector tables and recreate them (empty).
    /// Used for full rebuild when embedding model changes.
    pub async fn drop_and_recreate_tables(&self) -> Result<()> {
        let tables = self.conn.table_names().execute().await?;
        for name in &["paper_chunks", "entity_vectors", "claim_vectors"] {
            if tables.contains(&name.to_string()) {
                self.conn.drop_table(name, &[]).await?;
            }
        }
        self.ensure_tables().await?;
        Ok(())
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn chunk_schema(&self) -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("entry_id", DataType::Int64, false),
            Field::new("attachment_id", DataType::Int64, false),
            Field::new("attachment_title", DataType::Utf8, false),
            Field::new("section_name", DataType::Utf8, false),
            Field::new("section_level", DataType::Int32, false),
            Field::new("chunk_index", DataType::Int32, false),
            Field::new("chunk_text", DataType::Utf8, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, true)),
                    self.dims as i32,
                ),
                false,
            ),
        ]))
    }

    fn entity_schema(&self) -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("entity_id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("description", DataType::Utf8, false),
            Field::new("category", DataType::Utf8, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, true)),
                    self.dims as i32,
                ),
                false,
            ),
        ]))
    }

    fn claim_schema(&self) -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("claim_id", DataType::Int64, false),
            Field::new("entry_id", DataType::Int64, false),
            Field::new("statement", DataType::Utf8, false),
            Field::new("claim_type", DataType::Utf8, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, true)),
                    self.dims as i32,
                ),
                false,
            ),
        ]))
    }

    /// Parse chunk search results from RecordBatch vector.
    fn parse_chunk_results(batches: &[RecordBatch]) -> Vec<VectorSearchResult> {
        let mut results = Vec::new();

        for batch in batches {
            let entry_ids = batch
                .column_by_name("entry_id")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Int64Array>());
            let texts = batch
                .column_by_name("chunk_text")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let distances = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Float32Array>());
            let section_names = batch
                .column_by_name("section_name")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let att_ids = batch
                .column_by_name("attachment_id")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Int64Array>());
            let att_titles = batch
                .column_by_name("attachment_title")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());

            if let (Some(ids), Some(txts), Some(dists)) = (entry_ids, texts, distances) {
                for i in 0..batch.num_rows() {
                    let mut extra = std::collections::HashMap::new();
                    if let Some(sn) = section_names {
                        extra.insert("section_name".to_string(), sn.value(i).to_string());
                    }
                    if let Some(ai) = att_ids {
                        extra.insert("attachment_id".to_string(), ai.value(i).to_string());
                    }
                    if let Some(at) = att_titles {
                        extra.insert("attachment_title".to_string(), at.value(i).to_string());
                    }
                    results.push(VectorSearchResult {
                        id: ids.value(i),
                        text: txts.value(i).to_string(),
                        score: 1.0 / (1.0 + dists.value(i)), // convert distance to similarity
                        extra,
                    });
                }
            }
        }

        results
    }

    /// Parse entity search results.
    fn parse_entity_results(batches: &[RecordBatch]) -> Vec<VectorSearchResult> {
        let mut results = Vec::new();

        for batch in batches {
            let entity_ids = batch
                .column_by_name("entity_id")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Int64Array>());
            let names = batch
                .column_by_name("name")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let distances = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Float32Array>());
            let categories = batch
                .column_by_name("category")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let descriptions = batch
                .column_by_name("description")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());

            if let (Some(ids), Some(nms), Some(dists)) = (entity_ids, names, distances) {
                for i in 0..batch.num_rows() {
                    let mut extra = std::collections::HashMap::new();
                    if let Some(cat) = categories {
                        extra.insert("category".to_string(), cat.value(i).to_string());
                    }
                    if let Some(desc) = descriptions {
                        extra.insert("description".to_string(), desc.value(i).to_string());
                    }
                    results.push(VectorSearchResult {
                        id: ids.value(i),
                        text: nms.value(i).to_string(),
                        score: 1.0 / (1.0 + dists.value(i)),
                        extra,
                    });
                }
            }
        }

        results
    }

    /// Parse claim search results.
    fn parse_claim_results(batches: &[RecordBatch]) -> Vec<VectorSearchResult> {
        let mut results = Vec::new();

        for batch in batches {
            let claim_ids = batch
                .column_by_name("claim_id")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Int64Array>());
            let statements = batch
                .column_by_name("statement")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());
            let distances = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Float32Array>());
            let entry_ids = batch
                .column_by_name("entry_id")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::Int64Array>());
            let claim_types = batch
                .column_by_name("claim_type")
                .and_then(|c| c.as_any().downcast_ref::<arrow::array::StringArray>());

            if let (Some(ids), Some(stmts), Some(dists)) = (claim_ids, statements, distances) {
                for i in 0..batch.num_rows() {
                    let mut extra = std::collections::HashMap::new();
                    if let Some(ei) = entry_ids {
                        extra.insert("entry_id".to_string(), ei.value(i).to_string());
                    }
                    if let Some(ct) = claim_types {
                        extra.insert("claim_type".to_string(), ct.value(i).to_string());
                    }
                    results.push(VectorSearchResult {
                        id: ids.value(i),
                        text: stmts.value(i).to_string(),
                        score: 1.0 / (1.0 + dists.value(i)),
                        extra,
                    });
                }
            }
        }

        results
    }
}
