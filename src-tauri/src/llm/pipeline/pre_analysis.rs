use crate::llm::context_windows::ModelContext;

/// Pre-analysis result — purely computational stats.
/// No LLM calls, no regex, no semantic understanding.
#[derive(Debug, Clone)]
pub struct PreAnalysisResult {
    pub char_count: usize,
    pub word_count: usize,
    /// Rough estimate: chars / 4.
    pub estimated_tokens: usize,
    /// True if the document is too short to parse (< 500 chars).
    pub should_skip: bool,
    /// True if the document doesn't fit in one effective chunk.
    pub discovery_needs_chunking: bool,
    /// Model-aware chunk size in chars.
    pub chunk_size_chars: usize,
    /// Overlap between chunks in chars.
    pub overlap_chars: usize,
    /// How many chunks discovery will need (1 if it fits in one call).
    pub estimated_discovery_chunks: usize,
    /// Estimated total LLM calls: 1 (classify) + discovery_chunks + section_count_estimate.
    pub estimated_total_calls: usize,
    /// First ~2000 chars of the document (for classification).
    pub first_n_chars: String,
}

/// Minimum chars to bother parsing.
const MIN_CHARS: usize = 500;

/// Classification prompt uses the first N chars.
const FIRST_N_CHARS: usize = 2000;

/// Rough estimate of sections per 10K tokens (for call count estimation).
const SECTIONS_PER_10K_TOKENS: f64 = 3.0;

/// Analyze a document's extracted text and compute pipeline parameters.
pub fn analyze(text: &str, model_ctx: &ModelContext) -> PreAnalysisResult {
    let char_count = text.len();
    let word_count = text.split_whitespace().count();
    let estimated_tokens = char_count / 4;
    let should_skip = char_count < MIN_CHARS;

    let chunk_size_chars = model_ctx.effective_chunk_chars;
    // Overlap: ~5% of chunk size, clamped between 200 and 1000
    let overlap_chars = (chunk_size_chars / 20).clamp(200, 1000);

    let discovery_needs_chunking = estimated_tokens > model_ctx.effective_chunk_tokens;

    let estimated_discovery_chunks = if discovery_needs_chunking {
        // Account for overlap when estimating chunks
        let step = chunk_size_chars.saturating_sub(overlap_chars).max(1);
        (char_count + step - 1) / step
    } else {
        1
    };

    // Rough section count estimate for call count warning
    let estimated_sections = ((estimated_tokens as f64 / 10_000.0) * SECTIONS_PER_10K_TOKENS)
        .ceil()
        .max(3.0) as usize;

    // Total calls: 1 classify + N discover + M extract
    let estimated_total_calls = 1 + estimated_discovery_chunks + estimated_sections;

    let first_n_chars = if char_count > FIRST_N_CHARS {
        text[..FIRST_N_CHARS].to_string()
    } else {
        text.to_string()
    };

    PreAnalysisResult {
        char_count,
        word_count,
        estimated_tokens,
        should_skip,
        discovery_needs_chunking,
        chunk_size_chars,
        overlap_chars,
        estimated_discovery_chunks,
        estimated_total_calls,
        first_n_chars,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::context_windows;

    #[test]
    fn test_small_doc_no_chunking() {
        let text = "a ".repeat(2000); // 4000 chars ≈ 1000 tokens
        let ctx = context_windows::default_context("openai", "gpt-4o-mini");
        let result = analyze(&text, &ctx);

        assert!(!result.should_skip);
        assert!(!result.discovery_needs_chunking);
        assert_eq!(result.estimated_discovery_chunks, 1);
    }

    #[test]
    fn test_tiny_doc_skip() {
        let text = "Hello world.";
        let ctx = context_windows::default_context("openai", "gpt-4o-mini");
        let result = analyze(&text, &ctx);

        assert!(result.should_skip);
    }

    #[test]
    fn test_large_doc_needs_chunking_ollama() {
        // ~50K chars ≈ 12.5K tokens, exceeds Ollama's 3.7K effective chunk
        let text = "word ".repeat(10_000);
        let ctx = context_windows::default_context("ollama", "llama3");
        let result = analyze(&text, &ctx);

        assert!(result.discovery_needs_chunking);
        assert!(result.estimated_discovery_chunks > 1);
    }

    #[test]
    fn test_first_n_chars() {
        let text = "x".repeat(5000);
        let ctx = context_windows::default_context("openai", "gpt-4o");
        let result = analyze(&text, &ctx);

        assert_eq!(result.first_n_chars.len(), 2000);
    }
}
