use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::llm::provider::{
    call_with_retry_cancellable, parse_llm_json, ChatMessage, CompletionRequest, LlmError,
    LlmProvider, MessageRole, TokenUsageSummary,
};

use super::chunker::Section;
use super::doc_types::get_doc_type_config;

// ── Extraction result types ──────────────────────────────────────────

pub struct KnowledgeExtractionResult {
    pub entities: Vec<ExtractedEntity>,
    pub claims: Vec<ExtractedClaim>,
    /// True if some section batches failed during extraction.
    pub partial: bool,
}

/// Raw LLM output — only entities and claims, no metadata.
#[derive(Debug, Clone, Deserialize)]
struct LlmExtractionResponse {
    pub entities: Vec<ExtractedEntity>,
    pub claims: Vec<ExtractedClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedEntity {
    pub name: String,
    pub category: String,
    pub description: String,
    pub relation_type: String,
    pub weight: f32,
    pub evidence_text: String,
    pub section_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedClaim {
    pub statement: String,
    pub evidence_text: String,
    pub section_name: String,
    pub claim_type: String,
    pub confidence: f32,
}

// ── Entry metadata for the prompt ────────────────────────────────────

pub struct EntryContext {
    pub title: Option<String>,
    pub creators: Option<String>,
    pub abstract_text: Option<String>,
    pub item_type: Option<String>,
    pub document_type: String,
    pub language: String,
}

// ── Section batching ─────────────────────────────────────────────────

/// Max characters per batch sent to the LLM for extraction.
/// ~2K chars keeps batches small so each section gets focused attention.
const BATCH_MAX_CHARS: usize = 2_000;

struct SectionBatch {
    section_names: Vec<String>,
    content: String,
}

/// Group sections into batches for extraction.
///
/// Small adjacent sections are merged. Each batch stays under BATCH_MAX_CHARS.
fn batch_sections(sections: &[Section]) -> Vec<SectionBatch> {
    let mut batches = Vec::new();
    let mut current_names: Vec<String> = Vec::new();
    let mut current_content = String::new();

    for section in sections {
        let section_text = format!("## {}\n\n{}\n\n", section.name, section.content);

        // If adding this section would exceed the limit and we have content, flush
        if !current_content.is_empty()
            && current_content.len() + section_text.len() > BATCH_MAX_CHARS
        {
            batches.push(SectionBatch {
                section_names: current_names.clone(),
                content: current_content.clone(),
            });
            current_names.clear();
            current_content.clear();
        }

        current_names.push(section.name.clone());
        current_content.push_str(&section_text);

        // If current batch is at or near the limit, flush it
        if current_content.len() >= BATCH_MAX_CHARS {
            batches.push(SectionBatch {
                section_names: current_names.clone(),
                content: current_content.clone(),
            });
            current_names.clear();
            current_content.clear();
        }
    }

    // Flush remaining
    if !current_content.trim().is_empty() {
        batches.push(SectionBatch {
            section_names: current_names,
            content: current_content,
        });
    }

    batches
}

// ── Per-section extraction (public API) ──────────────────────────────

/// Extract knowledge from a document by processing each section (or batch of sections)
/// independently. Returns merged entities and claims across all sections.
///
/// This gives much more thorough extraction than a single whole-document call:
/// - No content is lost to truncation
/// - Section attribution is accurate
/// - Each section gets focused attention from the LLM
pub async fn extract_knowledge_from_sections(
    provider: &dyn LlmProvider,
    model: &str,
    sections: &[Section],
    context: &EntryContext,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &AtomicBool,
    progress: &dyn super::sync::GraphProgressCallback,
) -> Result<KnowledgeExtractionResult, LlmError> {
    let batches = batch_sections(sections);
    let total_batches = batches.len();

    tracing::info!(
        "[knowledge] Processing {} sections in {} batches",
        sections.len(),
        total_batches
    );

    let mut all_entities = Vec::new();
    let mut all_claims = Vec::new();
    let mut failed_batches = 0;

    for (i, batch) in batches.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        let section_label = if batch.section_names.len() == 1 {
            batch.section_names[0].clone()
        } else {
            format!("{} sections", batch.section_names.len())
        };

        progress.update(&format!(
            "Extracting knowledge ({}/{}: {})...",
            i + 1,
            total_batches,
            section_label
        ));

        match extract_section_batch(provider, model, &batch.content, &batch.section_names, context, retry_max, usage, cancel)
            .await
        {
            Ok(result) => {
                tracing::debug!(
                    "[knowledge] Batch {}/{}: {} entities, {} claims from [{}]",
                    i + 1,
                    total_batches,
                    result.entities.len(),
                    result.claims.len(),
                    batch.section_names.join(", ")
                );
                all_entities.extend(result.entities);
                all_claims.extend(result.claims);
            }
            Err(LlmError::Cancelled) => {
                tracing::info!("[knowledge] Extraction cancelled at batch {}/{}", i + 1, total_batches);
                break;
            }
            Err(e) => {
                failed_batches += 1;
                tracing::warn!(
                    "[knowledge] Batch {}/{} failed (sections: [{}]): {}",
                    i + 1,
                    total_batches,
                    batch.section_names.join(", "),
                    e
                );
                // Continue with other batches — partial extraction is better than none
            }
        }
    }

    // Deduplicate entities by (name_lowercase, category)
    let mut seen = std::collections::HashSet::new();
    all_entities.retain(|e| {
        let key = (e.name.trim().to_lowercase(), e.category.clone());
        seen.insert(key)
    });

    if failed_batches > 0 {
        tracing::warn!(
            "[knowledge] {}/{} batches failed — extraction is partial",
            failed_batches, total_batches
        );
    }

    tracing::info!(
        "[knowledge] Total: {} entities (deduped), {} claims from {} batches ({} failed)",
        all_entities.len(),
        all_claims.len(),
        total_batches,
        failed_batches,
    );

    Ok(KnowledgeExtractionResult {
        entities: all_entities,
        claims: all_claims,
        partial: failed_batches > 0,
    })
}

/// Extract entities and claims from a single batch of sections.
async fn extract_section_batch(
    provider: &dyn LlmProvider,
    model: &str,
    content: &str,
    section_names: &[String],
    context: &EntryContext,
    retry_max: u32,
    usage: &mut TokenUsageSummary,
    cancel: &AtomicBool,
) -> Result<KnowledgeExtractionResult, LlmError> {
    let doc_config = get_doc_type_config(&context.document_type);

    let entity_categories = doc_config.entity_categories.join(", ");
    let claim_types = doc_config.claim_types.join(", ");
    let relation_types = doc_config.relation_types.join(", ");
    let claim_examples = doc_config.claim_examples;

    let sections_hint = section_names.join(", ");

    let system_prompt = format!(
        r#"You are a thorough knowledge extractor for {doc_type} documents.

Extract entities and claims from the following section(s) of a {doc_type} written in {language}.
You are reading section(s): {sections_hint}

ENTITIES: Named concepts, methods, tools, datasets, or domain-specific items.
For each entity provide:
- name: specific, reusable name (would appear in other documents too)
- category: one of [{entity_categories}]
- description: 1-2 sentences explaining what this is
- relation_type: how this document relates to it, one of [{relation_types}]
- weight: 0.0-1.0 how central it is to this section
- evidence_text: exact quote from the text (max 200 chars)
- section_name: which section this appears in (use the exact section heading)

CLAIMS: Every factual assertion, result, comparison, design choice, or argument made in the text.
A claim is ANY statement that could be true or false — not just major findings.
Be AGGRESSIVE: extract every claim you can find, including:
{claim_examples}

For each claim provide:
- statement: the claim in one sentence
- evidence_text: exact quote supporting it (max 300 chars)
- section_name: which section (use the exact section heading)
- claim_type: one of [{claim_types}]
- confidence: 0.0-1.0 how clearly stated

{guidance}

Return JSON with keys "entities" (array) and "claims" (array).
For substantive sections (introduction, methods, results, discussion, analysis), extract MANY claims — aim for 5-15 per section.
For metadata sections (preamble, references, author info, submission history, acknowledgments), extract only what is genuinely asserted — it is fine to return an empty claims array if there are no real claims.
Err on the side of extracting too many claims from substantive content, but NEVER fabricate claims."#,
        doc_type = context.document_type,
        language = context.language,
        sections_hint = sections_hint,
        entity_categories = entity_categories,
        claim_types = claim_types,
        relation_types = relation_types,
        guidance = doc_config.extraction_guidance,
    );

    let mut user_parts = Vec::new();
    if let Some(ref title) = context.title {
        user_parts.push(format!("Document: {title}"));
    }
    if let Some(ref creators) = context.creators {
        user_parts.push(format!("Authors: {creators}"));
    }
    user_parts.push(String::new());
    user_parts.push(content.to_string());

    let user_message = user_parts.join("\n");

    let request = CompletionRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: MessageRole::System,
                content: system_prompt,
                tool_call_id: None,
            },
            ChatMessage {
                role: MessageRole::User,
                content: user_message,
                tool_call_id: None,
            },
        ],
        temperature: 0.0,
        max_tokens: Some(4000),
        json_mode: true,
        tools: vec![],
    };

    let response =
        call_with_retry_cancellable(provider, request, retry_max, false, Some(cancel)).await?;
    usage.add(&response);

    let content = response
        .content
        .as_deref()
        .ok_or_else(|| LlmError::ParseError("No content in knowledge extraction response".to_string()))?;

    let raw: LlmExtractionResponse = parse_llm_json(content).map_err(|e| {
        tracing::error!(
            "[knowledge] Failed to parse extraction JSON: {e}\nContent: {}",
            &content[..content.len().min(500)]
        );
        LlmError::ParseError(format!("Failed to parse knowledge extraction JSON: {e}"))
    })?;

    Ok(KnowledgeExtractionResult {
        entities: raw.entities,
        claims: raw.claims,
        partial: false,
    })
}
