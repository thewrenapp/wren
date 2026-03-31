use serde::Deserialize;

/// A section parsed from either `sections_json` or markdown headings.
#[derive(Debug, Clone)]
pub struct Section {
    pub name: String,
    pub level: u8,
    pub content: String,
}

/// A chunk with full provenance for citation.
#[derive(Debug, Clone)]
pub struct DocumentChunk {
    pub entry_id: i64,
    pub attachment_id: i64,
    pub attachment_title: String,
    pub section_name: String,
    pub section_level: i32,
    pub chunk_index: i32,
    pub text: String,
}

/// Section as stored in `parsed_content.sections_json` by the LLM pipeline assembler.
#[derive(Debug, Clone, Deserialize)]
pub struct ExtractedSection {
    pub name: String,
    pub level: u8,
    pub content: String,
    #[serde(default)]
    pub subsections: Vec<ExtractedSection>,
}

/// Parse `sections_json` into flat Section list.
pub fn sections_from_json(json_str: &str) -> Vec<Section> {
    let extracted: Vec<ExtractedSection> = serde_json::from_str(json_str).unwrap_or_default();
    let mut sections = Vec::new();
    flatten_sections(&extracted, &mut sections);
    sections
}

fn flatten_sections(extracted: &[ExtractedSection], out: &mut Vec<Section>) {
    for s in extracted {
        if !s.content.trim().is_empty() {
            out.push(Section {
                name: s.name.clone(),
                level: s.level,
                content: s.content.clone(),
            });
        }
        if !s.subsections.is_empty() {
            flatten_sections(&s.subsections, out);
        }
    }
}

/// Parse markdown headings from `structured_markdown` into sections.
///
/// Used for notes and documents without `sections_json` (e.g., backfilled notes).
/// Splits on lines starting with `#`.
pub fn sections_from_markdown(markdown: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut current_name = String::from("Introduction");
    let mut current_level: u8 = 1;
    let mut current_content = String::new();

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            // Flush current section
            if !current_content.trim().is_empty() {
                sections.push(Section {
                    name: current_name.clone(),
                    level: current_level,
                    content: current_content.trim().to_string(),
                });
            }

            // Parse heading level
            let hashes = trimmed.chars().take_while(|&c| c == '#').count();
            current_level = hashes.min(6) as u8;
            current_name = trimmed[hashes..].trim().to_string();
            current_content = String::new();
        } else {
            current_content.push_str(line);
            current_content.push('\n');
        }
    }

    // Flush last section
    if !current_content.trim().is_empty() {
        sections.push(Section {
            name: current_name,
            level: current_level,
            content: current_content.trim().to_string(),
        });
    }

    sections
}

/// Chunk sections into document chunks for embedding.
///
/// Short sections (< max_chars) become a single chunk.
/// Long sections are split at sentence boundaries.
pub fn chunk_sections(
    sections: &[Section],
    entry_id: i64,
    attachment_id: i64,
    attachment_title: &str,
    max_chars: usize,
) -> Vec<DocumentChunk> {
    let mut chunks = Vec::new();

    for section in sections {
        if section.content.len() <= max_chars {
            // Short section → single chunk
            chunks.push(DocumentChunk {
                entry_id,
                attachment_id,
                attachment_title: attachment_title.to_string(),
                section_name: section.name.clone(),
                section_level: section.level as i32,
                chunk_index: 0,
                text: section.content.clone(),
            });
        } else {
            // Long section → split at sentence boundaries
            let sub_chunks = split_at_sentences(&section.content, max_chars);
            for (i, text) in sub_chunks.into_iter().enumerate() {
                chunks.push(DocumentChunk {
                    entry_id,
                    attachment_id,
                    attachment_title: attachment_title.to_string(),
                    section_name: section.name.clone(),
                    section_level: section.level as i32,
                    chunk_index: i as i32,
                    text,
                });
            }
        }
    }

    chunks
}

/// Split text at sentence boundaries, keeping chunks under max_chars.
fn split_at_sentences(text: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    // Split on sentence-ending punctuation followed by whitespace
    let sentences = split_sentences(text);

    for sentence in sentences {
        if current.len() + sentence.len() > max_chars && !current.is_empty() {
            chunks.push(current.trim().to_string());
            current = String::new();
        }
        current.push_str(&sentence);
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    // If no chunks were produced (single very long sentence), force-split
    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.trim().to_string());
    }

    chunks
}

/// Simple sentence splitter: splits on `.`, `!`, `?` followed by whitespace.
fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();

    for i in 0..len {
        current.push(chars[i]);

        let is_sentence_end = (chars[i] == '.' || chars[i] == '!' || chars[i] == '?')
            && (i + 1 >= len || chars[i + 1].is_whitespace());

        if is_sentence_end {
            sentences.push(current.clone());
            current = String::new();
        }
    }

    if !current.is_empty() {
        sentences.push(current);
    }

    sentences
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sections_from_markdown() {
        let md = "# Introduction\nSome intro text.\n\n## Methods\nWe did stuff.\n\n### Sub-method\nDetails here.\n";
        let sections = sections_from_markdown(md);
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].name, "Introduction");
        assert_eq!(sections[0].level, 1);
        assert_eq!(sections[1].name, "Methods");
        assert_eq!(sections[1].level, 2);
        assert_eq!(sections[2].name, "Sub-method");
        assert_eq!(sections[2].level, 3);
    }

    #[test]
    fn test_chunk_short_section() {
        let sections = vec![Section {
            name: "Intro".to_string(),
            level: 1,
            content: "Short text.".to_string(),
        }];
        let chunks = chunk_sections(&sections, 1, 1, "test.pdf", 1000);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "Short text.");
    }

    #[test]
    fn test_split_sentences() {
        let text = "First sentence. Second sentence! Third? Yes.";
        let sentences = split_sentences(text);
        assert_eq!(sentences.len(), 4);
    }
}
