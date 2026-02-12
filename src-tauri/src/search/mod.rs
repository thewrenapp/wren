pub mod extractor;
pub mod indexer;
pub mod schema;
pub mod searcher;

use anyhow::Result;
use std::path::Path;
use std::sync::Arc;
use tantivy::directory::MmapDirectory;
use tantivy::{Index, IndexWriter};
use tokio::sync::RwLock;
use tracing::info;

use schema::{build_schema, SearchFields};

/// Thread-safe full-text search index
pub struct SearchIndex {
    index: Index,
    writer: Arc<RwLock<IndexWriter>>,
    fields: SearchFields,
}

impl SearchIndex {
    /// Open an existing index or create a new one at the given path
    pub fn open_or_create(index_path: &Path) -> Result<Self> {
        let schema = build_schema();

        // Create directory if it doesn't exist
        if !index_path.exists() {
            std::fs::create_dir_all(index_path)?;
        }

        // Check if index exists by looking for meta.json file
        let meta_file = index_path.join("meta.json");
        let index = if meta_file.exists() {
            info!("Opening existing search index at: {}", index_path.display());
            let dir = MmapDirectory::open(index_path)?;
            Index::open(dir)?
        } else {
            info!("Creating new search index at: {}", index_path.display());
            Index::create_in_dir(index_path, schema.clone())?
        };

        // Create writer with 50MB heap
        let writer = index.writer(50_000_000)?;

        let fields = SearchFields::new(&schema);

        Ok(Self {
            index,
            writer: Arc::new(RwLock::new(writer)),
            fields,
        })
    }

    /// Get the search fields
    pub fn fields(&self) -> &SearchFields {
        &self.fields
    }

    /// Get a reference to the index
    pub fn index(&self) -> &Index {
        &self.index
    }

    /// Get write access to the index writer
    pub async fn writer(&self) -> tokio::sync::RwLockWriteGuard<'_, IndexWriter> {
        self.writer.write().await
    }

    /// Commit pending changes to the index
    pub async fn commit(&self) -> Result<()> {
        let mut writer = self.writer.write().await;
        writer.commit()?;
        info!("Search index committed");
        Ok(())
    }

    /// Index entry metadata
    pub async fn index_entry_metadata(
        &self,
        metadata: &indexer::EntryMetadata,
    ) -> Result<()> {
        let writer = self.writer.read().await;
        // We need mutable access but can use interior mutability pattern
        // For now, we'll use a write lock
        drop(writer);

        let writer = self.writer.write().await;
        indexer::index_entry_metadata(&writer, &self.fields, metadata)?;
        Ok(())
    }

    /// Index attachment content
    pub async fn index_attachment_content(
        &self,
        attachment: &indexer::AttachmentData,
        config: &extractor::ExtractionConfig,
    ) -> Result<indexer::IndexingResult> {
        let writer = self.writer.write().await;
        indexer::index_attachment_content(&writer, &self.fields, attachment, config).await
    }

    /// Index pre-extracted text content for an attachment
    pub async fn index_text_content(
        &self,
        attachment: &indexer::AttachmentData,
        text: &str,
    ) -> Result<indexer::IndexingResult> {
        let writer = self.writer.write().await;
        indexer::index_text_content(&writer, &self.fields, attachment, text)
    }

    /// Delete all documents for an entry
    pub async fn delete_entry(&self, entry_id: i64) -> Result<()> {
        let writer = self.writer.write().await;
        indexer::delete_entry(&writer, &self.fields, entry_id)?;
        Ok(())
    }

    /// Delete a specific attachment
    pub async fn delete_attachment(&self, attachment_id: i64) -> Result<()> {
        let writer = self.writer.write().await;
        indexer::delete_attachment(&writer, &self.fields, attachment_id)?;
        Ok(())
    }

    /// Index annotations for an attachment
    pub async fn index_annotations(&self, data: &indexer::AnnotationData) -> Result<()> {
        let writer = self.writer.write().await;
        indexer::index_annotations(&writer, &self.fields, data)?;
        Ok(())
    }

    /// Execute a full-text search
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<searcher::FullSearchResult>> {
        searcher::full_text_search(&self.index, &self.fields, query, limit, offset)
    }
}
