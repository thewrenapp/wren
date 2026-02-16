use serde::{Deserialize, Serialize};

use crate::llm::pipeline::boundary_finder::SectionRange;
use crate::llm::pipeline::chunker;
use crate::llm::prompts;
use crate::llm::provider::{
    call_with_retry_cancellable, CompletionRequest, CompletionResponse, LlmError, LlmProvider,
    TokenUsageSummary,
};

/// Result of extracting a single section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedSectionContent {
    pub name: String,
    pub level: u8,
    pub content: String,
}

/// Progress callback for extraction stage.
pub trait ExtractionProgress: Send + Sync {
    fn on_section(&self, section_index: usize, total_sections: usize, section_name: &str);
}

/// Callback invoked after each section is successfully extracted, for incremental checkpointing.
#[async_trait::async_trait]
pub trait OnSectionExtracted: Send + Sync {
    async fn on_extracted(&self, section: &ExtractedSectionContent);
}

/// Run Stage 3: Extract and clean all sections in parallel (bounded concurrency).
///
/// Each section gets its own focused LLM call to clean extraction noise.
/// Large sections are sub-chunked and cleaned independently, then concatenated.
pub async fn extract_all(
    provider: &dyn LlmProvider,
    model: &str,
    doc_type_hint: &str,
    section_ranges: &[SectionRange],
    chunk_size_chars: usize,
    overlap_chars: usize,
    max_concurrent: usize,
    retry_max: u32,
    already_extracted: &[String],
    progress: Option<&dyn ExtractionProgress>,
    on_extracted: Option<&dyn OnSectionExtracted>,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<(Vec<ExtractedSectionContent>, TokenUsageSummary), LlmError> {
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent));
    let provider_ref = provider;

    // Filter out already-extracted sections (for checkpoint resume)
    let pending_sections: Vec<_> = section_ranges
        .iter()
        .filter(|s| !already_extracted.contains(&s.name))
        .collect();

    let total = section_ranges.len();
    let already_count = already_extracted.len();
    let mut results: Vec<ExtractedSectionContent> = Vec::with_capacity(total);
    let mut total_usage = TokenUsageSummary::default();

    if already_count > 0 {
        tracing::info!(
            "Resuming extraction: {} of {} sections already done, {} remaining",
            already_count, total, pending_sections.len()
        );
    }

    // Process sections sequentially with semaphore-controlled pacing
    for (idx, section) in pending_sections.iter().enumerate() {
        // Check cancellation
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(LlmError::Cancelled);
        }

        let sem = semaphore.clone();
        let section_name = section.name.clone();
        let section_level = section.level;
        let raw_text = section.raw_text.clone();
        let model = model.to_string();
        let doc_type = doc_type_hint.to_string();
        let chunk_size = chunk_size_chars;
        let overlap = overlap_chars;

        // We can't move provider into async block easily since it's a trait object,
        // so we extract section content sequentially with semaphore-controlled pacing
        let _permit = sem.acquire().await.map_err(|_| {
            LlmError::ApiError("Semaphore closed".to_string())
        })?;

        if let Some(p) = progress {
            // Report global position (already_count + current index) so progress
            // shows "section 6 of 13" instead of "section 1 of 13" when resuming
            p.on_section(already_count + idx + 1, total, &section_name);
        }

        let content = extract_section(
            provider_ref,
            &model,
            &doc_type,
            &section_name,
            &raw_text,
            chunk_size,
            overlap,
            retry_max,
            &mut total_usage,
            cancel,
        )
        .await?;

        let extracted = ExtractedSectionContent {
            name: section_name,
            level: section_level,
            content,
        };

        if let Some(cb) = on_extracted {
            cb.on_extracted(&extracted).await;
        }

        results.push(extracted);
    }

    // Re-insert already-extracted sections at correct positions
    // (They would have been provided from checkpoint data by the caller)

    Ok((results, total_usage))
}

/// Extract and clean a single section's content.
///
/// If the section fits in one effective chunk, makes 1 LLM call.
/// If the section is too large, sub-chunks it and cleans each independently.
async fn extract_section(
    provider: &dyn LlmProvider,
    model: &str,
    doc_type_hint: &str,
    section_name: &str,
    raw_text: &str,
    chunk_size_chars: usize,
    overlap_chars: usize,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<String, LlmError> {
    // If section fits in one chunk, extract directly
    if raw_text.len() <= chunk_size_chars {
        return extract_section_single(
            provider,
            model,
            doc_type_hint,
            section_name,
            raw_text,
            retry_max,
            usage,
            cancel,
        )
        .await;
    }

    // Large section: sub-chunk and clean each independently
    tracing::info!(
        "Section '{}' is {} chars, sub-chunking for extraction",
        section_name,
        raw_text.len()
    );

    let sub_chunks = chunker::chunk_text(raw_text, chunk_size_chars, overlap_chars);
    let mut cleaned_parts = Vec::with_capacity(sub_chunks.len());

    for (i, chunk) in sub_chunks.iter().enumerate() {
        let sub_name = format!("{} (part {}/{})", section_name, i + 1, sub_chunks.len());
        let cleaned = extract_section_single(
            provider,
            model,
            doc_type_hint,
            &sub_name,
            &chunk.text,
            retry_max,
            usage,
            cancel,
        )
        .await?;
        cleaned_parts.push(cleaned);
    }

    // Concatenate cleaned sub-chunks
    Ok(cleaned_parts.join("\n\n"))
}

/// Extract a single section (or sub-chunk) via one LLM call.
async fn extract_section_single(
    provider: &dyn LlmProvider,
    model: &str,
    doc_type_hint: &str,
    section_name: &str,
    raw_text: &str,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<String, LlmError> {
    let (messages, tools) = prompts::extraction_prompt(raw_text, section_name, doc_type_hint);

    let request = CompletionRequest {
        model: model.to_string(),
        messages: messages.clone(),
        temperature: 0.1,
        max_tokens: None, // let the model decide — extraction can be lengthy
        json_mode: false,
        tools: tools.clone(),
    };

    let response = call_with_retry_cancellable(provider, request, retry_max, true, Some(cancel)).await;

    match response {
        Ok(resp) => {
            usage.add(&resp);
            parse_extraction_response(&resp, section_name)
        }
        Err(LlmError::ToolsNotSupported) => {
            tracing::info!(
                "Tool calling not supported, falling back to JSON mode for extraction of '{}'",
                section_name
            );
            extract_section_json(
                provider,
                model,
                doc_type_hint,
                section_name,
                raw_text,
                retry_max,
                usage,
                cancel,
            )
            .await
        }
        Err(e) => Err(e),
    }
}

/// JSON-mode fallback for section extraction.
async fn extract_section_json(
    provider: &dyn LlmProvider,
    model: &str,
    doc_type_hint: &str,
    section_name: &str,
    raw_text: &str,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<String, LlmError> {
    let messages = prompts::extraction_prompt_json(raw_text, section_name, doc_type_hint);

    let request = CompletionRequest {
        model: model.to_string(),
        messages,
        temperature: 0.1,
        max_tokens: None,
        json_mode: true,
        tools: vec![],
    };

    let resp = call_with_retry_cancellable(provider, request, retry_max, false, Some(cancel)).await?;
    usage.add(&resp);

    let content = resp
        .content
        .as_deref()
        .ok_or_else(|| LlmError::ParseError("No content in JSON extraction response".to_string()))?;

    #[derive(Deserialize)]
    struct JsonExtractionResponse {
        content: String,
    }

    let parsed: JsonExtractionResponse = serde_json::from_str(content).map_err(|e| {
        LlmError::ParseError(format!(
            "Failed to parse extraction JSON for '{}': {e}\nContent: {content}",
            section_name
        ))
    })?;

    Ok(parsed.content)
}

/// Parse extraction response from tool calls or text content.
fn parse_extraction_response(
    response: &CompletionResponse,
    section_name: &str,
) -> Result<String, LlmError> {
    // Check tool calls first
    for tc in &response.tool_calls {
        if tc.name == "emit_clean_content" {
            #[derive(Deserialize)]
            struct EmitArgs {
                content: String,
            }

            let args: EmitArgs = serde_json::from_value(tc.arguments.clone()).map_err(|e| {
                LlmError::ParseError(format!(
                    "Failed to parse emit_clean_content args for '{}': {e}\nArgs: {}",
                    section_name, tc.arguments
                ))
            })?;
            return Ok(args.content);
        }
    }

    // Fallback: try parsing content as JSON
    if let Some(ref content) = response.content {
        #[derive(Deserialize)]
        struct JsonContent {
            content: String,
        }

        if let Ok(parsed) = serde_json::from_str::<JsonContent>(content) {
            return Ok(parsed.content);
        }

        // Last resort: use the raw text content as cleaned output
        // (some models might just return the cleaned text directly)
        if !content.trim().is_empty() {
            tracing::warn!(
                "No emit_clean_content tool call for '{}', using raw content as fallback",
                section_name
            );
            return Ok(content.clone());
        }
    }

    Err(LlmError::ParseError(format!(
        "No emit_clean_content tool call or parseable content for section '{}'",
        section_name
    )))
}
