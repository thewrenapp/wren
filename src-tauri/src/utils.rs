use std::path::{Path, PathBuf};

/// Convert an absolute path to a path relative to the library root.
/// If the path is already relative, returns it as-is.
/// Used when storing paths in SQLite — always store relative for portability.
pub fn to_relative_path(library_root: &Path, absolute_path: &Path) -> String {
    absolute_path
        .strip_prefix(library_root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| absolute_path.to_string_lossy().to_string())
}

/// Resolve a potentially relative path against the library root.
/// If already absolute, returns as-is. Used when reading paths from DB for the frontend.
pub fn resolve_path(library_root: &Path, stored_path: &str) -> String {
    let path = Path::new(stored_path);
    if path.is_absolute() {
        stored_path.to_string()
    } else {
        library_root.join(stored_path).to_string_lossy().to_string()
    }
}

/// Validates that a path is safely within the library directory.
/// Returns the canonicalized path if valid, or an error if the path escapes the library root.
/// Handles symlinked library/ directories (e.g., when synced via iCloud).
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

    // Also resolve through the library/ symlink if it exists
    let library_subdir = library_root.join("library");
    let canonical_library = library_subdir.canonicalize().ok();

    let in_root = canonical.starts_with(&canonical_root);
    let in_synced = canonical_library
        .as_ref()
        .map(|cl| canonical.starts_with(cl))
        .unwrap_or(false);

    if !in_root && !in_synced {
        return Err(format!(
            "Path {:?} escapes library directory {:?}",
            canonical, canonical_root
        ));
    }
    Ok(canonical)
}
