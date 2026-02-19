use serde::{Deserialize, Serialize};

use crate::llm::pipeline::boundary_finder::DiscoveredSection;
use crate::llm::pipeline::chunker;
use crate::llm::prompts;
use crate::llm::provider::{
    call_with_retry_cancellable, parse_llm_json, strip_markdown_fences, CompletionRequest,
    CompletionResponse, LlmError, LlmProvider, TokenUsageSummary,
};

/// Result of Stage 2: discovered document structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryResult {
    pub sections: Vec<DiscoveredSection>,
    pub chunks_processed: usize,
}

/// Compact carry-forward state between discovery chunks (~200-400 tokens).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryCarryForward {
    pub sections_found: Vec<CarryForwardSection>,
    pub partial_context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CarryForwardSection {
    pub name: String,
    pub level: u8,
    pub status: String, // "complete" or "partial"
}

/// Checkpoint for resuming chunked discovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryCheckpoint {
    pub sections_so_far: Vec<DiscoveredSection>,
    pub chunks_completed: usize,
    pub carry_forward: Option<String>,
}

/// Progress callback for discovery stage.
pub trait DiscoveryProgress: Send + Sync {
    fn on_chunk(&self, chunk_index: usize, total_chunks: usize);
}

/// Run Stage 2: Discover document structure.
///
/// If the text fits in one effective chunk, makes 1 LLM call.
/// If it needs chunking, makes N sequential calls with compact carry-forward.
pub async fn discover(
    provider: &dyn LlmProvider,
    model: &str,
    full_text: &str,
    doc_type_hint: &str,
    chunk_size_chars: usize,
    overlap_chars: usize,
    needs_chunking: bool,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    checkpoint: Option<&DiscoveryCheckpoint>,
    progress: Option<&dyn DiscoveryProgress>,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<DiscoveryResult, LlmError> {
    if !needs_chunking {
        // Single call — full text fits in one effective chunk
        return discover_single(provider, model, full_text, doc_type_hint, retry_max, usage, cancel).await;
    }

    // Chunked discovery
    let result = discover_chunked(
        provider,
        model,
        full_text,
        doc_type_hint,
        chunk_size_chars,
        overlap_chars,
        retry_max,
        usage,
        checkpoint,
        progress,
        cancel,
    )
    .await?;

    // If chunked tool-based discovery found nothing, the model likely can't do
    // tool calling. Fall back to single-call JSON mode over the full text.
    if result.sections.is_empty() {
        tracing::warn!(
            "Chunked discovery returned 0 sections across {} chunks, falling back to JSON mode",
            result.chunks_processed
        );
        return discover_single_json(provider, model, full_text, doc_type_hint, retry_max, usage, cancel).await;
    }

    Ok(result)
}

/// Discover structure in a single LLM call (document fits in one chunk).
async fn discover_single(
    provider: &dyn LlmProvider,
    model: &str,
    full_text: &str,
    doc_type_hint: &str,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<DiscoveryResult, LlmError> {
    let (messages, tools) = prompts::discovery_prompt_single(full_text, doc_type_hint);

    let request = CompletionRequest {
        model: model.to_string(),
        messages: messages.clone(),
        temperature: 0.0,
        max_tokens: Some(4000),
        json_mode: false,
        tools: tools.clone(),
    };

    let response = call_with_retry_cancellable(provider, request, retry_max, true, Some(cancel)).await;

    match response {
        Ok(resp) => {
            usage.add(&resp);
            tracing::debug!(
                "Discovery response: {} tool call(s), content length = {}",
                resp.tool_calls.len(),
                resp.content.as_deref().map_or(0, |c| c.len()),
            );
            let sections = parse_discovery_response(&resp)?;
            if sections.is_empty() {
                // Tool calling returned nothing useful — model may not support tools
                // properly (e.g., GLM emitting raw special tokens instead of tool_calls).
                // Fall back to JSON mode which any instruction-tuned model can handle.
                tracing::warn!(
                    "Tool-based discovery returned 0 sections, falling back to JSON mode. \
                     Tool calls: {:?}, content preview: {:?}",
                    resp.tool_calls.iter().map(|tc| &tc.name).collect::<Vec<_>>(),
                    resp.content.as_deref().map(|c| &c[..c.len().min(300)]),
                );
                discover_single_json(provider, model, full_text, doc_type_hint, retry_max, usage, cancel).await
            } else {
                tracing::info!("Discovery found {} section(s) via tool calls", sections.len());
                Ok(DiscoveryResult {
                    sections,
                    chunks_processed: 1,
                })
            }
        }
        Err(LlmError::ToolsNotSupported) => {
            tracing::info!(
                "Tool calling not supported, falling back to JSON mode for discovery"
            );
            discover_single_json(provider, model, full_text, doc_type_hint, retry_max, usage, cancel).await
        }
        Err(e) => Err(e),
    }
}

/// JSON-mode fallback for single-call discovery.
async fn discover_single_json(
    provider: &dyn LlmProvider,
    model: &str,
    full_text: &str,
    doc_type_hint: &str,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<DiscoveryResult, LlmError> {
    let messages = prompts::discovery_prompt_json(full_text, doc_type_hint, None, true);

    let request = CompletionRequest {
        model: model.to_string(),
        messages,
        temperature: 0.0,
        max_tokens: Some(4000),
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
                "[discoverer] No content in JSON discovery response! tool_calls={}, tokens={}/{}",
                resp.tool_calls.len(),
                resp.prompt_tokens,
                resp.completion_tokens,
            );
            LlmError::ParseError("No content in JSON discovery response".to_string())
        })?;

    let result = parse_discovery_json(content);
    match &result {
        Ok(r) => tracing::info!(
            "JSON discovery found {} section(s)",
            r.sections.len()
        ),
        Err(e) => tracing::warn!(
            "JSON discovery parse failed: {e}"
        ),
    }
    result
}

/// Chunked discovery: process text in N sequential chunks with carry-forward.
async fn discover_chunked(
    provider: &dyn LlmProvider,
    model: &str,
    full_text: &str,
    doc_type_hint: &str,
    chunk_size_chars: usize,
    overlap_chars: usize,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    checkpoint: Option<&DiscoveryCheckpoint>,
    progress: Option<&dyn DiscoveryProgress>,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<DiscoveryResult, LlmError> {
    let chunks = chunker::chunk_text(full_text, chunk_size_chars, overlap_chars);
    let total_chunks = chunks.len();

    // Resume from checkpoint if available
    let (mut all_sections, start_chunk, mut carry_forward_text) = if let Some(cp) = checkpoint {
        (
            cp.sections_so_far.clone(),
            cp.chunks_completed,
            cp.carry_forward.clone(),
        )
    } else {
        (vec![], 0, None)
    };

    for (i, chunk) in chunks.iter().enumerate().skip(start_chunk) {
        // Check cancellation between chunks
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            tracing::info!("Discovery cancelled at chunk {}/{}", i + 1, total_chunks);
            return Err(LlmError::Cancelled);
        }

        if let Some(p) = progress {
            p.on_chunk(i + 1, total_chunks);
        }

        let chunk_sections = discover_chunk(
            provider,
            model,
            &chunk.text,
            doc_type_hint,
            carry_forward_text.as_deref(),
            retry_max,
            usage,
            cancel,
        )
        .await?;

        // Build carry-forward for next chunk
        carry_forward_text = Some(build_carry_forward(&all_sections, &chunk_sections));

        // Append new sections
        all_sections.extend(chunk_sections);
    }

    Ok(DiscoveryResult {
        sections: all_sections,
        chunks_processed: total_chunks,
    })
}

/// Process a single chunk for discovery.
async fn discover_chunk(
    provider: &dyn LlmProvider,
    model: &str,
    chunk_text: &str,
    doc_type_hint: &str,
    carry_forward: Option<&str>,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<Vec<DiscoveredSection>, LlmError> {
    let (messages, tools) =
        prompts::discovery_prompt_chunk(chunk_text, doc_type_hint, carry_forward);

    let request = CompletionRequest {
        model: model.to_string(),
        messages: messages.clone(),
        temperature: 0.0,
        max_tokens: Some(4000),
        json_mode: false,
        tools: tools.clone(),
    };

    let response = call_with_retry_cancellable(provider, request, retry_max, true, Some(cancel)).await;

    match response {
        Ok(resp) => {
            usage.add(&resp);
            parse_discovery_response(&resp)
        }
        Err(LlmError::ToolsNotSupported) => {
            tracing::info!(
                "Tool calling not supported, falling back to JSON mode for chunk discovery"
            );
            let messages =
                prompts::discovery_prompt_json(chunk_text, doc_type_hint, carry_forward, false);

            let request = CompletionRequest {
                model: model.to_string(),
                messages,
                temperature: 0.0,
                max_tokens: Some(4000),
                json_mode: true,
                tools: vec![],
            };

            let resp = call_with_retry_cancellable(provider, request, retry_max, false, Some(cancel)).await?;
            usage.add(&resp);

            let content = resp.content.as_deref().ok_or_else(|| {
                tracing::error!(
                    "[discoverer] No content in JSON chunk discovery response! tool_calls={}, tokens={}/{}",
                    resp.tool_calls.len(),
                    resp.prompt_tokens,
                    resp.completion_tokens,
                );
                LlmError::ParseError("No content in JSON chunk discovery response".to_string())
            })?;

            let result = parse_discovery_json(content)?;
            Ok(result.sections)
        }
        Err(e) => Err(e),
    }
}

/// Parse discovery result from tool calls.
fn parse_discovery_response(
    response: &CompletionResponse,
) -> Result<Vec<DiscoveredSection>, LlmError> {
    let mut sections = Vec::new();

    for tc in &response.tool_calls {
        if tc.name == "report_section" {
            match serde_json::from_value::<DiscoveredSection>(tc.arguments.clone()) {
                Ok(section) => sections.push(section),
                Err(e) => {
                    // Skip malformed tool calls (common with local models that have
                    // weak function calling support) instead of failing the pipeline.
                    tracing::warn!(
                        "Skipping malformed report_section tool call: {e}\nArgs: {}",
                        tc.arguments
                    );
                }
            }
        }
        // report_partial_section is informational only — we don't store it as a section,
        // it's reflected in the carry-forward summary for the next chunk.
    }

    // If tool calls produced no valid sections, try parsing content as JSON fallback.
    // This covers: (1) no tool calls at all, (2) all tool calls were malformed,
    // (3) model returned sections in text content instead of tool calls.
    if sections.is_empty() {
        if let Some(ref content) = response.content {
            if let Ok(result) = parse_discovery_json(content) {
                return Ok(result.sections);
            }
        }
    }

    // It's valid to have 0 sections in a chunk (chunk might be all within one section)
    Ok(sections)
}

/// Parse JSON-mode discovery response.
///
/// Tries strict parsing first, then falls back to extracting embedded JSON
/// from mixed text/JSON responses (common with local models that output
/// reasoning text before/after the JSON).
fn parse_discovery_json(content: &str) -> Result<DiscoveryResult, LlmError> {
    #[derive(Deserialize)]
    struct JsonDiscoveryResponse {
        sections: Vec<DiscoveredSection>,
    }

    // Try parse with fence-stripping + control-char sanitization
    if let Ok(parsed) = parse_llm_json::<JsonDiscoveryResponse>(content) {
        return Ok(DiscoveryResult {
            sections: parsed.sections,
            chunks_processed: 1,
        });
    }

    // Strip fences for the embedded-JSON fallbacks
    let content = strip_markdown_fences(content);

    // Fallback: find embedded JSON object in the text (model may have output
    // reasoning text before/after the JSON)
    if let Some(json_str) = extract_json_object(content) {
        if let Ok(parsed) = parse_llm_json::<JsonDiscoveryResponse>(json_str) {
            tracing::debug!("Extracted discovery JSON from mixed text/JSON response");
            return Ok(DiscoveryResult {
                sections: parsed.sections,
                chunks_processed: 1,
            });
        }
    }

    // Last resort: try to find a JSON array of sections directly
    if let Some(arr_str) = extract_json_array(content) {
        if let Ok(sections) = parse_llm_json::<Vec<DiscoveredSection>>(arr_str) {
            tracing::debug!("Extracted discovery sections array from mixed response");
            return Ok(DiscoveryResult {
                sections,
                chunks_processed: 1,
            });
        }
    }

    Err(LlmError::ParseError(format!(
        "Failed to parse discovery JSON (tried strict, embedded object, embedded array)\nContent: {}",
        &content[..content.len().min(500)]
    )))
}

/// Extract the outermost `{...}` JSON object from text that may contain
/// surrounding natural language.
fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let mut depth = 0;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, ch) in text[start..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match ch {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => depth += 1,
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..start + i + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Extract the outermost `[...]` JSON array from text.
fn extract_json_array(text: &str) -> Option<&str> {
    let start = text.find('[')?;
    let mut depth = 0;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, ch) in text[start..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match ch {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '[' if !in_string => depth += 1,
            ']' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..start + i + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Build a compact carry-forward summary for the next chunk (~200-400 tokens).
///
/// Lists all sections found so far with their status, plus context about
/// any partial section at the end.
fn build_carry_forward(
    previous_sections: &[DiscoveredSection],
    current_chunk_sections: &[DiscoveredSection],
) -> String {
    let mut parts = Vec::new();

    // List all previous sections as complete
    for s in previous_sections {
        parts.push(format!("- {} (level {}, complete)", s.name, s.level));
    }

    // List current chunk sections — all complete except possibly the last
    for (i, s) in current_chunk_sections.iter().enumerate() {
        let status = if i == current_chunk_sections.len() - 1 {
            "possibly ongoing"
        } else {
            "complete"
        };
        parts.push(format!("- {} (level {}, {})", s.name, s.level, status));
    }

    if parts.is_empty() {
        "No sections discovered yet.".to_string()
    } else {
        format!("Sections discovered so far:\n{}", parts.join("\n"))
    }
}

/// Build a checkpoint for saving progress mid-discovery.
pub fn build_checkpoint(
    sections: &[DiscoveredSection],
    chunks_completed: usize,
    carry_forward: Option<&str>,
) -> DiscoveryCheckpoint {
    DiscoveryCheckpoint {
        sections_so_far: sections.to_vec(),
        chunks_completed,
        carry_forward: carry_forward.map(|s| s.to_string()),
    }
}
