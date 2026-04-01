//! RAG indexing pipeline: parse → chunk → embed → store in LanceDB.
//!
//! Ported from qark's `rag_setup.rs::index_pending_chunks()`.

use std::path::Path;

use sqlx::SqlitePool;

use super::embeddings::{self, EmbeddingConfig};

/// Configuration for prose chunking.
pub struct ChunkConfig {
    pub target_chunk_size: usize,
    pub overlap_size: usize,
    pub min_chunk_size: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            target_chunk_size: 1500,
            overlap_size: 200,
            min_chunk_size: 100,
        }
    }
}

/// A chunk of document text with metadata.
#[derive(Debug, Clone)]
pub struct DocumentChunk {
    pub chunk_id: String,
    pub document_id: String,
    pub chunk_index: usize,
    pub page_number: Option<usize>,
    pub section_name: Option<String>,
    pub content: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub token_estimate: i64,
}
use super::store::VectorStore;

/// Config for optional RAPTOR indexing.
pub struct RaptorIndexConfig {
    pub enabled: bool,
    pub gen_config: super::retrieval::RagGenModelConfig,
}

/// Index a single entry's attachments into the RAG vector store.
///
/// Flow: read extracted text → chunk → embed → upsert into LanceDB → (optional) RAPTOR.
pub async fn index_entry(
    db: &SqlitePool,
    store: &VectorStore,
    embed_config: &EmbeddingConfig,
    entry_id: i64,
    library_path: &Path,
    raptor: Option<&RaptorIndexConfig>,
) -> Result<usize, String> {
    // 1. Get attachments with extracted markdown text
    let attachments: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        r#"SELECT a.id, COALESCE(a.markdown_path, a.file_path) as text_path, a.file_path
           FROM attachments a
           JOIN attachment_types at ON a.attachment_type_id = at.id
           WHERE a.entry_id = ? AND a.markdown_path IS NOT NULL"#,
    )
    .bind(entry_id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to query attachments: {}", e))?;

    if attachments.is_empty() {
        return Ok(0);
    }

    let mut total_chunks_indexed = 0usize;
    let chunk_config = ChunkConfig::default();

    for (attachment_id, text_path, file_path) in &attachments {
        // 2. Read the extracted text
        let full_path = library_path.join(text_path);
        let text = match tokio::fs::read_to_string(&full_path).await {
            Ok(t) if !t.trim().is_empty() => t,
            Ok(_) => {
                tracing::debug!("Empty text for attachment {}, skipping", attachment_id);
                continue;
            }
            Err(e) => {
                tracing::warn!("Failed to read text for attachment {}: {}", attachment_id, e);
                continue;
            }
        };

        let filename = file_path
            .as_deref()
            .and_then(|p| Path::new(p).file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        let document_id = format!("{}", attachment_id);

        // 3. Delete old chunks for this document (re-indexing)
        if let Err(e) = store.delete_document(&document_id).await {
            tracing::warn!("Failed to delete old chunks for {}: {}", document_id, e);
            // Continue — upsert will add new ones anyway
        }

        // 4. Chunk the text
        let chunks = chunk_prose_text(&text, &document_id, filename, &chunk_config);

        if chunks.is_empty() {
            tracing::debug!("No chunks produced for attachment {}", attachment_id);
            continue;
        }

        let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let chunk_count = chunks.len();

        tracing::info!(
            "Embedding {} chunks for {} (attachment {})",
            chunk_count, filename, attachment_id
        );

        // 5. Embed chunks
        let embed_result = match embeddings::embed_batch(embed_config, &texts).await {
            Ok(result) => result,
            Err(e) => {
                tracing::warn!("Batch embedding failed for {}, trying per-chunk: {}", filename, e);
                // Per-chunk fallback (handles bad chunks that crash batch)
                match embed_per_chunk(embed_config, &chunks, &texts).await {
                    Ok((good_chunks, good_embeddings)) if !good_chunks.is_empty() => {
                        match store.upsert_chunks(&good_chunks, &good_embeddings, filename).await {
                            Ok(count) => {
                                total_chunks_indexed += count;
                                tracing::info!("Per-chunk fallback indexed {} of {} chunks for {}",
                                    count, chunk_count, filename);
                            }
                            Err(e) => {
                                tracing::error!("Vector store upsert failed for {}: {}", filename, e);
                            }
                        }
                        continue;
                    }
                    _ => {
                        tracing::error!("All embedding attempts failed for {}", filename);
                        continue;
                    }
                }
            }
        };

        // 6. Upsert into vector store
        match store.upsert_chunks(&chunks, &embed_result.embeddings, filename).await {
            Ok(count) => {
                total_chunks_indexed += count;
                tracing::info!("Indexed {} chunks for {} into vector store", count, filename);

                // 6b. Build RAPTOR tree if enabled
                if let Some(raptor_cfg) = raptor {
                    if raptor_cfg.enabled {
                        let chunk_ids: Vec<String> = chunks.iter().map(|c| c.chunk_id.clone()).collect();
                        let chunk_contents: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
                        let raptor_config = super::raptor::RaptorConfig::default();

                        match super::raptor::build_raptor_tree(
                            &document_id, filename,
                            &chunk_ids, &chunk_contents, &embed_result.embeddings,
                            embed_config, &raptor_cfg.gen_config, store,
                            db, &format!("entry_{}", entry_id),
                            &raptor_config,
                            |detail| { tracing::debug!("RAPTOR: {}", detail); },
                        ).await {
                            Ok(summary_count) => {
                                tracing::info!("RAPTOR: built {} summary nodes for {}", summary_count, filename);
                            }
                            Err(e) => {
                                tracing::warn!("RAPTOR tree building failed for {}: {}", filename, e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!("Vector store upsert failed for {}: {}", filename, e);
            }
        }
    }

    // 7. Mark entry as RAG-indexed
    if total_chunks_indexed > 0 {
        let _ = sqlx::query(
            "UPDATE entries SET rag_indexed = 1, rag_indexed_at = datetime('now') WHERE id = ?",
        )
        .bind(entry_id)
        .execute(db)
        .await;
    }

    Ok(total_chunks_indexed)
}

/// Index all unindexed entries.
pub async fn index_all_entries(
    db: &SqlitePool,
    store: &VectorStore,
    embed_config: &EmbeddingConfig,
    library_path: &Path,
    raptor: Option<&RaptorIndexConfig>,
    progress_callback: Option<&(dyn Fn(usize, usize, &str) + Send + Sync)>,
) -> Result<usize, String> {
    // Find entries with extracted text but not yet RAG-indexed
    let entry_ids: Vec<(i64, Option<String>)> = sqlx::query_as(
        r#"SELECT DISTINCT a.entry_id, e.title
           FROM attachments a
           JOIN entries e ON e.id = a.entry_id
           WHERE a.markdown_path IS NOT NULL
             AND e.is_deleted = 0
             AND (e.rag_indexed IS NULL OR e.rag_indexed = 0)
           ORDER BY a.entry_id"#,
    )
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to query unindexed entries: {}", e))?;

    let total = entry_ids.len();
    let mut total_chunks = 0usize;

    for (i, (entry_id, title)) in entry_ids.iter().enumerate() {
        let title = title.as_deref().unwrap_or("Untitled");

        if let Some(cb) = progress_callback {
            cb(i, total, &format!("Indexing: {}", title));
        }

        match index_entry(db, store, embed_config, *entry_id, library_path, raptor).await {
            Ok(count) => {
                total_chunks += count;
                tracing::info!("RAG indexed entry {} ({}) — {} chunks", entry_id, title, count);
            }
            Err(e) => {
                tracing::error!("Failed to RAG index entry {} ({}): {}", entry_id, title, e);
            }
        }
    }

    Ok(total_chunks)
}

/// Chunk prose text into DocumentChunks (no tree-sitter, just paragraph-based).
fn chunk_prose_text(
    text: &str,
    document_id: &str,
    _filename: &str,
    config: &ChunkConfig,
) -> Vec<DocumentChunk> {
    let mut chunks = Vec::new();
    let mut offset = 0usize;
    let mut chunk_index = 0usize;

    // Split by paragraphs (double newline)
    let paragraphs: Vec<&str> = text.split("\n\n").collect();
    let mut current_chunk = String::new();
    let mut chunk_start = 0usize;

    for para in &paragraphs {
        let para_trimmed = para.trim();
        if para_trimmed.is_empty() {
            offset += para.len() + 2; // +2 for "\n\n"
            continue;
        }

        if !current_chunk.is_empty()
            && current_chunk.len() + para_trimmed.len() + 2 > config.target_chunk_size
        {
            // Flush current chunk
            if current_chunk.len() >= config.min_chunk_size {
                chunks.push(DocumentChunk {
                    chunk_id: uuid::Uuid::new_v4().to_string(),
                    document_id: document_id.to_string(),
                    chunk_index,
                    page_number: None,
                    section_name: None,
                    content: current_chunk.clone(),
                    start_offset: chunk_start,
                    end_offset: offset,
                    token_estimate: (current_chunk.len() as i64) / 4,
                });
                chunk_index += 1;
            }

            // Start new chunk with overlap
            let mut overlap_start = if current_chunk.len() > config.overlap_size {
                current_chunk.len() - config.overlap_size
            } else {
                0
            };
            // Ensure we don't split a multi-byte character
            while overlap_start > 0 && !current_chunk.is_char_boundary(overlap_start) {
                overlap_start += 1;
            }
            let overlap_text = current_chunk[overlap_start..].to_string();
            chunk_start = offset.saturating_sub(overlap_text.len());
            current_chunk = overlap_text;
        }

        if !current_chunk.is_empty() {
            current_chunk.push_str("\n\n");
        }
        current_chunk.push_str(para_trimmed);
        offset += para.len() + 2;
    }

    // Flush remaining
    if current_chunk.len() >= config.min_chunk_size {
        chunks.push(DocumentChunk {
            chunk_id: uuid::Uuid::new_v4().to_string(),
            document_id: document_id.to_string(),
            chunk_index,
            page_number: None,
            section_name: None,
            content: current_chunk.clone(),
            start_offset: chunk_start,
            end_offset: offset,
            token_estimate: (current_chunk.len() as i64) / 4,
        });
    } else if !current_chunk.is_empty() && !chunks.is_empty() {
        // Append short remainder to last chunk
        if let Some(last) = chunks.last_mut() {
            last.content.push_str("\n\n");
            last.content.push_str(&current_chunk);
            last.end_offset = offset;
            last.token_estimate = (last.content.len() as i64) / 4;
        }
    } else if !current_chunk.is_empty() {
        // Only chunk — include even if small
        chunks.push(DocumentChunk {
            chunk_id: uuid::Uuid::new_v4().to_string(),
            document_id: document_id.to_string(),
            chunk_index,
            page_number: None,
            section_name: None,
            content: current_chunk.clone(),
            start_offset: chunk_start,
            end_offset: offset,
            token_estimate: (current_chunk.len() as i64) / 4,
        });
    }

    chunks
}

/// Per-chunk embedding fallback (when batch fails, e.g. Ollama NaN issues).
async fn embed_per_chunk(
    config: &EmbeddingConfig,
    chunks: &[DocumentChunk],
    texts: &[String],
) -> Result<(Vec<DocumentChunk>, Vec<Vec<f32>>), String> {
    let mut good_chunks = Vec::new();
    let mut good_embeddings = Vec::new();

    for (i, chunk) in chunks.iter().enumerate() {
        match embeddings::embed_batch(config, &[texts[i].clone()]).await {
            Ok(result) => {
                if let Some(emb) = result.embeddings.into_iter().next() {
                    good_chunks.push(chunk.clone());
                    good_embeddings.push(emb);
                }
            }
            Err(e) => {
                tracing::warn!("Skipping chunk {} (embedding failed): {}", i, e);
            }
        }
    }

    Ok((good_chunks, good_embeddings))
}

/// Build cross-document RAPTOR summaries for a collection.
///
/// Reads the top-level per-document summaries for all entries in the collection,
/// clusters them, and builds a cross-document summary tier.
pub async fn build_collection_raptor(
    db: &SqlitePool,
    store: &VectorStore,
    embed_config: &EmbeddingConfig,
    gen_config: &super::retrieval::RagGenModelConfig,
    collection_id: i64,
) -> Result<usize, String> {
    let scope_id = format!("collection_{}", collection_id);

    // Delete old cross-doc summaries for this collection
    let _ = store.delete_document(&scope_id).await;

    // Get attachment IDs for all entries in this collection
    let attachment_ids: Vec<i64> = sqlx::query_scalar(
        r#"SELECT DISTINCT a.id
           FROM attachments a
           JOIN entries e ON e.id = a.entry_id
           JOIN collection_entries ec ON ec.entry_id = e.id
           WHERE ec.collection_id = ?
             AND a.markdown_path IS NOT NULL
             AND e.is_deleted = 0"#,
    )
    .bind(collection_id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to query collection entries: {}", e))?;

    if attachment_ids.is_empty() {
        return Ok(0);
    }

    // Build filter to get per-document RAPTOR summaries (level > 0) for these attachments
    let doc_id_filter = attachment_ids
        .iter()
        .map(|id| format!("document_id = '{}'", id))
        .collect::<Vec<_>>()
        .join(" OR ");
    let filter = format!("level > 0 AND ({})", doc_id_filter);

    let per_doc_summaries = store.get_nodes_with_embeddings(Some(&filter)).await?;

    if per_doc_summaries.is_empty() {
        tracing::info!(
            "No per-document RAPTOR summaries found for collection {} ({} entries). \
             Index documents with RAPTOR enabled first.",
            collection_id, attachment_ids.len()
        );
        return Ok(0);
    }

    tracing::info!(
        "Building cross-doc RAPTOR for collection {} with {} per-doc summaries from {} entries",
        collection_id, per_doc_summaries.len(), attachment_ids.len()
    );

    let config = super::raptor::RaptorConfig::default();

    let count = super::raptor::build_cross_doc_tier(
        &scope_id,
        &per_doc_summaries,
        embed_config,
        gen_config,
        store,
        db,
        &config,
        |detail| tracing::debug!("RAPTOR cross-doc [collection {}]: {}", collection_id, detail),
    )
    .await?;

    tracing::info!(
        "Cross-doc RAPTOR for collection {}: built {} summary nodes",
        collection_id, count
    );

    Ok(count)
}
