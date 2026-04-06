use crate::connector::ConnectorServer;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorStatus {
    pub running: bool,
    pub port: Option<u16>,
}

#[tauri::command]
pub async fn get_connector_status(
    state: State<'_, AppState>,
) -> Result<ConnectorStatus, String> {
    let server = state.connector_server.read().await;

    Ok(ConnectorStatus {
        running: server.is_some(),
        port: server.as_ref().map(|s| s.port),
    })
}

#[tauri::command]
pub async fn start_connector_server(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut server = state.connector_server.write().await;
    if server.is_some() {
        return Err("Connector server is already running".to_string());
    }

    let port_str = crate::commands::settings::get_setting_value(&state.db, "connector_port")
        .await
        .unwrap_or_else(|| "1289".to_string());
    let port: u16 = port_str.parse().unwrap_or_else(|_| {
        tracing::warn!(
            "Failed to parse connector_port setting '{}', falling back to default port 1289",
            port_str
        );
        1289
    });

    let new_server = ConnectorServer::start(
        port,
        state.db.clone(),
        state.library_path.clone(),
        state.search_index.clone(),
        state.job_queue.clone(),
        app_handle,
    )
    .await
    .map_err(|e| format!("Failed to start connector server: {}", e))?;

    *server = Some(new_server);

    // Persist enabled state
    if let Err(e) = sqlx::query(
        "INSERT INTO settings (key, value, value_type) VALUES ('connector_enabled', 'true', 'boolean') ON CONFLICT(key) DO UPDATE SET value = 'true'"
    )
    .execute(&state.db)
    .await
    {
        tracing::error!("Failed to persist connector enabled state: {}", e);
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_connector_server(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut server = state.connector_server.write().await;
    if let Some(s) = server.take() {
        s.stop().await;
    }

    // Persist disabled state
    if let Err(e) = sqlx::query(
        "INSERT INTO settings (key, value, value_type) VALUES ('connector_enabled', 'false', 'boolean') ON CONFLICT(key) DO UPDATE SET value = 'false'"
    )
    .execute(&state.db)
    .await
    {
        tracing::error!("Failed to persist connector disabled state: {}", e);
    }

    Ok(())
}
