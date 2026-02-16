/// Finds section boundaries in raw text using `starts_with` markers from discovery.
///
/// Pure Rust — no LLM calls, no regex.

/// A discovered section from the LLM discovery stage.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiscoveredSection {
    pub name: String,
    pub level: u8,
    /// First ~50 chars of section content, used as a boundary marker.
    pub starts_with: String,
}

/// A section with resolved character offsets in the original text.
#[derive(Debug, Clone)]
pub struct SectionRange {
    pub name: String,
    pub level: u8,
    pub start_offset: usize,
    pub end_offset: usize,
    /// The raw text slice for this section.
    pub raw_text: String,
}

/// Given discovered sections and the full text, find character offsets for each section.
///
/// Sections are assumed to appear in document order. Each section's end offset
/// is the start of the next section (or end of document for the last section).
pub fn find_section_ranges(
    sections: &[DiscoveredSection],
    full_text: &str,
) -> Vec<SectionRange> {
    if sections.is_empty() {
        return vec![];
    }

    let mut ranges: Vec<SectionRange> = Vec::with_capacity(sections.len());
    let mut search_from = 0;

    for (_i, section) in sections.iter().enumerate() {
        let found_offset = find_boundary(full_text, &section.starts_with, search_from);

        match found_offset {
            Some(offset) => {
                // Update the end_offset of the previous section
                if let Some(prev) = ranges.last_mut() {
                    prev.end_offset = offset;
                    prev.raw_text = full_text[prev.start_offset..prev.end_offset].to_string();
                }

                ranges.push(SectionRange {
                    name: section.name.clone(),
                    level: section.level,
                    start_offset: offset,
                    end_offset: full_text.len(), // will be updated by the next section
                    raw_text: String::new(),      // will be filled when end_offset is set
                });

                // Advance past the character at offset to avoid re-matching.
                // Must respect char boundaries (multi-byte UTF-8 like '•' is 3 bytes).
                let char_len = full_text[offset..]
                    .chars()
                    .next()
                    .map_or(1, |c| c.len_utf8());
                search_from = offset + char_len;
            }
            None => {
                // Boundary marker not found — log warning and merge with previous section
                tracing::warn!(
                    "Could not find boundary for section '{}' (starts_with: '{}'), merging with previous",
                    section.name,
                    section.starts_with,
                );

                // If this is the first section and we can't find it, start from 0
                if ranges.is_empty() {
                    ranges.push(SectionRange {
                        name: section.name.clone(),
                        level: section.level,
                        start_offset: 0,
                        end_offset: full_text.len(),
                        raw_text: String::new(),
                    });
                }
                // Otherwise, the previous section absorbs this one (no new range added)
            }
        }
    }

    // Fill in raw_text for the last section
    if let Some(last) = ranges.last_mut() {
        last.end_offset = full_text.len();
        last.raw_text = full_text[last.start_offset..last.end_offset].to_string();
    }

    // If the first section doesn't start at the beginning of the text,
    // check if there's meaningful content before it (preamble: title, abstract, etc.)
    if let Some(first) = ranges.first() {
        if first.start_offset > 0 {
            let preamble_text = full_text[..first.start_offset].trim();
            // Only create a preamble if there's substantial text (not just whitespace/short headers)
            if preamble_text.len() > 100 {
                tracing::info!(
                    "Found {} chars of preamble content before first section '{}' — creating Preamble section",
                    preamble_text.len(),
                    first.name,
                );
                ranges.insert(
                    0,
                    SectionRange {
                        name: "Preamble".to_string(),
                        level: 1,
                        start_offset: 0,
                        end_offset: first.start_offset,
                        raw_text: full_text[..first.start_offset].to_string(),
                    },
                );
            }
        }
    }

    ranges
}

/// Find the position of a boundary marker in the text, starting from `search_from`.
///
/// Tries exact match first, then falls back to case-insensitive + whitespace-normalized.
fn find_boundary(text: &str, marker: &str, search_from: usize) -> Option<usize> {
    // Ensure search_from is on a valid char boundary (safety guard for multi-byte UTF-8)
    let mut sf = search_from.min(text.len());
    while sf < text.len() && !text.is_char_boundary(sf) {
        sf += 1;
    }
    let search_text = &text[sf..];
    let marker_trimmed = marker.trim();

    if marker_trimmed.is_empty() {
        return None;
    }

    // Exact match
    if let Some(pos) = search_text.find(marker_trimmed) {
        return Some(sf + pos);
    }

    // Fuzzy match: case-insensitive
    let marker_lower = marker_trimmed.to_lowercase();
    let search_lower = search_text.to_lowercase();
    if let Some(pos) = search_lower.find(&marker_lower) {
        return Some(sf + pos);
    }

    // Fuzzy match: strip control characters + case-insensitive
    // PDF extraction often inserts control chars (e.g. \x02) for hyphenated line breaks
    let search_stripped = strip_control_chars(&search_lower);
    if search_stripped != search_lower {
        if let Some(pos) = search_stripped.find(&marker_lower) {
            // Map position back to original text
            let approx_pos = map_stripped_pos(search_text, pos);
            return Some(sf + approx_pos);
        }
    }

    // Fuzzy match: whitespace-normalized + control-chars-stripped + case-insensitive
    let marker_normalized = normalize_whitespace(&marker_lower);
    if marker_normalized.len() >= 10 {
        let search_normalized = normalize_whitespace(&search_stripped);
        if let Some(norm_pos) = search_normalized.find(&marker_normalized) {
            let approx_pos = map_normalized_pos(search_text, norm_pos);
            return Some(sf + approx_pos);
        }
    }

    // Fuzzy match: ASCII-normalized fallback (converts Unicode math symbols like 𝐶→C, 𝑡→t, 𝐻→H,
    // subscript/superscript digits, and strips other non-ASCII that PDF extractors/LLMs may
    // disagree on). Lowercase AFTER ASCII normalization since to_lowercase() doesn't affect
    // math Unicode.
    let marker_ascii = normalize_whitespace(&normalize_to_ascii(marker_trimmed).to_lowercase());
    if marker_ascii.len() >= 10 {
        let search_ascii = normalize_whitespace(&normalize_to_ascii(search_text).to_lowercase());
        if let Some(pos) = search_ascii.find(&marker_ascii) {
            let approx_pos = map_ascii_pos(search_text, pos);
            return Some(sf + approx_pos);
        }

        // Truncated prefix fallback: math formulas in markers are often garbled differently
        // between the LLM output and the PDF text. Try matching just the first ~30 normalized
        // chars (the plain-text prefix before any formula) to locate the section.
        let prefix_len = marker_ascii.len().min(30);
        // Find the last word boundary within the limit
        let prefix_end = marker_ascii[..prefix_len]
            .rfind(' ')
            .unwrap_or(prefix_len);
        if prefix_end >= 10 {
            let marker_prefix = &marker_ascii[..prefix_end];
            if let Some(pos) = search_ascii.find(marker_prefix) {
                tracing::info!(
                    "Matched section boundary using truncated prefix ({} chars): '{}'",
                    marker_prefix.len(),
                    marker_prefix,
                );
                let approx_pos = map_ascii_pos(search_text, pos);
                return Some(sf + approx_pos);
            }
        }
    }

    None
}

/// Strip control characters (0x00-0x1F except \n \r \t) that PDF extractors
/// insert for hyphenated line breaks, soft hyphens, etc.
fn strip_control_chars(s: &str) -> String {
    s.chars()
        .filter(|&c| c >= ' ' || c == '\n' || c == '\r' || c == '\t')
        .collect()
}

/// Map a position in the control-char-stripped text back to the original text.
fn map_stripped_pos(original: &str, stripped_pos: usize) -> usize {
    let mut stripped_idx = 0;
    for (i, ch) in original.char_indices() {
        if stripped_idx >= stripped_pos {
            return i;
        }
        if ch >= ' ' || ch == '\n' || ch == '\r' || ch == '\t' {
            stripped_idx += 1;
        }
    }
    original.len()
}

/// Collapse all whitespace sequences into a single space.
fn normalize_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalize text to ASCII: converts Unicode math symbols (𝐶→C, 𝑡→t, 𝐻→H),
/// subscript/superscript digits, and other styled Unicode to plain ASCII equivalents.
/// Non-mappable non-ASCII chars are replaced with spaces.
fn normalize_to_ascii(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii() {
                if c.is_ascii_alphanumeric() || c == ' ' {
                    c
                } else {
                    ' ' // punctuation → space to preserve word boundaries
                }
            } else if let Some(ascii) = math_unicode_to_ascii(c) {
                ascii
            } else {
                ' '
            }
        })
        .collect()
}

/// Map Unicode Mathematical Alphanumeric Symbols to ASCII equivalents.
/// Covers: Bold, Italic, Bold Italic, Script, Fraktur, Double-struck,
/// Sans-serif, Monospace, and their digit variants.
fn math_unicode_to_ascii(c: char) -> Option<char> {
    let cp = c as u32;

    // Mathematical Alphanumeric Symbols block: U+1D400..U+1D7FF
    // Each style has 26 uppercase (A-Z) then 26 lowercase (a-z)
    // Styles start at these offsets (uppercase):
    //   Bold=0x1D400, Italic=0x1D434, BoldItalic=0x1D468, Script=0x1D49C,
    //   BoldScript=0x1D4D0, Fraktur=0x1D504, DoubleStruck=0x1D538,
    //   BoldFraktur=0x1D56C, SansSerif=0x1D5A0, SansBold=0x1D5D4,
    //   SansItalic=0x1D608, SansBoldItalic=0x1D63C, Monospace=0x1D670
    const LETTER_STYLES: [(u32, u32); 13] = [
        (0x1D400, 0x1D41A), // Bold
        (0x1D434, 0x1D44E), // Italic
        (0x1D468, 0x1D482), // Bold Italic
        (0x1D49C, 0x1D4B6), // Script
        (0x1D4D0, 0x1D4EA), // Bold Script
        (0x1D504, 0x1D51E), // Fraktur
        (0x1D538, 0x1D552), // Double-Struck
        (0x1D56C, 0x1D586), // Bold Fraktur
        (0x1D5A0, 0x1D5BA), // Sans-Serif
        (0x1D5D4, 0x1D5EE), // Sans-Serif Bold
        (0x1D608, 0x1D622), // Sans-Serif Italic
        (0x1D63C, 0x1D656), // Sans-Serif Bold Italic
        (0x1D670, 0x1D68A), // Monospace
    ];

    for &(upper_start, lower_start) in &LETTER_STYLES {
        if cp >= upper_start && cp < upper_start + 26 {
            return Some((b'A' + (cp - upper_start) as u8) as char);
        }
        if cp >= lower_start && cp < lower_start + 26 {
            return Some((b'a' + (cp - lower_start) as u8) as char);
        }
    }

    // Mathematical digit styles (each has 10 digits 0-9)
    const DIGIT_STYLES: [u32; 5] = [
        0x1D7CE, // Bold
        0x1D7D8, // Double-Struck
        0x1D7E2, // Sans-Serif
        0x1D7EC, // Sans-Serif Bold
        0x1D7F6, // Monospace
    ];

    for &start in &DIGIT_STYLES {
        if cp >= start && cp < start + 10 {
            return Some((b'0' + (cp - start) as u8) as char);
        }
    }

    // Subscript digits (₀-₉)
    if cp >= 0x2080 && cp <= 0x2089 {
        return Some((b'0' + (cp - 0x2080) as u8) as char);
    }

    // Superscript digits (⁰ ¹ ² ³ ⁴-⁹)
    match cp {
        0x2070 => return Some('0'), // ⁰
        0x00B9 => return Some('1'), // ¹
        0x00B2 => return Some('2'), // ²
        0x00B3 => return Some('3'), // ³
        0x2074..=0x2079 => return Some((b'0' + (cp - 0x2070) as u8) as char), // ⁴-⁹
        _ => {}
    }

    // Subscript/superscript operators and letters
    match cp {
        0x208A => return Some('+'), // ₊
        0x208B => return Some('-'), // ₋
        0x208C => return Some('='), // ₌
        0x208D => return Some('('), // ₍
        0x208E => return Some(')'), // ₎
        0x207A => return Some('+'), // ⁺
        0x207B => return Some('-'), // ⁻
        0x207C => return Some('='), // ⁼
        0x207D => return Some('('), // ⁽
        0x207E => return Some(')'), // ⁾
        0x2071 => return Some('i'), // ⁱ
        0x207F => return Some('n'), // ⁿ
        0x2090 => return Some('a'), // ₐ
        0x2091 => return Some('e'), // ₑ
        0x2092 => return Some('o'), // ₒ
        0x2093 => return Some('x'), // ₓ
        0x2095 => return Some('h'), // ₕ
        0x2096 => return Some('k'), // ₖ
        0x2097 => return Some('l'), // ₗ
        0x2098 => return Some('m'), // ₘ
        0x2099 => return Some('n'), // ₙ
        0x209A => return Some('p'), // ₚ
        0x209B => return Some('s'), // ₛ
        0x209C => return Some('t'), // ₜ
        _ => {}
    }

    // Special cases outside the main block
    match cp {
        0x210E => Some('h'), // PLANCK CONSTANT (ℎ) — used as math italic h
        0x2102 => Some('C'), // DOUBLE-STRUCK CAPITAL C (ℂ)
        0x210D => Some('H'), // DOUBLE-STRUCK CAPITAL H (ℍ)
        0x2115 => Some('N'), // DOUBLE-STRUCK CAPITAL N (ℕ)
        0x2119 => Some('P'), // DOUBLE-STRUCK CAPITAL P (ℙ)
        0x211A => return Some('Q'), // DOUBLE-STRUCK CAPITAL Q (ℚ)
        0x211D => Some('R'), // DOUBLE-STRUCK CAPITAL R (ℝ)
        0x2124 => Some('Z'), // DOUBLE-STRUCK CAPITAL Z (ℤ)
        _ => None,
    }
}

/// Map a position in the ASCII-normalized text back to the original text.
fn map_ascii_pos(original: &str, ascii_pos: usize) -> usize {
    let normalized = normalize_whitespace(&normalize_to_ascii(&original.to_lowercase()));

    // Walk through the original text, counting positions in the normalized ASCII version
    let mut norm_idx = 0;
    let mut in_whitespace = false;
    for (i, ch) in original.char_indices() {
        if norm_idx >= ascii_pos {
            return i;
        }

        // Determine what this char becomes in normalized form
        let ascii_ch = if ch.is_ascii() {
            if ch.is_ascii_alphanumeric() || ch == ' ' { Some(ch) } else { Some(' ') }
        } else {
            math_unicode_to_ascii(ch).or(Some(' '))
        };

        let is_space = ascii_ch == Some(' ');
        if is_space {
            if !in_whitespace {
                norm_idx += 1;
                in_whitespace = true;
            }
        } else {
            norm_idx += 1;
            in_whitespace = false;
        }
    }

    // Proportional fallback
    if !normalized.is_empty() {
        let ratio = ascii_pos as f64 / normalized.len() as f64;
        return (ratio * original.len() as f64).min(original.len() as f64) as usize;
    }

    original.len()
}

/// Roughly map a position in normalized text back to the original text.
fn map_normalized_pos(original: &str, norm_pos: usize) -> usize {
    let mut orig_idx = 0;
    let mut norm_idx = 0;
    let mut in_whitespace = false;

    for (i, ch) in original.char_indices() {
        if norm_idx >= norm_pos {
            return i;
        }

        if ch.is_whitespace() {
            if !in_whitespace {
                norm_idx += 1; // count first whitespace char as the single space
                in_whitespace = true;
            }
            // skip subsequent whitespace
        } else {
            norm_idx += 1;
            in_whitespace = false;
        }
        orig_idx = i;
    }

    orig_idx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_sections() {
        let text = "Abstract: This paper studies...\n\n1. Introduction\nWe present a new approach...\n\n2. Methods\nOur methodology involves...";
        let sections = vec![
            DiscoveredSection {
                name: "Abstract".to_string(),
                level: 1,
                starts_with: "Abstract: This paper studies".to_string(),
            },
            DiscoveredSection {
                name: "1. Introduction".to_string(),
                level: 1,
                starts_with: "1. Introduction".to_string(),
            },
            DiscoveredSection {
                name: "2. Methods".to_string(),
                level: 1,
                starts_with: "2. Methods".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0].name, "Abstract");
        assert_eq!(ranges[1].name, "1. Introduction");
        assert_eq!(ranges[2].name, "2. Methods");

        // Each section's range should end where the next begins
        assert_eq!(ranges[0].end_offset, ranges[1].start_offset);
        assert_eq!(ranges[1].end_offset, ranges[2].start_offset);
        assert_eq!(ranges[2].end_offset, text.len());
    }

    #[test]
    fn test_case_insensitive_fallback() {
        let text = "ABSTRACT\nThis paper studies machine learning...";
        let sections = vec![DiscoveredSection {
            name: "Abstract".to_string(),
            level: 1,
            starts_with: "abstract".to_string(),
        }];

        let ranges = find_section_ranges(&sections, text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].start_offset, 0);
    }

    #[test]
    fn test_missing_boundary() {
        let text = "Some text here\n\n2. Methods\nSome methods...";
        let sections = vec![
            DiscoveredSection {
                name: "Abstract".to_string(),
                level: 1,
                starts_with: "this marker does not exist in text".to_string(),
            },
            DiscoveredSection {
                name: "2. Methods".to_string(),
                level: 1,
                starts_with: "2. Methods".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        // Abstract boundary not found, so it starts from 0 and gets overridden by Methods
        assert!(ranges.len() >= 1);
    }

    #[test]
    fn test_empty_sections() {
        let ranges = find_section_ranges(&[], "some text");
        assert!(ranges.is_empty());
    }

    #[test]
    fn test_preamble_created_when_content_before_first_section() {
        // Simulates a research paper where Abstract is missed by discovery
        // and the first discovered section is "1. Introduction"
        let text = "A Multi-Horizon Quantile Recurrent Forecaster\n\
                    Ruofeng Wen, Kari Torkkola\n\
                    Abstract\n\
                    We propose a framework for general probabilistic multi-step time series regression. \
                    Specifically, we exploit the expressiveness and temporal nature of Sequence-to-Sequence \
                    Neural Networks.\n\n\
                    1. Introduction\n\
                    Classical time series forecasting models aim to predict...";
        let sections = vec![
            DiscoveredSection {
                name: "1. Introduction".to_string(),
                level: 1,
                starts_with: "1. Introduction".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        // Should have 2 sections: Preamble + 1. Introduction
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].name, "Preamble");
        assert_eq!(ranges[0].start_offset, 0);
        assert_eq!(ranges[1].name, "1. Introduction");
        // Preamble should contain the abstract text
        assert!(ranges[0].raw_text.contains("Abstract"));
        assert!(ranges[0].raw_text.contains("We propose a framework"));
    }

    #[test]
    fn test_no_preamble_for_short_prefix() {
        // Very short text before first section should NOT create a preamble
        let text = "Title\n\n1. Introduction\nSome content here...";
        let sections = vec![
            DiscoveredSection {
                name: "1. Introduction".to_string(),
                level: 1,
                starts_with: "1. Introduction".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        // Should only have 1 section — no preamble for short prefix
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].name, "1. Introduction");
    }

    #[test]
    fn test_multibyte_utf8_boundary() {
        // The '•' character is 3 bytes (U+2022). If the first section's starts_with
        // begins right at '•', advancing search_from by +1 would land mid-character.
        let text = "Song Jiang∗\nUniversity of California•\n\n1. Introduction\nWe present...";
        let sections = vec![
            DiscoveredSection {
                name: "Preamble".to_string(),
                level: 1,
                starts_with: "Song Jiang∗".to_string(),
            },
            DiscoveredSection {
                name: "1. Introduction".to_string(),
                level: 1,
                starts_with: "1. Introduction".to_string(),
            },
        ];

        // This should NOT panic (previously would panic with "byte index is not a char boundary")
        let ranges = find_section_ranges(&sections, text);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].name, "Preamble");
        assert_eq!(ranges[1].name, "1. Introduction");
    }

    #[test]
    fn test_control_char_in_text_matches_clean_marker() {
        // PDF extractors often insert \x02 for hyphenated line breaks:
        // "prob\x02lems" in the raw text but LLM reports "problems"
        let text = "4.1. Amazon\nSome content here...\n\n4.2. GEFCom\nWe also applied forecasting prob\x02lems using datasets";
        let sections = vec![
            DiscoveredSection {
                name: "4.1. Amazon".to_string(),
                level: 2,
                starts_with: "Some content here".to_string(),
            },
            DiscoveredSection {
                name: "4.2. GEFCom".to_string(),
                level: 2,
                starts_with: "We also applied forecasting problems using datasets".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].name, "4.1. Amazon");
        assert_eq!(ranges[1].name, "4.2. GEFCom");
        // 4.2 should have been found despite the \x02 in "prob\x02lems"
        assert!(ranges[1].raw_text.contains("prob\x02lems"));
    }

    #[test]
    fn test_unicode_math_symbols_in_marker() {
        // LLM may report starts_with containing Unicode math italic letters (𝐶, 𝑡, 𝐻)
        // while PDF text uses regular ASCII letters (C, t, H)
        let text = "3.1 Periodic Prediction\nSome content...\n\n3.2 Non-periodic Prediction\nThe non-periodic series C = [Ct0+1, ...,Ct0+H] represents the overall trend";
        let sections = vec![
            DiscoveredSection {
                name: "3.1 Periodic Prediction".to_string(),
                level: 2,
                starts_with: "Some content".to_string(),
            },
            DiscoveredSection {
                name: "3.2 Non-periodic Prediction".to_string(),
                level: 2,
                // LLM uses math italic Unicode, text has plain ASCII
                starts_with: "The non-periodic series 𝐶 = [𝐶𝑡0+1, ...,𝐶𝑡0+𝐻] represents the overall trend".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].name, "3.1 Periodic Prediction");
        assert_eq!(ranges[1].name, "3.2 Non-periodic Prediction");
        assert!(ranges[1].raw_text.contains("The non-periodic series"));
    }

    #[test]
    fn test_truncated_prefix_fallback_for_garbled_math() {
        // PDF text has completely different math representation (subscript Unicode)
        // than what the LLM marker contains. Full normalized match fails, but the
        // plain-text prefix "The non-periodic series" should still match.
        let text = "3.1 Periodic Prediction\nSome content...\n\n3.2 Non-periodic Series Prediction\nThe non-periodic series C\u{0305} = [C\u{209C}\u{2080}+1, ...,C\u{209C}\u{2080}+H\u{0305}] represents the overall trend";
        let sections = vec![
            DiscoveredSection {
                name: "3.1 Periodic Prediction".to_string(),
                level: 2,
                starts_with: "Some content".to_string(),
            },
            DiscoveredSection {
                name: "3.2 Non-periodic Series Prediction".to_string(),
                level: 2,
                // LLM uses math italic Unicode, PDF has completely different representation
                starts_with: "The non-periodic series 𝐶 = [𝐶𝑡0+1, ...,𝐶𝑡0+𝐻 ] represents the overall trend".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].name, "3.1 Periodic Prediction");
        assert_eq!(ranges[1].name, "3.2 Non-periodic Series Prediction");
        assert!(ranges[1].raw_text.contains("The non-periodic series"));
    }

    #[test]
    fn test_subscript_superscript_normalization() {
        // PDF text uses subscript/superscript Unicode characters
        let text = "Section A\nContent about x₀ and x₁ values\n\nSection B\nMore content";
        let sections = vec![
            DiscoveredSection {
                name: "Section A".to_string(),
                level: 1,
                // LLM uses regular digits where PDF has subscripts
                starts_with: "Content about x0 and x1 values".to_string(),
            },
            DiscoveredSection {
                name: "Section B".to_string(),
                level: 1,
                starts_with: "More content".to_string(),
            },
        ];

        let ranges = find_section_ranges(&sections, text);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].name, "Section A");
        assert_eq!(ranges[1].name, "Section B");
    }
}
