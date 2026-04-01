use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use super::provider::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageRole,
    ModelInfo, ToolCall,
};

/// OpenAI-compatible LLM provider.
///
/// Works with OpenAI API and any OpenAI-compatible endpoint (e.g., future Ollama).
pub struct OpenAiProvider {
    client: Client,
    api_key: String,
    base_url: String,
}

impl OpenAiProvider {
    pub fn new(api_key: String, base_url: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        let body = build_request_body(&request, false);
        send_request(&self.client, &self.api_key, &self.base_url, body).await
    }

    async fn complete_with_tools(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, LlmError> {
        if request.tools.is_empty() {
            return self.complete(request).await;
        }
        let body = build_request_body(&request, true);
        send_request(&self.client, &self.api_key, &self.base_url, body).await
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let url = format!("{}/models", self.base_url);
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await
            .map_err(|e| LlmError::NetworkError(e.to_string()))?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(LlmError::AuthError("Invalid API key".to_string()));
        }
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
        }

        let data: ModelsResponse = resp
            .json()
            .await
            .map_err(|e| LlmError::ParseError(e.to_string()))?;

        let mut models: Vec<ModelInfo> = data
            .data
            .into_iter()
            .filter(|m| is_chat_model(&m.id))
            .map(|m| ModelInfo {
                name: m.id.clone(),
                id: m.id,
                model_type: None,
            })
            .collect();

        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    fn name(&self) -> &str {
        "openai"
    }
}

// ── Model capability helpers ────────────────────────────────────────

/// Reasoning models (o-series, gpt-5) only accept the default temperature (1).
fn supports_temperature(model: &str) -> bool {
    !is_reasoning_model(model)
}

/// Check if this is a reasoning model (o-series, gpt-5).
/// These models spend completion tokens on internal chain-of-thought,
/// so low max_completion_tokens can result in empty output.
fn is_reasoning_model(model: &str) -> bool {
    let m = model.to_lowercase();
    if m.starts_with("o1") || m.starts_with("o3") || m.starts_with("o4") {
        return true;
    }
    // gpt-5, gpt-5-mini, gpt-5-nano are reasoning models.
    // gpt-5.1, gpt-5.1-mini, gpt-5.1-nano are NOT reasoning.
    if m.starts_with("gpt-5") && !m.starts_with("gpt-5.1") {
        return true;
    }
    false
}

/// Legacy models (gpt-3.5, gpt-4 non-o) use `max_tokens`.
/// Newer models (gpt-4o, gpt-5, o-series) use `max_completion_tokens`.
fn uses_legacy_max_tokens(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("gpt-3.5") || m.starts_with("gpt-4-") || m == "gpt-4"
}

/// Models that support reasoning but we want to use in non-reasoning mode.
/// These get `reasoning.effort = "none"` to disable chain-of-thought.
fn has_optional_reasoning(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("gpt-5.1")
}

/// Reasoning models use "developer" role instead of "system".
fn uses_developer_role(model: &str) -> bool {
    is_reasoning_model(model)
}

// ── Request building ────────────────────────────────────────────────

fn build_request_body(request: &CompletionRequest, include_tools: bool) -> serde_json::Value {
    let model = &request.model;
    let dev_role = uses_developer_role(model);

    let messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|m| {
            let role = match m.role {
                MessageRole::System => if dev_role { "developer" } else { "system" },
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
            };
            let mut msg = serde_json::json!({
                "role": role,
                "content": m.content,
            });
            if let Some(ref id) = m.tool_call_id {
                msg["tool_call_id"] = serde_json::json!(id);
            }
            msg
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
    });

    // Only include temperature for models that support it
    if supports_temperature(model) {
        body["temperature"] = serde_json::json!(request.temperature);
    }

    if let Some(max_tokens) = request.max_tokens {
        if uses_legacy_max_tokens(model) {
            body["max_tokens"] = serde_json::json!(max_tokens);
        } else if is_reasoning_model(model) {
            // Reasoning models spend completion tokens on chain-of-thought.
            // A low cap causes empty output (finish_reason: "length").
            // Omit the limit entirely so the model can think + respond.
        } else {
            body["max_completion_tokens"] = serde_json::json!(max_tokens);
        }
    }

    // Disable reasoning for models that have it on by default (e.g. gpt-5.1)
    // so they behave as plain chat models and don't burn tokens on thinking.
    if has_optional_reasoning(model) {
        body["reasoning"] = serde_json::json!({"effort": "none"});
    }

    if request.json_mode && !include_tools {
        body["response_format"] = serde_json::json!({"type": "json_object"});
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
    client: &Client,
    api_key: &str,
    base_url: &str,
    body: serde_json::Value,
) -> Result<CompletionResponse, LlmError> {
    let url = format!("{base_url}/chat/completions");

    let model = body.get("model").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::debug!(
        "[openai] POST {} | model={} | body_keys={:?}",
        url,
        model,
        body.as_object().map(|o| o.keys().collect::<Vec<_>>()),
    );

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("[openai] Request failed: {e}");
            if e.is_timeout() {
                LlmError::NetworkError(format!("Request timed out: {e}"))
            } else if e.is_connect() {
                LlmError::NetworkError(format!("Connection failed: {e}"))
            } else {
                LlmError::NetworkError(e.to_string())
            }
        })?;

    let status = resp.status();
    tracing::debug!("[openai] Response status: {status}");

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(LlmError::AuthError("Invalid API key".to_string()));
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::RateLimited(text));
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("[openai] Error response: {text}");
        return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
    }

    let raw_text = resp
        .text()
        .await
        .map_err(|e| LlmError::ParseError(format!("Failed to read response body: {e}")))?;

    tracing::debug!(
        "[openai] Raw response ({}ch): {}",
        raw_text.len(),
        &raw_text[..raw_text.len().min(1000)],
    );

    let data: ChatCompletionResponse = serde_json::from_str(&raw_text)
        .map_err(|e| {
            tracing::error!("[openai] Parse error: {e}\nBody: {}", &raw_text[..raw_text.len().min(2000)]);
            LlmError::ParseError(format!("Failed to parse response: {e}\nBody: {}", &raw_text[..raw_text.len().min(500)]))
        })?;

    let choice = data
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| LlmError::ParseError("No choices in response".to_string()))?;

    let content = choice.message.content;

    let tool_calls: Vec<ToolCall> = choice
        .message
        .tool_calls
        .unwrap_or_default()
        .into_iter()
        .filter_map(|tc| {
            let args: serde_json::Value =
                serde_json::from_str(&tc.function.arguments).unwrap_or(serde_json::Value::Null);
            Some(ToolCall {
                id: tc.id,
                name: tc.function.name,
                arguments: args,
            })
        })
        .collect();

    tracing::debug!(
        "[openai] Response: content={}ch, tool_calls={}, tokens={}/{}",
        content.as_ref().map(|c| c.len()).unwrap_or(0),
        tool_calls.len(),
        data.usage.prompt_tokens,
        data.usage.completion_tokens,
    );

    Ok(CompletionResponse {
        content,
        tool_calls,
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
    })
}

/// Filter to only include text chat/reasoning models.
/// Excludes: audio, realtime, transcribe, search, image,
/// preview/dated snapshots, and legacy models.
fn is_chat_model(id: &str) -> bool {
    let m = id.to_lowercase();

    // Allow GPT models and o-series reasoning models
    if !m.contains("gpt") && !m.starts_with("o1") && !m.starts_with("o3") && !m.starts_with("o4") {
        return false;
    }

    // Exclude non-chat capabilities
    if m.contains("audio")
        || m.contains("realtime")
        || m.contains("transcribe")
        || m.contains("search")
        || m.contains("image")
        || m.contains("embedding")
        || m.contains("moderation")
        || m.contains("whisper")
        || m.contains("tts")
        || m.contains("dall-e")
        || m.contains("davinci")
        || m.contains("babbage")
        || m.contains("instruct")
    {
        return false;
    }

    // Exclude dated snapshots and previews — keep only clean base names
    // (e.g. "gpt-4o-mini" yes, "gpt-4o-mini-2024-07-18" no)
    if m.contains("preview") || m.contains("-202") {
        return false;
    }

    true
}

// ── API response types ──────────────────────────────────────────────

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
    usage: Usage,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: Option<String>,
    tool_calls: Option<Vec<ResponseToolCall>>,
}

#[derive(Deserialize)]
struct ResponseToolCall {
    id: String,
    function: FunctionCall,
}

#[derive(Deserialize)]
struct FunctionCall {
    name: String,
    arguments: String,
}

#[derive(Deserialize)]
struct Usage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelData>,
}

#[derive(Deserialize)]
struct ModelData {
    id: String,
}
