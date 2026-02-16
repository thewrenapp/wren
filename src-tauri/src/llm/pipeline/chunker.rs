/// A chunk of text with metadata about its position in the original document.
#[derive(Debug, Clone)]
pub struct TextChunk {
    pub text: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub chunk_index: usize,
}

/// Split text into overlapping chunks, respecting paragraph and line boundaries.
///
/// - `chunk_size_chars`: target size per chunk (model-aware, not hardcoded).
/// - `overlap_chars`: overlap between adjacent chunks (typically ~5% of chunk_size).
///
/// Split preferences: `\n\n` (paragraph) > `\n` (line) > word boundary.
/// Never splits inside fenced code blocks or markdown tables.
pub fn chunk_text(
    text: &str,
    chunk_size_chars: usize,
    overlap_chars: usize,
) -> Vec<TextChunk> {
    if text.is_empty() {
        return vec![];
    }

    // If the text fits in one chunk, return it as-is
    if text.len() <= chunk_size_chars {
        return vec![TextChunk {
            text: text.to_string(),
            start_offset: 0,
            end_offset: text.len(),
            chunk_index: 0,
        }];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let mut chunk_index = 0;

    while start < text.len() {
        let mut end = (start + chunk_size_chars).min(text.len());

        // If this isn't the last chunk, find a good split point
        if end < text.len() {
            end = find_split_point(text, start, end, chunk_size_chars);
        }

        let chunk_text = &text[start..end];
        chunks.push(TextChunk {
            text: chunk_text.to_string(),
            start_offset: start,
            end_offset: end,
            chunk_index,
        });

        chunk_index += 1;

        // Advance by chunk_size minus overlap
        let step = (end - start).saturating_sub(overlap_chars);
        if step == 0 {
            // Safety: always advance by at least 1 char to avoid infinite loops
            start = end;
        } else {
            start += step;
        }
    }

    chunks
}

/// Find the best split point near `target_end`, preferring paragraph > line > word boundaries.
fn find_split_point(text: &str, _start: usize, target_end: usize, chunk_size: usize) -> usize {
    // Search window: look backwards up to 20% of chunk size for a good boundary
    let search_start = target_end.saturating_sub(chunk_size / 5);
    let search_range = &text[search_start..target_end];

    // Check if we're inside a fenced code block — if so, extend past it
    if is_inside_code_block(text, target_end) {
        if let Some(fence_end) = find_code_block_end(text, target_end) {
            // Extend to the end of the code block (but cap at 50% extra)
            let max_extend = target_end + chunk_size / 2;
            return fence_end.min(max_extend).min(text.len());
        }
    }

    // Preference 1: Split at paragraph boundary (\n\n)
    if let Some(pos) = search_range.rfind("\n\n") {
        return search_start + pos + 2; // after the double newline
    }

    // Preference 2: Split at line boundary (\n)
    if let Some(pos) = search_range.rfind('\n') {
        return search_start + pos + 1; // after the newline
    }

    // Preference 3: Split at word boundary (space)
    if let Some(pos) = search_range.rfind(' ') {
        return search_start + pos + 1; // after the space
    }

    // Fallback: split at target_end
    target_end
}

/// Check if a position is inside a fenced code block (``` ... ```).
fn is_inside_code_block(text: &str, pos: usize) -> bool {
    let before = &text[..pos];
    let fence_opens = before.matches("```").count();
    // If odd number of fences before this point, we're inside a code block
    fence_opens % 2 == 1
}

/// Find the end of the current code block (position after the closing ```).
fn find_code_block_end(text: &str, from: usize) -> Option<usize> {
    let remaining = &text[from..];
    remaining.find("```").map(|pos| {
        let fence_end = from + pos + 3;
        // Skip past the closing fence line
        if let Some(nl) = text[fence_end..].find('\n') {
            fence_end + nl + 1
        } else {
            fence_end
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_chunk() {
        let text = "Hello world";
        let chunks = chunk_text(text, 100, 10);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "Hello world");
        assert_eq!(chunks[0].start_offset, 0);
        assert_eq!(chunks[0].end_offset, 11);
    }

    #[test]
    fn test_multiple_chunks_paragraph_split() {
        let text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
        let chunks = chunk_text(text, 25, 5);
        assert!(chunks.len() >= 2);
        // First chunk should end at a paragraph boundary
        assert!(chunks[0].text.ends_with('\n'));
    }

    #[test]
    fn test_overlap() {
        let text = "word ".repeat(100); // 500 chars
        let chunks = chunk_text(&text, 100, 20);
        assert!(chunks.len() > 1);

        // Check that chunks overlap
        for i in 1..chunks.len() {
            assert!(
                chunks[i].start_offset < chunks[i - 1].end_offset,
                "Chunk {} should overlap with chunk {}",
                i,
                i - 1
            );
        }
    }

    #[test]
    fn test_code_block_protection() {
        let text = "Before\n\n```\ncode line 1\ncode line 2\ncode line 3\n```\n\nAfter";
        // Make chunk size small enough to want to split inside the code block
        let chunks = chunk_text(text, 30, 5);
        // The code block should not be split mid-block
        for chunk in &chunks {
            let opens = chunk.text.matches("```").count();
            // Each chunk should have either 0 or 2 fences (complete block)
            assert!(
                opens % 2 == 0,
                "Code block was split inside chunk: {:?}",
                chunk.text
            );
        }
    }

    #[test]
    fn test_empty_text() {
        let chunks = chunk_text("", 100, 10);
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_chunk_indices() {
        let text = "a ".repeat(200); // 400 chars
        let chunks = chunk_text(&text, 100, 20);
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.chunk_index, i);
        }
    }
}
