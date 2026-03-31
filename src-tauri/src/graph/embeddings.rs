use anyhow::Result;
use std::sync::{Arc, Mutex, OnceLock};

/// Embedding provider configuration.
pub enum EmbeddingProvider {
    /// Local fastembed model (runs locally)
    Local {
        model_enum: fastembed::EmbeddingModel,
    },
    /// Cloud-based embedding via the LLM provider's API
    Cloud {
        provider: String,
        model: String,
        api_key: String,
        base_url: String,
    },
}

/// Map a settings string (from the frontend dropdown) to a fastembed model enum + dimensions.
fn resolve_local_model(model_name: &str) -> (fastembed::EmbeddingModel, usize) {
    use fastembed::EmbeddingModel::*;
    match model_name {
        // English — Fast
        "all-MiniLM-L6-v2" => (AllMiniLML6V2, 384),
        "all-MiniLM-L12-v2" => (AllMiniLML12V2, 384),
        "snowflake-arctic-embed-xs" => (SnowflakeArcticEmbedXS, 384),
        // English — Quality
        "bge-small-en-v1.5" => (BGESmallENV15, 384),
        "bge-base-en-v1.5" => (BGEBaseENV15, 768),
        "bge-large-en-v1.5" => (BGELargeENV15, 1024),
        "gte-base-en-v1.5" => (GTEBaseENV15, 768),
        "gte-large-en-v1.5" => (GTELargeENV15, 1024),
        "snowflake-arctic-embed-m" => (SnowflakeArcticEmbedM, 768),
        "snowflake-arctic-embed-l" => (SnowflakeArcticEmbedL, 1024),
        "mxbai-embed-large-v1" => (MxbaiEmbedLargeV1, 1024),
        // English — Long Context
        "nomic-embed-text-v1.5" => (NomicEmbedTextV15, 768),
        "jina-embeddings-v2-base-en" => (JinaEmbeddingsV2BaseEN, 768),
        "snowflake-arctic-embed-m-long" => (SnowflakeArcticEmbedMLong, 768),
        // Multilingual
        "bge-m3" => (BGEM3, 1024),
        "multilingual-e5-small" => (MultilingualE5Small, 384),
        "multilingual-e5-base" => (MultilingualE5Base, 768),
        "multilingual-e5-large" => (MultilingualE5Large, 1024),
        "paraphrase-ml-minilm-l12-v2" => (ParaphraseMLMiniLML12V2, 384),
        // Code
        "jina-embeddings-v2-base-code" => (JinaEmbeddingsV2BaseCode, 768),
        // Default fallback
        _ => {
            tracing::warn!("Unknown embedding model '{}', falling back to all-MiniLM-L6-v2", model_name);
            (AllMiniLML6V2, 384)
        }
    }
}

/// Resolve the vector dimensions for a cloud embedding model.
pub fn resolve_cloud_model_dims(provider: &str, model: &str) -> usize {
    match (provider, model) {
        // OpenAI
        ("openai", "text-embedding-3-small") => 1536,
        ("openai", "text-embedding-3-large") => 3072,
        ("openai", "text-embedding-ada-002") => 1536,
        // Gemini
        ("gemini", "text-embedding-004") => 768,
        // Ollama / LMStudio common models
        (_, m) if m.contains("nomic-embed-text") => 768,
        (_, m) if m.contains("mxbai-embed-large") => 1024,
        (_, m) if m.contains("all-minilm") => 384,
        (_, m) if m.contains("snowflake-arctic-embed") => 1024,
        (_, m) if m.contains("bge-m3") => 1024,
        (_, m) if m.contains("bge-large") => 1024,
        (_, m) if m.contains("bge-base") => 768,
        (_, m) if m.contains("bge-small") => 384,
        // Safe default for unknown models
        _ => {
            tracing::warn!(
                "Unknown cloud embedding model '{}' for provider '{}', assuming 768 dims",
                model, provider
            );
            768
        }
    }
}

/// Service for generating text embeddings.
///
/// Lazy-initializes the fastembed model on first use (downloads ONNX weights).
/// Configurable to use cloud embeddings instead.
pub struct EmbeddingService {
    local_model: OnceLock<Arc<Mutex<fastembed::TextEmbedding>>>,
    provider: EmbeddingProvider,
    dims: usize,
}

impl EmbeddingService {
    /// Create a service using a local fastembed model.
    /// `model_name` should match one of the frontend dropdown values (e.g. "all-MiniLM-L6-v2").
    pub fn new_local(model_name: &str) -> Result<Self> {
        let (model_enum, dims) = resolve_local_model(model_name);
        tracing::info!("Embedding model configured: {} ({} dims)", model_name, dims);
        Ok(Self {
            local_model: OnceLock::new(),
            provider: EmbeddingProvider::Local { model_enum },
            dims,
        })
    }

    /// Create a service using cloud embeddings.
    pub fn new_cloud(
        provider: String,
        model: String,
        api_key: String,
        base_url: String,
        dimensions: usize,
    ) -> Result<Self> {
        Ok(Self {
            local_model: OnceLock::new(),
            provider: EmbeddingProvider::Cloud {
                provider,
                model,
                api_key,
                base_url,
            },
            dims: dimensions,
        })
    }

    /// Vector dimensionality for this embedding model.
    pub fn dimensions(&self) -> usize {
        self.dims
    }

    /// Embed a batch of texts. Returns one vector per input text.
    pub async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        match &self.provider {
            EmbeddingProvider::Local { .. } => self.embed_local(texts).await,
            EmbeddingProvider::Cloud {
                provider,
                model,
                api_key,
                base_url,
            } => {
                self.embed_cloud(texts, provider, model, api_key, base_url)
                    .await
            }
        }
    }

    /// Embed a single text.
    pub async fn embed_one(&self, text: &str) -> Result<Vec<f32>> {
        let results = self.embed_batch(&[text.to_string()]).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("Empty embedding result"))
    }

    /// Initialize or retrieve the local fastembed model.
    fn get_local_model(&self) -> Result<Arc<Mutex<fastembed::TextEmbedding>>> {
        if let Some(model) = self.local_model.get() {
            return Ok(Arc::clone(model));
        }

        let model_enum = match &self.provider {
            EmbeddingProvider::Local { model_enum } => model_enum.clone(),
            _ => fastembed::EmbeddingModel::AllMiniLML6V2,
        };

        tracing::info!("Initializing fastembed model ({:?})...", model_enum);
        let init_options = fastembed::InitOptions::new(model_enum)
            .with_show_download_progress(true);
        let model = fastembed::TextEmbedding::try_new(init_options)
            .map_err(|e| anyhow::anyhow!("Failed to initialize fastembed: {e}"))?;

        let arc = Arc::new(Mutex::new(model));
        // set() returns Err if another thread beat us — that's fine
        let _ = self.local_model.set(Arc::clone(&arc));
        Ok(self.local_model.get().map(Arc::clone).unwrap_or(arc))
    }

    /// Local embedding via fastembed (runs on blocking thread pool).
    async fn embed_local(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let model = self.get_local_model()?;
        let texts_owned: Vec<String> = texts.to_vec();

        // fastembed 5 embed() requires &mut self; run on blocking pool via Arc<Mutex<>>
        let embeddings = tokio::task::spawn_blocking(move || {
            let mut guard = model.lock().map_err(|e| anyhow::anyhow!("Mutex poisoned: {e}"))?;
            guard
                .embed(&texts_owned, None)
                .map_err(|e| anyhow::anyhow!("Embedding failed: {e}"))
        })
        .await??;

        Ok(embeddings)
    }

    /// Cloud embedding via provider API.
    async fn embed_cloud(
        &self,
        texts: &[String],
        provider: &str,
        model: &str,
        api_key: &str,
        base_url: &str,
    ) -> Result<Vec<Vec<f32>>> {
        if provider == "gemini" {
            return self.embed_cloud_gemini(texts, model, api_key).await;
        }

        // OpenAI-compatible format (works for OpenAI, Ollama, LMStudio, etc.)
        let url = format!("{}/embeddings", base_url.trim_end_matches('/'));

        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "model": model,
            "input": texts,
        });

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Embedding API error ({status}): {text}");
        }

        let json: serde_json::Value = resp.json().await?;

        // Parse OpenAI-compatible response: { data: [{ embedding: [...] }] }
        let data = json["data"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("Missing 'data' in embedding response"))?;

        let mut vectors = Vec::with_capacity(data.len());
        for item in data {
            let embedding = item["embedding"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("Missing 'embedding' in response item"))?;

            let vec: Vec<f32> = embedding
                .iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect();
            vectors.push(vec);
        }

        Ok(vectors)
    }

    /// Gemini embedding via Google's batchEmbedContents API.
    async fn embed_cloud_gemini(
        &self,
        texts: &[String],
        model: &str,
        api_key: &str,
    ) -> Result<Vec<Vec<f32>>> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:batchEmbedContents?key={}",
            model, api_key
        );

        let requests: Vec<serde_json::Value> = texts
            .iter()
            .map(|text| {
                serde_json::json!({
                    "model": format!("models/{}", model),
                    "content": { "parts": [{ "text": text }] }
                })
            })
            .collect();

        let body = serde_json::json!({ "requests": requests });
        let client = reqwest::Client::new();

        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Gemini embedding API error ({status}): {text}");
        }

        let json: serde_json::Value = resp.json().await?;

        // Parse Gemini response: { embeddings: [{ values: [...] }] }
        let embeddings = json["embeddings"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("Missing 'embeddings' in Gemini response"))?;

        let mut vectors = Vec::with_capacity(embeddings.len());
        for item in embeddings {
            let values = item["values"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("Missing 'values' in Gemini embedding item"))?;

            let vec: Vec<f32> = values
                .iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect();
            vectors.push(vec);
        }

        Ok(vectors)
    }
}
