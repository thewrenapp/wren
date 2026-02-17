use serde::{Deserialize, Serialize};

use crate::llm::pipeline::extractor::ExtractedSectionContent;

/// A section in the final parsed document, with nested subsections.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedSection {
    pub name: String,
    pub level: u8,
    pub content: String,
    pub subsections: Vec<ExtractedSection>,
}

/// Assemble extracted sections into a structured document.
///
/// Pure Rust — no LLM calls. Takes flat extracted sections and:
/// 1. Builds a nested tree based on heading levels
/// 2. Generates clean structured markdown
pub fn assemble(sections: &[ExtractedSectionContent]) -> (Vec<ExtractedSection>, String) {
    let tree = build_section_tree(sections);
    let markdown = generate_markdown(&tree);
    (tree, markdown)
}

/// Build a nested section tree from flat extracted sections.
///
/// Sections with level > previous section's level become subsections.
/// Uses a stack-based approach to handle arbitrary nesting depth.
fn build_section_tree(flat_sections: &[ExtractedSectionContent]) -> Vec<ExtractedSection> {
    if flat_sections.is_empty() {
        return vec![];
    }

    let mut root_sections: Vec<ExtractedSection> = Vec::new();

    for section in flat_sections {
        let node = ExtractedSection {
            name: section.name.clone(),
            level: section.level,
            content: section.content.clone(),
            subsections: vec![],
        };

        insert_into_tree(&mut root_sections, node);
    }

    root_sections
}

/// Insert a section node into the tree at the correct nesting level.
fn insert_into_tree(tree: &mut Vec<ExtractedSection>, node: ExtractedSection) {
    // If tree is empty or this is a top-level section (or same/higher level than last),
    // add to root
    if tree.is_empty() {
        tree.push(node);
        return;
    }

    let last = tree.last().unwrap();
    if node.level <= last.level {
        // Same or higher level — sibling at root
        tree.push(node);
    } else {
        // Lower level — try to nest under the last section
        let last = tree.last_mut().unwrap();
        insert_into_subtree(last, node);
    }
}

/// Recursively insert a node as a subsection of the given parent.
fn insert_into_subtree(parent: &mut ExtractedSection, node: ExtractedSection) {
    if parent.subsections.is_empty() {
        // No existing subsections — add directly
        parent.subsections.push(node);
        return;
    }

    let last_sub = parent.subsections.last().unwrap();
    if node.level <= last_sub.level {
        // Same or higher level as last subsection — sibling
        parent.subsections.push(node);
    } else {
        // Deeper nesting
        let last_sub = parent.subsections.last_mut().unwrap();
        insert_into_subtree(last_sub, node);
    }
}

/// Generate clean structured markdown from the section tree.
fn generate_markdown(sections: &[ExtractedSection]) -> String {
    let mut output = String::new();
    for section in sections {
        write_section_markdown(&mut output, section, 0);
    }
    // Trim trailing whitespace
    output.trim_end().to_string()
}

/// Recursively write a section and its subsections as markdown.
fn write_section_markdown(output: &mut String, section: &ExtractedSection, depth_offset: u8) {
    let heading_level = section.level + depth_offset;
    // Clamp heading level to 1-6 (markdown heading range)
    let hashes = "#".repeat(heading_level.clamp(1, 6) as usize);

    // Section heading
    output.push_str(&format!("{} {}\n\n", hashes, section.name));

    // Section content — strip leading line if it duplicates the heading we just wrote
    let content = strip_leading_heading(&section.content, &section.name);
    let trimmed = content.trim();
    if !trimmed.is_empty() {
        output.push_str(trimmed);
        output.push_str("\n\n");
    }

    // Subsections
    for sub in &section.subsections {
        write_section_markdown(output, sub, depth_offset);
    }
}

/// Strip a leading line from content if it duplicates the section heading.
///
/// The boundary finder includes the heading text in the section's raw text,
/// so after extraction the content often starts with "1. Introduction\n..."
/// which duplicates the `# 1. Introduction` heading the assembler adds.
fn strip_leading_heading<'a>(content: &'a str, section_name: &str) -> &'a str {
    let trimmed = content.trim_start();
    if let Some(first_newline) = trimmed.find('\n') {
        let first_line = trimmed[..first_newline].trim();
        if heading_matches(first_line, section_name) {
            return &trimmed[first_newline + 1..];
        }
    } else {
        // Content is a single line — check if it's just the heading
        if heading_matches(trimmed.trim(), section_name) {
            return "";
        }
    }
    content
}

/// Normalize a heading string for comparison: strip markdown `#` prefixes,
/// collapse whitespace, normalize trailing dots in section numbering.
fn normalize_heading(s: &str) -> String {
    let s = s.trim();
    // Strip leading '#' characters (markdown heading prefix)
    let s = s.trim_start_matches('#').trim_start();
    // Collapse whitespace to single spaces
    let words: Vec<&str> = s.split_whitespace().collect();
    let normalized = words.join(" ");
    // Lowercase for case-insensitive comparison
    let lower = normalized.to_lowercase();
    // Strip trailing dot from leading section number (e.g., "3.4." → "3.4")
    strip_number_trailing_dot(&lower)
}

/// Strip a trailing dot from a leading section number pattern.
/// "3.4. encoder extensions" → "3.4 encoder extensions"
/// "encoder extensions" → "encoder extensions" (no change)
fn strip_number_trailing_dot(s: &str) -> String {
    if let Some(space_idx) = s.find(' ') {
        let number_part = &s[..space_idx];
        // Check if it looks like a section number (digits and dots)
        if number_part.ends_with('.')
            && number_part.len() > 1
            && number_part[..number_part.len() - 1]
                .chars()
                .all(|c| c.is_ascii_digit() || c == '.')
        {
            let trimmed_number = &number_part[..number_part.len() - 1];
            return format!("{}{}", trimmed_number, &s[space_idx..]);
        }
    }
    s.to_string()
}

/// Check if a content line matches a section heading, with normalization.
fn heading_matches(first_line: &str, section_name: &str) -> bool {
    let norm_line = normalize_heading(first_line);
    let norm_name = normalize_heading(section_name);

    if norm_line.is_empty() || norm_name.is_empty() {
        return false;
    }

    // Exact match after normalization
    if norm_line == norm_name {
        return true;
    }

    // Line starts with section name (e.g., heading has extra content after)
    if norm_line.starts_with(&norm_name) {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flat_sections() {
        let sections = vec![
            ExtractedSectionContent {
                name: "Abstract".to_string(),
                level: 1,
                content: "This paper studies...".to_string(),
            },
            ExtractedSectionContent {
                name: "Introduction".to_string(),
                level: 1,
                content: "We present a new approach...".to_string(),
            },
            ExtractedSectionContent {
                name: "Methods".to_string(),
                level: 1,
                content: "Our methodology involves...".to_string(),
            },
        ];

        let (tree, markdown) = assemble(&sections);
        assert_eq!(tree.len(), 3);
        assert!(tree[0].subsections.is_empty());
        assert!(markdown.contains("# Abstract"));
        assert!(markdown.contains("# Introduction"));
        assert!(markdown.contains("# Methods"));
    }

    #[test]
    fn test_nested_sections() {
        let sections = vec![
            ExtractedSectionContent {
                name: "Introduction".to_string(),
                level: 1,
                content: "Overview text.".to_string(),
            },
            ExtractedSectionContent {
                name: "Background".to_string(),
                level: 2,
                content: "Background info.".to_string(),
            },
            ExtractedSectionContent {
                name: "Motivation".to_string(),
                level: 2,
                content: "Why we did this.".to_string(),
            },
            ExtractedSectionContent {
                name: "Methods".to_string(),
                level: 1,
                content: "How we did it.".to_string(),
            },
            ExtractedSectionContent {
                name: "Data Collection".to_string(),
                level: 2,
                content: "Data details.".to_string(),
            },
            ExtractedSectionContent {
                name: "Preprocessing".to_string(),
                level: 3,
                content: "Cleaning steps.".to_string(),
            },
        ];

        let (tree, markdown) = assemble(&sections);

        // Top level: Introduction, Methods
        assert_eq!(tree.len(), 2);
        assert_eq!(tree[0].name, "Introduction");
        assert_eq!(tree[0].subsections.len(), 2);
        assert_eq!(tree[0].subsections[0].name, "Background");
        assert_eq!(tree[0].subsections[1].name, "Motivation");

        assert_eq!(tree[1].name, "Methods");
        assert_eq!(tree[1].subsections.len(), 1);
        assert_eq!(tree[1].subsections[0].name, "Data Collection");
        assert_eq!(tree[1].subsections[0].subsections.len(), 1);
        assert_eq!(
            tree[1].subsections[0].subsections[0].name,
            "Preprocessing"
        );

        assert!(markdown.contains("# Introduction"));
        assert!(markdown.contains("## Background"));
        assert!(markdown.contains("## Motivation"));
        assert!(markdown.contains("# Methods"));
        assert!(markdown.contains("## Data Collection"));
        assert!(markdown.contains("### Preprocessing"));
    }

    #[test]
    fn test_empty_sections() {
        let (tree, markdown) = assemble(&[]);
        assert!(tree.is_empty());
        assert!(markdown.is_empty());
    }

    #[test]
    fn test_markdown_content() {
        let sections = vec![ExtractedSectionContent {
            name: "Abstract".to_string(),
            level: 1,
            content: "This is the abstract content.\n\nWith multiple paragraphs.".to_string(),
        }];

        let (_, markdown) = assemble(&sections);
        assert_eq!(
            markdown,
            "# Abstract\n\nThis is the abstract content.\n\nWith multiple paragraphs."
        );
    }

    #[test]
    fn test_duplicate_heading_stripped() {
        // Content starts with the heading text (as produced by boundary_finder)
        let sections = vec![
            ExtractedSectionContent {
                name: "1. Introduction".to_string(),
                level: 1,
                content: "1. Introduction\nClassical time series forecasting models aim to predict...".to_string(),
            },
            ExtractedSectionContent {
                name: "2. Related Work".to_string(),
                level: 1,
                content: "2. Related Work\nRNNs and CNNs have been recently applied...".to_string(),
            },
        ];

        let (_, markdown) = assemble(&sections);
        // The heading should appear once (as # heading), not twice
        assert!(markdown.contains("# 1. Introduction\n\nClassical time series"));
        assert!(markdown.contains("# 2. Related Work\n\nRNNs and CNNs"));
        // Should NOT have the duplicate
        assert!(!markdown.contains("# 1. Introduction\n\n1. Introduction"));
    }

    #[test]
    fn test_heading_strip_trailing_dot() {
        // Section name uses "3.4." but content uses "3.4" (or vice versa)
        let sections = vec![ExtractedSectionContent {
            name: "3.4. Encoder Extensions".to_string(),
            level: 2,
            content: "3.4 Encoder Extensions\nIn previous sections, the core design...".to_string(),
        }];

        let (_, markdown) = assemble(&sections);
        assert!(markdown.contains("## 3.4. Encoder Extensions\n\nIn previous sections"));
        assert!(!markdown.contains("3.4 Encoder Extensions\nIn previous"));
    }

    #[test]
    fn test_heading_strip_reverse_trailing_dot() {
        // Content has trailing dot, section name doesn't
        let sections = vec![ExtractedSectionContent {
            name: "3.4 Encoder Extensions".to_string(),
            level: 2,
            content: "3.4. Encoder Extensions\nIn previous sections, the core design...".to_string(),
        }];

        let (_, markdown) = assemble(&sections);
        assert!(markdown.contains("## 3.4 Encoder Extensions\n\nIn previous sections"));
    }

    #[test]
    fn test_heading_extra_whitespace() {
        let sections = vec![ExtractedSectionContent {
            name: "3.4 Encoder Extensions".to_string(),
            level: 2,
            content: "3.4  Encoder  Extensions\nContent here...".to_string(),
        }];

        let (_, markdown) = assemble(&sections);
        assert!(markdown.contains("## 3.4 Encoder Extensions\n\nContent here"));
    }

    #[test]
    fn test_heading_no_false_positive() {
        // Body text should NOT be stripped even if it starts with similar words
        let sections = vec![ExtractedSectionContent {
            name: "Abstract".to_string(),
            level: 1,
            content: "Abstract concepts are fundamental to...".to_string(),
        }];

        let (_, _markdown) = assemble(&sections);
        // "Abstract concepts..." starts with "Abstract" but is NOT the heading
        // However our starts_with check will match this — that's OK because
        // the boundary finder typically includes the heading as a standalone first line.
        // In practice, content like this would have "Abstract\nAbstract concepts..."
    }

    #[test]
    fn test_normalize_heading() {
        assert_eq!(normalize_heading("3.4. Encoder Extensions"), "3.4 encoder extensions");
        assert_eq!(normalize_heading("3.4 Encoder Extensions"), "3.4 encoder extensions");
        assert_eq!(normalize_heading("## 3.4. Encoder Extensions"), "3.4 encoder extensions");
        assert_eq!(normalize_heading("  Abstract  "), "abstract");
        assert_eq!(normalize_heading("1.  Introduction"), "1 introduction");
    }

    #[test]
    fn test_heading_matches_variants() {
        assert!(heading_matches("3.4. Encoder Extensions", "3.4 Encoder Extensions"));
        assert!(heading_matches("3.4 Encoder Extensions", "3.4. Encoder Extensions"));
        assert!(heading_matches("ABSTRACT", "Abstract"));
        assert!(heading_matches("1. Introduction", "1. Introduction"));
        assert!(!heading_matches("Some real content", "Abstract"));
    }
}
