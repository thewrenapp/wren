/// Default context window sizes per provider/model.
///
/// Used by the pipeline to compute chunk sizes dynamically.
/// Users can override the context window in settings.

#[derive(Debug, Clone)]
pub struct ModelContext {
    /// Total context window in tokens.
    pub context_window: usize,
    /// Usable tokens per chunk after subtracting prompt overhead.
    pub effective_chunk_tokens: usize,
    /// Usable chars per chunk (tokens × 4).
    pub effective_chunk_chars: usize,
}

/// Prompt overhead: system prompt + carry-forward summary + output room.
const PROMPT_OVERHEAD_TOKENS: usize = 2000;

/// We use 60% of available context for the actual text chunk,
/// leaving 40% for prompt, carry-forward summary, and output.
const CHUNK_RATIO: f64 = 0.6;

impl ModelContext {
    fn new(context_window: usize) -> Self {
        let available = context_window.saturating_sub(PROMPT_OVERHEAD_TOKENS);
        let effective_chunk_tokens = (available as f64 * CHUNK_RATIO) as usize;
        Self {
            context_window,
            effective_chunk_tokens,
            effective_chunk_chars: effective_chunk_tokens * 4,
        }
    }
}

/// Returns the default context window for known providers/models.
///
/// Unknown models default to a conservative 8K context.
pub fn default_context(provider: &str, model: &str) -> ModelContext {
    let context_window = match provider.to_lowercase().as_str() {
        "openai" => openai_context(model),
        "anthropic" => anthropic_context(model),
        "gemini" | "google" => gemini_context(model),
        "ollama" => ollama_context(model),
        "omlx" | "lmstudio" => omlx_context(model),
        "builtin" => 4_096,
        _ => 8_192, // conservative default for unknown providers
    };
    ModelContext::new(context_window)
}

/// Build a ModelContext from a user-specified context window override.
pub fn from_override(context_window: usize) -> ModelContext {
    ModelContext::new(context_window)
}

fn openai_context(model: &str) -> usize {
    let m = model.to_lowercase();
    if m.contains("gpt-4o") || m.contains("gpt-4.1") || m.contains("chatgpt-4o") {
        128_000
    } else if m.contains("gpt-4-turbo") {
        128_000
    } else if m.contains("gpt-4") {
        8_192
    } else if m.contains("gpt-3.5") {
        16_385
    } else if m.contains("o1") || m.contains("o3") || m.contains("o4") {
        200_000
    } else {
        128_000 // default for newer OpenAI models
    }
}

fn anthropic_context(model: &str) -> usize {
    let m = model.to_lowercase();
    if m.contains("claude-3") || m.contains("claude-4") {
        200_000
    } else {
        100_000 // older Claude models
    }
}

fn gemini_context(model: &str) -> usize {
    let m = model.to_lowercase();
    if m.contains("1.5") || m.contains("2.0") || m.contains("2.5") {
        1_000_000
    } else {
        32_000
    }
}

fn ollama_context(_model: &str) -> usize {
    // Conservative default – most local models have 4K-8K context.
    // Users should override this in settings if their model supports more.
    8_192
}

fn omlx_context(_model: &str) -> usize {
    // oMLX models typically have large context windows (32K-128K+).
    // Users explicitly load models in oMLX and can configure context there.
    // Default to 32K which is safe for most modern models.
    32_768
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_defaults() {
        let ctx = default_context("openai", "gpt-4o-mini");
        assert_eq!(ctx.context_window, 128_000);
        // (128000 - 2000) * 0.6 = 75600
        assert_eq!(ctx.effective_chunk_tokens, 75_600);
        assert_eq!(ctx.effective_chunk_chars, 302_400);
    }

    #[test]
    fn test_ollama_defaults() {
        let ctx = default_context("ollama", "llama3");
        assert_eq!(ctx.context_window, 8_192);
        // (8192 - 2000) * 0.6 = 3715
        assert_eq!(ctx.effective_chunk_tokens, 3_715);
    }

    #[test]
    fn test_unknown_provider() {
        let ctx = default_context("foo", "bar");
        assert_eq!(ctx.context_window, 8_192);
    }

    #[test]
    fn test_from_override() {
        let ctx = from_override(32_000);
        assert_eq!(ctx.context_window, 32_000);
        assert_eq!(ctx.effective_chunk_tokens, 18_000); // (32000-2000)*0.6
    }
}
