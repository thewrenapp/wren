use serde::{Deserialize, Serialize};
use sqlx::FromRow;

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

    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => JobStatus::Running,
            "completed" => JobStatus::Completed,
            "failed" => JobStatus::Failed,
            "cancelled" => JobStatus::Cancelled,
            _ => JobStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum JobType {
    ReindexLibrary,
    BulkImportPdfs,
    BulkImportFolder,
    OcrExtract,
}

impl JobType {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobType::ReindexLibrary => "reindex_library",
            JobType::BulkImportPdfs => "bulk_import_pdfs",
            JobType::BulkImportFolder => "bulk_import_folder",
            JobType::OcrExtract => "ocr_extract",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            JobType::ReindexLibrary => "Reindex Library",
            JobType::BulkImportPdfs => "Import PDFs",
            JobType::BulkImportFolder => "Import Folder",
            JobType::OcrExtract => "OCR Extraction",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "reindex_library" => Some(JobType::ReindexLibrary),
            "bulk_import_pdfs" => Some(JobType::BulkImportPdfs),
            "bulk_import_folder" => Some(JobType::BulkImportFolder),
            "ocr_extract" => Some(JobType::OcrExtract),
            _ => None,
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
        }
    }

    /// Whether this job type is CPU-bound and should run on spawn_blocking.
    /// I/O-bound jobs (DB queries, file reads, network) run on the async pool.
    /// CPU-bound jobs (LLM inference, heavy computation) use the blocking pool.
    pub fn is_cpu_bound(&self) -> bool {
        match self {
            JobType::ReindexLibrary => false,   // mostly I/O (DB + file reads)
            JobType::BulkImportPdfs => false,
            JobType::BulkImportFolder => false,
            JobType::OcrExtract => false,       // kreuzberg is async internally
            // Future: LlmAnalysis => true,
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
    pub enable_ocr: bool,
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
