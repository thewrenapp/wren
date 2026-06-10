//! oar-ocr structure-analysis engine wrapper.
//!
//! Builds and owns the [`OARStructure`] analyzer (layout detection + OCR + table
//! recognition). The analyzer holds ONNX Runtime sessions that are not `Sync`,
//! so it is guarded by a [`Mutex`]; inference must run on a blocking thread.

use std::sync::Mutex;

use anyhow::{Context, Result};
use image::RgbImage;
use oar_ocr::core::config::OrtSessionConfig;
use oar_ocr::domain::structure::StructureResult;
use oar_ocr::oarocr::{OARStructure, OARStructureBuilder};

use super::config::OrtConfig;
use super::models;

/// Owns the oar-ocr structure analyzer behind a mutex.
pub struct Engine {
    analyzer: Mutex<OARStructure>,
}

impl Engine {
    /// Build the analyzer, downloading any missing models on first use.
    pub fn new(config: &OrtConfig) -> Result<Self> {
        let paths = models::ensure_models()?;

        let mut builder = OARStructureBuilder::new(&paths.layout)
            .layout_model_name(models::LAYOUT_MODEL_NAME);

        if let Some(session) = ort_session(config) {
            builder = builder.ort_session(session);
        }

        builder = builder
            .with_ocr(&paths.ocr_det, &paths.ocr_rec, &paths.ocr_dict)
            .with_table_classification(&paths.table_cls)
            .with_table_structure_recognition(&paths.table_structure, "wireless")
            .table_structure_dict_path(&paths.table_dict);

        let analyzer = builder
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build OCR analyzer: {e}"))
            .context("oar-ocr structure pipeline build failed")?;

        Ok(Self {
            analyzer: Mutex::new(analyzer),
        })
    }

    /// Run structure analysis over the given page images (one per PDF page).
    ///
    /// Must be called from a blocking context. Returns one result per input
    /// image in order; pages that fail analysis are skipped with a warning.
    pub fn predict(&self, images: Vec<RgbImage>) -> Result<Vec<StructureResult>> {
        if images.is_empty() {
            return Ok(Vec::new());
        }

        let analyzer = self
            .analyzer
            .lock()
            .map_err(|_| anyhow::anyhow!("OCR analyzer mutex poisoned"))?;

        let mut results = Vec::with_capacity(images.len());
        for (idx, result) in analyzer.predict_images(images).into_iter().enumerate() {
            match result {
                Ok(res) => results.push(res),
                Err(e) => tracing::warn!("Structure analysis failed for page {}: {}", idx + 1, e),
            }
        }
        Ok(results)
    }
}

/// Build an ONNX session config for the requested execution provider.
/// Returns `None` for plain CPU (the library default).
fn ort_session(config: &OrtConfig) -> Option<OrtSessionConfig> {
    #[cfg(target_os = "macos")]
    {
        if config.use_coreml {
            use oar_ocr::core::config::OrtExecutionProvider;
            return Some(OrtSessionConfig::new().with_execution_providers(vec![
                OrtExecutionProvider::CoreML {
                    ane_only: Some(false),
                    subgraphs: Some(true),
                },
                OrtExecutionProvider::CPU,
            ]));
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = config;
    }

    None
}
