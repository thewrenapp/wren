use super::utf8::floor_char_boundary;
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
        char_count.div_ceil(step)
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
        let end = floor_char_boundary(text, FIRST_N_CHARS);
        text[..end].to_string()
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

/// Add line numbers to text for LLM processing.
///
/// Returns `(numbered_text, line_offsets)` where:
/// - `numbered_text` has `[N] ` prefixed to each line (1-indexed)
/// - `line_offsets[i]` is the byte offset where line `i+1` starts in the **original** text
///
/// Both discovery and extraction stages use this so the LLM can reference
/// positions precisely via line numbers.
pub fn add_line_numbers(text: &str) -> (String, Vec<usize>) {
    let mut numbered = String::with_capacity(text.len() + text.lines().count() * 6);
    let mut offsets: Vec<usize> = Vec::new();
    let mut byte_offset: usize = 0;

    for (i, line) in text.split('\n').enumerate() {
        offsets.push(byte_offset);
        use std::fmt::Write;
        let _ = write!(numbered, "[{}] {}", i + 1, line);
        if byte_offset + line.len() < text.len() {
            numbered.push('\n');
        }
        // +1 for the '\n' separator (except possibly the last line)
        byte_offset += line.len() + 1;
    }

    (numbered, offsets)
}

/// Resolve a 1-indexed line number to a byte offset in the original text.
/// Returns `None` if the line number is out of range.
pub fn line_to_offset(line_offsets: &[usize], line_number: u32) -> Option<usize> {
    if line_number == 0 {
        return None;
    }
    line_offsets.get((line_number - 1) as usize).copied()
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

    #[test]
    fn test_add_line_numbers_basic() {
        let text = "Abstract\nWe propose a framework.\n\n1. Introduction\nContent here.";
        let (numbered, offsets) = super::add_line_numbers(text);

        assert!(numbered.starts_with("[1] Abstract\n"));
        assert!(numbered.contains("[4] 1. Introduction\n"));
        assert_eq!(offsets.len(), 5);
        assert_eq!(offsets[0], 0); // line 1 starts at offset 0
        assert_eq!(&text[offsets[3]..offsets[3] + 17], "1. Introduction\nC");
    }

    #[test]
    fn test_add_line_numbers_single_line() {
        let text = "Hello world";
        let (numbered, offsets) = super::add_line_numbers(text);

        assert_eq!(numbered, "[1] Hello world");
        assert_eq!(offsets.len(), 1);
        assert_eq!(offsets[0], 0);
    }

    #[test]
    fn test_add_line_numbers_empty() {
        let (numbered, offsets) = super::add_line_numbers("");
        assert_eq!(numbered, "[1] ");
        assert_eq!(offsets.len(), 1);
    }

    #[test]
    fn test_line_to_offset() {
        let text = "Line one\nLine two\nLine three";
        let (_, offsets) = super::add_line_numbers(text);

        assert_eq!(super::line_to_offset(&offsets, 1), Some(0));
        assert_eq!(super::line_to_offset(&offsets, 2), Some(9));
        assert_eq!(super::line_to_offset(&offsets, 3), Some(18));
        assert_eq!(super::line_to_offset(&offsets, 0), None);
        assert_eq!(super::line_to_offset(&offsets, 4), None);
    }
}
