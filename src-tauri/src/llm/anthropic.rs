use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use super::provider::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageRole, ModelInfo,
    ToolCall,
};

/// Anthropic Claude API provider.
pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    base_url: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, base_url: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to build HTTP client");

        let base_url = if base_url.is_empty() {
            "https://api.anthropic.com/v1".to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };

        Self {
            client,
            api_key,
            base_url,
        }
    }
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
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
        // Anthropic doesn't have a public model listing API, so return known models.
        Ok(vec![
            ModelInfo {
                id: "claude-sonnet-4-20250514".to_string(),
                name: "Claude Sonnet 4".to_string(),
            },
            ModelInfo {
                id: "claude-haiku-4-20250414".to_string(),
                name: "Claude Haiku 4".to_string(),
            },
            ModelInfo {
                id: "claude-3-5-sonnet-20241022".to_string(),
                name: "Claude 3.5 Sonnet".to_string(),
            },
            ModelInfo {
                id: "claude-3-5-haiku-20241022".to_string(),
                name: "Claude 3.5 Haiku".to_string(),
            },
        ])
    }

    fn name(&self) -> &str {
        "anthropic"
    }
}

// ── Request building ────────────────────────────────────────────────

fn build_request_body(request: &CompletionRequest, include_tools: bool) -> serde_json::Value {
    // Anthropic separates system messages from the messages array.
    let mut system_text = String::new();
    let mut messages: Vec<serde_json::Value> = Vec::new();

    for msg in &request.messages {
        match msg.role {
            MessageRole::System => {
                if !system_text.is_empty() {
                    system_text.push('\n');
                }
                system_text.push_str(&msg.content);
            }
            MessageRole::User => {
                messages.push(serde_json::json!({
                    "role": "user",
                    "content": msg.content,
                }));
            }
            MessageRole::Assistant => {
                messages.push(serde_json::json!({
                    "role": "assistant",
                    "content": msg.content,
                }));
            }
            MessageRole::Tool => {
                // Anthropic tool results are user messages with tool_result content blocks.
                messages.push(serde_json::json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.tool_call_id.as_deref().unwrap_or(""),
                        "content": msg.content,
                    }],
                }));
            }
        }
    }

    let max_tokens = request.max_tokens.unwrap_or(4096);

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": request.temperature,
    });

    if !system_text.is_empty() {
        body["system"] = serde_json::json!(system_text);
    }

    if include_tools && !request.tools.is_empty() {
        let tools: Vec<serde_json::Value> = request
            .tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
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
    let url = format!("{base_url}/messages");

    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                LlmError::NetworkError(format!("Request timed out: {e}"))
            } else if e.is_connect() {
                LlmError::NetworkError(format!("Connection failed: {e}"))
            } else {
                LlmError::NetworkError(e.to_string())
            }
        })?;

    let status = resp.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(LlmError::AuthError("Invalid API key".to_string()));
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::RateLimited(text));
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
    }

    let data: AnthropicResponse = resp
        .json()
        .await
        .map_err(|e| LlmError::ParseError(format!("Failed to parse response: {e}")))?;

    // Extract text content and tool calls from content blocks.
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();

    for block in &data.content {
        match block.block_type.as_str() {
            "text" => {
                if let Some(ref text) = block.text {
                    text_parts.push(text.clone());
                }
            }
            "tool_use" => {
                tool_calls.push(ToolCall {
                    id: block.id.clone().unwrap_or_default(),
                    name: block.name.clone().unwrap_or_default(),
                    arguments: block.input.clone().unwrap_or(serde_json::Value::Null),
                });
            }
            _ => {}
        }
    }

    let content = if text_parts.is_empty() {
        None
    } else {
        Some(text_parts.join(""))
    };

    let prompt_tokens = data.usage.input_tokens;
    let completion_tokens = data.usage.output_tokens;

    Ok(CompletionResponse {
        content,
        tool_calls,
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
    })
}

// ── API response types ──────────────────────────────────────────────

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
    usage: AnthropicUsage,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    /// Present for "text" blocks.
    text: Option<String>,
    /// Present for "tool_use" blocks.
    id: Option<String>,
    name: Option<String>,
    input: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
}
