pub mod assembler;
pub mod boundary_finder;
pub mod chunker;
pub mod classifier;
pub mod discoverer;
pub mod extractor;
pub mod pre_analysis;
pub(crate) mod utf8;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use crate::llm::context_windows;
use crate::llm::pipeline::assembler::ExtractedSection;
use crate::llm::pipeline::boundary_finder::DiscoveredSection;
use crate::llm::pipeline::classifier::{ClassificationResult, EntryMetadata};
use crate::llm::pipeline::discoverer::DiscoveryCheckpoint;
use crate::llm::pipeline::extractor::ExtractedSectionContent;
use crate::llm::provider::{LlmError, LlmProvider, TokenUsageSummary};
use crate::search::extractor::sanitize_extracted_text;

// ── Configuration ──────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PipelineConfig {
    pub provider_name: String,
    pub model: String,
    /// Model's context window in tokens (from settings or defaults).
    pub context_window: usize,
    /// Max total tokens across all pipeline stages (default: 200_000).
    pub max_token_budget: u32,
    /// Parallel section extractions (default: 3, use 1 for local Ollama).
    pub max_concurrent_extractions: usize,
    /// Retry count per LLM call (default: 3).
    pub retry_max: u32,
}

// ── Output types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedDocument {
    pub document_type: String,
    pub classification_confidence: f32,
    pub language: String,
    pub sections: Vec<ExtractedSection>,
    pub structured_markdown: String,
    pub discovery_chunks: usize,
    pub sections_extracted: usize,
    pub token_usage: TokenUsageSummary,
    pub pipeline_stages: Vec<StageInfo>,
    /// "success" | "partial"
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageInfo {
    pub name: String,
    pub duration_ms: u64,
    pub tokens_used: u32,
}

// ── Checkpointing ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineCheckpoint {
    pub stage: PipelineStage,
    pub classification: Option<ClassificationResult>,
    pub discovered_sections: Option<Vec<DiscoveredSection>>,
    pub discovery_checkpoint: Option<DiscoveryCheckpoint>,
    pub extracted_sections: Vec<String>,
    pub section_contents: HashMap<String, ExtractedSectionContent>,
    pub tokens_used: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PipelineStage {
    Classify,
    Discover,
    Extract,
    Assemble,
}

/// Trait for saving checkpoints to persistent storage (DB).
#[async_trait::async_trait]
pub trait CheckpointSaver: Send + Sync {
    async fn save(&self, checkpoint: &PipelineCheckpoint) -> Result<(), String>;
}

/// Progress callback for the pipeline.
pub trait ProgressCallback: Send + Sync {
    fn update(&self, current: u32, total: u32, message: &str);
}

// ── Pipeline errors ────────────────────────────────────────────────

#[derive(Debug)]
pub enum PipelineError {
    Llm(LlmError),
    TooShort,
    Cancelled,
    BudgetExceeded(PipelineCheckpoint),
    /// Pre-analysis indicates too many calls — frontend should confirm.
    TooManyCalls { estimated_calls: usize },
}

impl From<LlmError> for PipelineError {
    fn from(e: LlmError) -> Self {
        match e {
            LlmError::Cancelled => PipelineError::Cancelled,
            other => PipelineError::Llm(other),
        }
    }
}

impl std::fmt::Display for PipelineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PipelineError::Llm(e) => write!(f, "{e}"),
            PipelineError::TooShort => write!(f, "Document too short to parse (< 500 chars)"),
            PipelineError::Cancelled => write!(f, "Pipeline cancelled"),
            PipelineError::BudgetExceeded(_) => write!(f, "Token budget exceeded"),
            PipelineError::TooManyCalls { estimated_calls } => {
                write!(f, "Estimated {estimated_calls} LLM calls required — confirm before proceeding")
            }
        }
    }
}

// ── Main pipeline entry point ──────────────────────────────────────

/// Run the full parsing pipeline.
///
/// Stages: Pre-Analysis → Classify → Discover → Extract → Assemble.
///
/// Accepts an optional checkpoint to resume from a previous interrupted run.
pub async fn run_pipeline(
    provider: &dyn LlmProvider,
    config: &PipelineConfig,
    extracted_text: &str,
    entry_metadata: &EntryMetadata,
    checkpoint: Option<PipelineCheckpoint>,
    progress: &dyn ProgressCallback,
    cancel: &AtomicBool,
    checkpoint_saver: &dyn CheckpointSaver,
) -> Result<ParsedDocument, PipelineError> {
    let mut stages: Vec<StageInfo> = Vec::new();
    let mut total_usage = TokenUsageSummary::default();

    // Sanitize extracted text: strip control characters left by PDF/OCR extraction
    let sanitized_text = sanitize_extracted_text(extracted_text);
    let extracted_text = sanitized_text.as_str();

    // ── Pre-analysis (pure Rust, no LLM calls) ────────────────────
    let model_ctx = context_windows::from_override(config.context_window);
    let analysis = pre_analysis::analyze(extracted_text, &model_ctx);

    if analysis.should_skip {
        return Err(PipelineError::TooShort);
    }

    // We don't know the real total work until after discovery (when section count
    // is known), so classification and discovery show indeterminate progress (0,0).
    // total_work is set after discovery to: sections + 1 (assemble).
    let total_work: u32;

    // Determine which stage to start from
    let start_stage = checkpoint
        .as_ref()
        .map(|cp| cp.stage.clone())
        .unwrap_or(PipelineStage::Classify);

    // Restore token usage from checkpoint
    if let Some(ref cp) = checkpoint {
        total_usage.total_tokens = cp.tokens_used;
    }

    // ── Stage 1: Classify ──────────────────────────────────────────
    let classification = if start_stage == PipelineStage::Classify {
        check_cancel(cancel)?;
        progress.update(0, 0, "Classifying document...");

        let stage_start = std::time::Instant::now();
        let mut stage_usage = TokenUsageSummary::default();

        let result = classifier::classify(
            provider,
            &config.model,
            &analysis.first_n_chars,
            entry_metadata,
            config.retry_max,
            &mut stage_usage,
            cancel,
        )
        .await?;

        total_usage.merge(&stage_usage);
        stages.push(StageInfo {
            name: "classify".to_string(),
            duration_ms: stage_start.elapsed().as_millis() as u64,
            tokens_used: stage_usage.total_tokens,
        });

        // Save checkpoint after classification
        let cp = PipelineCheckpoint {
            stage: PipelineStage::Discover,
            classification: Some(result.clone()),
            discovered_sections: None,
            discovery_checkpoint: None,
            extracted_sections: vec![],
            section_contents: HashMap::new(),
            tokens_used: total_usage.total_tokens,
        };
        let _ = checkpoint_saver.save(&cp).await;

        check_budget(config, &total_usage, &cp)?;

        result
    } else {
        // Restored from checkpoint
        checkpoint
            .as_ref()
            .and_then(|cp| cp.classification.clone())
            .ok_or_else(|| {
                PipelineError::Llm(LlmError::ParseError(
                    "Checkpoint missing classification result".to_string(),
                ))
            })?
    };

    tracing::info!(
        "Classification: {} (confidence: {}, language: {})",
        classification.document_type,
        classification.confidence,
        classification.language
    );

    // ── Prepare line-numbered text for discovery ──────────────────
    let (numbered_text, line_offsets) = pre_analysis::add_line_numbers(extracted_text);

    // ── Stage 2: Discover structure ────────────────────────────────
    let discovered_sections = if start_stage == PipelineStage::Classify
        || start_stage == PipelineStage::Discover
    {
        check_cancel(cancel)?;
        progress.update(0, 0, "Discovering document structure...");

        let stage_start = std::time::Instant::now();
        let mut stage_usage = TokenUsageSummary::default();

        let discovery_cp = checkpoint.as_ref().and_then(|cp| {
            if cp.stage == PipelineStage::Discover {
                cp.discovery_checkpoint.as_ref()
            } else {
                None
            }
        });

        struct DiscoveryProgressAdapter<'a> {
            progress: &'a dyn ProgressCallback,
        }
        impl<'a> discoverer::DiscoveryProgress for DiscoveryProgressAdapter<'a> {
            fn on_chunk(&self, chunk_index: usize, total_chunks: usize) {
                self.progress.update(
                    chunk_index as u32,
                    total_chunks as u32,
                    &format!("Discovering structure (chunk {} of {})...", chunk_index, total_chunks),
                );
            }
        }

        let disc_progress = DiscoveryProgressAdapter { progress };

        let result = discoverer::discover(
            provider,
            &config.model,
            &numbered_text,
            &classification.document_type,
            analysis.chunk_size_chars,
            analysis.overlap_chars,
            analysis.discovery_needs_chunking,
            config.retry_max,
            &mut stage_usage,
            discovery_cp,
            Some(&disc_progress),
            cancel,
        )
        .await?;

        total_usage.merge(&stage_usage);
        stages.push(StageInfo {
            name: "discover".to_string(),
            duration_ms: stage_start.elapsed().as_millis() as u64,
            tokens_used: stage_usage.total_tokens,
        });

        tracing::info!(
            "Discovery: found {} sections in {} chunks",
            result.sections.len(),
            result.chunks_processed
        );

        // Save checkpoint after discovery
        let cp = PipelineCheckpoint {
            stage: PipelineStage::Extract,
            classification: Some(classification.clone()),
            discovered_sections: Some(result.sections.clone()),
            discovery_checkpoint: None,
            extracted_sections: vec![],
            section_contents: HashMap::new(),
            tokens_used: total_usage.total_tokens,
        };
        let _ = checkpoint_saver.save(&cp).await;

        check_budget(config, &total_usage, &cp)?;

        result.sections
    } else {
        // Restored from checkpoint
        checkpoint
            .as_ref()
            .and_then(|cp| cp.discovered_sections.clone())
            .ok_or_else(|| {
                PipelineError::Llm(LlmError::ParseError(
                    "Checkpoint missing discovered sections".to_string(),
                ))
            })?
    };

    // ── Resolve section boundaries (pure Rust) ─────────────────────
    let section_ranges =
        boundary_finder::find_section_ranges_with_lines(&discovered_sections, extracted_text, Some(&line_offsets));

    // Now that discovery is done, total_work = sections to extract + 1 (assemble)
    total_work = (section_ranges.len() + 1) as u32;

    if section_ranges.is_empty() {
        tracing::warn!("No section boundaries could be resolved — returning minimal result");
        return Ok(ParsedDocument {
            document_type: classification.document_type,
            classification_confidence: classification.confidence,
            language: classification.language,
            sections: vec![],
            structured_markdown: String::new(),
            discovery_chunks: 0,
            sections_extracted: 0,
            token_usage: total_usage,
            pipeline_stages: stages,
            status: "partial".to_string(),
        });
    }

    // ── Stage 3: Extract sections ──────────────────────────────────
    let extracted = if start_stage != PipelineStage::Assemble {
        check_cancel(cancel)?;

        let stage_start = std::time::Instant::now();

        let already_extracted: Vec<String> = checkpoint
            .as_ref()
            .map(|cp| cp.extracted_sections.clone())
            .unwrap_or_default();

        struct ExtractionProgressAdapter<'a> {
            progress: &'a dyn ProgressCallback,
            total_work: u32,
        }
        impl<'a> extractor::ExtractionProgress for ExtractionProgressAdapter<'a> {
            fn on_section(
                &self,
                section_index: usize,
                total_sections: usize,
                section_name: &str,
            ) {
                self.progress.update(
                    section_index as u32,
                    self.total_work,
                    &format!(
                        "Extracting section {} of {}: {}...",
                        section_index + 1, total_sections, section_name
                    ),
                );
            }
        }

        let extract_progress = ExtractionProgressAdapter {
            progress,
            total_work,
        };

        // Per-section checkpoint saver — saves checkpoint after each extracted section
        struct PerSectionCheckpoint<'a> {
            saver: &'a dyn CheckpointSaver,
            classification: ClassificationResult,
            discovered_sections: Vec<DiscoveredSection>,
            extracted: tokio::sync::Mutex<HashMap<String, extractor::ExtractedSectionContent>>,
            tokens_used: std::sync::atomic::AtomicU32,
        }

        #[async_trait::async_trait]
        impl<'a> extractor::OnSectionExtracted for PerSectionCheckpoint<'a> {
            async fn on_extracted(&self, section: &extractor::ExtractedSectionContent) {
                let mut map = self.extracted.lock().await;
                map.insert(section.name.clone(), section.clone());
                let cp = PipelineCheckpoint {
                    stage: PipelineStage::Extract,
                    classification: Some(self.classification.clone()),
                    discovered_sections: Some(self.discovered_sections.clone()),
                    discovery_checkpoint: None,
                    extracted_sections: map.keys().cloned().collect(),
                    section_contents: map.clone(),
                    tokens_used: self.tokens_used.load(std::sync::atomic::Ordering::Relaxed),
                };
                let _ = self.saver.save(&cp).await;
            }
        }

        let section_checkpoint = PerSectionCheckpoint {
            saver: checkpoint_saver,
            classification: classification.clone(),
            discovered_sections: discovered_sections.clone(),
            extracted: tokio::sync::Mutex::new(
                checkpoint.as_ref()
                    .map(|cp| cp.section_contents.clone())
                    .unwrap_or_default(),
            ),
            tokens_used: std::sync::atomic::AtomicU32::new(total_usage.total_tokens),
        };

        let (mut extracted_contents, extraction_usage) = extractor::extract_all(
            provider,
            &config.model,
            &classification.document_type,
            &section_ranges,
            analysis.chunk_size_chars,
            analysis.overlap_chars,
            config.max_concurrent_extractions,
            config.retry_max,
            &already_extracted,
            Some(&extract_progress),
            Some(&section_checkpoint),
            cancel,
        )
        .await?;

        // Merge in any previously extracted sections from checkpoint
        if let Some(ref cp) = checkpoint {
            for (name, content) in &cp.section_contents {
                if !extracted_contents.iter().any(|s| s.name == *name) {
                    extracted_contents.push(content.clone());
                }
            }
        }

        // Sort to match section_ranges order (includes Preamble at correct position)
        let section_order: HashMap<String, usize> = section_ranges
            .iter()
            .enumerate()
            .map(|(i, s)| (s.name.clone(), i))
            .collect();
        extracted_contents.sort_by_key(|s| section_order.get(&s.name).copied().unwrap_or(usize::MAX));

        total_usage.merge(&extraction_usage);
        stages.push(StageInfo {
            name: "extract".to_string(),
            duration_ms: stage_start.elapsed().as_millis() as u64,
            tokens_used: extraction_usage.total_tokens,
        });

        // Save checkpoint after extraction
        let cp = PipelineCheckpoint {
            stage: PipelineStage::Assemble,
            classification: Some(classification.clone()),
            discovered_sections: Some(discovered_sections.clone()),
            discovery_checkpoint: None,
            extracted_sections: extracted_contents.iter().map(|s| s.name.clone()).collect(),
            section_contents: extracted_contents
                .iter()
                .map(|s| (s.name.clone(), s.clone()))
                .collect(),
            tokens_used: total_usage.total_tokens,
        };
        let _ = checkpoint_saver.save(&cp).await;

        extracted_contents
    } else {
        // Restored from checkpoint — rebuild from section_contents
        let cp = checkpoint.as_ref().unwrap();
        let section_order: HashMap<String, usize> = discovered_sections
            .iter()
            .enumerate()
            .map(|(i, s)| (s.name.clone(), i))
            .collect();
        let mut contents: Vec<ExtractedSectionContent> =
            cp.section_contents.values().cloned().collect();
        contents.sort_by_key(|s| section_order.get(&s.name).copied().unwrap_or(usize::MAX));
        contents
    };

    // ── Stage 4: Assemble (pure Rust) ──────────────────────────────
    progress.update(total_work, total_work, "Assembling final document...");

    let stage_start = std::time::Instant::now();
    let (sections_tree, structured_markdown) = assembler::assemble(&extracted);

    stages.push(StageInfo {
        name: "assemble".to_string(),
        duration_ms: stage_start.elapsed().as_millis() as u64,
        tokens_used: 0,
    });

    let sections_extracted = extracted.len();
    // Compare against resolved section_ranges (not discovered), since some discovered
    // sections may have been merged during boundary resolution. Merged sections aren't
    // missing — their content is included in the adjacent section.
    let status = if sections_extracted >= section_ranges.len() {
        "success"
    } else {
        "partial"
    };

    Ok(ParsedDocument {
        document_type: classification.document_type,
        classification_confidence: classification.confidence,
        language: classification.language,
        sections: sections_tree,
        structured_markdown,
        discovery_chunks: discovered_sections.len(),
        sections_extracted,
        token_usage: total_usage,
        pipeline_stages: stages,
        status: status.to_string(),
    })
}

/// Check if the pipeline has been cancelled.
fn check_cancel(cancel: &AtomicBool) -> Result<(), PipelineError> {
    if cancel.load(Ordering::Relaxed) {
        Err(PipelineError::Cancelled)
    } else {
        Ok(())
    }
}

/// Check if we've exceeded the token budget. If so, return BudgetExceeded with the checkpoint.
fn check_budget(
    config: &PipelineConfig,
    usage: &TokenUsageSummary,
    checkpoint: &PipelineCheckpoint,
) -> Result<(), PipelineError> {
    if usage.total_tokens > config.max_token_budget {
        tracing::warn!(
            "Token budget exceeded: {} / {} tokens used",
            usage.total_tokens,
            config.max_token_budget
        );
        Err(PipelineError::BudgetExceeded(checkpoint.clone()))
    } else {
        Ok(())
    }
}
