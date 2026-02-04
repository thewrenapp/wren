//! File naming utilities for automatic attachment renaming based on entry metadata.
//!
//! Implements Zotero-style filename generation with the template:
//! `{firstCreator} - {year} - {title}`

use crate::db::models::Creator;
use std::path::{Path, PathBuf};

/// Maximum length for title portion of filename
const MAX_TITLE_LENGTH: usize = 100;

/// Characters that are invalid in filenames on various operating systems
const INVALID_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];

/// Generate a filename from entry metadata using the template:
/// `{firstCreator} - {year} - {title}.{extension}`
///
/// Parts are omitted if not available:
/// - No creators: `{year} - {title}.ext` or just `{title}.ext`
/// - No year: `{firstCreator} - {title}.ext`
pub fn generate_filename(
    title: &str,
    creators: &[Creator],
    year: Option<&str>,
    extension: &str,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Add first creator if available
    let creator_str = format_first_creator(creators);
    if !creator_str.is_empty() {
        parts.push(creator_str);
    }

    // Add year if available
    if let Some(y) = year {
        let year_str = y.trim();
        if !year_str.is_empty() {
            parts.push(year_str.to_string());
        }
    }

    // Add title (required, truncated if too long)
    let title_clean = sanitize_filename(title);
    if !title_clean.is_empty() {
        let title_truncated = truncate_string(&title_clean, MAX_TITLE_LENGTH);
        parts.push(title_truncated);
    }

    // If we have no parts (empty title), return empty
    if parts.is_empty() {
        return String::new();
    }

    // Join parts and add extension
    let base_name = parts.join(" - ");
    let ext = extension.trim_start_matches('.');

    if ext.is_empty() {
        base_name
    } else {
        format!("{}.{}", base_name, ext)
    }
}

/// Format the first creator(s) in Zotero style:
/// - Single author: "LastName"
/// - Two authors: "LastName & LastName2"
/// - Three+ authors: "LastName et al."
/// - Institution/single-name: the name as-is
pub fn format_first_creator(creators: &[Creator]) -> String {
    // Filter to primary creators (authors, or first by sort_order)
    let primary_creators: Vec<&Creator> = creators
        .iter()
        .filter(|c| c.creator_type == "author" || c.sort_order == 0)
        .collect();

    // If no primary creators, use all creators
    let creators_to_use = if primary_creators.is_empty() {
        creators.iter().collect::<Vec<_>>()
    } else {
        primary_creators
    };

    match creators_to_use.len() {
        0 => String::new(),
        1 => short_name(&creators_to_use[0]),
        2 => format!(
            "{} & {}",
            short_name(&creators_to_use[0]),
            short_name(&creators_to_use[1])
        ),
        _ => format!("{} et al.", short_name(&creators_to_use[0])),
    }
}

/// Get the short name (last name or institutional name) for a creator
fn short_name(creator: &Creator) -> String {
    if let Some(name) = &creator.name {
        sanitize_filename(name)
    } else if let Some(last) = &creator.last_name {
        sanitize_filename(last)
    } else if let Some(first) = &creator.first_name {
        sanitize_filename(first)
    } else {
        String::new()
    }
}

/// Sanitize a string for use as a filename by removing/replacing invalid characters
pub fn sanitize_filename(name: &str) -> String {
    let mut result = String::with_capacity(name.len());

    for c in name.chars() {
        if INVALID_CHARS.contains(&c) {
            result.push('-');
        } else {
            result.push(c);
        }
    }

    // Collapse multiple dashes/spaces
    let mut prev_dash_or_space = false;
    let mut collapsed = String::with_capacity(result.len());

    for c in result.chars() {
        let is_dash_or_space = c == '-' || c == ' ';
        if is_dash_or_space {
            if !prev_dash_or_space {
                collapsed.push(c);
            }
            prev_dash_or_space = true;
        } else {
            collapsed.push(c);
            prev_dash_or_space = false;
        }
    }

    // Trim leading/trailing whitespace and dashes/dots
    collapsed
        .trim()
        .trim_matches(|c| c == '-' || c == '.')
        .to_string()
}

/// Truncate a string to a maximum length, breaking at word boundaries if possible
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }

    // Find the last space before max_len
    let truncated = &s[..max_len];
    if let Some(last_space) = truncated.rfind(' ') {
        if last_space > max_len / 2 {
            // Only break at word if it's not too early
            return s[..last_space].trim_end().to_string();
        }
    }

    // No good word break, just truncate
    truncated.trim_end().to_string()
}

/// Resolve filename conflicts by appending "supplement" suffix.
/// If `filename.pdf` exists, try `filename - supplement.pdf`, `filename - supplement-1.pdf`, etc.
///
/// Returns the final path that doesn't exist yet.
pub fn resolve_conflict(dir: &Path, filename: &str) -> PathBuf {
    let target = dir.join(filename);

    if !target.exists() {
        return target;
    }

    // Split filename into base and extension
    let (base, ext) = split_filename(filename);

    // First try "supplement" without number
    let first_supplement = if ext.is_empty() {
        format!("{} - supplement", base)
    } else {
        format!("{} - supplement.{}", base, ext)
    };

    let first_path = dir.join(&first_supplement);
    if !first_path.exists() {
        return first_path;
    }

    // Then try "supplement-1", "supplement-2", etc.
    let mut counter = 1;
    loop {
        let new_name = if ext.is_empty() {
            format!("{} - supplement-{}", base, counter)
        } else {
            format!("{} - supplement-{}.{}", base, counter, ext)
        };

        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }

        counter += 1;

        // Safety limit to avoid infinite loop
        if counter > 1000 {
            // Return a UUID-based name as fallback
            let uuid = uuid::Uuid::new_v4();
            let fallback = if ext.is_empty() {
                format!("{}-{}", base, uuid)
            } else {
                format!("{}-{}.{}", base, uuid, ext)
            };
            return dir.join(fallback);
        }
    }
}

/// Split a filename into base name and extension
fn split_filename(filename: &str) -> (&str, &str) {
    if let Some(dot_pos) = filename.rfind('.') {
        if dot_pos > 0 && dot_pos < filename.len() - 1 {
            return (&filename[..dot_pos], &filename[dot_pos + 1..]);
        }
    }
    (filename, "")
}

/// Rename a file safely, handling conflicts.
///
/// Returns the new path on success.
pub fn rename_file_safely(old_path: &Path, new_path: &Path) -> std::io::Result<PathBuf> {
    // If paths are the same, nothing to do
    if old_path == new_path {
        return Ok(old_path.to_path_buf());
    }

    // Get the directory and resolve conflicts
    let dir = new_path.parent().unwrap_or(Path::new("."));
    let filename = new_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unnamed");

    let final_path = resolve_conflict(dir, filename);

    // Perform the rename
    std::fs::rename(old_path, &final_path)?;

    Ok(final_path)
}

/// Check if a file path is within the library directory
/// (we only rename files inside the library, not external/linked files)
pub fn is_in_library(file_path: &Path, library_path: &Path) -> bool {
    file_path.starts_with(library_path)
}

/// Extract the year from a date string (handles various formats)
pub fn extract_year(date: &str) -> Option<String> {
    let date = date.trim();

    // Try to find a 4-digit year
    for word in date.split(|c: char| !c.is_ascii_digit()) {
        if word.len() == 4 {
            if let Ok(year) = word.parse::<u32>() {
                if (1000..=2100).contains(&year) {
                    return Some(word.to_string());
                }
            }
        }
    }

    // If date starts with year (YYYY-MM-DD format)
    if date.len() >= 4 {
        let first_four = &date[..4];
        if let Ok(year) = first_four.parse::<u32>() {
            if (1000..=2100).contains(&year) {
                return Some(first_four.to_string());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_creator(last_name: &str) -> Creator {
        Creator {
            id: None,
            creator_type: "author".to_string(),
            creator_type_display: None,
            first_name: None,
            last_name: Some(last_name.to_string()),
            name: None,
            sort_order: 0,
        }
    }

    #[test]
    fn test_format_first_creator_single() {
        let creators = vec![make_creator("Smith")];
        assert_eq!(format_first_creator(&creators), "Smith");
    }

    #[test]
    fn test_format_first_creator_two() {
        let creators = vec![make_creator("Smith"), make_creator("Jones")];
        assert_eq!(format_first_creator(&creators), "Smith & Jones");
    }

    #[test]
    fn test_format_first_creator_three() {
        let creators = vec![
            make_creator("Smith"),
            make_creator("Jones"),
            make_creator("Brown"),
        ];
        assert_eq!(format_first_creator(&creators), "Smith et al.");
    }

    #[test]
    fn test_generate_filename_full() {
        let creators = vec![make_creator("Smith")];
        let filename = generate_filename("My Paper Title", &creators, Some("2023"), "pdf");
        assert_eq!(filename, "Smith - 2023 - My Paper Title.pdf");
    }

    #[test]
    fn test_generate_filename_no_year() {
        let creators = vec![make_creator("Smith")];
        let filename = generate_filename("My Paper Title", &creators, None, "pdf");
        assert_eq!(filename, "Smith - My Paper Title.pdf");
    }

    #[test]
    fn test_generate_filename_no_creators() {
        let creators: Vec<Creator> = vec![];
        let filename = generate_filename("My Paper Title", &creators, Some("2023"), "pdf");
        assert_eq!(filename, "2023 - My Paper Title.pdf");
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("Hello: World?"), "Hello- World");
        assert_eq!(sanitize_filename("A/B\\C"), "A-B-C");
        assert_eq!(sanitize_filename("  Leading and trailing  "), "Leading and trailing");
    }

    #[test]
    fn test_extract_year() {
        assert_eq!(extract_year("2023-01-15"), Some("2023".to_string()));
        assert_eq!(extract_year("2023"), Some("2023".to_string()));
        assert_eq!(extract_year("January 2023"), Some("2023".to_string()));
        assert_eq!(extract_year("no year"), None);
    }
}
