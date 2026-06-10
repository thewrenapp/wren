//! Native, Apache/BSD-licensed document parsing pipeline.
//!
//! Replaces the previous GPL ferrules backend with a Rust pipeline built on
//! `oar-ocr` (layout analysis + OCR + table recognition) and `pdfium-render`
//! (PDF rasterization). The public surface intentionally mirrors the small set
//! of types the search parser consumes.

pub mod blocks;
pub mod config;
pub mod convert;
pub mod engine;
pub mod entities;
pub mod models;
pub mod pdf;

use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;

use config::{DocParseConfig, OrtConfig};
use engine::Engine;
use entities::{DocMetadata, ParsedDocument};

/// Document parser: rasterizes PDFs and runs layout/OCR/table analysis.
///
/// `Send + Sync` so it can live behind `Arc<OnceCell<DocParser>>`. The
/// underlying analyzer is not `Sync`, so it is guarded internally by a mutex
/// and all inference runs on a blocking thread.
pub struct DocParser {
    engine: Arc<Engine>,
}

impl DocParser {
    /// Build the parser, fetching any missing OCR/layout models on first use.
    pub fn new(config: OrtConfig) -> Result<Self> {
        let engine = Engine::new(&config)?;
        Ok(Self {
            engine: Arc::new(engine),
        })
    }

    /// Parse a PDF document into structured pages and blocks.
    ///
    /// `_config` and `_progress` are accepted for API compatibility.
    pub async fn parse_document(
        &self,
        data: &[u8],
        _filename: String,
        _config: DocParseConfig,
        _progress: Option<fn(usize)>,
    ) -> Result<ParsedDocument> {
        let start = Instant::now();

        // pdfium is not Send: rasterize on a blocking thread, return owned images.
        let data = data.to_vec();
        let images = tokio::task::spawn_blocking(move || pdf::render_pdf_pages(&data))
            .await
            .map_err(|e| anyhow::anyhow!("PDF rasterization task panicked: {e}"))??;

        // Run structure analysis on a blocking thread (ONNX inference).
        let engine = self.engine.clone();
        let results = tokio::task::spawn_blocking(move || engine.predict(images))
            .await
            .map_err(|e| anyhow::anyhow!("Structure analysis task panicked: {e}"))??;

        let (blocks, pages) = convert::results_to_document(&results);

        Ok(ParsedDocument {
            pages,
            blocks,
            metadata: DocMetadata {
                parser_version: env!("CARGO_PKG_VERSION").to_string(),
                parsing_duration: start.elapsed(),
            },
        })
    }
}
