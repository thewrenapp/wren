use crate::connector::ConnectorServer;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub token: Option<String>,
}

#[tauri::command]
pub async fn get_connector_status(
    state: State<'_, AppState>,
) -> Result<ConnectorStatus, String> {
    let server = state.connector_server.read().await;
    let token = crate::commands::settings::get_setting_value(&state.db, "connector_token").await;

    Ok(ConnectorStatus {
        running: server.is_some(),
        port: server.as_ref().map(|s| s.port),
        token,
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
    let port: u16 = port_str.parse().unwrap_or(1289);

    // Get or generate token
    let token = match crate::commands::settings::get_setting_value(&state.db, "connector_token").await {
        Some(t) if !t.is_empty() => t,
        _ => {
            let new_token = Uuid::new_v4().to_string();
            let _ = sqlx::query(
                "INSERT INTO settings (key, value, value_type) VALUES ('connector_token', ?, 'string') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            )
            .bind(&new_token)
            .execute(&state.db)
            .await;
            new_token
        }
    };

    let new_server = ConnectorServer::start(
        port,
        token,
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
    let _ = sqlx::query(
        "INSERT INTO settings (key, value, value_type) VALUES ('connector_enabled', 'true', 'boolean') ON CONFLICT(key) DO UPDATE SET value = 'true'"
    )
    .execute(&state.db)
    .await;

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
    let _ = sqlx::query(
        "INSERT INTO settings (key, value, value_type) VALUES ('connector_enabled', 'false', 'boolean') ON CONFLICT(key) DO UPDATE SET value = 'false'"
    )
    .execute(&state.db)
    .await;

    Ok(())
}

#[tauri::command]
pub async fn regenerate_connector_token(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let new_token = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO settings (key, value, value_type) VALUES ('connector_token', ?, 'string') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .bind(&new_token)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(new_token)
}
