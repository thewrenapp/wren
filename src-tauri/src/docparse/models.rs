//! Model file management for the oar-ocr pipeline.
//!
//! oar-ocr 0.6 expects on-disk ONNX model paths (it has no built-in
//! auto-download). On first use we fetch the required PaddleOCR ONNX models and
//! dictionaries from the ModelScope repository that backs oar-ocr
//! (`greatv/oar-ocr`) into a per-user cache directory (`$OAR_HOME`, defaulting
//! to an app-data location) and reuse them on subsequent runs. Names, sizes and
//! SHA-256 hashes mirror oar-ocr's own download registry; every download is
//! verified against both before being committed to the cache.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

/// ModelScope repo + revision backing oar-ocr's registered model files.
const MODELSCOPE_REPO: &str = "greatv/oar-ocr";
const MODELSCOPE_REVISION: &str = "master";

/// A model artifact mirrored on ModelScope: registered file name, expected
/// SHA-256 hash, and byte size.
struct ModelFile {
    name: &'static str,
    sha256: &'static str,
    size: u64,
}

/// Layout model family name passed to the structure builder for label decoding.
pub const LAYOUT_MODEL_NAME: &str = "pp-doclayout-s";

const LAYOUT: ModelFile = ModelFile {
    name: "pp-doclayout-s.onnx",
    sha256: "c2336493a0a13cd9b9b457ca68aea370b327c362a4a7da4917c2bba96029bceb",
    size: 4_914_918,
};
const OCR_DET: ModelFile = ModelFile {
    name: "pp-ocrv5_mobile_det.onnx",
    sha256: "1eb7b4f7ab657ebd1c66d5f79bca7497f29768a2e3c15e52daecbba1a8e4a039",
    size: 4_826_518,
};
const OCR_REC: ModelFile = ModelFile {
    name: "pp-ocrv5_mobile_rec.onnx",
    sha256: "243a0f06d826761323e9045e9b113ab2c191c3aa50565585e628300b8eda0224",
    size: 16_562_373,
};
const OCR_DICT: ModelFile = ModelFile {
    name: "ppocrv5_dict.txt",
    sha256: "d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b",
    size: 74_012,
};
const TABLE_CLS: ModelFile = ModelFile {
    name: "pp-lcnet_x1_0_table_cls.onnx",
    sha256: "61ed75151cadba903ec5182f1ffc59e961e52de501c61c5ffeb466346fc65040",
    size: 6_776_998,
};
const TABLE_STRUCTURE: ModelFile = ModelFile {
    name: "slanet_plus.onnx",
    sha256: "3a96a71719247c5d94992fca31266b598c54740388de371f0c75077e2a9e0b55",
    size: 7_782_138,
};
const TABLE_DICT: ModelFile = ModelFile {
    name: "table_structure_dict_ch.txt",
    sha256: "68d344a84b726e043f390122240ff2b2ced2949b2a80ce9b61ae955054d190ef",
    size: 578,
};

const ALL_MODELS: &[ModelFile] = &[
    LAYOUT,
    OCR_DET,
    OCR_REC,
    OCR_DICT,
    TABLE_CLS,
    TABLE_STRUCTURE,
    TABLE_DICT,
];

/// Resolved on-disk paths for every model the parser needs.
pub struct ModelPaths {
    pub layout: PathBuf,
    pub ocr_det: PathBuf,
    pub ocr_rec: PathBuf,
    pub ocr_dict: PathBuf,
    pub table_cls: PathBuf,
    pub table_structure: PathBuf,
    pub table_dict: PathBuf,
}

/// Directory where models are cached: `$OAR_HOME` if set, else app-data.
pub fn model_home() -> PathBuf {
    if let Ok(dir) = std::env::var("OAR_HOME")
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir);
    }
    if let Some(dirs) = directories::ProjectDirs::from("com", "wren", "wren") {
        return dirs.data_dir().join("oar-models");
    }
    if let Some(user) = directories::UserDirs::new() {
        return user.home_dir().join(".oar").join("models");
    }
    PathBuf::from(".oar/models")
}

/// Ensure all required models are present (downloading any that are missing),
/// returning their resolved paths.
pub fn ensure_models() -> Result<ModelPaths> {
    let home = model_home();
    std::fs::create_dir_all(&home)
        .with_context(|| format!("Failed to create model dir {}", home.display()))?;

    for model in ALL_MODELS {
        ensure_one(&home, model)?;
    }

    Ok(ModelPaths {
        layout: home.join(LAYOUT.name),
        ocr_det: home.join(OCR_DET.name),
        ocr_rec: home.join(OCR_REC.name),
        ocr_dict: home.join(OCR_DICT.name),
        table_cls: home.join(TABLE_CLS.name),
        table_structure: home.join(TABLE_STRUCTURE.name),
        table_dict: home.join(TABLE_DICT.name),
    })
}

/// ModelScope download URL for a registered file name.
fn download_url(name: &str) -> String {
    format!(
        "https://www.modelscope.cn/api/v1/models/{}/repo?Revision={}&FilePath={}",
        MODELSCOPE_REPO, MODELSCOPE_REVISION, name
    )
}

/// Download `model` into `home` if it is missing or the wrong size.
///
/// A cached file whose size matches is trusted (hashing every ~30MB model on
/// each startup would be wasteful); freshly downloaded bytes are verified
/// against both the expected size and SHA-256 before being committed.
fn ensure_one(home: &Path, model: &ModelFile) -> Result<()> {
    let dest = home.join(model.name);

    if let Ok(meta) = std::fs::metadata(&dest) {
        if meta.len() == model.size {
            return Ok(());
        }
        tracing::warn!(
            "Model {} has unexpected size {} (expected {}); re-downloading",
            model.name,
            meta.len(),
            model.size
        );
    }

    let url = download_url(model.name);
    tracing::info!(
        "Downloading OCR model {} ({} bytes) from ModelScope...",
        model.name,
        model.size
    );

    let bytes = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .context("Failed to build HTTP client")?
        .get(&url)
        .send()
        .with_context(|| format!("Failed to request {url}"))?
        .error_for_status()
        .with_context(|| format!("Download failed for {url}"))?
        .bytes()
        .with_context(|| format!("Failed to read body for {url}"))?;

    if bytes.len() as u64 != model.size {
        anyhow::bail!(
            "Downloaded {} has size {} but expected {}",
            model.name,
            bytes.len(),
            model.size
        );
    }

    let digest = hex::encode(Sha256::digest(&bytes));
    if digest != model.sha256 {
        anyhow::bail!(
            "Downloaded {} failed SHA-256 verification (got {}, expected {})",
            model.name,
            digest,
            model.sha256
        );
    }

    // Write to a temp file then rename for atomicity.
    let tmp = home.join(format!("{}.part", model.name));
    std::fs::write(&tmp, &bytes)
        .with_context(|| format!("Failed to write {}", tmp.display()))?;
    std::fs::rename(&tmp, &dest)
        .with_context(|| format!("Failed to finalize {}", dest.display()))?;

    tracing::info!("Saved OCR model to {}", dest.display());
    Ok(())
}
