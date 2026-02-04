use anyhow::Result;
use std::path::Path;
use tracing::{info, warn};

/// Try to bind to pdfium library bundled with the app
fn bind_to_bundled_pdfium() -> Option<Box<dyn pdfium_render::prelude::PdfiumLibraryBindings>> {
    use pdfium_render::prelude::*;

    // Try various locations where the bundled library might be
    let possible_paths = [
        // Development: next to the binary
        "./libpdfium.dylib",
        // Development: in resources folder
        "./resources/libpdfium.dylib",
        // macOS app bundle: Resources folder
        "../Resources/libpdfium.dylib",
        // Tauri dev mode
        "src-tauri/resources/libpdfium.dylib",
    ];

    for lib_path in possible_paths {
        if std::path::Path::new(lib_path).exists() {
            if let Ok(bindings) = Pdfium::bind_to_library(lib_path) {
                info!("Loaded pdfium from: {}", lib_path);
                return Some(bindings);
            }
        }
    }

    // Also try the executable's directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let lib_path = exe_dir.join("libpdfium.dylib");
            if lib_path.exists() {
                if let Ok(bindings) = Pdfium::bind_to_library(lib_path.to_string_lossy().as_ref()) {
                    info!("Loaded pdfium from executable directory: {}", lib_path.display());
                    return Some(bindings);
                }
            }
            // macOS: Check Resources folder relative to MacOS folder
            let resources_path = exe_dir.parent().map(|p| p.join("Resources").join("libpdfium.dylib"));
            if let Some(resources_lib) = resources_path {
                if resources_lib.exists() {
                    if let Ok(bindings) = Pdfium::bind_to_library(resources_lib.to_string_lossy().as_ref()) {
                        info!("Loaded pdfium from Resources: {}", resources_lib.display());
                        return Some(bindings);
                    }
                }
            }
        }
    }

    None
}

/// Maximum text size to extract (10MB)
pub const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

/// Progress callback for reporting extraction status
pub type ProgressCallback = Box<dyn Fn(&str, &str) + Send + Sync>;

/// Configuration for text extraction
#[derive(Clone)]
pub struct ExtractionConfig {
    /// Skip all OCR processing (scanned PDFs will have no text)
    pub skip_ocr: bool,
    /// Whether Ollama vision is enabled
    pub ollama_enabled: bool,
    /// Ollama API endpoint (e.g., "http://localhost:11434")
    pub ollama_endpoint: String,
    /// Ollama vision model name (e.g., "llava")
    pub ollama_model: String,
}

impl std::fmt::Debug for ExtractionConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExtractionConfig")
            .field("skip_ocr", &self.skip_ocr)
            .field("ollama_enabled", &self.ollama_enabled)
            .field("ollama_endpoint", &self.ollama_endpoint)
            .field("ollama_model", &self.ollama_model)
            .finish()
    }
}

/// Result of text extraction with method info
#[derive(Clone, Debug)]
pub struct ExtractionResult {
    /// Extracted text content
    pub text: String,
    /// Method used for extraction
    pub method: ExtractionMethod,
    /// Optional message (e.g., why a method failed)
    pub message: Option<String>,
}

/// Method used for text extraction
#[derive(Clone, Debug, PartialEq)]
pub enum ExtractionMethod {
    /// Direct text extraction from PDF
    PdfExtract,
    /// Ollama vision API for scanned PDFs
    OllamaVision,
    /// Traditional OCR (ocrs)
    TraditionalOcr,
    /// Direct file read (markdown, text)
    DirectRead,
    /// HTML parsing
    HtmlParse,
    /// No extraction (unsupported file type)
    None,
    /// Extraction skipped (file type not supported)
    Skipped,
}

impl ExtractionMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExtractionMethod::PdfExtract => "pdf-extract",
            ExtractionMethod::OllamaVision => "ollama-vision",
            ExtractionMethod::TraditionalOcr => "ocr",
            ExtractionMethod::DirectRead => "direct",
            ExtractionMethod::HtmlParse => "html-parse",
            ExtractionMethod::None => "none",
            ExtractionMethod::Skipped => "skipped",
        }
    }
}

impl Default for ExtractionConfig {
    fn default() -> Self {
        Self {
            skip_ocr: false,
            ollama_enabled: false,
            ollama_endpoint: "http://localhost:11434".to_string(),
            ollama_model: "llava".to_string(),
        }
    }
}

/// Extract text content from a file based on its extension
pub async fn extract_text(path: &Path, config: &ExtractionConfig) -> Result<ExtractionResult> {
    let result = match path.extension().and_then(|e| e.to_str()) {
        Some("pdf") => extract_pdf_text(path, config).await?,
        Some("md") | Some("txt") | Some("markdown") => {
            let text = std::fs::read_to_string(path).unwrap_or_default();
            ExtractionResult {
                text,
                method: ExtractionMethod::DirectRead,
                message: None,
            }
        }
        Some("html") | Some("htm") => {
            let text = extract_html_text(path)?;
            ExtractionResult {
                text,
                method: ExtractionMethod::HtmlParse,
                message: None,
            }
        }
        _ => ExtractionResult {
            text: String::new(),
            method: ExtractionMethod::Skipped,
            message: Some("Unsupported file type".to_string()),
        },
    };

    // Truncate at max size
    let text = if result.text.len() > MAX_TEXT_BYTES {
        result.text[..MAX_TEXT_BYTES].to_string()
    } else {
        result.text
    };

    Ok(ExtractionResult { text, ..result })
}

/// Extract text from PDF files
/// Strategy: pdf-extract first, then Ollama vision, then traditional OCR as fallback
async fn extract_pdf_text(path: &Path, config: &ExtractionConfig) -> Result<ExtractionResult> {
    let page_count = get_page_count(path).unwrap_or(1);

    // 1. Try fast pdf-extract first (wrapped in catch_unwind to handle panics)
    let path_owned = path.to_path_buf();
    let extract_result = std::panic::catch_unwind(|| {
        pdf_extract::extract_text(&path_owned)
    });

    let (needs_ocr, pdf_extract_msg) = match extract_result {
        Ok(Ok(text)) if !extraction_seems_failed(&text, page_count) => {
            info!("PDF text extracted successfully with pdf-extract: {}", path.display());
            return Ok(ExtractionResult {
                text,
                method: ExtractionMethod::PdfExtract,
                message: None,
            });
        }
        Ok(Ok(_)) => {
            info!("PDF appears scanned, trying OCR: {}", path.display());
            (true, Some("Scanned PDF detected".to_string()))
        }
        Ok(Err(e)) => {
            warn!("pdf-extract failed: {}, trying OCR", e);
            (true, Some(format!("pdf-extract failed: {}", e)))
        }
        Err(_) => {
            warn!("pdf-extract panicked on {}, trying OCR as fallback", path.display());
            (true, Some("pdf-extract crashed".to_string()))
        }
    };

    // If OCR is disabled, return empty for scanned PDFs
    if needs_ocr && config.skip_ocr {
        info!("OCR disabled, skipping scanned PDF: {}", path.display());
        return Ok(ExtractionResult {
            text: String::new(),
            method: ExtractionMethod::Skipped,
            message: Some("OCR disabled in settings".to_string()),
        });
    }

    // 2. Try Ollama vision if enabled in settings
    if needs_ocr && config.ollama_enabled {
        info!("Trying Ollama vision for: {}", path.display());
        match extract_pdf_with_ollama(path, &config.ollama_endpoint, &config.ollama_model).await {
            Ok(text) if !text.trim().is_empty() => {
                info!("PDF text extracted with Ollama vision: {}", path.display());
                return Ok(ExtractionResult {
                    text,
                    method: ExtractionMethod::OllamaVision,
                    message: pdf_extract_msg,
                });
            }
            Ok(_) => warn!("Ollama returned empty text for {}, falling back to traditional OCR", path.display()),
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("libpdfium") || err_str.contains("LoadLibrary") {
                    warn!("PDF rendering requires libpdfium library.");
                    return Ok(ExtractionResult {
                        text: String::new(),
                        method: ExtractionMethod::None,
                        message: Some("libpdfium not found".to_string()),
                    });
                }
                warn!("Ollama vision failed: {}, falling back to traditional OCR", e);
            }
        }
    }

    // 3. Fall back to traditional OCR (ocrs - pure Rust)
    if needs_ocr {
        info!("Trying traditional OCR for: {}", path.display());
        match extract_pdf_with_ocrs(path) {
            Ok(text) if !text.trim().is_empty() => {
                info!("PDF text extracted with traditional OCR: {}", path.display());
                return Ok(ExtractionResult {
                    text,
                    method: ExtractionMethod::TraditionalOcr,
                    message: pdf_extract_msg,
                });
            }
            Ok(_) => warn!("Traditional OCR returned empty text for {}", path.display()),
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("libpdfium") || err_str.contains("LoadLibrary") {
                    warn!("PDF rendering requires libpdfium library. Scanned PDFs cannot be indexed without it.");
                    return Ok(ExtractionResult {
                        text: String::new(),
                        method: ExtractionMethod::None,
                        message: Some("libpdfium not found".to_string()),
                    });
                }
                warn!("Traditional OCR failed for {}: {}", path.display(), e);
            }
        }
    }

    // 4. No text extracted
    warn!("Could not extract text from PDF: {}", path.display());
    Ok(ExtractionResult {
        text: String::new(),
        method: ExtractionMethod::None,
        message: pdf_extract_msg.or(Some("All extraction methods failed".to_string())),
    })
}

/// Get the page count of a PDF
fn get_page_count(path: &Path) -> Result<u32> {
    let doc = lopdf::Document::load(path)?;
    Ok(doc.get_pages().len() as u32)
}

/// Detect if text extraction likely failed (scanned PDF, encoding issues)
fn extraction_seems_failed(text: &str, page_count: u32) -> bool {
    let text = text.trim();
    if text.is_empty() {
        return true;
    }

    // < 100 chars per page suggests scanned document
    let chars_per_page = text.len() as f32 / page_count.max(1) as f32;
    if chars_per_page < 100.0 {
        return true;
    }

    // < 50% printable chars suggests encoding/font issues
    let printable = text
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .count();
    if (printable as f32 / text.len() as f32) < 0.5 {
        return true;
    }

    false
}

/// Maximum pages to process with OCR (to avoid extremely long processing times)
const MAX_OCR_PAGES: usize = 50;

/// Timeout for each Ollama API call (2 minutes per page)
const OLLAMA_PAGE_TIMEOUT_SECS: u64 = 120;

/// Extract text from PDF using Ollama vision API
async fn extract_pdf_with_ollama(path: &Path, endpoint: &str, model: &str) -> Result<String> {
    let images = render_pdf_pages(path)?;
    let total_pages = images.len();
    let pages_to_process = images.len().min(MAX_OCR_PAGES);

    if total_pages > MAX_OCR_PAGES {
        warn!(
            "PDF has {} pages, only processing first {} for OCR: {}",
            total_pages, MAX_OCR_PAGES, path.display()
        );
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(OLLAMA_PAGE_TIMEOUT_SECS))
        .build()?;
    let api_url = format!("{}/api/generate", endpoint);

    let mut text = String::new();
    for (i, img) in images.iter().take(pages_to_process).enumerate() {
        info!("Ollama OCR: processing page {}/{} of {}", i + 1, pages_to_process, path.display());

        // Convert image to base64 PNG
        let mut buf = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buf);
        img.write_to(&mut cursor, image::ImageFormat::Png)?;
        let base64_img = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf);

        // Call Ollama vision API
        let response = client
            .post(&api_url)
            .json(&serde_json::json!({
                "model": model,
                "prompt": "Extract all text from this document image. Output only the text content, no explanations or formatting.",
                "images": [base64_img],
                "stream": false
            }))
            .send()
            .await;

        match response {
            Ok(resp) => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(page_text) = json["response"].as_str() {
                        text.push_str(&format!("--- Page {} ---\n", i + 1));
                        text.push_str(page_text);
                        text.push('\n');
                    }
                }
            }
            Err(e) => {
                warn!("Ollama API failed on page {}: {}", i + 1, e);
                // Continue with other pages instead of failing completely
            }
        }
    }

    if total_pages > MAX_OCR_PAGES {
        text.push_str(&format!(
            "\n--- Note: Only first {} of {} pages were processed ---\n",
            MAX_OCR_PAGES, total_pages
        ));
    }

    Ok(text)
}

/// Try to find bundled OCR models
fn find_ocr_models() -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    // Try various locations for bundled models
    let possible_dirs = [
        std::path::PathBuf::from("./resources"),
        std::path::PathBuf::from("."),
        std::path::PathBuf::from("src-tauri/resources"),
    ];

    // Also check executable's directory
    let exe_dirs: Vec<std::path::PathBuf> = if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            vec![
                exe_dir.to_path_buf(),
                exe_dir.join("resources"),
                // macOS: Resources folder in app bundle
                exe_dir.parent().map(|p| p.join("Resources")).unwrap_or_default(),
            ]
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    let all_dirs: Vec<_> = possible_dirs.into_iter().chain(exe_dirs).collect();

    for dir in all_dirs {
        let detection_path = dir.join("text-detection.rten");
        let recognition_path = dir.join("text-recognition.rten");
        if detection_path.exists() && recognition_path.exists() {
            info!("Found bundled OCR models in: {}", dir.display());
            return Some((detection_path, recognition_path));
        }
    }

    // Fall back to user's cache directory (where ocrs CLI stores models)
    if let Some(cache_dir) = dirs::cache_dir().map(|d| d.join("ocrs")) {
        let detection_path = cache_dir.join("text-detection.rten");
        let recognition_path = cache_dir.join("text-recognition.rten");
        if detection_path.exists() && recognition_path.exists() {
            info!("Found OCR models in cache: {}", cache_dir.display());
            return Some((detection_path, recognition_path));
        }
    }

    None
}

/// Extract text from PDF using traditional OCR (ocrs - pure Rust)
fn extract_pdf_with_ocrs(path: &Path) -> Result<String> {
    use ocrs::{DimOrder, ImageSource, OcrEngine, OcrEngineParams};
    use rten_tensor::{AsView, NdTensor};

    let images = render_pdf_pages(path)?;
    let total_pages = images.len();
    let pages_to_process = images.len().min(MAX_OCR_PAGES);

    if total_pages > MAX_OCR_PAGES {
        warn!(
            "PDF has {} pages, only processing first {} for OCR: {}",
            total_pages, MAX_OCR_PAGES, path.display()
        );
    }

    // Find OCR models (bundled or in cache)
    let (detection_model_path, recognition_model_path) = find_ocr_models()
        .ok_or_else(|| anyhow::anyhow!(
            "OCR models not found. Enable Ollama in Settings for scanned PDF support."
        ))?;

    let detection_model = rten::Model::load_file(&detection_model_path)
        .map_err(|e| anyhow::anyhow!("Failed to load detection model: {}", e))?;
    let recognition_model = rten::Model::load_file(&recognition_model_path)
        .map_err(|e| anyhow::anyhow!("Failed to load recognition model: {}", e))?;

    // Initialize OCR engine with loaded models
    let engine = OcrEngine::new(OcrEngineParams {
        detection_model: Some(detection_model),
        recognition_model: Some(recognition_model),
        ..Default::default()
    })?;

    let mut text = String::new();
    for (i, img) in images.iter().take(pages_to_process).enumerate() {
        info!("Traditional OCR: processing page {}/{} of {}", i + 1, pages_to_process, path.display());
        // Convert DynamicImage to RGB8 for OCR
        let rgb = img.to_rgb8();
        let (width, height) = rgb.dimensions();

        // Create NdTensor from image data [height, width, channels]
        let tensor: NdTensor<u8, 3> = NdTensor::from_data(
            [height as usize, width as usize, 3],
            rgb.into_vec(),
        );

        // Create ImageSource from tensor
        let img_source = ImageSource::from_tensor(tensor.view(), DimOrder::Hwc)?;

        // Run OCR
        let ocr_input = engine.prepare_input(img_source)?;

        // Detect words and find text lines
        let word_rects = engine.detect_words(&ocr_input)?;
        let line_rects = engine.find_text_lines(&ocr_input, &word_rects);

        // Recognize text from lines
        let line_texts = engine.recognize_text(&ocr_input, &line_rects)?;
        let page_text: String = line_texts
            .iter()
            .filter_map(|line| line.as_ref())
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        if !page_text.trim().is_empty() {
            text.push_str(&format!("--- Page {} ---\n", i + 1));
            text.push_str(&page_text);
            text.push('\n');
        }
    }

    if total_pages > MAX_OCR_PAGES {
        text.push_str(&format!(
            "\n--- Note: Only first {} of {} pages were processed ---\n",
            MAX_OCR_PAGES, total_pages
        ));
    }

    Ok(text)
}

/// Render PDF pages to images for OCR
fn render_pdf_pages(path: &Path) -> Result<Vec<image::DynamicImage>> {
    use pdfium_render::prelude::*;

    // Try to bind to pdfium library from bundled resources, then system
    let bindings = bind_to_bundled_pdfium()
        .or_else(|| Pdfium::bind_to_system_library().ok())
        .ok_or_else(|| anyhow::anyhow!("libpdfium not found. Scanned PDF OCR is not available."))?;

    let pdfium = Pdfium::new(bindings);
    let document = pdfium.load_pdf_from_file(path, None)?;

    let mut images = Vec::new();
    let render_config = PdfRenderConfig::new()
        .set_target_width(2000) // Good resolution for OCR
        .set_maximum_height(3000);

    for page in document.pages().iter() {
        let bitmap = page.render_with_config(&render_config)?;
        let img = bitmap.as_image();
        images.push(img);
    }

    Ok(images)
}

/// Extract text from HTML files using scraper
fn extract_html_text(path: &Path) -> Result<String> {
    let html = std::fs::read_to_string(path)?;
    let document = scraper::Html::parse_document(&html);
    Ok(document.root_element().text().collect::<Vec<_>>().join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extraction_seems_failed() {
        // Empty text should fail
        assert!(extraction_seems_failed("", 1));
        assert!(extraction_seems_failed("   ", 1));

        // Very short text for page count should fail
        assert!(extraction_seems_failed("Hello", 1));

        // Good text should pass
        let good_text = "This is a sample document with enough text content to pass the extraction check. It contains multiple sentences and paragraphs of readable content that would typically be found in a real PDF document.";
        assert!(!extraction_seems_failed(good_text, 1));

        // Mostly non-printable should fail
        let garbage = "\u{0000}\u{0001}\u{0002}abc";
        assert!(extraction_seems_failed(garbage, 1));
    }
}
