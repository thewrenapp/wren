use crate::state::AppState;
use crate::sync::sharing;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ShareResponse {
    #[serde(rename = "shareId")]
    pub share_id: String,
}

#[tauri::command]
pub async fn get_shares(
    state: State<'_, AppState>,
) -> Result<Vec<sharing::ShareInfo>, String> {
    sharing::get_active_shares(&state.db)
        .await
        .map_err(|e| e.to_string())
}
