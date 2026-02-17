pub mod anthropic;
pub mod context_windows;
pub mod gemini;
pub mod lmstudio;
pub mod ollama;
pub mod openai;
pub mod pipeline;
pub mod prompts;
pub mod provider;

use provider::LlmProvider;

/// Create the appropriate LLM provider based on provider name and settings.
///
/// For cloud providers (openai, anthropic, gemini), an API key is required.
/// For local providers (ollama, lmstudio), only a base URL is needed.
pub fn create_provider(
    provider_name: &str,
    api_key: String,
    base_url: String,
) -> Box<dyn LlmProvider> {
    match provider_name {
        "anthropic" => Box::new(anthropic::AnthropicProvider::new(api_key, base_url)),
        "gemini" => Box::new(gemini::GeminiProvider::new(api_key, base_url)),
        "ollama" => Box::new(ollama::OllamaProvider::new(base_url)),
        "lmstudio" => Box::new(lmstudio::LmStudioProvider::new(base_url)),
        _ => Box::new(openai::OpenAiProvider::new(api_key, base_url)),
    }
}

/// Returns true if the provider requires an API key.
pub fn provider_requires_api_key(provider_name: &str) -> bool {
    matches!(provider_name, "openai" | "anthropic" | "gemini")
}
