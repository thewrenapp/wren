use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use super::provider::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageRole, ModelInfo,
    ToolCall,
};

/// Ollama provider using native `/api/chat` endpoint.
/// Supports both local Ollama and Ollama Cloud (with optional API key).
pub struct OllamaProvider {
    client: Client,
    api_key: Option<String>,
    base_url: String,
}

impl OllamaProvider {
    pub fn new(api_key: String, base_url: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(1800)) // 30 min — local models can be very slow
            .build()
            .expect("failed to build Ollama HTTP client: TLS backend unavailable");

        let base_url = if base_url.is_empty() {
            "http://localhost:11434".to_string()
        } else {
            // Strip /v1 suffix if user configured the OpenAI-compatible URL
            let trimmed = base_url.trim_end_matches('/');
            trimmed.trim_end_matches("/v1").to_string()
        };

        let api_key = if api_key.is_empty() {
            None
        } else {
            Some(api_key)
        };

        Self {
            client,
            api_key,
            base_url,
        }
    }

    /// Build a request with optional Bearer auth for Ollama Cloud.
    fn request(&self, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.client.post(url);
        if let Some(ref key) = self.api_key {
            req = req.bearer_auth(key);
        }
        req.header("Content-Type", "application/json")
    }

    /// Build a GET request with optional Bearer auth.
    fn get_request(&self, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.client.get(url);
        if let Some(ref key) = self.api_key {
            req = req.bearer_auth(key);
        }
        req
    }
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        let body = build_request_body(&request, false);
        send_request(self, body).await
    }

    async fn complete_with_tools(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, LlmError> {
        if request.tools.is_empty() {
            return self.complete(request).await;
        }
        let body = build_request_body(&request, true);
        send_request(self, body).await
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let url = format!("{}/api/tags", self.base_url);

        let resp = self
            .get_request(&url)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    LlmError::NetworkError(
                        "Cannot connect to Ollama. Is it running?".to_string(),
                    )
                } else {
                    LlmError::NetworkError(e.to_string())
                }
            })?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            return Err(LlmError::AuthError("Invalid API key".to_string()));
        }
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
        }

        let data: OllamaTagsResponse = resp
            .json()
            .await
            .map_err(|e| LlmError::ParseError(e.to_string()))?;

        let mut models: Vec<ModelInfo> = data
            .models
            .into_iter()
            .map(|m| ModelInfo {
                name: m.name.clone(),
                id: m.name,
                model_type: None,
            })
            .collect();

        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    fn name(&self) -> &str {
        "ollama"
    }
}

// ── Model helpers ──────────────────────────────────────────────────

/// Models with built-in thinking that is enabled by default.
/// We disable thinking via `think: false` in the native Ollama API.
/// Full list: https://ollama.com/search?c=thinking
fn has_thinking(model: &str) -> bool {
    let m = model.to_lowercase();
    m.contains("qwen3")
        || m.contains("qwen-3")
        || m.contains("deepseek-r1")
        || m.contains("deepseek-v3")
        || m.contains("qwq")
        || m.contains("glm-4")
        || m.contains("gpt-oss")
        || m.contains("magistral")
        || m.contains("nemotron")
}

// ── Native Ollama API request/response ──────────────────────────────

fn build_request_body(request: &CompletionRequest, include_tools: bool) -> serde_json::Value {
    let messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|m| {
            let mut msg = serde_json::json!({
                "role": match m.role {
                    MessageRole::System => "system",
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::Tool => "tool",
                },
                "content": m.content,
            });
            if let Some(ref id) = m.tool_call_id {
                msg["tool_call_id"] = serde_json::json!(id);
            }
            msg
        })
        .collect();

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "stream": false,
        "options": {
            "temperature": request.temperature,
        },
    });

    // Disable thinking for models that have it enabled by default.
    if has_thinking(&request.model) {
        body["think"] = serde_json::json!(false);
    }

    if let Some(max_tokens) = request.max_tokens {
        body["options"]["num_predict"] = serde_json::json!(max_tokens);
    }

    if request.json_mode && !include_tools {
        body["format"] = serde_json::json!("json");
    }

    if include_tools && !request.tools.is_empty() {
        let tools: Vec<serde_json::Value> = request
            .tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect();
        body["tools"] = serde_json::json!(tools);
    }

    body
}

async fn send_request(
    provider: &OllamaProvider,
    body: serde_json::Value,
) -> Result<CompletionResponse, LlmError> {
    let url = format!("{}/api/chat", provider.base_url);

    let model = body.get("model").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::debug!(
        "[ollama] POST {} | model={} | body_keys={:?}",
        url,
        model,
        body.as_object().map(|o| o.keys().collect::<Vec<_>>()),
    );

    let resp = provider
        .request(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("[ollama] Request failed: {e}");
            if e.is_timeout() {
                LlmError::NetworkError(format!(
                    "Request timed out. The model may still be loading or the document is too large for local inference: {e}"
                ))
            } else if e.is_connect() {
                LlmError::NetworkError(
                    "Cannot connect to Ollama. Is it running?".to_string(),
                )
            } else {
                LlmError::NetworkError(e.to_string())
            }
        })?;

    let status = resp.status();
    tracing::debug!("[ollama] Response status: {status}");

    if status == reqwest::StatusCode::UNAUTHORIZED
        || status == reqwest::StatusCode::FORBIDDEN
    {
        return Err(LlmError::AuthError("Invalid API key".to_string()));
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("[ollama] Error response: {text}");
        return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
    }

    let raw_text = resp
        .text()
        .await
        .map_err(|e| LlmError::ParseError(format!("Failed to read response body: {e}")))?;

    tracing::debug!(
        "[ollama] Raw response ({}ch): {}",
        raw_text.len(),
        &raw_text[..raw_text.len().min(1000)],
    );

    let data: OllamaChatResponse = serde_json::from_str(&raw_text)
        .map_err(|e| {
            tracing::error!("[ollama] Parse error: {e}\nBody: {}", &raw_text[..raw_text.len().min(2000)]);
            LlmError::ParseError(format!("Failed to parse response: {e}\nBody: {}", &raw_text[..raw_text.len().min(500)]))
        })?;

    let content = data
        .message
        .content
        .filter(|c| !c.is_empty());

    let tool_calls: Vec<ToolCall> = data
        .message
        .tool_calls
        .unwrap_or_default()
        .into_iter()
        .filter_map(|tc| {
            Some(ToolCall {
                id: tc.function.name.clone(), // Ollama native API doesn't provide tool call IDs
                name: tc.function.name,
                arguments: tc.function.arguments.unwrap_or(serde_json::Value::Null),
            })
        })
        .collect();

    let prompt_tokens = data.prompt_eval_count.unwrap_or(0);
    let completion_tokens = data.eval_count.unwrap_or(0);

    tracing::debug!(
        "[ollama] Response: content={}ch, tool_calls={}, tokens={}/{}",
        content.as_ref().map(|c| c.len()).unwrap_or(0),
        tool_calls.len(),
        prompt_tokens,
        completion_tokens,
    );

    Ok(CompletionResponse {
        content,
        tool_calls,
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
    })
}

// ── Response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct OllamaChatResponse {
    message: OllamaMessage,
    #[serde(default)]
    prompt_eval_count: Option<u32>,
    #[serde(default)]
    eval_count: Option<u32>,
}

#[derive(Deserialize)]
struct OllamaMessage {
    content: Option<String>,
    tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Deserialize)]
struct OllamaToolCall {
    function: OllamaFunction,
}

#[derive(Deserialize)]
struct OllamaFunction {
    name: String,
    arguments: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}
