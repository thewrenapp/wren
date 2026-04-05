use serde::{Deserialize, Serialize};

use crate::llm::prompts;
use crate::llm::provider::{
    call_with_retry_cancellable, parse_llm_json, CompletionRequest, CompletionResponse, LlmError,
    LlmProvider, TokenUsageSummary,
};
use std::sync::atomic::AtomicBool;

/// Result of document classification (Stage 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub document_type: String,
    pub confidence: f32,
    pub language: String,
    pub reasoning: String,
}

/// Entry metadata passed to the classifier.
pub struct EntryMetadata {
    pub title: Option<String>,
    pub authors: Option<String>,
    pub abstract_text: Option<String>,
    pub item_type: Option<String>,
}

/// Run Stage 1: Classify the document type and language.
///
/// Makes 1 LLM call with the first ~2000 chars + metadata.
pub async fn classify(
    provider: &dyn LlmProvider,
    model: &str,
    text_sample: &str,
    metadata: &EntryMetadata,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &AtomicBool,
) -> Result<ClassificationResult, LlmError> {
    // Try with tool calling first
    let (messages, tools) = prompts::classification_prompt(
        text_sample,
        metadata.title.as_deref(),
        metadata.authors.as_deref(),
        metadata.abstract_text.as_deref(),
        metadata.item_type.as_deref(),
    );

    let request = CompletionRequest {
        model: model.to_string(),
        messages: messages.clone(),
        temperature: 0.0,
        max_tokens: Some(500),
        json_mode: false,
        tools: tools.clone(),
    };

    let response = call_with_retry_cancellable(provider, request, retry_max, true, Some(cancel)).await;

    match response {
        Ok(resp) => {
            usage.add(&resp);
            match parse_classification_response(&resp) {
                Ok(result) => Ok(result),
                Err(_) => {
                    // Tool calling returned garbage — model can't do tools properly.
                    // Retry with JSON mode.
                    tracing::warn!(
                        "Tool-based classification failed to parse, falling back to JSON mode"
                    );
                    classify_json_fallback(provider, model, text_sample, metadata, retry_max, usage, cancel).await
                }
            }
        }
        Err(LlmError::ToolsNotSupported) => {
            tracing::info!("Tool calling not supported, falling back to JSON mode for classification");
            classify_json_fallback(provider, model, text_sample, metadata, retry_max, usage, cancel).await
        }
        Err(e) => Err(e),
    }
}

/// Fallback: classify using JSON mode instead of tools.
async fn classify_json_fallback(
    provider: &dyn LlmProvider,
    model: &str,
    text_sample: &str,
    metadata: &EntryMetadata,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &AtomicBool,
) -> Result<ClassificationResult, LlmError> {
    let messages = prompts::classification_prompt_json(
        text_sample,
        metadata.title.as_deref(),
        metadata.authors.as_deref(),
        metadata.abstract_text.as_deref(),
        metadata.item_type.as_deref(),
    );

    let request = CompletionRequest {
        model: model.to_string(),
        messages,
        temperature: 0.0,
        max_tokens: Some(500),
        json_mode: true,
        tools: vec![],
    };

    let resp = call_with_retry_cancellable(provider, request, retry_max, false, Some(cancel)).await?;
    usage.add(&resp);

    tracing::debug!(
        "[classifier] JSON fallback response: content={:?}, tool_calls={}, tokens={}/{}",
        resp.content.as_ref().map(|c| format!("{}ch: {}", c.len(), &c[..c.len().min(200)])),
        resp.tool_calls.len(),
        resp.prompt_tokens,
        resp.completion_tokens,
    );

    let content = resp
        .content
        .as_deref()
        .ok_or_else(|| {
            tracing::error!(
                "[classifier] No content in JSON response! tool_calls={:?}, tokens={}/{}",
                resp.tool_calls,
                resp.prompt_tokens,
                resp.completion_tokens,
            );
            LlmError::ParseError("No content in JSON response".to_string())
        })?;

    parse_llm_json(content).map_err(|e| {
        tracing::error!("[classifier] Failed to parse classification JSON: {e}\nContent: {content}");
        LlmError::ParseError(format!("Failed to parse classification JSON: {e}\nContent: {content}"))
    })
}

/// Parse classification result from either tool calls or text content.
fn parse_classification_response(
    response: &CompletionResponse,
) -> Result<ClassificationResult, LlmError> {
    // Check tool calls first
    for tc in &response.tool_calls {
        if tc.name == "classify_document" {
            match serde_json::from_value::<ClassificationResult>(tc.arguments.clone()) {
                Ok(result) => return Ok(result),
                Err(e) => {
                    // Skip malformed tool calls (common with local models that have
                    // weak function calling support) instead of failing the pipeline.
                    tracing::warn!(
                        "Skipping malformed classify_document tool call: {e}\nArgs: {}",
                        tc.arguments
                    );
                }
            }
        }
    }

    // Fallback: try parsing content as JSON (also covers malformed tool calls)
    if let Some(ref content) = response.content
        && let Ok(result) = parse_llm_json::<ClassificationResult>(content) {
            return Ok(result);
        }

    Err(LlmError::ParseError(
        "No classify_document tool call or parseable JSON in response".to_string(),
    ))
}
