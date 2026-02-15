use tauri::State;

use super::types::{Job, JobType};
use crate::state::AppState;

#[tauri::command]
pub async fn enqueue_job(
    state: State<'_, AppState>,
    job_type: String,
    payload: serde_json::Value,
    priority: Option<i32>,
    title: Option<String>,
) -> Result<String, String> {
    let jt = JobType::from_str(&job_type)
        .ok_or_else(|| format!("Unknown job type: {}", job_type))?;
    state
        .job_queue
        .enqueue(jt, title, payload, priority.unwrap_or(0))
        .await
}

#[tauri::command]
pub async fn get_jobs(
    state: State<'_, AppState>,
    status: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Job>, String> {
    state
        .job_queue
        .get_jobs(status.as_deref(), limit.unwrap_or(50))
        .await
}

#[tauri::command]
pub async fn get_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<Job, String> {
    state.job_queue.get_job(&job_id).await
}

#[tauri::command]
pub async fn cancel_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    state.job_queue.cancel(&job_id).await
}

#[tauri::command]
pub async fn retry_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<String, String> {
    state.job_queue.retry(&job_id).await
}

#[tauri::command]
pub async fn clear_finished_jobs(
    state: State<'_, AppState>,
) -> Result<u64, String> {
    state.job_queue.clear_finished_jobs().await
}
