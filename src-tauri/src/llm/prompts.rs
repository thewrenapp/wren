use crate::llm::provider::{ChatMessage, MessageRole, ToolDefinition};

// ── Stage 1: Classification ─────────────────────────────────────────

/// Build messages + tool definition for document classification.
pub fn classification_prompt(
    text_sample: &str,
    title: Option<&str>,
    authors: Option<&str>,
    abstract_text: Option<&str>,
    item_type: Option<&str>,
) -> (Vec<ChatMessage>, Vec<ToolDefinition>) {
    let mut metadata_parts = Vec::new();
    if let Some(t) = title {
        metadata_parts.push(format!("Title: {t}"));
    }
    if let Some(a) = authors {
        metadata_parts.push(format!("Authors: {a}"));
    }
    if let Some(abs) = abstract_text {
        metadata_parts.push(format!("Abstract: {abs}"));
    }
    if let Some(it) = item_type {
        metadata_parts.push(format!("Library item type: {it}"));
    }

    let metadata_section = if metadata_parts.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nEntry metadata:\n{}",
            metadata_parts.join("\n")
        )
    };

    let messages = vec![
        ChatMessage {
            role: MessageRole::System,
            content: "You are a document analysis assistant. Analyze the beginning of a document \
                      and its metadata. Classify its type and language. Call the classify_document \
                      tool with your findings."
                .to_string(),
            tool_call_id: None,
        },
        ChatMessage {
            role: MessageRole::User,
            content: format!(
                "Classify this document based on the text sample and metadata below.\n\n\
                 Text sample (first ~2000 characters):\n\
                 ---\n{text_sample}\n---{metadata_section}"
            ),
            tool_call_id: None,
        },
    ];

    let tool = ToolDefinition {
        name: "classify_document".to_string(),
        description: "Classify the document type and language.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "required": ["document_type", "confidence", "language", "reasoning"],
            "properties": {
                "document_type": {
                    "type": "string",
                    "description": "Free-form document type, e.g. 'research_paper', 'textbook', 'thesis', 'patent', 'technical_report', 'legal_case', 'book_chapter', 'news_article', 'blog_post', 'software_documentation', etc."
                },
                "confidence": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "description": "Confidence in the classification (0.0 to 1.0)"
                },
                "language": {
                    "type": "string",
                    "description": "ISO 639-1 language code (e.g. 'en', 'de', 'zh')"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of why this classification was chosen"
                }
            }
        }),
    };

    (messages, vec![tool])
}

/// Build JSON-mode fallback prompt for classification (when tools aren't supported).
pub fn classification_prompt_json(
    text_sample: &str,
    title: Option<&str>,
    authors: Option<&str>,
    abstract_text: Option<&str>,
    item_type: Option<&str>,
) -> Vec<ChatMessage> {
    let (mut messages, tools) = classification_prompt(text_sample, title, authors, abstract_text, item_type);

    // Append schema to user message
    let schema = &tools[0].parameters;
    if let Some(user_msg) = messages.last_mut() {
        user_msg.content.push_str(&format!(
            "\n\nRespond with a JSON object matching this schema:\n{}",
            serde_json::to_string_pretty(schema).unwrap_or_default()
        ));
    }

    messages
}

// ── Stage 2: Discovery ──────────────────────────────────────────────

/// Build messages + tools for section discovery (full text fits in one call).
pub fn discovery_prompt_single(
    full_text: &str,
    doc_type_hint: &str,
) -> (Vec<ChatMessage>, Vec<ToolDefinition>) {
    let messages = vec![
        ChatMessage {
            role: MessageRole::System,
            content: "You are a document structure analyst. Read the document text and identify \
                      ALL sections and subsections, from the very beginning to the very end. \
                      \n\nIMPORTANT:\n\
                      - Include preliminary sections like Abstract, Preface, Foreword, Summary, \
                        Executive Summary, etc. that appear before numbered sections.\n\
                      - Include ALL numbered subsections (e.g. if you see 4.1, also look for 4.2, 4.3, etc.).\n\
                      - Include back matter like Conclusion, Acknowledgment, References, Appendix, etc.\n\
                      - Do NOT skip any section, even if it is short.\n\n\
                      For each section you find, call report_section \
                      with the section name exactly as it appears in the text, its heading level, \
                      and the first ~50 characters of that section's content (for boundary matching). \
                      Do NOT extract the full content — only identify the sections."
                .to_string(),
            tool_call_id: None,
        },
        ChatMessage {
            role: MessageRole::User,
            content: format!(
                "This appears to be a {doc_type_hint}. \
                 Identify ALL sections and subsections in the following text, from the very first \
                 section to the last.\n\n\
                 ---\n{full_text}\n---"
            ),
            tool_call_id: None,
        },
    ];

    (messages, discovery_tools())
}

/// Build messages + tools for chunked discovery (one chunk at a time).
pub fn discovery_prompt_chunk(
    chunk_text: &str,
    doc_type_hint: &str,
    carry_forward: Option<&str>,
) -> (Vec<ChatMessage>, Vec<ToolDefinition>) {
    let context_note = if let Some(cf) = carry_forward {
        format!(
            "\n\nPrevious context (sections discovered so far):\n{cf}\n\n\
             Continue identifying sections from this chunk. If a section from the previous \
             context is still ongoing, do NOT re-report it. Only report NEW sections that \
             start in this chunk."
        )
    } else {
        "\n\nThis is the first chunk of the document.".to_string()
    };

    let messages = vec![
        ChatMessage {
            role: MessageRole::System,
            content: "You are a document structure analyst. Read a chunk of document text and \
                      identify any section/subsection headings that START in this chunk. \
                      \n\nIMPORTANT:\n\
                      - Include preliminary sections like Abstract, Preface, Foreword, etc.\n\
                      - Include ALL numbered subsections (e.g. if you see 4.1, also look for 4.2, 4.3, etc.).\n\
                      - Include back matter like Conclusion, Acknowledgment, References, Appendix.\n\
                      - Do NOT skip any section, even if it is short.\n\n\
                      For each new section, call report_section. \
                      If the chunk ends mid-section, call report_partial_section for the last \
                      incomplete section. \
                      Do NOT extract full content — only identify section boundaries."
                .to_string(),
            tool_call_id: None,
        },
        ChatMessage {
            role: MessageRole::User,
            content: format!(
                "This appears to be a {doc_type_hint}.{context_note}\n\n\
                 Current chunk:\n---\n{chunk_text}\n---"
            ),
            tool_call_id: None,
        },
    ];

    (messages, discovery_tools())
}

/// Build JSON-mode fallback for discovery.
pub fn discovery_prompt_json(
    text: &str,
    doc_type_hint: &str,
    carry_forward: Option<&str>,
    is_single: bool,
) -> Vec<ChatMessage> {
    let (mut messages, _tools) = if is_single {
        discovery_prompt_single(text, doc_type_hint)
    } else {
        discovery_prompt_chunk(text, doc_type_hint, carry_forward)
    };

    let schema = serde_json::json!({
        "type": "object",
        "required": ["sections"],
        "properties": {
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["name", "level", "starts_with"],
                    "properties": {
                        "name": {"type": "string"},
                        "level": {"type": "integer"},
                        "starts_with": {"type": "string"}
                    }
                }
            },
            "partial_section": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "last_content_snippet": {"type": "string"}
                }
            }
        }
    });

    if let Some(user_msg) = messages.last_mut() {
        user_msg.content.push_str(&format!(
            "\n\nRespond with a JSON object matching this schema:\n{}",
            serde_json::to_string_pretty(&schema).unwrap_or_default()
        ));
    }

    messages
}

fn discovery_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "report_section".to_string(),
            description: "Report a section or subsection found in the text.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "required": ["name", "level", "starts_with"],
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Section heading exactly as it appears in the text (e.g. '3.1. Loss Function')"
                    },
                    "level": {
                        "type": "integer",
                        "description": "Heading level: 1=top-level section, 2=subsection, 3=sub-subsection"
                    },
                    "starts_with": {
                        "type": "string",
                        "description": "First ~50 characters of the section content (after the heading), used for boundary matching"
                    }
                }
            }),
        },
        ToolDefinition {
            name: "report_partial_section".to_string(),
            description: "Report that the chunk ends mid-section (the section is still ongoing).".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "required": ["name", "last_content_snippet"],
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the section that was still ongoing when the chunk ended"
                    },
                    "last_content_snippet": {
                        "type": "string",
                        "description": "Last ~50 characters of content seen in this chunk (for context continuity)"
                    }
                }
            }),
        },
    ]
}

// ── Stage 3: Extraction ─────────────────────────────────────────────

/// Build messages + tool for cleaning a single section's raw text.
pub fn extraction_prompt(
    section_raw_text: &str,
    section_name: &str,
    doc_type_hint: &str,
) -> (Vec<ChatMessage>, Vec<ToolDefinition>) {
    let messages = vec![
        ChatMessage {
            role: MessageRole::System,
            content: format!(
                "You are a document text cleaner. You are given raw extracted text from a {doc_type_hint}. \
                 The text starts at the section '{section_name}'. \
                 Clean the text: remove repeated running headers, page numbers, \
                 figure/table captions that are mixed into the body text, and other extraction noise. \
                 \n\nIMPORTANT:\n\
                 - Preserve ALL actual document content verbatim — do not summarize, paraphrase, or omit content.\n\
                 - The text may contain content from subsequent sections or subsections. \
                   Include ALL of it — do NOT strip content that looks like it belongs to a different section.\n\
                 - Only remove extraction artifacts (repeated headers, page numbers, noise), not real document text.\n\n\
                 Call emit_clean_content with the cleaned text."
            ),
            tool_call_id: None,
        },
        ChatMessage {
            role: MessageRole::User,
            content: format!(
                "Clean the following raw text starting from section '{section_name}'. \
                 Preserve all content including any subsequent sections:\n\n---\n{section_raw_text}\n---"
            ),
            tool_call_id: None,
        },
    ];

    let tool = ToolDefinition {
        name: "emit_clean_content".to_string(),
        description: "Emit the cleaned content for this section.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "required": ["content"],
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The cleaned section text with noise removed, content preserved verbatim"
                }
            }
        }),
    };

    (messages, vec![tool])
}

/// Build JSON-mode fallback for extraction.
pub fn extraction_prompt_json(
    section_raw_text: &str,
    section_name: &str,
    doc_type_hint: &str,
) -> Vec<ChatMessage> {
    let (mut messages, tools) = extraction_prompt(section_raw_text, section_name, doc_type_hint);

    let schema = &tools[0].parameters;
    if let Some(user_msg) = messages.last_mut() {
        user_msg.content.push_str(&format!(
            "\n\nRespond with a JSON object matching this schema:\n{}",
            serde_json::to_string_pretty(schema).unwrap_or_default()
        ));
    }

    messages
}
