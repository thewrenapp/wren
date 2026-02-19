use serde::{Deserialize, Serialize};

use super::utf8::{ceil_char_boundary, floor_char_boundary};
use crate::llm::pipeline::boundary_finder;
use crate::llm::pipeline::boundary_finder::SectionRange;
use crate::llm::pipeline::chunker;
use crate::llm::prompts;
use crate::llm::provider::{
    call_with_retry_cancellable, parse_llm_json, CompletionRequest, CompletionResponse, LlmError,
    LlmProvider, TokenUsageSummary,
};

/// Result of extracting a single section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedSectionContent {
    pub name: String,
    pub level: u8,
    pub content: String,
}

/// A noise region identified by the LLM, anchored by text snippets.
#[derive(Debug, Clone, Deserialize)]
pub struct NoiseRegion {
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub replace: String,
    #[serde(default)]
    pub reason: String,
}

/// Apply noise removals to section text using text-anchor matching.
///
/// Returns `Ok(cleaned_text)` with noise regions surgically removed, or
/// `Err(reason)` if the noise removals seem wrong (e.g. >50% of text removed).
///
/// Uses fuzzy matching from `boundary_finder` for robustness.
/// If an anchor can't be found, that removal is skipped (safe failure).
/// Anchors shorter than 5 characters (after stripping line prefixes) are
/// rejected as too ambiguous.
pub fn apply_noise_removals(raw_text: &str, noise_regions: &[NoiseRegion]) -> Result<String, String> {
    if noise_regions.is_empty() {
        return Ok(raw_text.to_string());
    }

    // Resolve all noise spans to byte ranges
    let mut spans: Vec<(usize, usize, String)> = Vec::new();

    for region in noise_regions {
        // Strip [N] line number prefixes that the LLM may have included from numbered input.
        // The anchors should reference the original (unnumbered) text.
        let start_anchor = strip_line_prefix(&region.start);
        let end_anchor = strip_line_prefix(&region.end);

        // Reject anchors that are too short to be reliable
        let start_trimmed = start_anchor.trim();
        let end_trimmed = end_anchor.trim();
        if start_trimmed.len() < 5 {
            tracing::warn!(
                "Noise start anchor too short ({} chars), skipping: '{}'",
                start_trimmed.len(),
                &region.start
            );
            continue;
        }
        if end_trimmed.len() < 5 {
            tracing::warn!(
                "Noise end anchor too short ({} chars), skipping: '{}'",
                end_trimmed.len(),
                &region.end
            );
            continue;
        }

        // Find start anchor
        let Some(start_pos) = boundary_finder::find_boundary(raw_text, &start_anchor, 0) else {
            tracing::warn!(
                "Noise start anchor not found, skipping: '{}'",
                truncate_safe(&region.start, 50)
            );
            continue;
        };

        // Find end anchor after start position
        let Some(end_pos) = boundary_finder::find_boundary(raw_text, &end_anchor, start_pos)
        else {
            tracing::warn!(
                "Noise end anchor not found, skipping: '{}'",
                truncate_safe(&region.end, 50)
            );
            continue;
        };

        // The span includes the end anchor text itself (inclusive).
        // Use trimmed length since find_boundary() trims the marker before matching.
        let end_inclusive = (end_pos + end_trimmed.len()).min(raw_text.len());

        if start_pos >= end_inclusive {
            tracing::warn!(
                "Noise span has invalid range ({} >= {}), skipping",
                start_pos,
                end_inclusive
            );
            continue;
        }

        // Per-region size guard: real noise is 1-3 lines (typically < 500 bytes).
        // If a single resolved span is very large, the anchors probably matched at
        // wrong positions — skip this region rather than removing real content.
        let span_size = end_inclusive - start_pos;
        if span_size > 500 {
            tracing::warn!(
                "Noise span suspiciously large ({} bytes, start='{}', end='{}'), skipping — likely anchor mismatch",
                span_size,
                truncate_safe(&region.start, 30),
                truncate_safe(&region.end, 30)
            );
            continue;
        }

        spans.push((start_pos, end_inclusive, region.replace.clone()));
    }

    if spans.is_empty() {
        return Ok(raw_text.to_string());
    }

    // Sort spans by start position
    spans.sort_by_key(|s| s.0);

    // Merge overlapping spans
    let mut merged: Vec<(usize, usize, String)> = Vec::new();
    for span in spans {
        if let Some(last) = merged.last_mut() {
            if span.0 <= last.1 {
                // Overlapping — extend the existing span
                last.1 = last.1.max(span.1);
                continue;
            }
        }
        merged.push(span);
    }

    // Reject if >50% of text would be removed — the LLM is probably wrong
    let total_removed: usize = merged.iter().map(|(s, e, _)| e - s).sum();
    if total_removed > raw_text.len() / 2 {
        let pct = total_removed * 100 / raw_text.len();
        tracing::warn!(
            "Noise removal would delete {}% of text ({} of {} bytes) — rejecting as excessive",
            pct,
            total_removed,
            raw_text.len()
        );
        return Err(format!(
            "Excessive deletion: {}% of text ({} of {} bytes)",
            pct, total_removed, raw_text.len()
        ));
    }

    // Apply removals from end to start so positions don't shift
    let mut result = raw_text.to_string();
    for (start, end, replacement) in merged.into_iter().rev() {
        let safe_start = ceil_char_boundary(&result, start);
        let safe_end = ceil_char_boundary(&result, end);
        result.replace_range(safe_start..safe_end, &replacement);
    }

    Ok(result)
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
///
/// Tries noise-detector approach first (LLM identifies noise, we remove it locally).
/// Falls back to legacy emit_clean_content if noise detection fails.
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
    // Try noise-detector approach first
    match extract_section_noise(
        provider, model, doc_type_hint, section_name, raw_text, retry_max, usage, cancel,
    )
    .await
    {
        Ok(cleaned) => return Ok(cleaned),
        Err(LlmError::Cancelled) => return Err(LlmError::Cancelled),
        Err(e) => {
            tracing::info!(
                "Noise detection failed for '{}' ({}), falling back to legacy extraction",
                section_name,
                e
            );
        }
    }

    // Legacy fallback: emit_clean_content
    extract_section_legacy(
        provider, model, doc_type_hint, section_name, raw_text, retry_max, usage, cancel,
    )
    .await
}

/// Noise-detector extraction: LLM identifies noise regions, we remove them locally.
async fn extract_section_noise(
    provider: &dyn LlmProvider,
    model: &str,
    doc_type_hint: &str,
    section_name: &str,
    raw_text: &str,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<String, LlmError> {
    // No line numbering — noise detection uses text anchors, not line numbers.
    let (messages, tools) =
        prompts::extraction_noise_prompt(raw_text, section_name, doc_type_hint);

    let request = CompletionRequest {
        model: model.to_string(),
        messages: messages.clone(),
        temperature: 0.1,
        max_tokens: Some(4000),
        json_mode: false,
        tools: tools.clone(),
    };

    let response =
        call_with_retry_cancellable(provider, request, retry_max, true, Some(cancel)).await;

    match response {
        Ok(resp) => {
            usage.add(&resp);
            match parse_noise_response(&resp) {
                Ok(noise_regions) => {
                    apply_noise_removals(raw_text, &noise_regions).map_err(|e| {
                        LlmError::ParseError(format!(
                            "Noise detection rejected for '{}': {e}",
                            section_name
                        ))
                    })
                }
                Err(_) => {
                    // Tool calling returned garbage — model can't do tools properly.
                    // Retry with JSON mode.
                    tracing::warn!(
                        "Tool-based noise detection failed to parse for '{}', falling back to JSON mode",
                        section_name
                    );
                    extract_section_noise_json(
                        provider, model, doc_type_hint, section_name, raw_text, retry_max, usage,
                        cancel,
                    )
                    .await
                }
            }
        }
        Err(LlmError::ToolsNotSupported) => {
            tracing::info!(
                "Tool calling not supported, trying JSON mode for noise detection of '{}'",
                section_name
            );
            extract_section_noise_json(
                provider, model, doc_type_hint, section_name, raw_text, retry_max, usage, cancel,
            )
            .await
        }
        Err(e) => Err(e),
    }
}

/// JSON-mode fallback for noise-detector extraction.
async fn extract_section_noise_json(
    provider: &dyn LlmProvider,
    model: &str,
    doc_type_hint: &str,
    section_name: &str,
    raw_text: &str,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<String, LlmError> {
    // No line numbering — noise detection uses text anchors, not line numbers.
    let messages =
        prompts::extraction_noise_prompt_json(raw_text, section_name, doc_type_hint);

    let request = CompletionRequest {
        model: model.to_string(),
        messages,
        temperature: 0.1,
        max_tokens: Some(4000),
        json_mode: true,
        tools: vec![],
    };

    let resp =
        call_with_retry_cancellable(provider, request, retry_max, false, Some(cancel)).await?;
    usage.add(&resp);

    let content = resp.content.as_deref().ok_or_else(|| {
        tracing::error!(
            "[extractor] No content in JSON noise detection response! tool_calls={}, tokens={}/{}",
            resp.tool_calls.len(),
            resp.prompt_tokens,
            resp.completion_tokens,
        );
        LlmError::ParseError("No content in JSON noise detection response".to_string())
    })?;

    #[derive(Deserialize)]
    struct JsonNoiseResponse {
        noise_regions: Vec<NoiseRegion>,
    }

    let parsed: JsonNoiseResponse = parse_llm_json(content).map_err(|e| {
        LlmError::ParseError(format!(
            "Failed to parse noise detection JSON for '{}': {e}\nContent: {content}",
            section_name
        ))
    })?;

    apply_noise_removals(raw_text, &parsed.noise_regions).map_err(|e| {
        LlmError::ParseError(format!(
            "Noise detection rejected for '{}': {e}",
            section_name
        ))
    })
}

/// Legacy extraction: LLM reproduces the cleaned text directly.
async fn extract_section_legacy(
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
        max_tokens: None,
        json_mode: false,
        tools: tools.clone(),
    };

    let response =
        call_with_retry_cancellable(provider, request, retry_max, true, Some(cancel)).await;

    match response {
        Ok(resp) => {
            usage.add(&resp);
            match parse_extraction_response(&resp, section_name) {
                Ok(content) => Ok(content),
                Err(_) => {
                    // Tool calling returned garbage — model can't do tools properly.
                    // Retry with JSON mode.
                    tracing::warn!(
                        "Tool-based extraction failed to parse for '{}', falling back to JSON mode",
                        section_name
                    );
                    extract_section_json(
                        provider, model, doc_type_hint, section_name, raw_text, retry_max, usage,
                        cancel,
                    )
                    .await
                }
            }
        }
        Err(LlmError::ToolsNotSupported) => {
            tracing::info!(
                "Tool calling not supported, falling back to JSON mode for extraction of '{}'",
                section_name
            );
            extract_section_json(
                provider, model, doc_type_hint, section_name, raw_text, retry_max, usage, cancel,
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
        .ok_or_else(|| {
            tracing::error!(
                "[extractor] No content in JSON extraction response! tool_calls={}, tokens={}/{}",
                resp.tool_calls.len(),
                resp.prompt_tokens,
                resp.completion_tokens,
            );
            LlmError::ParseError("No content in JSON extraction response".to_string())
        })?;

    #[derive(Deserialize)]
    struct JsonExtractionResponse {
        content: String,
    }

    let parsed: JsonExtractionResponse = parse_llm_json(content).map_err(|e| {
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

            match serde_json::from_value::<EmitArgs>(tc.arguments.clone()) {
                Ok(args) => return Ok(args.content),
                Err(e) => {
                    // Skip malformed tool calls (common with local models that have
                    // weak function calling support) instead of failing the pipeline.
                    tracing::warn!(
                        "Skipping malformed emit_clean_content tool call for '{}': {e}\nArgs: {}",
                        section_name, tc.arguments
                    );
                }
            }
        }
    }

    // Fallback: try parsing content as JSON (also covers malformed tool calls)
    if let Some(ref content) = response.content {
        #[derive(Deserialize)]
        struct JsonContent {
            content: String,
        }

        if let Ok(parsed) = parse_llm_json::<JsonContent>(content) {
            return Ok(parsed.content);
        }

        // Try extracting from fake XML tool calls (models like DeepSeek output these as text)
        if let Some(extracted) = extract_fake_xml_param(content, "emit_clean_content", "content") {
            tracing::info!(
                "Extracted content from fake XML tool call for '{}'",
                section_name
            );
            return Ok(extracted);
        }

        // Last resort: strip fake XML blocks and meta-commentary, use remaining content
        if !content.trim().is_empty() {
            let cleaned = strip_model_commentary(content);
            if !cleaned.trim().is_empty() {
                tracing::warn!(
                    "No emit_clean_content tool call for '{}', using cleaned raw content as fallback (stripped {} bytes of commentary)",
                    section_name,
                    content.len() - cleaned.len()
                );
                return Ok(cleaned);
            }
        }
    }

    Err(LlmError::ParseError(format!(
        "No emit_clean_content tool call or parseable content for section '{}'",
        section_name
    )))
}

/// Truncate a string to at most `max_bytes` for logging, respecting UTF-8 char boundaries.
fn truncate_safe(s: &str, max_bytes: usize) -> &str {
    let end = floor_char_boundary(s, max_bytes);
    &s[..end]
}

/// Strip `[N] ` line number prefixes from an anchor string.
///
/// The LLM sees line-numbered text like `[42] Some content` and may include
/// the prefix in reported anchors. We strip it since noise removals are
/// applied to the original unnumbered text.
fn strip_line_prefix(s: &str) -> String {
    let trimmed = s.trim_start();
    if trimmed.starts_with('[') {
        if let Some(bracket_end) = trimmed.find(']') {
            let inside = &trimmed[1..bracket_end];
            // Only strip if the content inside brackets is a number
            if inside.chars().all(|c| c.is_ascii_digit()) && !inside.is_empty() {
                let after = &trimmed[bracket_end + 1..];
                // Strip optional space after the bracket
                let after = after.strip_prefix(' ').unwrap_or(after);
                return after.to_string();
            }
        }
    }
    s.to_string()
}

/// Try to extract a parameter value from fake XML tool calls that some models produce.
///
/// Models like DeepSeek sometimes output `<function_calls><invoke name="tool_name">
/// <parameter name="param_name">value</parameter></invoke></function_calls>`
/// as text content instead of using proper tool calling.
fn extract_fake_xml_param(text: &str, tool_name: &str, param_name: &str) -> Option<String> {
    // Look for <invoke name="tool_name"> ... <parameter name="param_name">...</parameter>
    let invoke_marker = format!("name=\"{}\"", tool_name);
    let invoke_pos = text.find(&invoke_marker)?;
    let after_invoke = &text[invoke_pos..];

    // Find the parameter
    let param_marker = format!("name=\"{}\"", param_name);
    let param_pos = after_invoke.find(&param_marker)?;
    let after_param_name = &after_invoke[param_pos + param_marker.len()..];

    // Skip past the closing >
    let gt_pos = after_param_name.find('>')?;
    let content_start = &after_param_name[gt_pos + 1..];

    // Find closing </parameter>
    let close_pos = content_start.find("</parameter>")?;
    let value = &content_start[..close_pos];

    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Strip fake XML tool call blocks and meta-commentary from LLM output.
///
/// Some models (especially local ones) output their response as narrative text
/// with embedded fake XML instead of using proper tool calling.
fn strip_model_commentary(text: &str) -> String {
    let mut result = text.to_string();

    // Strip <function_calls>...</function_calls> blocks
    loop {
        if let Some(start) = result.find("<function_calls>") {
            if let Some(end_rel) = result[start..].find("</function_calls>") {
                let end = start + end_rel + "</function_calls>".len();
                result.replace_range(start..end, "");
            } else {
                // Unclosed — strip from <function_calls> to end
                result.truncate(start);
                break;
            }
        } else {
            break;
        }
    }

    // Strip leading meta-commentary lines
    let trimmed = result.trim();
    let lines: Vec<&str> = trimmed.lines().collect();
    let mut start_idx = 0;
    for (i, line) in lines.iter().enumerate() {
        let lower = line.trim().to_lowercase();
        if lower.is_empty() || is_meta_commentary_line(&lower) {
            start_idx = i + 1;
        } else {
            break;
        }
    }

    if start_idx >= lines.len() {
        return trimmed.to_string(); // all lines are commentary — return original as-is
    }

    lines[start_idx..].join("\n").trim().to_string()
}

/// Check if a lowercased line is LLM meta-commentary (not real document content).
fn is_meta_commentary_line(line_lower: &str) -> bool {
    let prefixes = [
        "i'll clean",
        "i will clean",
        "i'll remove",
        "i will remove",
        "i'll preserve",
        "i will preserve",
        "i'll identify",
        "i will identify",
        "i'll fix",
        "i will fix",
        "i'll process",
        "i will process",
        "here is the cleaned",
        "here's the cleaned",
        "here is the text",
        "here's the text",
        "here is the result",
        "here's the result",
        "let me clean",
        "let me remove",
        "let me process",
        "the cleaned text is",
        "the cleaned text:",
        "the cleaned content",
        "below is the cleaned",
    ];

    for prefix in &prefixes {
        if line_lower.starts_with(prefix) {
            return true;
        }
    }

    false
}

/// Max noise regions we'll accept — anything beyond this is LLM runaway.
const MAX_NOISE_REGIONS: usize = 50;

/// Deduplicate and cap noise regions to guard against LLM output runaway.
fn sanitize_noise_regions(mut regions: Vec<NoiseRegion>) -> Vec<NoiseRegion> {
    // Dedup by (start, end) — the LLM often repeats the same region hundreds of times
    let mut seen = std::collections::HashSet::new();
    regions.retain(|r| seen.insert((r.start.clone(), r.end.clone())));
    regions.truncate(MAX_NOISE_REGIONS);
    regions
}

/// Parse noise-detection response from tool calls.
fn parse_noise_response(response: &CompletionResponse) -> Result<Vec<NoiseRegion>, LlmError> {
    // Check tool calls for report_noise
    for tc in &response.tool_calls {
        if tc.name == "report_noise" {
            #[derive(Deserialize)]
            struct ReportNoiseArgs {
                noise_regions: Vec<NoiseRegion>,
            }

            match serde_json::from_value::<ReportNoiseArgs>(tc.arguments.clone()) {
                Ok(args) => return Ok(sanitize_noise_regions(args.noise_regions)),
                Err(e) => {
                    // Skip malformed tool calls (common with local models that have
                    // weak function calling support) instead of failing the pipeline.
                    tracing::warn!(
                        "Skipping malformed report_noise tool call: {e}\nArgs: {}",
                        tc.arguments
                    );
                }
            }
        }
    }

    // Fallback: try parsing content as JSON (also covers malformed tool calls)
    if let Some(ref content) = response.content {
        #[derive(Deserialize)]
        struct JsonNoiseResponse {
            noise_regions: Vec<NoiseRegion>,
        }

        if let Ok(parsed) = parse_llm_json::<JsonNoiseResponse>(content) {
            return Ok(sanitize_noise_regions(parsed.noise_regions));
        }

        // Try extracting from fake XML tool calls (models like DeepSeek output these as text)
        if let Some(json_str) = extract_fake_xml_param(content, "report_noise", "noise_regions") {
            if let Ok(regions) = parse_llm_json::<Vec<NoiseRegion>>(&json_str) {
                tracing::info!("Extracted noise regions from fake XML tool call");
                return Ok(sanitize_noise_regions(regions));
            }
        }
    }

    Err(LlmError::ParseError(
        "No report_noise tool call or parseable noise response".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_noise_removals_empty() {
        let text = "Hello world, this is clean text.";
        let result = apply_noise_removals(text, &[]).unwrap();
        assert_eq!(result, text);
    }

    #[test]
    fn test_apply_noise_removals_whole_line() {
        let text = "Real content here with several sentences of actual document text that is important.\nA Multi-Horizon Quantile Recurrent Forecaster\nMore real content follows in this paragraph with additional detail.";
        let noise = vec![NoiseRegion {
            start: "A Multi-Horizon".to_string(),
            end: "Forecaster".to_string(),
            replace: String::new(),
            reason: "Running header".to_string(),
        }];
        let result = apply_noise_removals(text, &noise).unwrap();
        assert_eq!(result, "Real content here with several sentences of actual document text that is important.\n\nMore real content follows in this paragraph with additional detail.");
    }

    #[test]
    fn test_apply_noise_removals_mid_line_with_replacement() {
        let text = "In previous work we have demonstrated important results. We have re1\nSome footnote text here about details\ncently shown that the method works well for many scenarios.";
        let noise = vec![NoiseRegion {
            start: "re1\nSome footnote".to_string(),
            end: "about details\ncently".to_string(),
            replace: "recently".to_string(),
            reason: "Footnote splitting word".to_string(),
        }];
        let result = apply_noise_removals(text, &noise).unwrap();
        assert_eq!(result, "In previous work we have demonstrated important results. We have recently shown that the method works well for many scenarios.");
    }

    #[test]
    fn test_apply_noise_removals_anchor_not_found() {
        let text = "Real content that should stay intact.";
        let noise = vec![NoiseRegion {
            start: "nonexistent anchor".to_string(),
            end: "also nonexistent".to_string(),
            replace: String::new(),
            reason: "This should be skipped".to_string(),
        }];
        let result = apply_noise_removals(text, &noise).unwrap();
        assert_eq!(result, text); // unchanged
    }

    #[test]
    fn test_strip_line_prefix() {
        assert_eq!(strip_line_prefix("[1] Abstract"), "Abstract");
        assert_eq!(strip_line_prefix("[42] Some content"), "Some content");
        assert_eq!(strip_line_prefix("[100] Text"), "Text");
        // No prefix — unchanged
        assert_eq!(strip_line_prefix("No prefix here"), "No prefix here");
        // Non-numeric bracket — unchanged
        assert_eq!(strip_line_prefix("[abc] Not a line number"), "[abc] Not a line number");
        // Empty bracket — unchanged
        assert_eq!(strip_line_prefix("[] Empty"), "[] Empty");
        // Just a line number — returns empty
        assert_eq!(strip_line_prefix("[3]"), "");
    }

    #[test]
    fn test_apply_noise_removals_with_line_prefixes() {
        // Simulates LLM including [N] prefixes in anchors
        let text = "Real content here with enough surrounding text to avoid excessive deletion threshold.\nA Multi-Horizon Quantile Recurrent Forecaster\nMore real content that continues for a while with detailed analysis.";
        let noise = vec![NoiseRegion {
            start: "[1] A Multi-Horizon".to_string(),
            end: "[1] Forecaster".to_string(),
            replace: String::new(),
            reason: "Running header".to_string(),
        }];
        let result = apply_noise_removals(text, &noise).unwrap();
        assert_eq!(result, "Real content here with enough surrounding text to avoid excessive deletion threshold.\n\nMore real content that continues for a while with detailed analysis.");
    }

    #[test]
    fn test_apply_noise_removals_multiple_regions() {
        let text = "Content here with enough text to keep.\nPage number 42 of 100\nMore content that is real and should remain in the output.\nA Multi-Horizon Quantile Recurrent Forecaster\nEven more content that has valuable information in it.";
        let noise = vec![
            NoiseRegion {
                start: "Page number 42 of 100".to_string(),
                end: "Page number 42 of 100".to_string(),
                replace: String::new(),
                reason: "Page number".to_string(),
            },
            NoiseRegion {
                start: "A Multi-Horizon".to_string(),
                end: "Recurrent Forecaster".to_string(),
                replace: String::new(),
                reason: "Running header".to_string(),
            },
        ];
        let result = apply_noise_removals(text, &noise).unwrap();
        assert_eq!(
            result,
            "Content here with enough text to keep.\n\nMore content that is real and should remain in the output.\n\nEven more content that has valuable information in it."
        );
    }

    #[test]
    fn test_apply_noise_removals_short_anchor_skipped() {
        // Anchors < 5 chars should be skipped as too ambiguous
        let text = "Real content.\n42\nMore content here and then some.";
        let noise = vec![NoiseRegion {
            start: "42".to_string(),
            end: "42".to_string(),
            replace: String::new(),
            reason: "Page number".to_string(),
        }];
        let result = apply_noise_removals(text, &noise).unwrap();
        assert_eq!(result, text); // unchanged — anchors too short
    }

    #[test]
    fn test_apply_noise_removals_excessive_deletion() {
        // If noise regions would remove >50% of text, return Err
        let text = "Short.\nThis entire long passage is incorrectly flagged as noise and should not be removed from the document.";
        let noise = vec![NoiseRegion {
            start: "This entire long passage".to_string(),
            end: "from the document.".to_string(),
            replace: String::new(),
            reason: "All noise".to_string(),
        }];
        let result = apply_noise_removals(text, &noise);
        assert!(result.is_err(), "Should reject excessive deletion");
    }

    #[test]
    fn test_extract_fake_xml_param_emit_content() {
        let text = r#"I'll clean this text by removing extraction artifacts.

<function_calls>
<invoke name="emit_clean_content">
<parameter name="content">This is the actual cleaned document content that should be extracted.</parameter>
</invoke>
</function_calls>"#;

        let result = extract_fake_xml_param(text, "emit_clean_content", "content");
        assert!(result.is_some());
        assert_eq!(
            result.unwrap(),
            "This is the actual cleaned document content that should be extracted."
        );
    }

    #[test]
    fn test_extract_fake_xml_param_report_noise() {
        let text = r#"I'll identify the noise regions.

<function_calls>
<invoke name="report_noise">
<parameter name="noise_regions">[{"start":"Page 42","end":"Page 42","replace":"","reason":"page number"}]</parameter>
</invoke>
</function_calls>"#;

        let result = extract_fake_xml_param(text, "report_noise", "noise_regions");
        assert!(result.is_some());
        let json_str = result.unwrap();
        let regions: Vec<NoiseRegion> = serde_json::from_str(&json_str).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].start, "Page 42");
    }

    #[test]
    fn test_extract_fake_xml_param_not_found() {
        let text = "Just regular text with no XML.";
        assert!(extract_fake_xml_param(text, "emit_clean_content", "content").is_none());
    }

    #[test]
    fn test_strip_model_commentary_with_fake_xml() {
        let text = r#"I'll clean this text by removing artifacts.

Some real document content here.

<function_calls>
<invoke name="emit_clean_content">
<parameter name="content">duplicate content</parameter>
</invoke>
</function_calls>"#;

        let result = strip_model_commentary(text);
        assert_eq!(result, "Some real document content here.");
    }

    #[test]
    fn test_strip_model_commentary_preamble_only() {
        let text = "I'll clean this text by removing extraction artifacts while preserving all actual content.\n\nThe actual document content starts here.\nAnd continues with more text.";
        let result = strip_model_commentary(text);
        assert_eq!(
            result,
            "The actual document content starts here.\nAnd continues with more text."
        );
    }

    #[test]
    fn test_strip_model_commentary_no_commentary() {
        let text = "This is just normal document text.\nWith multiple lines.\nNo commentary here.";
        let result = strip_model_commentary(text);
        assert_eq!(result, text);
    }

    #[test]
    fn test_is_meta_commentary_line() {
        assert!(is_meta_commentary_line("i'll clean this text by removing artifacts"));
        assert!(is_meta_commentary_line("here is the cleaned text:"));
        assert!(is_meta_commentary_line("let me clean the text for you"));
        assert!(!is_meta_commentary_line("the experiment was conducted in 2024"));
        assert!(!is_meta_commentary_line("i'll discuss the results in section 4"));
        assert!(!is_meta_commentary_line(""));
    }
}
