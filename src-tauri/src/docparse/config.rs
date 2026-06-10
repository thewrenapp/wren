//! Configuration types for the document parser.

/// Per-document parse options. Currently a placeholder kept for API symmetry
/// and forward compatibility; OCR and layout are handled automatically.
#[derive(Debug, Clone, Default)]
pub struct DocParseConfig;

/// ONNX Runtime / execution-provider configuration for the parser.
///
/// `use_coreml` enables the CoreML execution provider (Apple Neural Engine) on
/// macOS. It is **opt-in**: for these PaddleOCR layout/OCR models CoreML both
/// runs slower and degrades extraction quality (fragmented layout, dropped
/// text) versus CPU, so the default is CPU on every platform.
#[derive(Debug, Clone, Default)]
pub struct OrtConfig {
    /// Opt into the CoreML execution provider (macOS only).
    pub use_coreml: bool,
}
