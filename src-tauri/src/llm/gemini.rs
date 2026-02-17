use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use super::provider::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageRole, ModelInfo,
    ToolCall,
};

/// Google Gemini API provider.
pub struct GeminiProvider {
    client: Client,
    api_key: String,
    base_url: String,
}

impl GeminiProvider {
    pub fn new(api_key: String, base_url: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to build HTTP client");

        let base_url = if base_url.is_empty() {
            "https://generativelanguage.googleapis.com/v1beta".to_string()
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
impl LlmProvider for GeminiProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        let body = build_request_body(&request, false);
        send_request(
            &self.client,
            &self.api_key,
            &self.base_url,
            &request.model,
            body,
        )
        .await
    }

    async fn complete_with_tools(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, LlmError> {
        if request.tools.is_empty() {
            return self.complete(request).await;
        }
        let body = build_request_body(&request, true);
        send_request(
            &self.client,
            &self.api_key,
            &self.base_url,
            &request.model,
            body,
        )
        .await
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let url = format!("{}/models?key={}", self.base_url, self.api_key);

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| LlmError::NetworkError(e.to_string()))?;

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

        let data: GeminiModelsResponse = resp
            .json()
            .await
            .map_err(|e| LlmError::ParseError(e.to_string()))?;

        let mut models: Vec<ModelInfo> = data
            .models
            .into_iter()
            .filter(|m| {
                m.supported_generation_methods
                    .iter()
                    .any(|method| method == "generateContent")
            })
            .map(|m| {
                // Model name comes as "models/gemini-2.0-flash", strip the prefix.
                let id = m.name.strip_prefix("models/").unwrap_or(&m.name).to_string();
                let display = m.display_name.unwrap_or_else(|| id.clone());
                ModelInfo {
                    id,
                    name: display,
                }
            })
            .collect();

        models.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(models)
    }

    fn name(&self) -> &str {
        "gemini"
    }
}

// ── Request building ────────────────────────────────────────────────

fn build_request_body(request: &CompletionRequest, include_tools: bool) -> serde_json::Value {
    let mut system_text = String::new();
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for msg in &request.messages {
        match msg.role {
            MessageRole::System => {
                if !system_text.is_empty() {
                    system_text.push('\n');
                }
                system_text.push_str(&msg.content);
            }
            MessageRole::User => {
                contents.push(serde_json::json!({
                    "role": "user",
                    "parts": [{ "text": msg.content }],
                }));
            }
            MessageRole::Assistant => {
                contents.push(serde_json::json!({
                    "role": "model",
                    "parts": [{ "text": msg.content }],
                }));
            }
            MessageRole::Tool => {
                // Gemini tool responses are sent as function responses.
                let fn_name = msg
                    .tool_call_id
                    .as_deref()
                    .unwrap_or("function");
                // Try to parse tool result as JSON, fall back to wrapping as string.
                let response_val =
                    serde_json::from_str::<serde_json::Value>(&msg.content).unwrap_or_else(|_| {
                        serde_json::json!({ "result": msg.content })
                    });
                contents.push(serde_json::json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": fn_name,
                            "response": response_val,
                        }
                    }],
                }));
            }
        }
    }

    let mut body = serde_json::json!({
        "contents": contents,
        "generationConfig": {
            "temperature": request.temperature,
        },
    });

    if let Some(max_tokens) = request.max_tokens {
        body["generationConfig"]["maxOutputTokens"] = serde_json::json!(max_tokens);
    }

    if !system_text.is_empty() {
        body["systemInstruction"] = serde_json::json!({
            "parts": [{ "text": system_text }],
        });
    }

    if request.json_mode && !include_tools {
        body["generationConfig"]["responseMimeType"] = serde_json::json!("application/json");
    }

    if include_tools && !request.tools.is_empty() {
        let declarations: Vec<serde_json::Value> = request
            .tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                })
            })
            .collect();
        body["tools"] = serde_json::json!([{
            "functionDeclarations": declarations,
        }]);
    }

    body
}

async fn send_request(
    client: &Client,
    api_key: &str,
    base_url: &str,
    model: &str,
    body: serde_json::Value,
) -> Result<CompletionResponse, LlmError> {
    let url = format!(
        "{base_url}/models/{model}:generateContent?key={api_key}"
    );

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
                LlmError::NetworkError(format!("Connection failed: {e}"))
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
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::RateLimited(text));
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::ApiError(format!("HTTP {status}: {text}")));
    }

    let data: GeminiResponse = resp
        .json()
        .await
        .map_err(|e| LlmError::ParseError(format!("Failed to parse response: {e}")))?;

    let candidate = data
        .candidates
        .into_iter()
        .next()
        .ok_or_else(|| LlmError::ParseError("No candidates in response".to_string()))?;

    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();

    for part in candidate.content.parts {
        if let Some(text) = part.text {
            text_parts.push(text);
        }
        if let Some(fc) = part.function_call {
            tool_calls.push(ToolCall {
                id: fc.name.clone(), // Gemini doesn't have separate IDs
                name: fc.name,
                arguments: fc.args.unwrap_or(serde_json::Value::Null),
            });
        }
    }

    let content = if text_parts.is_empty() {
        None
    } else {
        Some(text_parts.join(""))
    };

    let (prompt_tokens, completion_tokens, total_tokens) =
        if let Some(meta) = data.usage_metadata {
            (
                meta.prompt_token_count.unwrap_or(0),
                meta.candidates_token_count.unwrap_or(0),
                meta.total_token_count.unwrap_or(0),
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

// ── API response types ──────────────────────────────────────────────

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Deserialize)]
struct GeminiPart {
    text: Option<String>,
    #[serde(rename = "functionCall")]
    function_call: Option<GeminiFunctionCall>,
}

#[derive(Deserialize)]
struct GeminiFunctionCall {
    name: String,
    args: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GeminiUsageMetadata {
    #[serde(rename = "promptTokenCount")]
    prompt_token_count: Option<u32>,
    #[serde(rename = "candidatesTokenCount")]
    candidates_token_count: Option<u32>,
    #[serde(rename = "totalTokenCount")]
    total_token_count: Option<u32>,
}

#[derive(Deserialize)]
struct GeminiModelsResponse {
    models: Vec<GeminiModelInfo>,
}

#[derive(Deserialize)]
struct GeminiModelInfo {
    name: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "supportedGenerationMethods", default)]
    supported_generation_methods: Vec<String>,
}
