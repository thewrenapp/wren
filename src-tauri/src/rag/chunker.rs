use crate::search::parser::{DocumentSection, ParsedDocument};
use serde::{Deserialize, Serialize};

/// Configuration for document chunking.
pub struct ChunkConfig {
    /// Target characters per chunk (default: 1500, ~375 tokens).
    pub target_chunk_size: usize,
    /// Overlap between adjacent chunks (default: 200 chars).
    pub overlap_size: usize,
    /// Minimum characters to form a standalone chunk (default: 100).
    pub min_chunk_size: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            target_chunk_size: 1500,
            overlap_size: 200,
            min_chunk_size: 100,
        }
    }
}

/// A chunk of text extracted from a document, ready for embedding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentChunk {
    pub chunk_id: String,
    pub document_id: String,
    pub chunk_index: usize,
    pub page_number: Option<usize>,
    pub section_name: Option<String>,
    pub content: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub token_estimate: i64,
}

/// Chunk a parsed document into smaller pieces for embedding.
///
/// For code files, uses AST-based chunking via tree-sitter (respects function/class
/// boundaries). For prose files (PDF, DOCX, MD, etc.), uses paragraph-based chunking.
pub fn chunk_document(doc: &ParsedDocument, config: &ChunkConfig) -> Vec<DocumentChunk> {
    let is_code = is_code_file(&doc.filename);

    // For code files, try AST-based chunking on the full content
    if is_code {
        let full_text: String = doc
            .sections
            .iter()
            .map(|s| s.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        if !full_text.trim().is_empty() {
            if let Some(chunks) = try_ast_chunk(&doc.id, &full_text, &doc.filename, config) {
                if !chunks.is_empty() {
                    return chunks;
                }
            }
        }
        // Fall through to text-based chunking if AST parsing fails
    }

    // Prose/fallback: paragraph-based chunking per section
    let mut chunks = Vec::new();
    let mut chunk_index = 0;

    for section in &doc.sections {
        let section_chunks = chunk_section_prose(&doc.id, section, config, &mut chunk_index);
        chunks.extend(section_chunks);
    }

    // If no chunks produced, create a single chunk from all content
    if chunks.is_empty() {
        let full_text: String = doc
            .sections
            .iter()
            .map(|s| s.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        if !full_text.trim().is_empty() {
            chunks.push(DocumentChunk {
                chunk_id: uuid::Uuid::new_v4().to_string(),
                document_id: doc.id.clone(),
                chunk_index: 0,
                page_number: doc.sections.first().and_then(|s| s.page_number),
                section_name: doc.sections.first().and_then(|s| s.section_name.clone()),
                content: full_text.clone(),
                start_offset: 0,
                end_offset: full_text.len(),
                token_estimate: estimate_tokens(&full_text),
            });
        }
    }

    chunks
}

// ── AST-based chunking (tree-sitter) ─────────────────────────────

/// Try to chunk code using tree-sitter AST.
/// Returns None if the language isn't supported or parsing fails.
fn try_ast_chunk(
    document_id: &str,
    code: &str,
    filename: &str,
    config: &ChunkConfig,
) -> Option<Vec<DocumentChunk>> {
    let lang = detect_tree_sitter_language(filename)?;
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&lang).ok()?;

    let tree = parser.parse(code.as_bytes(), None)?;
    let root = tree.root_node();

    let raw_chunks = split_node(root, code, config.target_chunk_size);

    let mut result = Vec::new();
    for (idx, (start_byte, end_byte)) in raw_chunks.iter().enumerate() {
        let text = &code[*start_byte..*end_byte];
        if text.trim().is_empty() {
            continue;
        }
        result.push(DocumentChunk {
            chunk_id: uuid::Uuid::new_v4().to_string(),
            document_id: document_id.to_string(),
            chunk_index: idx,
            page_number: None,
            section_name: None,
            content: text.to_string(),
            start_offset: *start_byte,
            end_offset: *end_byte,
            token_estimate: estimate_tokens(text),
        });
    }

    Some(result)
}

/// Recursively split an AST node into chunks that fit within max_size.
/// Same algorithm as code-splitter: DFS, split oversized nodes into children,
/// merge adjacent small siblings greedily.
fn split_node(
    node: tree_sitter::Node,
    code: &str,
    max_size: usize,
) -> Vec<(usize, usize)> {
    let node_text = &code[node.byte_range()];
    let node_size = node_text.len();

    // If this node fits, return it as a single chunk
    if node_size <= max_size {
        return vec![(node.start_byte(), node.end_byte())];
    }

    // If this node has no children (leaf that's too big), hard-split by lines
    if node.child_count() == 0 {
        return hard_split_text(node.start_byte(), node_text, max_size);
    }

    // Recurse into children, then merge adjacent small chunks
    let mut child_chunks: Vec<(usize, usize)> = Vec::new();
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        let sub_chunks = split_node(child, code, max_size);
        child_chunks.extend(sub_chunks);
    }

    // Merge adjacent chunks if combined size <= max_size
    merge_adjacent(child_chunks, code, max_size)
}

/// Merge adjacent chunk ranges if their combined text fits within max_size.
fn merge_adjacent(
    chunks: Vec<(usize, usize)>,
    code: &str,
    max_size: usize,
) -> Vec<(usize, usize)> {
    if chunks.is_empty() {
        return chunks;
    }

    let mut merged: Vec<(usize, usize)> = Vec::new();
    let mut current = chunks[0];

    for next in chunks.iter().skip(1) {
        let combined_text = &code[current.0..next.1];

        if combined_text.len() <= max_size {
            // Merge: extend current to include next
            current.1 = next.1;
        } else {
            // Can't merge: flush current, start new
            merged.push(current);
            current = *next;
        }
    }
    merged.push(current);

    merged
}

/// Hard-split a large leaf node by line boundaries.
fn hard_split_text(base_offset: usize, text: &str, max_size: usize) -> Vec<(usize, usize)> {
    let mut chunks = Vec::new();
    let mut current_start = 0;
    let mut current_len = 0;

    for line in text.split_inclusive('\n') {
        if current_len + line.len() > max_size && current_len > 0 {
            chunks.push((
                base_offset + current_start,
                base_offset + current_start + current_len,
            ));
            current_start += current_len;
            current_len = 0;
        }
        current_len += line.len();
    }

    if current_len > 0 {
        chunks.push((
            base_offset + current_start,
            base_offset + current_start + current_len,
        ));
    }

    chunks
}

/// Detect tree-sitter language from file extension.
/// Returns None for unsupported languages (falls back to text-based chunking).
fn detect_tree_sitter_language(filename: &str) -> Option<tree_sitter::Language> {
    let ext = filename.rsplit('.').next()?.to_lowercase();

    let lang = match ext.as_str() {
        "rs" => tree_sitter_rust::LANGUAGE,
        "py" | "pyi" | "pyw" => tree_sitter_python::LANGUAGE,
        "js" | "mjs" | "cjs" | "jsx" => tree_sitter_javascript::LANGUAGE,
        "ts" | "mts" | "tsx" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
        "go" => tree_sitter_go::LANGUAGE,
        "java" => tree_sitter_java::LANGUAGE,
        "c" | "h" => tree_sitter_c::LANGUAGE,
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" | "mm" => tree_sitter_cpp::LANGUAGE,
        "rb" => tree_sitter_ruby::LANGUAGE,
        "json" | "jsonl" => tree_sitter_json::LANGUAGE,
        "css" | "scss" => tree_sitter_css::LANGUAGE,
        "html" | "htm" => tree_sitter_html::LANGUAGE,
        "sh" | "bash" | "zsh" => tree_sitter_bash::LANGUAGE,
        "lua" => tree_sitter_lua::LANGUAGE,
        "swift" => tree_sitter_swift::LANGUAGE,
        "md" | "markdown" => tree_sitter_md::LANGUAGE,
        "toml" => tree_sitter_toml_ng::LANGUAGE,
        _ => return None,
    };

    Some(lang.into())
}

/// Check if a filename corresponds to a code file that should use AST chunking.
fn is_code_file(filename: &str) -> bool {
    let ext = match filename.rsplit('.').next() {
        Some(e) => e.to_lowercase(),
        None => return false,
    };

    matches!(
        ext.as_str(),
        // Languages with tree-sitter support (AST chunking)
        "rs" | "py" | "pyi" | "pyw"
            | "js" | "mjs" | "cjs" | "jsx"
            | "ts" | "mts" | "tsx"
            | "go" | "java"
            | "c" | "h" | "cpp" | "cc" | "cxx" | "hpp" | "hxx" | "mm"
            | "rb" | "json" | "jsonl"
            | "css" | "scss"
            | "html" | "htm"
            | "sh" | "bash" | "zsh"
            | "lua" | "swift"
            | "md" | "markdown"
            | "toml"
            // Languages without tree-sitter but still code (will fall through to text chunking)
            | "php" | "kt" | "kts" | "scala" | "zig" | "nim" | "dart"
            | "ex" | "exs" | "erl" | "hrl" | "clj" | "cljs" | "cljc"
            | "hs" | "lhs" | "ml" | "mli" | "fs" | "fsi" | "fsx"
            | "jl" | "r" | "rmd" | "sql" | "pl" | "pm"
            | "groovy" | "gvy" | "tf" | "hcl"
            | "vue" | "svelte" | "astro"
            | "graphql" | "gql" | "proto" | "thrift"
            | "v" | "vala" | "d" | "pas" | "bat" | "cmd" | "ps1" | "fish"
    )
}

// ── Prose-based chunking (paragraph splitting) ───────────────────

fn chunk_section_prose(
    document_id: &str,
    section: &DocumentSection,
    config: &ChunkConfig,
    chunk_index: &mut usize,
) -> Vec<DocumentChunk> {
    let text = &section.content;
    if text.trim().is_empty() {
        return Vec::new();
    }

    // If section is small enough, return as single chunk
    if text.len() <= config.target_chunk_size {
        let chunk = DocumentChunk {
            chunk_id: uuid::Uuid::new_v4().to_string(),
            document_id: document_id.to_string(),
            chunk_index: *chunk_index,
            page_number: section.page_number,
            section_name: section.section_name.clone(),
            content: text.to_string(),
            start_offset: section.start_offset,
            end_offset: section.end_offset,
            token_estimate: estimate_tokens(text),
        };
        *chunk_index += 1;
        return vec![chunk];
    }

    // Split by paragraphs, then greedily accumulate
    let paragraph_splits = split_by_paragraphs(text);
    let mut chunks = Vec::new();
    let mut current_text = String::new();
    let mut current_start = 0;

    for (para_offset, para_text) in paragraph_splits {
        if !current_text.is_empty()
            && current_text.len() + para_text.len() > config.target_chunk_size
        {
            let abs_start = section.start_offset + current_start;
            let abs_end = abs_start + current_text.len();
            chunks.push(DocumentChunk {
                chunk_id: uuid::Uuid::new_v4().to_string(),
                document_id: document_id.to_string(),
                chunk_index: *chunk_index,
                page_number: section.page_number,
                section_name: section.section_name.clone(),
                content: current_text.clone(),
                start_offset: abs_start,
                end_offset: abs_end,
                token_estimate: estimate_tokens(&current_text),
            });
            *chunk_index += 1;

            // Start new chunk with overlap (snap to char boundary for multi-byte UTF-8)
            let mut overlap_start = if current_text.len() > config.overlap_size {
                current_text.len() - config.overlap_size
            } else {
                0
            };
            while overlap_start < current_text.len()
                && !current_text.is_char_boundary(overlap_start)
            {
                overlap_start += 1;
            }
            current_text.drain(..overlap_start);
            current_start = para_offset.saturating_sub(current_text.len());
        }

        if current_text.is_empty() {
            current_start = para_offset;
        }
        current_text.push_str(para_text);
    }

    // Flush remaining
    if current_text.len() >= config.min_chunk_size {
        let abs_start = section.start_offset + current_start;
        let abs_end = abs_start + current_text.len();
        chunks.push(DocumentChunk {
            chunk_id: uuid::Uuid::new_v4().to_string(),
            document_id: document_id.to_string(),
            chunk_index: *chunk_index,
            page_number: section.page_number,
            section_name: section.section_name.clone(),
            content: current_text.clone(),
            start_offset: abs_start,
            end_offset: abs_end,
            token_estimate: estimate_tokens(&current_text),
        });
        *chunk_index += 1;
    } else if !current_text.trim().is_empty() {
        if let Some(last) = chunks.last_mut() {
            last.content.push_str(&current_text);
            last.end_offset = section.start_offset + current_start + current_text.len();
            last.token_estimate = estimate_tokens(&last.content);
        } else {
            let abs_start = section.start_offset + current_start;
            chunks.push(DocumentChunk {
                chunk_id: uuid::Uuid::new_v4().to_string(),
                document_id: document_id.to_string(),
                chunk_index: *chunk_index,
                page_number: section.page_number,
                section_name: section.section_name.clone(),
                content: current_text.clone(),
                start_offset: abs_start,
                end_offset: abs_start + current_text.len(),
                token_estimate: estimate_tokens(&current_text),
            });
            *chunk_index += 1;
        }
    }

    chunks
}

// ── Shared utilities ─────────────────────────────────────────────

/// Split text by paragraph boundaries (double newlines).
fn split_by_paragraphs(text: &str) -> Vec<(usize, &str)> {
    let mut result = Vec::new();
    let mut pos = 0;

    for part in text.split("\n\n") {
        if !part.is_empty() {
            result.push((pos, part));
        }
        pos += part.len() + 2;
    }

    // If no paragraph splits, split by single newlines for dense text
    if result.len() <= 1 && text.len() > 3000 {
        result.clear();
        pos = 0;
        for line in text.split('\n') {
            if !line.is_empty() {
                result.push((pos, line));
            }
            pos += line.len() + 1;
        }
    }

    result
}

/// Rough token estimate (~4 chars per token).
fn estimate_tokens(text: &str) -> i64 {
    (text.len() as f64 / 4.0).ceil() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::parser::{DocumentSection, DocumentType, ParsedDocument};

    fn make_doc(filename: &str, sections: Vec<DocumentSection>) -> ParsedDocument {
        let total_chars = sections.iter().map(|s| s.content.len()).sum();
        ParsedDocument {
            id: "test-doc".to_string(),
            filename: filename.to_string(),
            document_type: DocumentType::PlainText,
            total_chars,
            total_pages: None,
            sections,
            metadata: serde_json::json!({}),
        }
    }

    #[test]
    fn test_small_section_single_chunk() {
        let doc = make_doc(
            "test.txt",
            vec![DocumentSection {
                page_number: None,
                section_name: None,
                content: "Hello world".to_string(),
                start_offset: 0,
                end_offset: 11,
            }],
        );
        let chunks = chunk_document(&doc, &ChunkConfig::default());
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content, "Hello world");
    }

    #[test]
    fn test_large_prose_multiple_chunks() {
        let text = "A".repeat(4000);
        let doc = make_doc(
            "test.txt",
            vec![DocumentSection {
                page_number: Some(1),
                section_name: Some("Test".to_string()),
                content: text,
                start_offset: 0,
                end_offset: 4000,
            }],
        );
        let config = ChunkConfig {
            target_chunk_size: 1500,
            overlap_size: 200,
            min_chunk_size: 100,
        };
        let chunks = chunk_document(&doc, &config);
        assert!(chunks.len() >= 2);
        for chunk in &chunks {
            assert_eq!(chunk.page_number, Some(1));
        }
    }

    #[test]
    fn test_rust_code_ast_chunking() {
        let code = r#"
fn hello() {
    println!("hello");
}

fn world() {
    println!("world");
}

struct Foo {
    bar: i32,
    baz: String,
}

impl Foo {
    fn new() -> Self {
        Foo { bar: 0, baz: String::new() }
    }

    fn method(&self) -> i32 {
        self.bar
    }
}
"#;
        let doc = make_doc(
            "test.rs",
            vec![DocumentSection {
                page_number: None,
                section_name: None,
                content: code.to_string(),
                start_offset: 0,
                end_offset: code.len(),
            }],
        );
        let config = ChunkConfig {
            target_chunk_size: 200,
            overlap_size: 0,
            min_chunk_size: 10,
        };
        let chunks = chunk_document(&doc, &config);
        assert!(chunks.len() >= 2, "Rust code should be split into multiple AST chunks");
        // Each chunk should contain valid Rust constructs, not arbitrary line breaks
        for chunk in &chunks {
            assert!(!chunk.content.trim().is_empty());
        }
    }

    #[test]
    fn test_is_code_file() {
        assert!(is_code_file("main.rs"));
        assert!(is_code_file("app.tsx"));
        assert!(is_code_file("script.py"));
        assert!(is_code_file("Makefile.go"));
        assert!(!is_code_file("document.pdf"));
        assert!(!is_code_file("notes.txt"));
        assert!(!is_code_file("report.docx"));
    }
}
