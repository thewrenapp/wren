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
            .timeout(std::time::Duration::from_secs(300)) // longer timeout for local models
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
    });

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

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
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

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
    }

    let data: OpenAiResponse = resp
        .json()
        .await
        .map_err(|e| LlmError::ParseError(format!("Failed to parse response: {e}")))?;

    let choice = data
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| LlmError::ParseError("No choices in response".to_string()))?;

    let content = choice.message.content;

    let tool_calls = choice
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
