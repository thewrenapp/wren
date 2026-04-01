//! Tauri commands for the RAG system.
//!
//! Wires up: embedding config resolution, vector store, indexing pipeline,
//! search with strategies (HyDE/step-back/CRAG), reranking, and RAPTOR.

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
    pub strategy: String,
    pub reranked: bool,
    pub crag_active: bool,
    pub raptor_active: bool,
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

// ── Helper: resolve all RAG configs from settings ────────────────

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

async fn resolve_rag_gen_config(db: &sqlx::SqlitePool) -> Option<crate::rag::retrieval::RagGenModelConfig> {
    let provider = get_setting(db, "llm_provider").await?;
    let api_key = get_setting(db, &format!("llm_api_key_{}", provider)).await.unwrap_or_default();
    let base_url = get_setting(db, "llm_base_url").await;

    // Use dedicated RAG gen model if set, otherwise fall back to main LLM model
    let model = get_setting(db, "rag_gen_model").await
        .filter(|m| !m.is_empty())
        .or_else(|| None) // Will use blocking get below
        .unwrap_or_else(|| {
            // Can't await here, but this is synchronous context inside unwrap_or_else
            // Use empty string as sentinel — caller checks
            String::new()
        });

    let model = if model.is_empty() {
        get_setting(db, "llm_model").await?
    } else {
        model
    };

    Some(crate::rag::retrieval::RagGenModelConfig {
        provider_type: provider,
        api_key,
        base_url,
        model,
    })
}

async fn resolve_reranker_config(db: &sqlx::SqlitePool) -> Option<crate::rag::retrieval::RerankerConfig> {
    let provider = get_setting(db, "reranker_provider").await?;
    let model = get_setting(db, "reranker_model").await?;

    // For oMLX reranker, use the same API key and base URL
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

async fn resolve_crag_config(db: &sqlx::SqlitePool) -> Option<crate::rag::retrieval::CragConfig> {
    let enabled = get_setting(db, "crag_enabled").await
        .map(|v| v == "true")
        .unwrap_or(false);

    if !enabled {
        return None;
    }

    let upper = get_setting(db, "crag_upper_threshold").await
        .and_then(|v| v.parse().ok())
        .unwrap_or(60.0);
    let lower = get_setting(db, "crag_lower_threshold").await
        .and_then(|v| v.parse().ok())
        .unwrap_or(25.0);

    Some(crate::rag::retrieval::CragConfig {
        upper_threshold: upper,
        lower_threshold: lower,
        enable_query_rewrite: true,
    })
}

async fn resolve_raptor_retrieval_config(
    db: &sqlx::SqlitePool,
) -> Option<crate::rag::retrieval::RaptorRetrievalConfig> {
    let enabled = get_setting(db, "raptor_enabled").await
        .map(|v| v == "true")
        .unwrap_or(false);

    if !enabled {
        return None;
    }

    let budget = get_setting(db, "raptor_token_budget").await
        .and_then(|v| v.parse().ok())
        .unwrap_or(2000);

    Some(crate::rag::retrieval::RaptorRetrievalConfig {
        enabled: true,
        token_budget: budget,
    })
}

async fn build_raptor_config(
    db: &sqlx::SqlitePool,
) -> Option<crate::rag::indexer::RaptorIndexConfig> {
    let enabled = get_setting(db, "raptor_enabled").await
        .map(|v| v == "true")
        .unwrap_or(false);

    if !enabled {
        return None;
    }

    let gen_config = resolve_rag_gen_config(db).await?;

    Some(crate::rag::indexer::RaptorIndexConfig {
        enabled: true,
        gen_config,
    })
}

async fn open_vector_store(
    library_path: &std::path::Path,
    dimension: usize,
) -> Result<crate::rag::store::VectorStore, String> {
    let lance_path = library_path.join(".wren").join("rag_vectors");
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

/// Search across all indexed documents using the RAG system.
/// Reads ALL settings: embedding, RAG gen model, reranker, CRAG, strategy.
#[tauri::command]
pub async fn rag_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    strategy: Option<String>,
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
            strategy: "none".to_string(),
            reranked: false,
            crag_active: false,
            raptor_active: false,
            total_results: 0,
            query_time_ms: start.elapsed().as_millis() as u64,
        });
    }

    let strategy = match strategy.as_deref() {
        Some("semantic") => crate::rag::retrieval::SearchStrategy::Semantic,
        Some("hyde") => crate::rag::retrieval::SearchStrategy::Hyde,
        Some("step_back") => crate::rag::retrieval::SearchStrategy::StepBack,
        _ => crate::rag::retrieval::SearchStrategy::Auto,
    };

    let rag_gen = resolve_rag_gen_config(db).await;
    let reranker = resolve_reranker_config(db).await;
    let crag = resolve_crag_config(db).await;
    let raptor_retrieval = resolve_raptor_retrieval_config(db).await;

    let has_reranker = reranker.is_some();
    let has_crag = crag.is_some();
    let has_raptor = raptor_retrieval.as_ref().map(|r| r.enabled).unwrap_or(false);

    // Determine actual strategy (Auto resolves here for reporting)
    let strategy_name = match &strategy {
        crate::rag::retrieval::SearchStrategy::Auto => "auto",
        crate::rag::retrieval::SearchStrategy::Semantic => "semantic",
        crate::rag::retrieval::SearchStrategy::Hyde => "hyde",
        crate::rag::retrieval::SearchStrategy::StepBack => "step_back",
    };

    let results = crate::rag::retrieval::search_documents(
        &store,
        &embed_config,
        &query,
        limit,
        strategy,
        rag_gen.as_ref(),
        reranker.as_ref(),
        crag.as_ref(),
        raptor_retrieval.as_ref(),
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
        strategy: strategy_name.to_string(),
        reranked: has_reranker,
        crag_active: has_crag,
        raptor_active: has_raptor,
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

    // TODO: query actual chunk count from vector store
    let total_chunks = 0i64;

    Ok(RagStatus {
        entries_indexed,
        total_parseable,
        total_chunks,
    })
}

/// Index a single entry into the RAG vector store.
#[tauri::command]
pub async fn rag_index_entry(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<String, String> {
    let db = &state.db;
    let embed_config = resolve_embed_config(db).await?;
    let dimension = resolve_dimension(&embed_config).await?;

    let lib_path = state.library_path.read().await;
    let store = open_vector_store(&lib_path, dimension).await?;

    let raptor = build_raptor_config(db).await;
    let count = crate::rag::indexer::index_entry(
        db, &store, &embed_config, entry_id, &lib_path, raptor.as_ref(),
    )
    .await?;

    Ok(format!("Indexed {} chunks for entry {}", count, entry_id))
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

/// Build cross-document RAPTOR summaries for a collection.
/// Clusters per-document summaries and creates higher-level thematic summaries.
#[tauri::command]
pub async fn rag_build_collection_raptor(
    state: State<'_, AppState>,
    collection_id: i64,
) -> Result<String, String> {
    let name: String = sqlx::query_scalar("SELECT name FROM collections WHERE id = ?")
        .bind(collection_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| format!("Collection {}", collection_id));

    let payload = serde_json::json!({ "collectionId": collection_id });
    let job_id = state.job_queue.enqueue(
        crate::jobs::types::JobType::RagCollectionRaptor,
        Some(format!("Cross-doc RAPTOR: {}", name)),
        payload,
        0,
    ).await?;

    Ok(job_id)
}

/// Rebuild the entire RAG index (drop and re-create).
#[tauri::command]
pub async fn rag_rebuild(state: State<'_, AppState>) -> Result<(), String> {
    let lib_path = state.library_path.read().await;
    let lance_path = lib_path.join(".wren").join("rag_vectors");

    // Drop the vector store
    if lance_path.exists() {
        std::fs::remove_dir_all(&lance_path)
            .map_err(|e| format!("Failed to delete RAG vectors: {}", e))?;
    }

    // Reset rag_indexed flags
    sqlx::query("UPDATE entries SET rag_indexed = 0, rag_indexed_at = NULL")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to reset RAG index flags: {}", e))?;

    tracing::info!("RAG index rebuilt (dropped and reset)");
    Ok(())
}

/// Enqueue a cross-doc RAPTOR job for a collection. No-op if RAPTOR disabled.
pub fn spawn_collection_raptor_rebuild(
    db: sqlx::SqlitePool,
    _library_path: std::sync::Arc<tokio::sync::RwLock<std::path::PathBuf>>,
    collection_id: i64,
) {
    // Check if RAPTOR is enabled before enqueuing — avoid spawning unnecessary jobs
    tokio::spawn(async move {
        let enabled = crate::commands::settings::is_setting_enabled(&db, "raptor_enabled").await;
        if !enabled {
            return;
        }

        // Get collection name for job title
        let name: String = sqlx::query_scalar("SELECT name FROM collections WHERE id = ?")
            .bind(collection_id)
            .fetch_optional(&db)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| format!("Collection {}", collection_id));

        let payload = serde_json::json!({ "collectionId": collection_id });

        // We don't have access to JobQueue here, so insert directly into DB
        let job_id = uuid::Uuid::new_v4().to_string();
        let _ = sqlx::query(
            r#"INSERT INTO jobs (id, job_type, status, title, payload_json, priority)
               VALUES (?, 'rag_collection_raptor', 'pending', ?, ?, 0)"#,
        )
        .bind(&job_id)
        .bind(format!("Cross-doc RAPTOR: {}", name))
        .bind(payload.to_string())
        .execute(&db)
        .await;

        tracing::info!("Enqueued cross-doc RAPTOR job {} for collection {}", job_id, collection_id);
    });
}

