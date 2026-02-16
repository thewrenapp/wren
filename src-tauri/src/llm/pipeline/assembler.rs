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

    // Section content
    let trimmed = section.content.trim();
    if !trimmed.is_empty() {
        output.push_str(trimmed);
        output.push_str("\n\n");
    }

    // Subsections
    for sub in &section.subsections {
        write_section_markdown(output, sub, depth_offset);
    }
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
}
