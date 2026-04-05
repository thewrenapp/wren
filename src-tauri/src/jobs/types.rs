use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Pending => "pending",
            JobStatus::Running => "running",
            JobStatus::Completed => "completed",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }
}

impl FromStr for JobStatus {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "running" => JobStatus::Running,
            "completed" => JobStatus::Completed,
            "failed" => JobStatus::Failed,
            "cancelled" => JobStatus::Cancelled,
            _ => JobStatus::Pending,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum JobType {
    ReindexLibrary,
    BulkImportPdfs,
    BulkImportFolder,
    OcrExtract,
    LlmParse,
    MetadataExtract,
    RagIndex,
    RagCleanupVectors,
}

impl JobType {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobType::ReindexLibrary => "reindex_library",
            JobType::BulkImportPdfs => "bulk_import_pdfs",
            JobType::BulkImportFolder => "bulk_import_folder",
            JobType::OcrExtract => "ocr_extract",
            JobType::LlmParse => "llm_parse",
            JobType::MetadataExtract => "metadata_extract",
            JobType::RagIndex => "rag_index",
            JobType::RagCleanupVectors => "rag_cleanup_vectors",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            JobType::ReindexLibrary => "Reindex Library",
            JobType::BulkImportPdfs => "Import PDFs",
            JobType::BulkImportFolder => "Import Folder",
            JobType::OcrExtract => "OCR Extraction",
            JobType::LlmParse => "Parse Document Structure",
            JobType::MetadataExtract => "Extract Metadata with AI",
            JobType::RagIndex => "Build Semantic Index",
            JobType::RagCleanupVectors => "Cleanup Vectors",
        }
    }

    /// Whether this job type is safe to restart from scratch after interruption.
    /// Idempotent jobs (reindex, import with dedup) can safely restart.
    pub fn is_restartable(&self) -> bool {
        match self {
            JobType::ReindexLibrary => true,
            JobType::BulkImportPdfs => true,   // import has SHA256 dedup
            JobType::BulkImportFolder => true,  // same dedup
            JobType::OcrExtract => true,
            JobType::LlmParse => true,          // checkpointed, can resume
            JobType::MetadataExtract => true,
            JobType::RagIndex => true,
            JobType::RagCleanupVectors => true,
        }
    }

    pub fn is_cpu_bound(&self) -> bool {
        match self {
            JobType::ReindexLibrary => false,
            JobType::BulkImportPdfs => false,
            JobType::BulkImportFolder => false,
            JobType::OcrExtract => false,
            JobType::LlmParse => false,
            JobType::MetadataExtract => false,
            JobType::RagIndex => false,
            JobType::RagCleanupVectors => false,
        }
    }
}

impl FromStr for JobType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "reindex_library" => Ok(JobType::ReindexLibrary),
            "bulk_import_pdfs" => Ok(JobType::BulkImportPdfs),
            "bulk_import_folder" => Ok(JobType::BulkImportFolder),
            "ocr_extract" => Ok(JobType::OcrExtract),
            "llm_parse" => Ok(JobType::LlmParse),
            "metadata_extract" => Ok(JobType::MetadataExtract),
            "rag_index" => Ok(JobType::RagIndex),
            "rag_cleanup_vectors" => Ok(JobType::RagCleanupVectors),
            _ => Err(format!("Unknown job type: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub job_type: String,
    pub status: String,
    pub title: Option<String>,
    pub payload_json: String,
    pub result_json: Option<String>,
    pub error_message: Option<String>,
    pub progress_current: i64,
    pub progress_total: i64,
    pub progress_message: Option<String>,
    pub priority: i32,
    pub max_retries: i32,
    pub retry_count: i32,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

// Payload structs for each job type

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexPayload {
    // OCR settings removed — ferrules handles OCR automatically.
    // Fields kept for backward compat with existing job payloads in DB.
    #[serde(default)]
    pub enable_ocr: bool,
    #[serde(default)]
    pub force_ocr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportPdfsPayload {
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportFolderPayload {
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrExtractPayload {
    pub attachment_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmParsePayload {
    pub attachment_id: i64,
    pub entry_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataExtractPayload {
    pub entry_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexPayload {
    pub entry_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagCleanupVectorsPayload {
    pub entry_id: i64,
}

