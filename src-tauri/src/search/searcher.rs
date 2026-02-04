use anyhow::Result;
use serde::Serialize;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{OwnedValue, Value};
use tantivy::{Index, ReloadPolicy, Snippet, SnippetGenerator, TantivyDocument};

use super::schema::SearchFields;

/// Result from a full-text search
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullSearchResult {
    pub entry_id: i64,
    pub entry_key: String,
    pub attachment_id: Option<i64>,
    pub title: Option<String>,
    pub snippet: Option<String>,
    pub content_source: String,
    pub score: f32,
}

/// Execute a full-text search query
pub fn full_text_search(
    index: &Index,
    fields: &SearchFields,
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<FullSearchResult>> {
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()?;

    let searcher = reader.searcher();

    // Build query parser to search across multiple fields
    let query_parser = QueryParser::for_index(
        index,
        vec![
            fields.title,
            fields.creators,
            fields.abstract_text,
            fields.content,
        ],
    );

    let parsed_query = query_parser.parse_query(query)?;

    // Search with limit + offset
    let top_docs = searcher.search(&parsed_query, &TopDocs::with_limit(limit + offset))?;

    // Create snippet generator for content field
    let snippet_generator = SnippetGenerator::create(&searcher, &parsed_query, fields.content)?;

    let mut results = Vec::new();

    for (i, (score, doc_address)) in top_docs.into_iter().enumerate() {
        // Skip offset results
        if i < offset {
            continue;
        }

        let retrieved_doc: TantivyDocument = searcher.doc(doc_address)?;

        // Helper function to extract i64 from OwnedValue
        fn get_i64(doc: &TantivyDocument, field: tantivy::schema::Field) -> Option<i64> {
            doc.get_first(field).and_then(|v: &OwnedValue| v.as_i64())
        }

        // Helper function to extract str from OwnedValue
        fn get_str<'a>(doc: &'a TantivyDocument, field: tantivy::schema::Field) -> Option<&'a str> {
            doc.get_first(field).and_then(|v: &OwnedValue| v.as_str())
        }

        // Extract fields
        let entry_id = get_i64(&retrieved_doc, fields.entry_id).unwrap_or(0);
        let entry_key = get_str(&retrieved_doc, fields.entry_key).unwrap_or("").to_string();
        let attachment_id = get_i64(&retrieved_doc, fields.attachment_id).filter(|&id| id != 0);
        let title = get_str(&retrieved_doc, fields.title)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let content_source = get_str(&retrieved_doc, fields.content_source)
            .unwrap_or("unknown")
            .to_string();

        // Generate snippet from content
        let snippet = {
            let content = get_str(&retrieved_doc, fields.content).unwrap_or("");

            if !content.is_empty() {
                let snippet = snippet_generator.snippet(content);
                Some(snippet_to_html(&snippet))
            } else {
                // Try to generate snippet from abstract
                let abstract_text = get_str(&retrieved_doc, fields.abstract_text).unwrap_or("");

                if !abstract_text.is_empty() {
                    // Truncate abstract as snippet
                    Some(truncate_text(abstract_text, 200))
                } else {
                    None
                }
            }
        };

        results.push(FullSearchResult {
            entry_id,
            entry_key,
            attachment_id,
            title,
            snippet,
            content_source,
            score,
        });
    }

    Ok(results)
}

/// Convert Tantivy Snippet to HTML with highlight markers
fn snippet_to_html(snippet: &Snippet) -> String {
    let mut html = String::new();
    let mut current_pos = 0;
    let fragment = snippet.fragment();

    for highlight in snippet.highlighted() {
        // Add text before highlight
        if highlight.start > current_pos {
            html.push_str(&html_escape(&fragment[current_pos..highlight.start]));
        }
        // Add highlighted text
        html.push_str("<mark>");
        html.push_str(&html_escape(&fragment[highlight.start..highlight.end]));
        html.push_str("</mark>");
        current_pos = highlight.end;
    }

    // Add remaining text
    if current_pos < fragment.len() {
        html.push_str(&html_escape(&fragment[current_pos..]));
    }

    html
}

/// Simple HTML escaping
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Truncate text to a maximum length, breaking at word boundaries
fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        return text.to_string();
    }

    let truncated = &text[..max_len];
    if let Some(last_space) = truncated.rfind(' ') {
        format!("{}...", &truncated[..last_space])
    } else {
        format!("{}...", truncated)
    }
}
