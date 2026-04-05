//! Tauri commands for the RAG system.
//!
//! Simple vector DB chunk indexing with optional reranker support.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

// ── Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResult {
    pub chunk_id: String,
    pub document_id: String,
    pub filename: String,
    pub chunk_index: usize,
    pub page_number: Option<usize>,
    pub section_name: Option<String>,
    pub content: String,
    pub relevance_score: f32,
    pub level: usize,
    pub entry_id: Option<i64>,
    pub entry_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResponse {
    pub results: Vec<RagSearchResult>,
    pub reranked: bool,
    pub total_results: usize,
    pub query_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagStatus {
    pub entries_indexed: i64,
    pub total_parseable: i64,
    pub total_chunks: i64,
}

// ── Helper: resolve configs from settings ────────────────────────

async fn get_setting(db: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}

async fn resolve_embed_config(db: &sqlx::SqlitePool) -> Result<crate::rag::embeddings::EmbeddingConfig, String> {
    crate::rag::embeddings::resolve_embedding_config(db).await
}

async fn resolve_reranker_config(db: &sqlx::SqlitePool) -> Option<crate::rag::retrieval::RerankerConfig> {
    let provider = get_setting(db, "reranker_provider").await?;
    let model = get_setting(db, "reranker_model").await?;

    let llm_provider = get_setting(db, "llm_provider").await.unwrap_or_default();
    let api_key = if provider == "omlx" || provider == llm_provider {
        get_setting(db, &format!("llm_api_key_{}", llm_provider)).await.unwrap_or_default()
    } else {
        get_setting(db, &format!("reranker_api_key_{}", provider)).await.unwrap_or_default()
    };

    let base_url = if provider == "omlx" || provider == llm_provider {
        get_setting(db, "llm_base_url").await
            .unwrap_or_else(|| crate::rag::embeddings::default_base_url(&provider))
    } else {
        crate::rag::embeddings::default_base_url(&provider)
    };

    Some(crate::rag::retrieval::RerankerConfig {
        provider_type: provider,
        api_key,
        base_url,
        model,
    })
}

async fn open_vector_store(
    library_path: &std::path::Path,
    dimension: usize,
) -> Result<crate::rag::store::VectorStore, String> {
    let lance_path = library_path.join(".local.nosync").join("rag_vectors");
    crate::rag::store::VectorStore::new(&lance_path, dimension).await
}

async fn resolve_dimension(
    embed_config: &crate::rag::embeddings::EmbeddingConfig,
) -> Result<usize, String> {
    match crate::rag::embeddings::probe_dimension(embed_config).await {
        Ok(d) => Ok(d),
        Err(_) => crate::rag::embeddings::known_dimension(
            &embed_config.provider_type,
            &embed_config.model,
        )
        .ok_or_else(|| {
            "Could not determine embedding dimension. Check your embedding model.".to_string()
        }),
    }
}

// ── Commands ─────────────────────────────────────────────────────

/// Search across all indexed documents using vector similarity + optional reranking.
#[tauri::command]
pub async fn rag_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<RagSearchResponse, String> {
    let start = std::time::Instant::now();
    let limit = limit.unwrap_or(10).min(50);
    let db = &state.db;

    let embed_config = resolve_embed_config(db).await?;
    let dimension = resolve_dimension(&embed_config).await?;

    let lib_path = state.library_path.read().await;
    let store = open_vector_store(&lib_path, dimension).await?;

    if store.is_empty().await {
        return Ok(RagSearchResponse {
            results: Vec::new(),
            reranked: false,
            total_results: 0,
            query_time_ms: start.elapsed().as_millis() as u64,
        });
    }

    let reranker = resolve_reranker_config(db).await;
    let has_reranker = reranker.is_some();

    let results = crate::rag::retrieval::search_documents(
        &store,
        &embed_config,
        &query,
        limit,
        reranker.as_ref(),
        None,
    )
    .await?;

    let total_results = results.len();

    let mut out = Vec::with_capacity(results.len());
    for r in results {
        let entry_info: Option<(i64, Option<String>)> = sqlx::query_as(
            "SELECT e.id, e.title FROM entries e \
             JOIN attachments a ON a.entry_id = e.id \
             WHERE a.id = ? LIMIT 1",
        )
        .bind(r.document_id.parse::<i64>().unwrap_or(-1))
        .fetch_optional(db)
        .await
        .ok()
        .flatten();

        out.push(RagSearchResult {
            chunk_id: r.chunk_id,
            document_id: r.document_id,
            filename: r.filename,
            chunk_index: r.chunk_index,
            page_number: r.page_number,
            section_name: r.section_name,
            content: r.content,
            relevance_score: r.relevance_score,
            level: r.level,
            entry_id: entry_info.as_ref().map(|(id, _)| *id),
            entry_title: entry_info.and_then(|(_, t)| t),
        });
    }

    Ok(RagSearchResponse {
        results: out,
        reranked: has_reranker,
        total_results,
        query_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// Get RAG indexing status.
#[tauri::command]
pub async fn rag_status(state: State<'_, AppState>) -> Result<RagStatus, String> {
    let db = &state.db;

    let entries_indexed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM entries WHERE rag_indexed = 1 AND is_deleted = 0",
    )
    .fetch_one(db)
    .await
    .unwrap_or(0);

    let total_parseable: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT a.entry_id) FROM attachments a WHERE a.markdown_path IS NOT NULL",
    )
    .fetch_one(db)
    .await
    .unwrap_or(0);

    let total_chunks = 0i64;

    Ok(RagStatus {
        entries_indexed,
        total_parseable,
        total_chunks,
    })
}

/// Index a single entry into the RAG vector store (via job queue).
#[tauri::command]
pub async fn rag_index_entry(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<String, String> {
    let title: String = sqlx::query_scalar("SELECT title FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| format!("Entry {}", entry_id));

    let short_title = if title.len() > 50 {
        format!("{}...", &title[..47])
    } else {
        title.clone()
    };

    state
        .job_queue
        .enqueue(
            crate::jobs::types::JobType::RagIndex,
            Some(format!("Semantic Index: {}", short_title)),
            serde_json::json!({ "entryId": entry_id }),
            0,
        )
        .await
        .map_err(|e| format!("Failed to enqueue RAG index job: {}", e))?;

    Ok(format!("Queued semantic indexing for {}", title))
}

/// Enqueue one RAG index job per unindexed entry.
#[tauri::command]
pub async fn rag_index_all(state: State<'_, AppState>) -> Result<String, String> {
    let db = &state.db;

    let entries: Vec<(i64, Option<String>)> = sqlx::query_as(
        r#"SELECT DISTINCT a.entry_id, e.title
           FROM attachments a
           JOIN entries e ON e.id = a.entry_id
           WHERE a.markdown_path IS NOT NULL
             AND e.is_deleted = 0
             AND (e.rag_indexed IS NULL OR e.rag_indexed = 0)"#,
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;

    let count = entries.len();
    for (entry_id, title) in &entries {
        let title = title.as_deref().unwrap_or("Untitled");
        let payload = serde_json::json!({ "entryId": entry_id });
        let _ = state.job_queue.enqueue(
            crate::jobs::types::JobType::RagIndex,
            Some(format!("Semantic Index: {}", title)),
            payload,
            0,
        ).await;
    }

    Ok(format!("Enqueued {} entries for semantic indexing", count))
}

/// Rebuild the entire RAG index (drop and re-create).
#[tauri::command]
pub async fn rag_rebuild(state: State<'_, AppState>) -> Result<(), String> {
    let lib_path = state.library_path.read().await;
    let lance_path = lib_path.join(".local.nosync").join("rag_vectors");

    // Drop the vector store
    if lance_path.exists() {
        std::fs::remove_dir_all(&lance_path)
            .map_err(|e| format!("Failed to delete RAG vectors: {}", e))?;
    }

    // Drop legacy summaries table if it exists
    let _ = sqlx::query("DROP TABLE IF EXISTS document_summaries")
        .execute(&state.db)
        .await;

    // Clean up stale settings from removed features
    let _ = sqlx::query(
        "DELETE FROM settings WHERE key IN ('rag_gen_model', 'crag_enabled', 'crag_upper_threshold', 'crag_lower_threshold', 'raptor_enabled', 'raptor_token_budget', 'raptor_retrieval_mode')"
    )
    .execute(&state.db)
    .await;

    // Reset rag_indexed flags
    sqlx::query("UPDATE entries SET rag_indexed = 0, rag_indexed_at = NULL")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to reset RAG index flags: {}", e))?;

    tracing::info!("RAG index rebuilt (dropped and reset)");
    Ok(())
}
