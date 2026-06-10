//! PDF rasterization via pdfium-render (dynamic binding).
//!
//! All pdfium work happens here. `Pdfium` is not `Send`, so callers must invoke
//! [`render_pdf_pages`] inside `tokio::task::spawn_blocking` and only move the
//! returned owned [`image::RgbImage`]s across threads.

use std::path::PathBuf;

use anyhow::{Context, Result};
use image::RgbImage;
use pdfium_render::prelude::*;

/// Target rasterization resolution in DPI. PDF user space is 72 points/inch,
/// so the scale factor applied to each page is `DPI / 72`.
const RENDER_DPI: f32 = 150.0;

/// Locate the `libpdfium` dynamic library, preferring the bundled copy.
fn locate_pdfium() -> Result<Box<dyn PdfiumLibraryBindings>> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Next to the running executable (Tauri bundles resources alongside the binary).
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(Pdfium::pdfium_platform_library_name_at_path(dir));
        // macOS app bundle: Contents/MacOS/<bin> -> Contents/Resources
        if let Some(contents) = dir.parent() {
            candidates.push(Pdfium::pdfium_platform_library_name_at_path(
                &contents.join("Resources"),
            ));
        }
    }

    // Project `resources/` directory (development).
    candidates.push(Pdfium::pdfium_platform_library_name_at_path("resources"));
    candidates.push(Pdfium::pdfium_platform_library_name_at_path(
        "src-tauri/resources",
    ));

    for path in &candidates {
        if path.exists()
            && let Ok(bindings) = Pdfium::bind_to_library(path)
        {
            tracing::debug!("Loaded pdfium from {}", path.display());
            return Ok(bindings);
        }
    }

    // Fall back to a system-installed pdfium.
    Pdfium::bind_to_system_library()
        .context("Could not load bundled or system libpdfium")
}

/// Rasterize every page of `data` (PDF bytes) to an RGB image at ~150 DPI.
///
/// Returns one image per page, in page order.
pub fn render_pdf_pages(data: &[u8]) -> Result<Vec<RgbImage>> {
    let pdfium = Pdfium::new(locate_pdfium()?);

    let document = pdfium
        .load_pdf_from_byte_slice(data, None)
        .context("Failed to load PDF document")?;

    let scale = RENDER_DPI / 72.0;
    let config = PdfRenderConfig::new().scale_page_by_factor(scale);

    let mut images = Vec::new();
    for (idx, page) in document.pages().iter().enumerate() {
        match page.render_with_config(&config) {
            Ok(bitmap) => images.push(bitmap.as_image().into_rgb8()),
            Err(e) => {
                tracing::warn!("Failed to render PDF page {}: {}", idx + 1, e);
            }
        }
    }

    Ok(images)
}
