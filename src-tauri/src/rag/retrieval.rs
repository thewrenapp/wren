use serde::Deserialize;

use super::embeddings::{self, EmbeddingConfig};
use super::store::{SearchResult, VectorStore};

/// Dedicated reranker config — a cross-encoder model for relevance scoring.
#[derive(Clone)]
pub struct RerankerConfig {
    pub provider_type: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

/// Search documents using vector similarity with optional reranking.
pub async fn search_documents(
    store: &VectorStore,
    embed_config: &EmbeddingConfig,
    query: &str,
    top_k: usize,
    reranker_config: Option<&RerankerConfig>,
    document_filter: Option<&[String]>,
) -> Result<Vec<SearchResult>, String> {
    let fetch_count = if reranker_config.is_some() {
        top_k * 3
    } else {
        top_k
    };

    // Embed query and search vector store
    let embedding = embeddings::embed_query(embed_config, query)
        .await
        .map_err(|e| format!("Embedding failed: {}", e))?;
    let mut results = store.search(&embedding, fetch_count, document_filter).await?;

    // Filter out any legacy summary nodes (level > 0)
    results.retain(|r| r.level == 0);

    tracing::info!(
        "RAG search: {} results, reranker={}",
        results.len(),
        reranker_config.is_some()
    );

    // Rerank using dedicated cross-encoder if configured
    if let Some(reranker) = reranker_config {
        if results.len() > top_k {
            tracing::info!(
                "Reranking {} candidates with {} -> top {}",
                results.len(),
                reranker.model,
                top_k
            );
            let (reranked, succeeded, _err) =
                rerank_with_cross_encoder(results, query, top_k, reranker, None).await;
            tracing::info!(
                "Reranking {}",
                if succeeded {
                    "succeeded"
                } else {
                    "failed, using original order"
                }
            );
            results = reranked;
        }
    } else {
        results.truncate(top_k);
    }

    Ok(results)
}

// ── Cross-encoder reranking ──────────────────────────────────────

/// Rerank results using a dedicated cross-encoder model via /rerank API.
pub async fn rerank_with_cross_encoder(
    results: Vec<SearchResult>,
    query: &str,
    top_k: usize,
    config: &RerankerConfig,
    shared_client: Option<&reqwest::Client>,
) -> (Vec<SearchResult>, bool, Option<String>) {
    if results.len() <= top_k {
        return (results, false, None);
    }

    let documents: Vec<String> = results
        .iter()
        .map(|r| truncate_str(&r.content, 500).to_string())
        .collect();

    let url = format!("{}/rerank", config.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": config.model,
        "query": query,
        "documents": documents,
        "top_n": top_k,
        "return_documents": false,
    });

    tracing::info!(
        "Reranker: calling {} with model={}, {} documents",
        url,
        config.model,
        documents.len()
    );

    let fallback_client;
    let client = match shared_client {
        Some(c) => c,
        None => {
            fallback_client = reqwest::Client::new();
            &fallback_client
        }
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => match resp.json::<RerankResponse>().await {
            Ok(rerank_resp) => {
                let mut reranked: Vec<SearchResult> = rerank_resp
                    .results
                    .into_iter()
                    .filter_map(|rr| {
                        results.get(rr.index).map(|orig| {
                            let mut result = orig.clone();
                            result.relevance_score = rr.relevance_score;
                            result
                        })
                    })
                    .collect();
                reranked.truncate(top_k);
                (reranked, true, None)
            }
            Err(e) => {
                let reason = format!("Failed to parse response: {}", e);
                tracing::warn!("Reranker: {}", reason);
                (
                    results.into_iter().take(top_k).collect(),
                    false,
                    Some(reason),
                )
            }
        },
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let reason = format!("{} — {}", status, &body[..body.len().min(200)]);
            tracing::warn!("Reranker API error: {}", reason);
            (
                results.into_iter().take(top_k).collect(),
                false,
                Some(reason),
            )
        }
        Err(e) => {
            let reason = format!("Request failed: {}", e);
            tracing::warn!("Reranker: {}", reason);
            (
                results.into_iter().take(top_k).collect(),
                false,
                Some(reason),
            )
        }
    }
}

#[derive(Deserialize)]
struct RerankResponse {
    results: Vec<RerankResult>,
}

#[derive(Deserialize)]
struct RerankResult {
    index: usize,
    relevance_score: f32,
}

// ── Utility ──────────────────────────────────────────────────────

/// Truncate a string to at most `max_bytes` without splitting a multi-byte character.
fn truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}
