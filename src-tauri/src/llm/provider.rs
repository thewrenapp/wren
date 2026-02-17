use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

// ── Provider trait ──────────────────────────────────────────────────

#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Send a chat completion request (plain text or JSON mode).
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError>;

    /// Send a request with tool definitions (function calling).
    /// Falls back to `complete` with JSON mode if tools are not supported.
    async fn complete_with_tools(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, LlmError>;

    /// List available models for the settings UI model dropdown.
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError>;

    /// Provider name (e.g., "openai").
    fn name(&self) -> &str;
}

// ── Request / Response types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub max_tokens: Option<u32>,
    pub json_mode: bool,
    pub tools: Vec<ToolDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    /// Only set for tool-result messages.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    /// JSON Schema describing the tool's parameters.
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct CompletionResponse {
    /// Text content of the response (None if the model only made tool calls).
    pub content: Option<String>,
    /// Tool calls made by the model.
    pub tool_calls: Vec<ToolCall>,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

// ── Errors ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum LlmError {
    /// 401 – bad API key.
    AuthError(String),
    /// 429 – rate limited.
    RateLimited(String),
    /// Other HTTP / API errors.
    ApiError(String),
    /// Failed to parse LLM response (malformed JSON, unexpected schema).
    ParseError(String),
    /// Network-level failure (timeout, DNS, connection refused).
    NetworkError(String),
    /// Tool calling is not supported by this provider/model.
    ToolsNotSupported,
    /// Operation was cancelled by the user.
    Cancelled,
}

impl fmt::Display for LlmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LlmError::AuthError(msg) => write!(f, "Authentication error: {msg}"),
            LlmError::RateLimited(msg) => write!(f, "Rate limited: {msg}"),
            LlmError::ApiError(msg) => write!(f, "API error: {msg}"),
            LlmError::ParseError(msg) => write!(f, "Parse error: {msg}"),
            LlmError::NetworkError(msg) => write!(f, "Network error: {msg}"),
            LlmError::ToolsNotSupported => write!(f, "Tool calling not supported by this model"),
            LlmError::Cancelled => write!(f, "Cancelled"),
        }
    }
}

impl std::error::Error for LlmError {}

// ── Token usage tracking ────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsageSummary {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

impl TokenUsageSummary {
    pub fn add(&mut self, response: &CompletionResponse) {
        self.prompt_tokens += response.prompt_tokens;
        self.completion_tokens += response.completion_tokens;
        self.total_tokens += response.total_tokens;
    }

    pub fn merge(&mut self, other: &TokenUsageSummary) {
        self.prompt_tokens += other.prompt_tokens;
        self.completion_tokens += other.completion_tokens;
        self.total_tokens += other.total_tokens;
    }
}

// ── Retry logic ─────────────────────────────────────────────────────

/// Call a provider with exponential backoff retry on transient errors.
///
/// Retries on: RateLimited, NetworkError.
/// Does NOT retry on: AuthError, ParseError, ApiError, ToolsNotSupported.
pub async fn call_with_retry(
    provider: &dyn LlmProvider,
    request: CompletionRequest,
    max_retries: u32,
    use_tools: bool,
) -> Result<CompletionResponse, LlmError> {
    call_with_retry_cancellable(provider, request, max_retries, use_tools, None).await
}

/// Like `call_with_retry` but accepts an optional cancel flag.
/// When the cancel flag is set, the in-flight API call is aborted immediately.
pub async fn call_with_retry_cancellable(
    provider: &dyn LlmProvider,
    request: CompletionRequest,
    max_retries: u32,
    use_tools: bool,
    cancel: Option<&AtomicBool>,
) -> Result<CompletionResponse, LlmError> {
    let mut last_error = LlmError::ApiError("No attempts made".to_string());
    let mut delay = Duration::from_secs(1);
    let mut timeout_retries: u32 = 0;
    const MAX_TIMEOUT_RETRIES: u32 = 1; // allow 1 timeout retry (transient), not the full count

    for attempt in 0..=max_retries {
        if attempt > 0 {
            // Add jitter: ±25% of delay
            let jitter_ms = (delay.as_millis() as f64 * 0.25) as u64;
            let jitter = Duration::from_millis(rand_jitter(jitter_ms));
            tokio::time::sleep(delay + jitter).await;
            delay *= 2; // exponential backoff
        }

        // Check cancel before starting the call
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                return Err(LlmError::Cancelled);
            }
        }

        let api_future = if use_tools && !request.tools.is_empty() {
            provider.complete_with_tools(request.clone())
        } else {
            provider.complete(request.clone())
        };

        // Race the API call against a cancel check loop
        let result = if let Some(flag) = cancel {
            tokio::select! {
                res = api_future => res,
                _ = poll_cancel(flag) => Err(LlmError::Cancelled),
            }
        } else {
            api_future.await
        };

        match result {
            Ok(response) => return Ok(strip_thinking(response)),
            Err(LlmError::Cancelled) => return Err(LlmError::Cancelled),
            Err(ref e) => match e {
                LlmError::RateLimited(_) => {
                    tracing::warn!(
                        "LLM call attempt {}/{} rate limited, retrying: {}",
                        attempt + 1,
                        max_retries + 1,
                        e
                    );
                    last_error = e.clone();
                }
                LlmError::NetworkError(msg) => {
                    // Limit timeout retries to 1 — transient cloud slowness gets
                    // one more chance, but local models stuck on a request don't
                    // waste 15+ minutes on repeated timeouts.
                    if msg.contains("timed out") || msg.contains("Timed out") {
                        timeout_retries += 1;
                        if timeout_retries > MAX_TIMEOUT_RETRIES {
                            tracing::warn!("LLM call timed out {} times, giving up: {}", timeout_retries, e);
                            return Err(e.clone());
                        }
                        tracing::warn!("LLM call timed out (attempt {}), will retry once: {}", timeout_retries, e);
                        last_error = e.clone();
                        continue;
                    }
                    tracing::warn!(
                        "LLM call attempt {}/{} network error, retrying: {}",
                        attempt + 1,
                        max_retries + 1,
                        e
                    );
                    last_error = e.clone();
                }
                _ => return Err(e.clone()),
            },
        }
    }

    Err(last_error)
}

/// Polls the cancel flag every 250ms, resolves when it becomes true.
async fn poll_cancel(flag: &AtomicBool) {
    loop {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if flag.load(Ordering::Relaxed) {
            return;
        }
    }
}

/// Strip `<think>...</think>` blocks from LLM responses.
///
/// Local "thinking" models (DeepSeek, QwQ, etc.) emit chain-of-thought reasoning
/// wrapped in `<think>` tags. This pollutes extracted content and can break JSON
/// parsing in tool call arguments. We strip these blocks from:
/// - The response `content` field
/// - Any string values inside tool call arguments
fn strip_thinking(mut response: CompletionResponse) -> CompletionResponse {
    if let Some(ref content) = response.content {
        let cleaned = strip_think_tags(content);
        if cleaned.len() != content.len() {
            tracing::debug!(
                "Stripped {} bytes of <think> content from response",
                content.len() - cleaned.len()
            );
            response.content = if cleaned.trim().is_empty() {
                None
            } else {
                Some(cleaned)
            };
        }
    }

    for tc in &mut response.tool_calls {
        tc.arguments = strip_think_from_json(tc.arguments.clone());
    }

    response
}

/// Remove all `<think>...</think>` blocks (and unclosed `<think>...` at end) from text.
fn strip_think_tags(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut remaining = text;

    while let Some(start) = remaining.find("<think>") {
        result.push_str(&remaining[..start]);
        remaining = &remaining[start + 7..]; // skip past "<think>"
        if let Some(end) = remaining.find("</think>") {
            remaining = &remaining[end + 8..]; // skip past "</think>"
        } else {
            // Unclosed <think> — strip everything to the end
            return result.trim().to_string();
        }
    }

    result.push_str(remaining);
    result.trim().to_string()
}

/// Recursively strip `<think>` tags from string values in JSON.
fn strip_think_from_json(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => {
            if s.contains("<think>") {
                serde_json::Value::String(strip_think_tags(&s))
            } else {
                serde_json::Value::String(s)
            }
        }
        serde_json::Value::Object(map) => {
            serde_json::Value::Object(
                map.into_iter()
                    .map(|(k, v)| (k, strip_think_from_json(v)))
                    .collect(),
            )
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(strip_think_from_json).collect())
        }
        other => other,
    }
}

/// Simple deterministic jitter (not cryptographic, just for backoff).
fn rand_jitter(max_ms: u64) -> u64 {
    if max_ms == 0 {
        return 0;
    }
    // Use system time nanoseconds as a cheap random source
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    nanos % max_ms
}
