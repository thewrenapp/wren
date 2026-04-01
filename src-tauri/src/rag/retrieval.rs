use serde::{Deserialize, Serialize};

use super::embeddings::{self, EmbeddingConfig};
use super::store::{SearchResult, VectorStore};

// ── Search Strategies ────────────────────────────────────────────

/// Search strategy for document retrieval.
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchStrategy {
    #[default]
    Auto,
    Semantic,
    Hyde,
    StepBack,
}

/// Compaction/cheap LLM config — used for HyDE hypothetical answer generation,
/// step-back abstract query generation, and CRAG evaluation.
#[derive(Clone)]
pub struct RagGenModelConfig {
    pub provider_type: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: String,
}

/// Dedicated reranker config — a cross-encoder model for relevance scoring.
#[derive(Clone)]
pub struct RerankerConfig {
    pub provider_type: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

/// Corrective RAG (CRAG) config.
#[derive(Clone)]
pub struct CragConfig {
    pub upper_threshold: f32,
    pub lower_threshold: f32,
    pub enable_query_rewrite: bool,
}

impl Default for CragConfig {
    fn default() -> Self {
        Self {
            upper_threshold: 60.0,
            lower_threshold: 25.0,
            enable_query_rewrite: true,
        }
    }
}

/// RAPTOR retrieval config.
pub struct RaptorRetrievalConfig {
    pub enabled: bool,
    pub token_budget: usize,
}

/// Search documents using vector similarity with optional advanced strategies.
pub async fn search_documents(
    store: &VectorStore,
    embed_config: &EmbeddingConfig,
    query: &str,
    top_k: usize,
    strategy: SearchStrategy,
    rag_gen_config: Option<&RagGenModelConfig>,
    reranker_config: Option<&RerankerConfig>,
    crag_config: Option<&CragConfig>,
    raptor_config: Option<&RaptorRetrievalConfig>,
    document_filter: Option<&[String]>,
) -> Result<Vec<SearchResult>, String> {
    let raptor_active = raptor_config.map(|r| r.enabled).unwrap_or(false);
    let fetch_count = if reranker_config.is_some() || raptor_active {
        top_k * 3
    } else {
        top_k
    };

    // Determine strategy
    let strategy = match strategy {
        SearchStrategy::Auto => auto_detect_strategy(query),
        other => other,
    };
    let strategy_name = match &strategy {
        SearchStrategy::Semantic => "semantic",
        SearchStrategy::Hyde => "hyde",
        SearchStrategy::StepBack => "step_back",
        SearchStrategy::Auto => "auto",
    };

    // Execute search based on strategy
    let mut results = match strategy {
        SearchStrategy::Hyde => {
            search_hyde(store, embed_config, rag_gen_config, query, fetch_count, document_filter).await?
        }
        SearchStrategy::StepBack => {
            search_step_back(store, embed_config, rag_gen_config, query, fetch_count, document_filter).await?
        }
        _ => {
            search_semantic(store, embed_config, query, fetch_count, document_filter).await?
        }
    };

    // Log result level breakdown before filtering
    let level_0 = results.iter().filter(|r| r.level == 0).count();
    let level_1_plus = results.iter().filter(|r| r.level > 0).count();
    tracing::info!(
        "RAG search: {} results (L0={}, L1+={}), strategy={:?}, raptor={}, reranker={}, crag={}",
        results.len(), level_0, level_1_plus,
        strategy_name, raptor_active,
        reranker_config.is_some(), crag_config.is_some()
    );

    // Filter RAPTOR summary nodes if RAPTOR is disabled
    if !raptor_active {
        let before = results.len();
        results.retain(|r| r.level == 0);
        if before != results.len() {
            tracing::info!("RAPTOR disabled: filtered {} summary nodes", before - results.len());
        }
    }

    // RAPTOR token-budget selection FIRST (on full result set, before truncation)
    if raptor_active {
        let budget = raptor_config.map(|r| r.token_budget).unwrap_or(2000);
        let before = results.len();
        if budget > 0 {
            results = super::raptor::select_by_token_budget(results, budget);
            tracing::info!("RAPTOR token budget {}: {} → {} results", budget, before, results.len());
        }
    }

    // Rerank using dedicated cross-encoder if configured
    if let Some(reranker) = reranker_config {
        if results.len() > top_k {
            tracing::info!("Reranking {} candidates with {} → top {}", results.len(), reranker.model, top_k);
            let (reranked, succeeded, _err) = rerank_with_cross_encoder(
                results, query, top_k, reranker, None,
            ).await;
            tracing::info!("Reranking {}", if succeeded { "succeeded" } else { "failed, using original order" });
            results = reranked;
        }
    } else if !raptor_active {
        // Only truncate if RAPTOR didn't already limit results
        results.truncate(top_k);
    }

    // CRAG: Corrective RAG evaluation
    if let (Some(crag), Some(rag_gen)) = (crag_config, rag_gen_config) {
        let eval_count = results.len().min(3);
        if eval_count > 0 {
            // Build snippets for LLM evaluation
            let mut snippets = String::new();
            for (i, r) in results.iter().take(eval_count).enumerate() {
                let preview = if r.content.len() > 500 { &r.content[..500] } else { &r.content };
                snippets.push_str(&format!("\n--- Result {} [{}] ---\n{}\n", i + 1, r.filename, preview));
            }

            let eval_prompt = format!(
                "Rate how relevant these search results are to the query.\n\
                 Score from 1 (completely irrelevant) to 100 (perfectly relevant).\n\
                 Return ONLY a single integer number, nothing else.\n\n\
                 Query: {}\n{}", query, snippets
            );

            match prompt_llm(rag_gen, "You evaluate search result relevance. Return only a number 1-100.", &eval_prompt).await {
                Ok(score_str) => {
                    let score = score_str.trim().parse::<f32>().unwrap_or(50.0).max(1.0).min(100.0);
                    tracing::info!("CRAG: relevance score = {} (upper={}, lower={})", score, crag.upper_threshold, crag.lower_threshold);

                    if score < crag.lower_threshold && crag.enable_query_rewrite {
                        // Query rewrite
                        tracing::info!("CRAG: score below lower threshold, attempting query rewrite");
                        let rewrite_prompt = format!(
                            "The following search query returned low-relevance results from a document collection. \
                             Rewrite it to better match the document content. \
                             Return ONLY the rewritten query, no explanation.\n\nOriginal query: {}", query
                        );
                        if let Ok(rewritten) = prompt_llm(rag_gen, "You rewrite search queries for better retrieval.", &rewrite_prompt).await {
                            let rewritten = rewritten.trim().to_string();
                            tracing::info!("CRAG: rewritten query: {:?}", rewritten);
                            if let Ok(mut retry_results) = search_semantic(store, embed_config, &rewritten, fetch_count, document_filter).await {
                                if let Some(reranker) = reranker_config {
                                    let (reranked, _, _) = rerank_with_cross_encoder(retry_results, &rewritten, top_k, reranker, None).await;
                                    retry_results = reranked;
                                } else {
                                    retry_results.truncate(top_k);
                                }
                                if !retry_results.is_empty() {
                                    results = retry_results;
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("CRAG evaluation failed, using original results: {}", e);
                }
            }
        }
    }

    Ok(results)
}

// ── Strategy implementations ─────────────────────────────────────

fn auto_detect_strategy(query: &str) -> SearchStrategy {
    let q = query.to_lowercase();
    let is_question = q.contains('?')
        || q.starts_with("what ")
        || q.starts_with("how ")
        || q.starts_with("why ")
        || q.starts_with("when ")
        || q.starts_with("where ")
        || q.starts_with("who ")
        || q.starts_with("which ")
        || q.starts_with("explain ")
        || q.starts_with("describe ");

    let is_broad = q.contains("overview")
        || q.contains("summary")
        || q.contains("general")
        || q.contains("main ")
        || q.contains("key ")
        || q.contains("concept");

    if is_question && !is_broad {
        SearchStrategy::Hyde
    } else if is_broad {
        SearchStrategy::StepBack
    } else {
        SearchStrategy::Semantic
    }
}

pub async fn search_semantic(
    store: &VectorStore,
    config: &EmbeddingConfig,
    query: &str,
    top_k: usize,
    document_filter: Option<&[String]>,
) -> Result<Vec<SearchResult>, String> {
    let embedding = embeddings::embed_query(config, query)
        .await
        .map_err(|e| format!("Embedding failed: {}", e))?;
    store
        .search(&embedding, top_k, document_filter)
        .await
}

async fn search_hyde(
    store: &VectorStore,
    config: &EmbeddingConfig,
    rag_gen: Option<&RagGenModelConfig>,
    query: &str,
    top_k: usize,
    document_filter: Option<&[String]>,
) -> Result<Vec<SearchResult>, String> {
    let hyde_text = if let Some(comp) = rag_gen {
        let prompt = format!(
            "Given this question, write a 2-3 paragraph answer as if you had \
             the perfect document in front of you. Be specific and factual.\n\nQuestion: {}",
            query
        );
        match prompt_llm(comp, "You generate hypothetical document content for search retrieval.", &prompt).await {
            Ok(answer) => answer,
            Err(e) => {
                tracing::warn!("HyDE generation failed, falling back to semantic: {}", e);
                return search_semantic(store, config, query, top_k, document_filter).await;
            }
        }
    } else {
        return search_semantic(store, config, query, top_k, document_filter).await;
    };

    let hyde_embedding = embeddings::embed_query(config, &hyde_text).await
        .map_err(|e| format!("HyDE embedding failed: {}", e))?;
    let query_embedding = embeddings::embed_query(config, query).await
        .map_err(|e| format!("Query embedding failed: {}", e))?;

    let hyde_results = store.search(&hyde_embedding, top_k, document_filter).await?;
    let query_results = store.search(&query_embedding, top_k, document_filter).await?;
    Ok(merge_deduplicate(hyde_results, query_results))
}

async fn search_step_back(
    store: &VectorStore,
    config: &EmbeddingConfig,
    rag_gen: Option<&RagGenModelConfig>,
    query: &str,
    top_k: usize,
    document_filter: Option<&[String]>,
) -> Result<Vec<SearchResult>, String> {
    let abstract_query = if let Some(comp) = rag_gen {
        match prompt_llm(
            comp,
            "You generate abstract search queries. Return ONLY the query, no explanation.",
            &format!("Generate a broader, more general version of this question:\n\n{}", query),
        ).await {
            Ok(q) => q.trim().to_string(),
            Err(e) => {
                tracing::warn!("Step-back query generation failed: {}", e);
                query.to_string()
            }
        }
    } else {
        return search_semantic(store, config, query, top_k, document_filter).await;
    };

    let orig_embedding = embeddings::embed_query(config, query).await
        .map_err(|e| format!("Embedding failed: {}", e))?;
    let abstract_embedding = embeddings::embed_query(config, &abstract_query).await
        .map_err(|e| format!("Step-back embedding failed: {}", e))?;

    let orig_results = store.search(&orig_embedding, top_k, document_filter).await?;
    let abstract_results = store.search(&abstract_embedding, top_k / 2, document_filter).await?;
    Ok(merge_deduplicate(orig_results, abstract_results))
}

fn merge_deduplicate(mut a: Vec<SearchResult>, b: Vec<SearchResult>) -> Vec<SearchResult> {
    for result in b {
        if !a.iter().any(|r| r.chunk_id == result.chunk_id) {
            a.push(result);
        }
    }
    a.sort_by(|x, y| y.relevance_score.partial_cmp(&x.relevance_score).unwrap_or(std::cmp::Ordering::Equal));
    a
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

    tracing::info!("Reranker: calling {} with model={}, {} documents", url, config.model, documents.len());

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
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<RerankResponse>().await {
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
                    (results.into_iter().take(top_k).collect(), false, Some(reason))
                }
            }
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let reason = format!("{} — {}", status, &body[..body.len().min(200)]);
            tracing::warn!("Reranker API error: {}", reason);
            (results.into_iter().take(top_k).collect(), false, Some(reason))
        }
        Err(e) => {
            let reason = format!("Request failed: {}", e);
            tracing::warn!("Reranker: {}", reason);
            (results.into_iter().take(top_k).collect(), false, Some(reason))
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

// ── LLM prompting helper ─────────────────────────────────────────

/// Prompt an LLM using wren's provider system.
/// Used for HyDE generation, step-back query rewriting, CRAG evaluation.
pub async fn prompt_llm(
    config: &RagGenModelConfig,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    use crate::llm::provider::{CompletionRequest, ChatMessage, MessageRole};

    let provider = crate::llm::create_provider(
        &config.provider_type,
        config.api_key.clone(),
        config.base_url.clone().unwrap_or_else(|| super::embeddings::default_base_url(&config.provider_type)),
    );

    let request = CompletionRequest {
        model: config.model.clone(),
        messages: vec![
            ChatMessage {
                role: MessageRole::System,
                content: system.to_string(),
                tool_call_id: None,
            },
            ChatMessage {
                role: MessageRole::User,
                content: prompt.to_string(),
                tool_call_id: None,
            },
        ],
        temperature: 0.3,
        max_tokens: Some(1000),
        tools: Vec::new(),
        json_mode: false,
    };

    let timeout_secs = match config.provider_type.as_str() {
        "omlx" | "ollama" => 120,
        _ => 30,
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        provider.complete(request),
    )
    .await
    .map_err(|_| format!("LLM prompt timed out after {}s", timeout_secs))?
    .map_err(|e| format!("LLM prompt failed: {}", e))?;

    result.content.ok_or_else(|| "LLM returned empty response".to_string())
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
