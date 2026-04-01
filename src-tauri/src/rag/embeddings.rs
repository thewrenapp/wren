use serde::Deserialize;

/// Embedding provider configuration.
#[derive(Debug, Clone)]
pub struct EmbeddingConfig {
    pub provider_type: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

/// Result of an embedding operation.
pub struct EmbeddingResult {
    pub embeddings: Vec<Vec<f32>>,
    pub model: String,
    pub dimension: usize,
    pub total_tokens: i64,
}

/// Resolve embedding config from wren's settings.
pub async fn resolve_embedding_config(
    db: &sqlx::SqlitePool,
) -> Result<EmbeddingConfig, String> {
    let provider_type = get_setting(db, "llm_provider")
        .await
        .unwrap_or_else(|| "openai".to_string());

    let model = get_setting(db, "cloud_embedding_model")
        .await
        .unwrap_or_else(|| "text-embedding-3-small".to_string());

    let api_key = get_setting(db, &format!("llm_api_key_{}", provider_type))
        .await
        .unwrap_or_default();

    let base_url = get_setting(db, "llm_base_url")
        .await
        .unwrap_or_else(|| default_base_url(&provider_type));

    Ok(EmbeddingConfig {
        provider_type,
        api_key,
        base_url,
        model,
    })
}

pub fn default_base_url(provider: &str) -> String {
    match provider {
        "openai" => "https://api.openai.com/v1".to_string(),
        "gemini" => "https://generativelanguage.googleapis.com/v1beta".to_string(),
        "ollama" => "http://localhost:11434".to_string(),
        "omlx" | "lmstudio" => "http://localhost:1234/v1".to_string(),
        "cohere" => "https://api.cohere.ai/v1".to_string(),
        "jina" => "https://api.jina.ai/v1".to_string(),
        "voyage" => "https://api.voyageai.com/v1".to_string(),
        "together" => "https://api.together.xyz/v1".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

async fn get_setting(db: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}

/// Embed a batch of texts using the configured embedding provider.
pub async fn embed_batch(
    config: &EmbeddingConfig,
    texts: &[String],
) -> Result<EmbeddingResult, String> {
    if texts.is_empty() {
        return Ok(EmbeddingResult {
            embeddings: Vec::new(),
            model: config.model.clone(),
            dimension: 0,
            total_tokens: 0,
        });
    }

    // Gemini uses a different API format
    if config.provider_type == "gemini" {
        return embed_batch_gemini(config, texts).await;
    }

    // OpenAI-compatible API (works for OpenAI, Ollama, oMLX, Cohere, Jina, Voyage, Together, etc.)
    let url = format!("{}/embeddings", config.base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 min for local models
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let body = serde_json::json!({
        "model": config.model,
        "input": texts,
    });

    // Retry with exponential backoff for transient errors
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            let delay = std::time::Duration::from_millis(1000 * 2u64.pow(attempt as u32));
            tokio::time::sleep(delay).await;
        }

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                let data: OpenAiEmbeddingResponse = r
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

                let dimension = data.data.first().map(|d| d.embedding.len()).unwrap_or(0);
                let total_tokens = data.usage.map(|u| u.total_tokens).unwrap_or(0);

                let embeddings: Vec<Vec<f32>> = data.data.into_iter().map(|d| d.embedding).collect();

                return Ok(EmbeddingResult {
                    embeddings,
                    model: config.model.clone(),
                    dimension,
                    total_tokens,
                });
            }
            Ok(r) => {
                let status = r.status().as_u16();
                let body = r.text().await.unwrap_or_default();
                last_error = format!("HTTP {}: {}", status, &body[..body.len().min(500)]);

                // Only retry on transient errors
                if !matches!(status, 429 | 500 | 502 | 503 | 504) {
                    return Err(format!("Embedding API error: {}", last_error));
                }
                tracing::warn!("Embedding attempt {} failed (retryable): {}", attempt + 1, last_error);
            }
            Err(e) => {
                last_error = e.to_string();
                tracing::warn!("Embedding attempt {} failed: {}", attempt + 1, last_error);
            }
        }
    }

    Err(format!("Embedding failed after 3 attempts: {}", last_error))
}

/// Embed a single query text.
pub async fn embed_query(
    config: &EmbeddingConfig,
    text: &str,
) -> Result<Vec<f32>, String> {
    let result = embed_batch(config, &[text.to_string()]).await?;
    result
        .embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "No embedding returned".to_string())
}

/// Probe the embedding model's dimension by sending a test request.
pub async fn probe_dimension(config: &EmbeddingConfig) -> Result<usize, String> {
    let result = embed_batch(config, &["dimension probe".to_string()]).await?;
    if result.dimension == 0 {
        return Err("Dimension probe returned 0".to_string());
    }
    Ok(result.dimension)
}

/// Known embedding dimensions for common models (fallback if probe fails).
pub fn known_dimension(provider: &str, model: &str) -> Option<usize> {
    match (provider, model) {
        ("openai", "text-embedding-3-small") => Some(1536),
        ("openai", "text-embedding-3-large") => Some(3072),
        ("openai", "text-embedding-ada-002") => Some(1536),
        ("gemini", "text-embedding-004") => Some(768),
        ("cohere", m) if m.contains("embed-english-v3") => Some(1024),
        ("jina", "jina-embeddings-v3") => Some(1024),
        ("jina", "jina-embeddings-v2-base-en") => Some(768),
        ("voyage", m) if m.contains("voyage-3") => Some(1024),
        (_, m) if m.contains("nomic-embed-text") => Some(768),
        (_, m) if m.contains("mxbai-embed-large") => Some(1024),
        (_, m) if m.contains("all-minilm") || m.contains("all-MiniLM") => Some(384),
        (_, m) if m.contains("snowflake-arctic") => Some(1024),
        (_, m) if m.contains("bge-large") => Some(1024),
        (_, m) if m.contains("bge-m3") => Some(1024),
        _ => None,
    }
}

// ── Gemini embedding API ─────────────────────────────────────────

async fn embed_batch_gemini(
    config: &EmbeddingConfig,
    texts: &[String],
) -> Result<EmbeddingResult, String> {
    let url = format!(
        "{}/models/{}:batchEmbedContents?key={}",
        config.base_url.trim_end_matches('/'),
        config.model,
        config.api_key,
    );

    let requests: Vec<serde_json::Value> = texts
        .iter()
        .map(|t| {
            serde_json::json!({
                "model": format!("models/{}", config.model),
                "content": { "parts": [{ "text": t }] },
            })
        })
        .collect();

    let body = serde_json::json!({ "requests": requests });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini embedding request failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini embedding error: {}", &body[..body.len().min(500)]));
    }

    let data: GeminiEmbeddingResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini embedding response: {}", e))?;

    let embeddings: Vec<Vec<f32>> = data
        .embeddings
        .into_iter()
        .map(|e| e.values)
        .collect();

    let dimension = embeddings.first().map(|e| e.len()).unwrap_or(0);

    Ok(EmbeddingResult {
        embeddings,
        model: config.model.clone(),
        dimension,
        total_tokens: 0,
    })
}

// ── Response types ───────────────────────────────────────────────

#[derive(Deserialize)]
struct OpenAiEmbeddingResponse {
    data: Vec<EmbeddingData>,
    usage: Option<EmbeddingUsage>,
}

#[derive(Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingUsage {
    total_tokens: i64,
}

#[derive(Deserialize)]
struct GeminiEmbeddingResponse {
    embeddings: Vec<GeminiEmbedding>,
}

#[derive(Deserialize)]
struct GeminiEmbedding {
    values: Vec<f32>,
}
