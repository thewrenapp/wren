use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use anyhow::Result;
use sqlx::{Row, SqlitePool};

use super::chunker::{chunk_sections, sections_from_json, sections_from_markdown};
use super::embeddings::EmbeddingService;
use super::knowledge::{self, EntryContext};
use super::vectors::{ChunkRecord, ClaimVectorRecord, EntityVectorRecord, VectorStore};
use crate::llm::provider::{LlmProvider, TokenUsageSummary};

// ── Progress callback ────────────────────────────────────────────────

pub trait GraphProgressCallback: Send + Sync {
    fn update(&self, message: &str);
}

/// No-op progress callback for non-interactive usage.
pub struct NoopProgress;
impl GraphProgressCallback for NoopProgress {
    fn update(&self, _message: &str) {}
}

/// Wraps another progress callback, prepending a context prefix to all messages.
struct PrefixedProgress<'a> {
    inner: &'a dyn GraphProgressCallback,
    prefix: String,
}

impl GraphProgressCallback for PrefixedProgress<'_> {
    fn update(&self, message: &str) {
        self.inner.update(&format!("{}{}", self.prefix, message));
    }
}

// ── Main orchestration ───────────────────────────────────────────────

/// Index all unindexed attachments for a given entry.
///
/// Returns the number of attachments indexed.
pub async fn index_entry_to_graph(
    db: &SqlitePool,
    vector_store: &VectorStore,
    embedding_service: &Arc<EmbeddingService>,
    provider: &dyn LlmProvider,
    model: &str,
    entry_id: i64,
    cancel: &AtomicBool,
    progress: &dyn GraphProgressCallback,
) -> Result<usize> {
    // Find all parsed_content rows for this entry where graph_indexed = 0
    let rows: Vec<(i64, i64)> = sqlx::query(
        "SELECT attachment_id, entry_id FROM parsed_content WHERE entry_id = ? AND graph_indexed = 0 AND status = 'success'",
    )
    .bind(entry_id)
    .fetch_all(db)
    .await?
    .iter()
    .map(|r| (r.get("attachment_id"), r.get("entry_id")))
    .collect();

    if rows.is_empty() {
        return Ok(0);
    }

    let mut indexed = 0;
    for (attachment_id, _) in &rows {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        match index_attachment_to_graph(
            db,
            vector_store,
            embedding_service,
            provider,
            model,
            entry_id,
            *attachment_id,
            cancel,
            progress,
        )
        .await
        {
            Ok(()) => indexed += 1,
            Err(e) => {
                tracing::error!(
                    "Failed to index attachment {} for entry {}: {}",
                    attachment_id, entry_id, e
                );
            }
        }
    }

    Ok(indexed)
}

/// Index a single attachment into the knowledge graph + vector store.
///
/// This is the core function that handles:
/// 1. Loading parsed content
/// 2. Building section tree
/// 3. LLM knowledge extraction
/// 4. Entity dedup + insert (SQLite)
/// 5. Claim insert (SQLite)
/// 6. Chunking + embedding + LanceDB insert
/// 7. Marking as indexed
pub async fn index_attachment_to_graph(
    db: &SqlitePool,
    vector_store: &VectorStore,
    embedding_service: &Arc<EmbeddingService>,
    provider: &dyn LlmProvider,
    model: &str,
    entry_id: i64,
    attachment_id: i64,
    cancel: &AtomicBool,
    progress: &dyn GraphProgressCallback,
) -> Result<()> {
    progress.update(&format!("Loading parsed content..."));

    // ── 1. Load parsed content ───────────────────────────────────────
    let pc_row = sqlx::query(
        r#"SELECT structured_markdown, sections_json, document_type, language
           FROM parsed_content WHERE attachment_id = ? AND status = 'success'"#,
    )
    .bind(attachment_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| anyhow::anyhow!("No parsed content for attachment {attachment_id}"))?;

    let structured_markdown: String = pc_row.get("structured_markdown");
    let sections_json: Option<String> = pc_row.get("sections_json");
    let document_type: Option<String> = pc_row.get("document_type");
    let language: Option<String> = pc_row.get("language");

    if structured_markdown.trim().is_empty() {
        return Err(anyhow::anyhow!("Empty structured_markdown for attachment {attachment_id}"));
    }

    // ── 2. Load entry metadata ───────────────────────────────────────
    let entry_row = sqlx::query(
        r#"SELECT e.title, e.creators_sort, it.name as item_type_name
           FROM entries e
           JOIN item_types it ON e.item_type_id = it.id
           WHERE e.id = ?"#,
    )
    .bind(entry_id)
    .fetch_optional(db)
    .await?;

    let (title, creators, item_type) = match entry_row {
        Some(r) => (
            r.get::<Option<String>, _>("title"),
            r.get::<Option<String>, _>("creators_sort"),
            r.get::<Option<String>, _>("item_type_name"),
        ),
        None => (None, None, None),
    };

    let abstract_text: Option<String> = sqlx::query_scalar(
        r#"SELECT ef.value FROM entry_fields ef
           JOIN fields f ON ef.field_id = f.id
           WHERE ef.entry_id = ? AND f.name = 'abstractNote' LIMIT 1"#,
    )
    .bind(entry_id)
    .fetch_optional(db)
    .await?
    .flatten();

    // Get attachment title for chunk provenance
    let attachment_title: String = sqlx::query_scalar(
        "SELECT COALESCE(title, file_path, 'attachment') FROM attachments WHERE id = ?",
    )
    .bind(attachment_id)
    .fetch_optional(db)
    .await?
    .flatten()
    .unwrap_or_else(|| format!("attachment-{attachment_id}"));

    // Build a prefixed progress wrapper so all messages include entry context
    let entry_label = title.as_deref().unwrap_or("Untitled");
    let short_title = if entry_label.len() > 50 {
        format!("{}…", &entry_label[..49])
    } else {
        entry_label.to_string()
    };
    let prefixed = PrefixedProgress {
        inner: progress,
        prefix: format!("{short_title} — "),
    };

    // ── 3. Build section tree ────────────────────────────────────────
    let sections = if let Some(ref json) = sections_json {
        sections_from_json(json)
    } else {
        sections_from_markdown(&structured_markdown)
    };

    // Build effective sections (used for both extraction and chunking)
    let effective_sections = if sections.is_empty() {
        tracing::warn!("No sections found for attachment {attachment_id}, using full text as single section");
        vec![super::chunker::Section {
            name: "Full Document".to_string(),
            level: 1,
            content: structured_markdown.clone(),
        }]
    } else {
        sections
    };

    // ── 4. LLM knowledge extraction (per-section) ─────────────────
    prefixed.update("Extracting knowledge (entities & claims)...");

    let context = EntryContext {
        title: title.clone(),
        creators,
        abstract_text,
        item_type,
        document_type: document_type.unwrap_or_else(|| "general".to_string()),
        language: language.unwrap_or_else(|| "en".to_string()),
    };

    let mut usage = TokenUsageSummary::default();
    let extraction = knowledge::extract_knowledge_from_sections(
        provider,
        model,
        &effective_sections,
        &context,
        3,
        &mut usage,
        cancel,
        &prefixed,
    )
    .await
    .map_err(|e| anyhow::anyhow!("Knowledge extraction failed: {e}"))?;

    // ── 5. Entity dedup + insert (SQLite) ────────────────────────────
    prefixed.update(&format!("Storing {} entities...", extraction.entities.len()));

    let mut new_entity_ids: Vec<(i64, String, String)> = Vec::new(); // (id, name, description)

    for entity in &extraction.entities {
        let name_normalized = entity.name.trim().to_lowercase();
        if name_normalized.is_empty() {
            continue;
        }

        // Check if entity already exists
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM entities WHERE name_normalized = ? AND category = ?",
        )
        .bind(&name_normalized)
        .bind(&entity.category)
        .fetch_optional(db)
        .await?;

        let entity_id = if let Some(id) = existing {
            id
        } else {
            // Insert new entity
            let result = sqlx::query(
                "INSERT INTO entities (name, name_normalized, description, category) VALUES (?, ?, ?, ?)",
            )
            .bind(&entity.name)
            .bind(&name_normalized)
            .bind(&entity.description)
            .bind(&entity.category)
            .execute(db)
            .await?;

            let id = result.last_insert_rowid();
            new_entity_ids.push((id, entity.name.clone(), entity.description.clone()));
            id
        };

        // Insert entry_entity edge
        let _ = sqlx::query(
            r#"INSERT OR IGNORE INTO entry_entities
               (entry_id, attachment_id, entity_id, relation_type, weight, evidence_text, section_name, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(entry_id)
        .bind(attachment_id)
        .bind(entity_id)
        .bind(&entity.relation_type)
        .bind(entity.weight)
        .bind(&entity.evidence_text)
        .bind(&entity.section_name)
        .bind(0.8_f64)
        .execute(db)
        .await;
    }

    // ── 6. Claim insert (SQLite) ─────────────────────────────────────
    prefixed.update(&format!("Storing {} claims...", extraction.claims.len()));

    let mut claim_ids: Vec<(i64, String)> = Vec::new(); // (id, statement)

    for claim in &extraction.claims {
        if claim.statement.trim().is_empty() {
            continue;
        }

        let result = sqlx::query(
            r#"INSERT INTO claims (entry_id, attachment_id, statement, evidence_text, section_name, claim_type, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(entry_id)
        .bind(attachment_id)
        .bind(&claim.statement)
        .bind(&claim.evidence_text)
        .bind(&claim.section_name)
        .bind(&claim.claim_type)
        .bind(claim.confidence as f64)
        .execute(db)
        .await?;

        claim_ids.push((result.last_insert_rowid(), claim.statement.clone()));
    }

    // ── 7. Chunking ──────────────────────────────────────────────────
    prefixed.update("Chunking document...");

    let chunks = chunk_sections(
        &effective_sections,
        entry_id,
        attachment_id,
        &attachment_title,
        1000, // ~256 tokens
    );

    // ── 8. Embedding generation ──────────────────────────────────────
    prefixed.update(&format!("Embedding {} chunks + {} entities + {} claims...", chunks.len(), new_entity_ids.len(), claim_ids.len()));

    // Collect all texts to embed in one batch
    let mut all_texts: Vec<String> = Vec::new();
    let mut text_sources: Vec<&str> = Vec::new(); // "chunk", "entity", "claim"

    for chunk in &chunks {
        all_texts.push(chunk.text.clone());
        text_sources.push("chunk");
    }
    for (_, name, desc) in &new_entity_ids {
        all_texts.push(format!("{name}: {desc}"));
        text_sources.push("entity");
    }
    for (_, statement) in &claim_ids {
        all_texts.push(statement.clone());
        text_sources.push("claim");
    }

    let embeddings = embedding_service.embed_batch(&all_texts).await?;

    if embeddings.len() != all_texts.len() {
        return Err(anyhow::anyhow!(
            "Embedding count mismatch: expected {}, got {}",
            all_texts.len(),
            embeddings.len()
        ));
    }

    // Validate vector dimensions match what LanceDB expects
    if let Some(first) = embeddings.first() {
        let expected = embedding_service.dimensions();
        if first.len() != expected {
            return Err(anyhow::anyhow!(
                "Embedding dimension mismatch: got {}, expected {}. \
                 The embedding model may have changed — rebuild the knowledge graph.",
                first.len(),
                expected
            ));
        }
    }

    // ── 9. LanceDB inserts ───────────────────────────────────────────
    prefixed.update("Storing vectors...");

    let mut chunk_records = Vec::new();
    let mut entity_records = Vec::new();
    let mut claim_records = Vec::new();

    let mut idx = 0;
    for chunk in &chunks {
        chunk_records.push(ChunkRecord {
            entry_id: chunk.entry_id,
            attachment_id: chunk.attachment_id,
            attachment_title: chunk.attachment_title.clone(),
            section_name: chunk.section_name.clone(),
            section_level: chunk.section_level,
            chunk_index: chunk.chunk_index,
            chunk_text: chunk.text.clone(),
            vector: embeddings[idx].clone(),
        });
        idx += 1;
    }

    for (entity_id, name, desc) in &new_entity_ids {
        entity_records.push(EntityVectorRecord {
            entity_id: *entity_id,
            name: name.clone(),
            description: desc.clone(),
            category: extraction
                .entities
                .iter()
                .find(|e| e.name == *name)
                .map(|e| e.category.clone())
                .unwrap_or_default(),
            vector: embeddings[idx].clone(),
        });
        idx += 1;
    }

    for (claim_id, statement) in &claim_ids {
        claim_records.push(ClaimVectorRecord {
            claim_id: *claim_id,
            entry_id,
            statement: statement.clone(),
            claim_type: extraction
                .claims
                .iter()
                .find(|c| c.statement == *statement)
                .map(|c| c.claim_type.clone())
                .unwrap_or_default(),
            vector: embeddings[idx].clone(),
        });
        idx += 1;
    }

    vector_store.insert_chunks(&chunk_records).await?;
    vector_store.insert_entity_vectors(&entity_records).await?;
    vector_store.insert_claim_vectors(&claim_records).await?;

    // ── 10. Mark as indexed ──────────────────────────────────────────
    sqlx::query(
        "UPDATE parsed_content SET graph_indexed = 1, graph_indexed_at = datetime('now') WHERE attachment_id = ?",
    )
    .bind(attachment_id)
    .execute(db)
    .await?;

    prefixed.update(&format!(
        "Done: {} entities, {} claims, {} chunks{}",
        extraction.entities.len(),
        extraction.claims.len(),
        chunks.len(),
        if extraction.partial { " (partial — some sections failed)" } else { "" }
    ));

    tracing::info!(
        "Graph indexed attachment {}: {} entities, {} claims, {} chunks, {} tokens",
        attachment_id,
        extraction.entities.len(),
        extraction.claims.len(),
        chunks.len(),
        usage.total_tokens,
    );

    Ok(())
}

/// Re-index an attachment's graph data.
///
/// Called when:
/// - User edits a note (markdown content changes)
/// - User manually updates `parsed_content.structured_markdown`
/// - LLM re-parses an attachment
///
/// Clears existing graph data for this attachment, then rebuilds.
pub async fn reindex_attachment_graph(
    db: &SqlitePool,
    vector_store: &VectorStore,
    embedding_service: &Arc<EmbeddingService>,
    provider: &dyn LlmProvider,
    model: &str,
    entry_id: i64,
    attachment_id: i64,
    cancel: &AtomicBool,
    progress: &dyn GraphProgressCallback,
) -> Result<()> {
    progress.update("Clearing old graph data...");

    // Clear SQLite graph data for this attachment; returns orphaned entity IDs
    let orphaned_entity_ids = clear_attachment_graph_data(db, attachment_id).await?;

    // Clear LanceDB vectors: chunks by attachment_id, plus claim vectors by entry_id
    vector_store.delete_attachment_vectors(attachment_id).await?;
    vector_store.delete_entry_vectors(entry_id).await?;

    // Delete orphaned entity vectors from LanceDB
    for entity_id in &orphaned_entity_ids {
        if let Err(e) = vector_store.delete_entity_vector(*entity_id).await {
            tracing::warn!("Failed to delete orphaned entity vector {}: {}", entity_id, e);
        }
    }

    // Reset the graph_indexed flag so it gets re-processed
    sqlx::query("UPDATE parsed_content SET graph_indexed = 0, graph_indexed_at = NULL WHERE attachment_id = ?")
        .bind(attachment_id)
        .execute(db)
        .await?;

    // Re-index
    index_attachment_to_graph(
        db,
        vector_store,
        embedding_service,
        provider,
        model,
        entry_id,
        attachment_id,
        cancel,
        progress,
    )
    .await
}

/// Clear all graph data for a specific attachment.
///
/// This removes:
/// - entry_entities rows for this attachment
/// - claims for this attachment
/// - orphaned entities (entities no longer referenced by any entry_entity)
///
/// Called before re-indexing or when an attachment is deleted.
pub async fn clear_attachment_graph_data(db: &SqlitePool, attachment_id: i64) -> Result<Vec<i64>> {
    // Remove entry_entities for this attachment
    sqlx::query("DELETE FROM entry_entities WHERE attachment_id = ?")
        .bind(attachment_id)
        .execute(db)
        .await?;

    // Remove claims for this attachment
    sqlx::query("DELETE FROM claims WHERE attachment_id = ?")
        .bind(attachment_id)
        .execute(db)
        .await?;

    // Find orphaned entities (no longer referenced by any entry_entity or entity_relation)
    let orphaned_entity_ids: Vec<i64> = sqlx::query_scalar(
        r#"SELECT id FROM entities WHERE id NOT IN (
               SELECT DISTINCT entity_id FROM entry_entities
           ) AND id NOT IN (
               SELECT DISTINCT source_entity_id FROM entity_relations
               UNION
               SELECT DISTINCT target_entity_id FROM entity_relations
           )"#,
    )
    .fetch_all(db)
    .await?;

    // Delete orphaned entities from SQLite
    if !orphaned_entity_ids.is_empty() {
        let placeholders: Vec<String> = orphaned_entity_ids.iter().map(|_| "?".to_string()).collect();
        let query_str = format!("DELETE FROM entities WHERE id IN ({})", placeholders.join(","));
        let mut query = sqlx::query(&query_str);
        for id in &orphaned_entity_ids {
            query = query.bind(id);
        }
        query.execute(db).await?;
    }

    // Return orphaned entity IDs so caller can clean up vectors
    Ok(orphaned_entity_ids)
}

/// Re-embed all graph data using the current embedding model.
///
/// This does NOT re-run LLM extraction — entities and claims in SQLite are
/// untouched. It only:
/// 1. Drops and recreates LanceDB vector tables
/// 2. For each indexed attachment: re-chunks sections, loads entities + claims
///    from SQLite, embeds them with the current model, and inserts into LanceDB
///
/// Called when the user changes embedding model/source.
pub async fn reembed_all(
    db: &SqlitePool,
    vector_store: &VectorStore,
    embedding_service: &Arc<EmbeddingService>,
    cancel: &AtomicBool,
    progress: &dyn GraphProgressCallback,
) -> Result<usize> {
    use std::sync::atomic::Ordering;

    progress.update("Clearing vector store...");
    vector_store.drop_and_recreate_tables().await?;

    // Find all indexed attachments
    let rows: Vec<(i64, i64)> = sqlx::query(
        r#"SELECT attachment_id, entry_id FROM parsed_content
           WHERE graph_indexed = 1 AND status = 'success'"#,
    )
    .fetch_all(db)
    .await?
    .iter()
    .map(|r| (r.get("attachment_id"), r.get("entry_id")))
    .collect();

    let total = rows.len();
    if total == 0 {
        progress.update("No indexed attachments to re-embed.");
        return Ok(0);
    }

    tracing::info!("[reembed] Re-embedding {} attachments", total);

    let mut done = 0;
    for (i, (attachment_id, entry_id)) in rows.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        // Get attachment title for progress + chunk provenance
        let attachment_title: String = sqlx::query_scalar(
            "SELECT COALESCE(title, file_path, 'attachment') FROM attachments WHERE id = ?",
        )
        .bind(attachment_id)
        .fetch_optional(db)
        .await?
        .flatten()
        .unwrap_or_else(|| format!("attachment-{attachment_id}"));

        let short_title = if attachment_title.len() > 50 {
            format!("{}…", &attachment_title[..49])
        } else {
            attachment_title.clone()
        };

        progress.update(&format!(
            "({}/{}) {} — Loading sections...",
            i + 1, total, short_title
        ));

        // Load parsed content for chunking
        let pc_row = sqlx::query(
            r#"SELECT structured_markdown, sections_json
               FROM parsed_content WHERE attachment_id = ? AND status = 'success'"#,
        )
        .bind(attachment_id)
        .fetch_optional(db)
        .await?;

        let pc_row = match pc_row {
            Some(r) => r,
            None => continue,
        };

        let structured_markdown: String = pc_row.get("structured_markdown");
        let sections_json: Option<String> = pc_row.get("sections_json");

        if structured_markdown.trim().is_empty() {
            continue;
        }

        // Build sections
        let sections = if let Some(ref json) = sections_json {
            sections_from_json(json)
        } else {
            sections_from_markdown(&structured_markdown)
        };

        let effective_sections = if sections.is_empty() {
            vec![super::chunker::Section {
                name: "Full Document".to_string(),
                level: 1,
                content: structured_markdown.clone(),
            }]
        } else {
            sections
        };

        // Chunk
        let chunks = chunk_sections(
            &effective_sections,
            *entry_id,
            *attachment_id,
            &attachment_title,
            1000,
        );

        // Load entities for this attachment from SQLite
        let entity_rows: Vec<(i64, String, String, String)> = sqlx::query(
            r#"SELECT e.id, e.name, COALESCE(e.description, '') as description, e.category
               FROM entities e
               JOIN entry_entities ee ON ee.entity_id = e.id
               WHERE ee.attachment_id = ?"#,
        )
        .bind(attachment_id)
        .fetch_all(db)
        .await?
        .iter()
        .map(|r| (
            r.get("id"),
            r.get::<String, _>("name"),
            r.get::<String, _>("description"),
            r.get::<String, _>("category"),
        ))
        .collect();

        // Load claims for this attachment from SQLite
        let claim_rows: Vec<(i64, String, String)> = sqlx::query(
            r#"SELECT id, statement, claim_type FROM claims WHERE attachment_id = ?"#,
        )
        .bind(attachment_id)
        .fetch_all(db)
        .await?
        .iter()
        .map(|r| (
            r.get("id"),
            r.get::<String, _>("statement"),
            r.get::<String, _>("claim_type"),
        ))
        .collect();

        // Collect all texts to embed
        let mut all_texts: Vec<String> = Vec::new();
        let mut text_sources: Vec<&str> = Vec::new();

        for chunk in &chunks {
            all_texts.push(chunk.text.clone());
            text_sources.push("chunk");
        }
        for (_, name, desc, _) in &entity_rows {
            all_texts.push(format!("{name}: {desc}"));
            text_sources.push("entity");
        }
        for (_, statement, _) in &claim_rows {
            all_texts.push(statement.clone());
            text_sources.push("claim");
        }

        if all_texts.is_empty() {
            continue;
        }

        progress.update(&format!(
            "({}/{}) {} — Embedding {} chunks + {} entities + {} claims...",
            i + 1, total, short_title, chunks.len(), entity_rows.len(), claim_rows.len()
        ));

        let embeddings = embedding_service.embed_batch(&all_texts).await?;

        if embeddings.len() != all_texts.len() {
            tracing::error!(
                "[reembed] Embedding count mismatch for attachment {}: expected {}, got {}",
                attachment_id, all_texts.len(), embeddings.len()
            );
            continue;
        }

        // Build LanceDB records
        let mut chunk_records = Vec::new();
        let mut entity_records = Vec::new();
        let mut claim_records = Vec::new();
        let mut idx = 0;

        for chunk in &chunks {
            chunk_records.push(ChunkRecord {
                entry_id: chunk.entry_id,
                attachment_id: chunk.attachment_id,
                attachment_title: chunk.attachment_title.clone(),
                section_name: chunk.section_name.clone(),
                section_level: chunk.section_level,
                chunk_index: chunk.chunk_index,
                chunk_text: chunk.text.clone(),
                vector: embeddings[idx].clone(),
            });
            idx += 1;
        }

        for (entity_id, name, desc, category) in &entity_rows {
            entity_records.push(EntityVectorRecord {
                entity_id: *entity_id,
                name: name.clone(),
                description: desc.clone(),
                category: category.clone(),
                vector: embeddings[idx].clone(),
            });
            idx += 1;
        }

        for (claim_id, statement, claim_type) in &claim_rows {
            claim_records.push(ClaimVectorRecord {
                claim_id: *claim_id,
                entry_id: *entry_id,
                statement: statement.clone(),
                claim_type: claim_type.clone(),
                vector: embeddings[idx].clone(),
            });
            idx += 1;
        }

        vector_store.insert_chunks(&chunk_records).await?;
        vector_store.insert_entity_vectors(&entity_records).await?;
        vector_store.insert_claim_vectors(&claim_records).await?;

        done += 1;
    }

    progress.update(&format!("Re-embedded {done}/{total} attachments."));
    tracing::info!("[reembed] Done — re-embedded {done}/{total} attachments");
    Ok(done)
}
