use serde::{Deserialize, Serialize};

use crate::llm::prompts;
use crate::llm::provider::{
    call_with_retry_cancellable, CompletionRequest, CompletionResponse, LlmError, LlmProvider, TokenUsageSummary,
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
            parse_classification_response(&resp)
        }
        Err(LlmError::ToolsNotSupported) => {
            // Fallback to JSON mode
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

    let content = resp
        .content
        .as_deref()
        .ok_or_else(|| LlmError::ParseError("No content in JSON response".to_string()))?;

    serde_json::from_str(content).map_err(|e| {
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
            return serde_json::from_value(tc.arguments.clone()).map_err(|e| {
                LlmError::ParseError(format!(
                    "Failed to parse classify_document args: {e}\nArgs: {}",
                    tc.arguments
                ))
            });
        }
    }

    // Fallback: try parsing content as JSON
    if let Some(ref content) = response.content {
        if let Ok(result) = serde_json::from_str::<ClassificationResult>(content) {
            return Ok(result);
        }
    }

    Err(LlmError::ParseError(
        "No classify_document tool call or parseable JSON in response".to_string(),
    ))
}
