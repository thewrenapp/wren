//! Tauri command: enqueue AI metadata extraction as a background job.

use tauri::State;
use crate::state::AppState;

/// Enqueue a metadata extraction job for a single entry.
#[tauri::command]
pub async fn extract_metadata_with_ai(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<String, String> {
    let payload = serde_json::json!({ "entryId": entry_id });

    let job_id = state.job_queue.enqueue(
        crate::jobs::types::JobType::MetadataExtract,
        Some(format!("Extract Metadata #{}", entry_id)),
        payload,
        0,
    ).await?;

    Ok(job_id)
}
