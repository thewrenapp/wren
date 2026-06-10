//! End-to-end integration test for the `docparse` PDF pipeline.
//!
//! Exercises the *entire* replacement for ferrules: it loads a real PDF,
//! rasterizes it with pdfium, runs oar-ocr layout + OCR over each page, and
//! verifies recognized text comes back as structured blocks.
//!
//! `#[ignore]`d by default: the first run downloads ~40 MB of PaddleOCR ONNX
//! models from ModelScope into `$OAR_HOME` and needs the ONNX Runtime + bundled
//! libpdfium. Point it at any PDF via `WREN_TEST_PDF` and run:
//!
//! ```text
//! source ~/.nvm/nvm.sh \
//!   && WREN_TEST_PDF=/path/to/paper.pdf \
//!      cargo test --test docparse_e2e -- --ignored --nocapture
//! ```
//!
//! Without `WREN_TEST_PDF` the test no-ops (there is no bundled fixture).

use wren_lib::docparse::blocks::BlockType;
use wren_lib::docparse::config::{DocParseConfig, OrtConfig};
use wren_lib::docparse::DocParser;

/// Flatten a block's recognized text.
fn block_text(kind: &BlockType) -> String {
    match kind {
        BlockType::Title(t) => t.text.clone(),
        BlockType::Header(h) | BlockType::Footer(h) => h.text.clone(),
        BlockType::TextBlock(t) => t.text.clone(),
        BlockType::ListBlock(l) => l.items.join(" "),
        BlockType::Table(tbl) => tbl
            .rows
            .iter()
            .flat_map(|r| r.cells.iter().map(|c| c.text.clone()))
            .collect::<Vec<_>>()
            .join(" "),
        BlockType::Image(_) => String::new(),
    }
}

#[tokio::test]
#[ignore = "downloads ~40MB of ONNX models on first run; set WREN_TEST_PDF and run with --ignored"]
async fn end_to_end_pdf_parse() {
    let Ok(pdf_path) = std::env::var("WREN_TEST_PDF") else {
        eprintln!("WREN_TEST_PDF not set — skipping end-to-end parse test.");
        return;
    };

    let pdf = std::fs::read(&pdf_path).expect("read WREN_TEST_PDF file");
    assert!(pdf.starts_with(b"%PDF"), "{pdf_path} is not a PDF");
    eprintln!("Parsing {} ({} bytes)...", pdf_path, pdf.len());

    // DocParser::new performs blocking model downloads, so build it on a
    // blocking thread exactly as the app does (state.rs).
    let parser = tokio::task::spawn_blocking(|| DocParser::new(OrtConfig::default()))
        .await
        .expect("parser init task panicked")
        .expect("DocParser::new failed (model download / ONNX init)");

    let doc = parser
        .parse_document(&pdf, "test.pdf".to_string(), DocParseConfig, None::<fn(usize)>)
        .await
        .expect("parse_document failed");

    let text: String = doc
        .blocks
        .iter()
        .map(|b| block_text(&b.kind))
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    let title_count = doc
        .blocks
        .iter()
        .filter(|b| matches!(b.kind, BlockType::Title(_)))
        .count();
    let table_count = doc
        .blocks
        .iter()
        .filter(|b| matches!(b.kind, BlockType::Table(_)))
        .count();

    eprintln!(
        "\n=== parsed {} page(s), {} block(s) ({} titles, {} tables), {} chars in {:?} ===",
        doc.pages.len(),
        doc.blocks.len(),
        title_count,
        table_count,
        text.len(),
        doc.metadata.parsing_duration,
    );
    let preview: String = text.chars().take(1200).collect();
    eprintln!("--- recognized text (first 1200 chars) ---\n{preview}\n------------------------------------------");

    // A real multi-page paper must yield pages, blocks, and substantial text.
    assert!(!doc.pages.is_empty(), "no pages were rendered");
    assert!(!doc.blocks.is_empty(), "no blocks were extracted");
    assert!(
        text.len() > 500,
        "recovered only {} chars of text — extraction looks broken",
        text.len()
    );
}
