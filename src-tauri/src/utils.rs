use std::path::{Path, PathBuf};

/// Validates that a path is safely within the library directory.
/// Returns the canonicalized path if valid, or an error if the path escapes the library root.
pub fn validate_library_path(
    library_root: &Path,
    relative_or_joined: &Path,
) -> Result<PathBuf, String> {
    let canonical = relative_or_joined
        .canonicalize()
        .map_err(|e| format!("Path does not exist or is inaccessible: {}", e))?;
    let canonical_root = library_root
        .canonicalize()
        .map_err(|e| format!("Library root does not exist: {}", e))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(format!(
            "Path {:?} escapes library directory {:?}",
            canonical, canonical_root
        ));
    }
    Ok(canonical)
}
