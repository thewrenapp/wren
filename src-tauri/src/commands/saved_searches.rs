use crate::db::models::{CreateSavedSearchInput, SavedSearch, SavedSearchCriterion, UpdateSavedSearchInput};
use crate::state::AppState;
use sqlx::{FromRow, Row};
use tauri::State;

#[derive(Debug, FromRow)]
struct SavedSearchRow {
    id: i64,
    name: String,
    match_mode: String,
    criteria_json: String,
    scope: String,
    collection_id: Option<i64>,
    sort_order: i32,
    date_added: String,
    date_modified: String,
}

impl SavedSearchRow {
    fn into_saved_search(self) -> Result<SavedSearch, String> {
        let criteria: Vec<SavedSearchCriterion> = serde_json::from_str(&self.criteria_json)
            .map_err(|e| format!("Failed to parse criteria: {}", e))?;

        Ok(SavedSearch {
            id: self.id,
            name: self.name,
            match_mode: self.match_mode,
            criteria,
            scope: self.scope,
            collection_id: self.collection_id,
            sort_order: self.sort_order,
            date_added: self.date_added,
            date_modified: self.date_modified,
        })
    }
}

#[tauri::command]
pub async fn get_saved_searches(state: State<'_, AppState>) -> Result<Vec<SavedSearch>, String> {
    let rows: Vec<SavedSearchRow> = sqlx::query_as(
        r#"
        SELECT id, name, match_mode, criteria_json, scope, collection_id, sort_order, date_added, date_modified
        FROM saved_searches
        ORDER BY sort_order, name
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    rows.into_iter()
        .map(|row| row.into_saved_search())
        .collect()
}

#[tauri::command]
pub async fn get_saved_search(state: State<'_, AppState>, id: i64) -> Result<SavedSearch, String> {
    let row: SavedSearchRow = sqlx::query_as(
        r#"
        SELECT id, name, match_mode, criteria_json, scope, collection_id, sort_order, date_added, date_modified
        FROM saved_searches
        WHERE id = ?
        "#,
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    row.into_saved_search()
}

#[tauri::command]
pub async fn create_saved_search(
    state: State<'_, AppState>,
    input: CreateSavedSearchInput,
) -> Result<SavedSearch, String> {
    let criteria_json = serde_json::to_string(&input.criteria)
        .map_err(|e| format!("Failed to serialize criteria: {}", e))?;

    let result = sqlx::query(
        r#"
        INSERT INTO saved_searches (name, match_mode, criteria_json, scope, collection_id)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id, date_added, date_modified
        "#,
    )
    .bind(&input.name)
    .bind(&input.match_mode)
    .bind(&criteria_json)
    .bind(&input.scope)
    .bind(input.collection_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(SavedSearch {
        id: result.get("id"),
        name: input.name,
        match_mode: input.match_mode,
        criteria: input.criteria,
        scope: input.scope,
        collection_id: input.collection_id,
        sort_order: 0,
        date_added: result.get("date_added"),
        date_modified: result.get("date_modified"),
    })
}

#[tauri::command]
pub async fn update_saved_search(
    state: State<'_, AppState>,
    id: i64,
    input: UpdateSavedSearchInput,
) -> Result<SavedSearch, String> {
    // Update name if provided
    if let Some(name) = &input.name {
        sqlx::query(
            "UPDATE saved_searches SET name = ?, date_modified = datetime('now') WHERE id = ?",
        )
        .bind(name)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Update match_mode if provided
    if let Some(match_mode) = &input.match_mode {
        sqlx::query(
            "UPDATE saved_searches SET match_mode = ?, date_modified = datetime('now') WHERE id = ?",
        )
        .bind(match_mode)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Update criteria if provided
    if let Some(criteria) = &input.criteria {
        let criteria_json = serde_json::to_string(criteria)
            .map_err(|e| format!("Failed to serialize criteria: {}", e))?;
        sqlx::query(
            "UPDATE saved_searches SET criteria_json = ?, date_modified = datetime('now') WHERE id = ?",
        )
        .bind(&criteria_json)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Update scope if provided
    if let Some(scope) = &input.scope {
        sqlx::query(
            "UPDATE saved_searches SET scope = ?, date_modified = datetime('now') WHERE id = ?",
        )
        .bind(scope)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Update collection_id - handle both setting a value and clearing it
    if input.collection_id.is_some() || input.scope.as_deref() == Some("all") {
        sqlx::query(
            "UPDATE saved_searches SET collection_id = ?, date_modified = datetime('now') WHERE id = ?",
        )
        .bind(input.collection_id)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Fetch and return updated record
    get_saved_search(state, id).await
}

#[tauri::command]
pub async fn delete_saved_search(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM saved_searches WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn reorder_saved_searches(
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<(), String> {
    for (index, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE saved_searches SET sort_order = ? WHERE id = ?")
            .bind(index as i32)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
