use crate::db::models::Setting;
use crate::state::AppState;
use sqlx::{Row, FromRow};
use tauri::State;

#[derive(Debug, FromRow)]
struct SettingRow {
    key: String,
    value: String,
    value_type: String,
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Vec<Setting>, String> {
    let settings: Vec<SettingRow> = sqlx::query_as::<_, SettingRow>(
        "SELECT key, value, value_type FROM settings"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(settings
        .into_iter()
        .map(|s| Setting {
            key: s.key,
            value: s.value,
            value_type: s.value_type,
        })
        .collect())
}

#[tauri::command]
pub async fn update_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO settings (key, value, date_modified)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            date_modified = datetime('now')
        "#
    )
    .bind(key)
    .bind(value)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_library_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.get_library_path_string().await)
}
