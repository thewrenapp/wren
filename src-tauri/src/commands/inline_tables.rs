use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;

use crate::state::AppState;

// =====================================================
// Types
// =====================================================

#[derive(Debug, Serialize)]
pub struct InlineTable {
    pub id: i64,
    pub key: String,
    pub title: String,
    pub columns: serde_json::Value,
    pub rows: Vec<InlineTableRow>,
    pub date_added: String,
    pub date_modified: String,
}

#[derive(Debug, Serialize)]
pub struct InlineTableRow {
    pub id: i64,
    pub table_id: i64,
    pub data: serde_json::Value,
    pub sort_order: i64,
}

#[derive(Debug, Serialize)]
pub struct InlineTableSummary {
    pub id: i64,
    pub key: String,
    pub title: String,
    pub column_count: i64,
    pub row_count: i64,
    pub date_modified: String,
}

#[derive(Debug, Serialize)]
pub struct InlineTableInfo {
    pub title: String,
    pub column_count: i64,
    pub row_count: i64,
}

#[derive(Debug, Serialize)]
pub struct TableRef {
    pub attachment_id: i64,
    pub entry_id: i64,
    pub entry_title: String,
}

#[derive(Debug, Deserialize)]
pub struct InlineTableColumn {
    pub id: String,
    pub name: String,
    pub width: f64,
}

// =====================================================
// Commands
// =====================================================

/// Create a new inline table with the given title and columns
#[tauri::command]
pub async fn create_inline_table(
    state: State<'_, AppState>,
    title: String,
    columns_json: String,
) -> Result<InlineTable, String> {
    let key = Uuid::new_v4().to_string();

    let result = sqlx::query(
        r#"
        INSERT INTO inline_tables (key, title, columns_json)
        VALUES (?, ?, ?)
        RETURNING id, date_added, date_modified
        "#,
    )
    .bind(&key)
    .bind(&title)
    .bind(&columns_json)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let columns: serde_json::Value =
        serde_json::from_str(&columns_json).unwrap_or(serde_json::Value::Array(vec![]));

    Ok(InlineTable {
        id: result.get("id"),
        key,
        title,
        columns,
        rows: vec![],
        date_added: result.get("date_added"),
        date_modified: result.get("date_modified"),
    })
}

/// Get an inline table by key (UUID), including all rows
#[tauri::command]
pub async fn get_inline_table(
    state: State<'_, AppState>,
    key: String,
) -> Result<InlineTable, String> {
    let table_row = sqlx::query(
        "SELECT id, key, title, columns_json, date_added, date_modified FROM inline_tables WHERE key = ?",
    )
    .bind(&key)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Table not found: {}", key))?;

    let table_id: i64 = table_row.get("id");
    let columns_json: String = table_row.get("columns_json");
    let columns: serde_json::Value =
        serde_json::from_str(&columns_json).unwrap_or(serde_json::Value::Array(vec![]));

    let row_rows = sqlx::query(
        "SELECT id, table_id, data_json, sort_order FROM inline_table_rows WHERE table_id = ? ORDER BY sort_order",
    )
    .bind(table_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let rows: Vec<InlineTableRow> = row_rows
        .iter()
        .map(|r| {
            let data_json: String = r.get("data_json");
            InlineTableRow {
                id: r.get("id"),
                table_id: r.get("table_id"),
                data: serde_json::from_str(&data_json).unwrap_or(serde_json::Value::Object(
                    serde_json::Map::new(),
                )),
                sort_order: r.get("sort_order"),
            }
        })
        .collect();

    Ok(InlineTable {
        id: table_id,
        key: table_row.get("key"),
        title: table_row.get("title"),
        columns,
        rows,
        date_added: table_row.get("date_added"),
        date_modified: table_row.get("date_modified"),
    })
}

/// List all inline tables (summaries, no row data)
#[tauri::command]
pub async fn get_inline_tables(
    state: State<'_, AppState>,
) -> Result<Vec<InlineTableSummary>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            t.id, t.key, t.title, t.columns_json, t.date_modified,
            (SELECT COUNT(*) FROM inline_table_rows WHERE table_id = t.id) as row_count
        FROM inline_tables t
        ORDER BY t.date_modified DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let columns_json: String = r.get("columns_json");
            let columns: Vec<serde_json::Value> =
                serde_json::from_str(&columns_json).unwrap_or_default();
            InlineTableSummary {
                id: r.get("id"),
                key: r.get("key"),
                title: r.get("title"),
                column_count: columns.len() as i64,
                row_count: r.get("row_count"),
                date_modified: r.get("date_modified"),
            }
        })
        .collect())
}

/// Update an inline table's title and/or columns
#[tauri::command]
pub async fn update_inline_table(
    state: State<'_, AppState>,
    key: String,
    title: Option<String>,
    columns_json: Option<String>,
) -> Result<InlineTable, String> {
    // Update fields that are provided
    if let Some(ref t) = title {
        sqlx::query("UPDATE inline_tables SET title = ?, date_modified = datetime('now') WHERE key = ?")
            .bind(t)
            .bind(&key)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(ref c) = columns_json {
        sqlx::query(
            "UPDATE inline_tables SET columns_json = ?, date_modified = datetime('now') WHERE key = ?",
        )
        .bind(c)
        .bind(&key)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Return the updated table
    get_inline_table(state, key).await
}

/// Add a new row to an inline table
#[tauri::command]
pub async fn add_inline_table_row(
    state: State<'_, AppState>,
    table_key: String,
    data_json: String,
) -> Result<InlineTableRow, String> {
    // Get table id
    let table_row = sqlx::query("SELECT id FROM inline_tables WHERE key = ?")
        .bind(&table_key)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Table not found: {}", table_key))?;

    let table_id: i64 = table_row.get("id");

    // Get next sort_order
    let max_order: Option<i64> =
        sqlx::query_scalar("SELECT MAX(sort_order) FROM inline_table_rows WHERE table_id = ?")
            .bind(table_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    let next_order = max_order.unwrap_or(-1) + 1;

    let result = sqlx::query(
        r#"
        INSERT INTO inline_table_rows (table_id, data_json, sort_order)
        VALUES (?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(table_id)
    .bind(&data_json)
    .bind(next_order)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Touch parent table's date_modified
    let _ = sqlx::query("UPDATE inline_tables SET date_modified = datetime('now') WHERE id = ?")
        .bind(table_id)
        .execute(&state.db)
        .await;

    let data: serde_json::Value = serde_json::from_str(&data_json)
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    Ok(InlineTableRow {
        id: result.get("id"),
        table_id,
        data,
        sort_order: next_order,
    })
}

/// Update a row's data
#[tauri::command]
pub async fn update_inline_table_row(
    state: State<'_, AppState>,
    row_id: i64,
    data_json: String,
) -> Result<InlineTableRow, String> {
    let row = sqlx::query(
        "UPDATE inline_table_rows SET data_json = ? WHERE id = ? RETURNING id, table_id, data_json, sort_order",
    )
    .bind(&data_json)
    .bind(row_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Row not found: {}", row_id))?;

    // Touch parent table's date_modified
    let table_id: i64 = row.get("table_id");
    let _ = sqlx::query("UPDATE inline_tables SET date_modified = datetime('now') WHERE id = ?")
        .bind(table_id)
        .execute(&state.db)
        .await;

    let data_str: String = row.get("data_json");
    Ok(InlineTableRow {
        id: row.get("id"),
        table_id: row.get("table_id"),
        data: serde_json::from_str(&data_str)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
        sort_order: row.get("sort_order"),
    })
}

/// Delete a row
#[tauri::command]
pub async fn delete_inline_table_row(
    state: State<'_, AppState>,
    row_id: i64,
) -> Result<(), String> {
    // Get table_id before deleting
    let row = sqlx::query("SELECT table_id FROM inline_table_rows WHERE id = ?")
        .bind(row_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM inline_table_rows WHERE id = ?")
        .bind(row_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Touch parent table's date_modified
    if let Some(r) = row {
        let table_id: i64 = r.get("table_id");
        let _ =
            sqlx::query("UPDATE inline_tables SET date_modified = datetime('now') WHERE id = ?")
                .bind(table_id)
                .execute(&state.db)
                .await;
    }

    Ok(())
}

/// Reorder rows by providing the full list of row IDs in the desired order
#[tauri::command]
pub async fn reorder_inline_table_rows(
    state: State<'_, AppState>,
    table_key: String,
    row_ids: Vec<i64>,
) -> Result<(), String> {
    let table_row = sqlx::query("SELECT id FROM inline_tables WHERE key = ?")
        .bind(&table_key)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Table not found: {}", table_key))?;

    let table_id: i64 = table_row.get("id");

    for (i, row_id) in row_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE inline_table_rows SET sort_order = ? WHERE id = ? AND table_id = ?",
        )
        .bind(i as i64)
        .bind(row_id)
        .bind(table_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    let _ = sqlx::query("UPDATE inline_tables SET date_modified = datetime('now') WHERE id = ?")
        .bind(table_id)
        .execute(&state.db)
        .await;

    Ok(())
}

/// Delete an inline table and all its rows (force-delete, used after ref count check)
#[tauri::command]
pub async fn delete_inline_table(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    sqlx::query("DELETE FROM inline_tables WHERE key = ?")
        .bind(&key)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get a GFM pipe table markdown representation of an inline table (for indexing/LLM)
#[tauri::command]
pub async fn get_inline_table_as_markdown(
    state: State<'_, AppState>,
    key: String,
) -> Result<String, String> {
    let table = get_inline_table(state, key).await?;

    let columns: Vec<InlineTableColumn> =
        serde_json::from_value(table.columns.clone()).unwrap_or_default();

    if columns.is_empty() {
        return Ok(format!("**{}**\n\n(empty table)", table.title));
    }

    // Header row
    let header: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    let header_line = format!("| {} |", header.join(" | "));

    // Separator row
    let separator: Vec<String> = columns.iter().map(|_| "---".to_string()).collect();
    let separator_line = format!("| {} |", separator.join(" | "));

    // Data rows
    let mut data_lines = Vec::new();
    for row in &table.rows {
        let cells: Vec<String> = columns
            .iter()
            .map(|col| {
                row.data
                    .get(&col.id)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            })
            .collect();
        data_lines.push(format!("| {} |", cells.join(" | ")));
    }

    let mut result = format!("**{}**\n\n{}\n{}", table.title, header_line, separator_line);
    for line in data_lines {
        result.push('\n');
        result.push_str(&line);
    }

    Ok(result)
}

/// Get documents that embed a given table (for table link navigation)
#[tauri::command]
pub async fn get_inline_table_refs(
    state: State<'_, AppState>,
    table_key: String,
) -> Result<Vec<TableRef>, String> {
    let rows = sqlx::query(
        r#"
        SELECT r.attachment_id, a.entry_id, e.title as entry_title
        FROM inline_table_refs r
        JOIN inline_tables t ON r.table_id = t.id
        JOIN attachments a ON r.attachment_id = a.id
        JOIN entries e ON a.entry_id = e.id
        WHERE t.key = ?
        ORDER BY e.title
        "#,
    )
    .bind(&table_key)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| TableRef {
            attachment_id: r.get("attachment_id"),
            entry_id: r.get("entry_id"),
            entry_title: r.get::<String, _>("entry_title"),
        })
        .collect())
}

/// Get lightweight table info (for hover tooltips on table links)
#[tauri::command]
pub async fn get_inline_table_info(
    state: State<'_, AppState>,
    key: String,
) -> Result<InlineTableInfo, String> {
    let row = sqlx::query(
        r#"
        SELECT t.title, t.columns_json,
               (SELECT COUNT(*) FROM inline_table_rows WHERE table_id = t.id) as row_count
        FROM inline_tables t
        WHERE t.key = ?
        "#,
    )
    .bind(&key)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Table not found: {}", key))?;

    let columns_json: String = row.get("columns_json");
    let columns: Vec<serde_json::Value> =
        serde_json::from_str(&columns_json).unwrap_or_default();

    Ok(InlineTableInfo {
        title: row.get("title"),
        column_count: columns.len() as i64,
        row_count: row.get("row_count"),
    })
}
