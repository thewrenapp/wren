//! AI-based metadata extraction from document text.

use serde::{Deserialize, Serialize};

use super::provider::{ChatMessage, CompletionRequest, LlmError, LlmProvider, MessageRole};

/// Extracted metadata from document text.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtractedMetadata {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub year: Option<String>,
    #[serde(default, rename = "abstract")]
    pub abstract_text: Option<String>,
    #[serde(default)]
    pub journal: Option<String>,
    #[serde(default)]
    pub doi: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub document_type: Option<String>,
}

const SYSTEM_PROMPT: &str = r#"You extract bibliographic metadata from the beginning of academic documents.

Return a JSON object with exactly these keys:
{
  "title": "Full paper title",
  "authors": ["FirstName LastName", "FirstName LastName"],
  "year": "2024",
  "abstract": "The abstract text if present, otherwise null",
  "journal": "Journal or conference name if mentioned, otherwise null",
  "doi": "DOI string if present, otherwise null",
  "keywords": ["keyword1", "keyword2"],
  "document_type": "journal_article"
}

Rules:
- "title": Extract the actual paper title from the text. Never use filenames or arXiv IDs as title.
- "authors": List ALL authors. Format each as "FirstName LastName". If affiliations are mixed in, extract just the names. Look for author lists after the title, often with superscript numbers or email addresses nearby.
- "year": The publication year. Look for it near the date, journal info, or copyright notice.
- "abstract": Full abstract text. Look for a section labeled "Abstract" or the first paragraph after authors.
- "document_type": One of: "journal_article", "conference_paper", "preprint", "thesis", "book", "report", "other"

Return ONLY the JSON object. No markdown fences, no explanation."#;

/// Extract metadata from document text using an LLM.
pub async fn extract_metadata(
    provider: &dyn LlmProvider,
    model: &str,
    extracted_text: &str,
) -> Result<ExtractedMetadata, LlmError> {
    // Take first ~5000 chars — some papers have long author lists and affiliations
    // before the abstract starts
    let max_chars = 5000;
    let text_sample = if extracted_text.len() > max_chars {
        // Don't cut mid-word
        let mut end = max_chars;
        while end > 0 && !extracted_text.is_char_boundary(end) {
            end -= 1;
        }
        &extracted_text[..end]
    } else {
        extracted_text
    };

    let request = CompletionRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: MessageRole::System,
                content: SYSTEM_PROMPT.to_string(),
                tool_call_id: None,
            },
            ChatMessage {
                role: MessageRole::User,
                content: format!("Extract metadata from this document text:\n\n{}", text_sample),
                tool_call_id: None,
            },
        ],
        temperature: 0.0,
        max_tokens: Some(2000),
        tools: Vec::new(),
        json_mode: true,
    };

    let response = provider.complete(request).await?;

    let content = response.content
        .ok_or_else(|| LlmError::ParseError("Empty response from LLM".to_string()))?;

    let content = content.trim();

    // Strip markdown code fences if the model wraps in ```json
    let json_str = if content.starts_with("```") {
        content
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        content
    };

    // Try to find JSON object if there's extra text around it
    let json_str = if let Some(start) = json_str.find('{') {
        if let Some(end) = json_str.rfind('}') {
            &json_str[start..=end]
        } else {
            json_str
        }
    } else {
        json_str
    };

    let metadata: ExtractedMetadata = serde_json::from_str(json_str)
        .map_err(|e| LlmError::ParseError(
            format!("Failed to parse metadata JSON: {}.\nRaw response: {}", e, &content[..content.len().min(500)])
        ))?;

    Ok(metadata)
}
