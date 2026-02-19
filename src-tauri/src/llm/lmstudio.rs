use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use super::provider::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageRole, ModelInfo,
    ToolCall,
};

/// LM Studio provider using OpenAI-compatible API.
pub struct LmStudioProvider {
    client: Client,
    base_url: String,
}

impl LmStudioProvider {
    pub fn new(base_url: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(1800)) // 30 min — local models can be very slow
            .build()
            .expect("Failed to build HTTP client");

        let base_url = if base_url.is_empty() {
            "http://localhost:1234/v1".to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };

        Self { client, base_url }
    }
}

#[async_trait]
impl LlmProvider for LmStudioProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        let body = build_request_body(&request, false);
        send_request(&self.client, &self.base_url, body).await
    }

    async fn complete_with_tools(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, LlmError> {
        if request.tools.is_empty() {
            return self.complete(request).await;
        }
        let body = build_request_body(&request, true);
        send_request(&self.client, &self.base_url, body).await
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let url = format!("{}/models", self.base_url);

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    LlmError::NetworkError(
                        "Cannot connect to LM Studio. Is it running?".to_string(),
                    )
                } else {
                    LlmError::NetworkError(e.to_string())
                }
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(LlmError::ApiError(format!("Failed to list models: {text}")));
        }

        let data: ModelsResponse = resp
            .json()
            .await
            .map_err(|e| LlmError::ParseError(e.to_string()))?;

        let mut models: Vec<ModelInfo> = data
            .data
            .into_iter()
            .map(|m| ModelInfo {
                name: m.id.clone(),
                id: m.id,
            })
            .collect();

        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    fn name(&self) -> &str {
        "lmstudio"
    }
}

// ── Model helpers ──────────────────────────────────────────────────

/// Models with built-in thinking that is enabled by default.
/// LM Studio supports `enable_thinking: false` to disable it.
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

// ── OpenAI-compatible request building ──────────────────────────────

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
        "temperature": request.temperature,
        "stream": false,
    });

    // Disable thinking for models that have it enabled by default.
    if has_thinking(&request.model) {
        body["enable_thinking"] = serde_json::json!(false);
    }

    if let Some(max_tokens) = request.max_tokens {
        body["max_tokens"] = serde_json::json!(max_tokens);
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
    base_url: &str,
    body: serde_json::Value,
) -> Result<CompletionResponse, LlmError> {
    let url = format!("{base_url}/chat/completions");

    let model = body.get("model").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::debug!(
        "[lmstudio] POST {} | model={} | body_keys={:?}",
        url,
        model,
        body.as_object().map(|o| o.keys().collect::<Vec<_>>()),
    );

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("[lmstudio] Request failed: {e}");
            if e.is_timeout() {
                LlmError::NetworkError(format!("Request timed out: {e}"))
            } else if e.is_connect() {
                LlmError::NetworkError(
                    "Cannot connect to LM Studio. Is it running?".to_string(),
                )
            } else {
                LlmError::NetworkError(e.to_string())
            }
        })?;

    let status = resp.status();
    tracing::debug!("[lmstudio] Response status: {status}");

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("[lmstudio] Error response: {text}");
        return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
    }

    let raw_text = resp
        .text()
        .await
        .map_err(|e| LlmError::ParseError(format!("Failed to read response body: {e}")))?;

    tracing::debug!(
        "[lmstudio] Raw response ({}ch): {}",
        raw_text.len(),
        &raw_text[..raw_text.len().min(1000)],
    );

    let data: OpenAiResponse = serde_json::from_str(&raw_text)
        .map_err(|e| {
            tracing::error!("[lmstudio] Parse error: {e}\nBody: {}", &raw_text[..raw_text.len().min(2000)]);
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

    let (prompt_tokens, completion_tokens, total_tokens) = if let Some(usage) = data.usage {
        (
            usage.prompt_tokens,
            usage.completion_tokens,
            usage.total_tokens,
        )
    } else {
        (0, 0, 0)
    };

    tracing::debug!(
        "[lmstudio] Response: content={}ch, tool_calls={}, tokens={}/{}",
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
        total_tokens,
    })
}

// ── Response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OaiChoice>,
    usage: Option<OaiUsage>,
}

#[derive(Deserialize)]
struct OaiChoice {
    message: OaiMessage,
}

#[derive(Deserialize)]
struct OaiMessage {
    content: Option<String>,
    tool_calls: Option<Vec<OaiToolCall>>,
}

#[derive(Deserialize)]
struct OaiToolCall {
    id: String,
    function: OaiFunction,
}

#[derive(Deserialize)]
struct OaiFunction {
    name: String,
    arguments: String,
}

#[derive(Deserialize)]
struct OaiUsage {
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
