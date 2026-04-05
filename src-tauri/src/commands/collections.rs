use crate::db::models::{Collection, CreateCollectionInput};
use crate::state::AppState;
use crate::sync::globals::sync_collections_json;
use crate::sync::writer::sync_entry_json;
use sqlx::{Row, FromRow};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct CollectionRow {
    id: i64,
    key: String,
    name: String,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<i64>,
    item_count: i64,
}

#[tauri::command]
pub async fn get_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    let collections: Vec<CollectionRow> = sqlx::query_as::<_, CollectionRow>(
        r#"
        SELECT
            c.id,
            c.key,
            c.name,
            c.description,
            c.color,
            c.icon,
            c.parent_id,
            COALESCE((
                SELECT COUNT(*)
                FROM collection_entries ce
                INNER JOIN entries e ON e.id = ce.entry_id
                WHERE ce.collection_id = c.id AND e.is_deleted = 0
            ), 0) as item_count
        FROM collections c
        ORDER BY c.name
        "#
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(collections
        .into_iter()
        .map(|c| Collection {
            id: c.id,
            key: c.key,
            name: c.name,
            description: c.description,
            color: c.color,
            icon: c.icon,
            parent_id: c.parent_id,
            item_count: c.item_count,
        })
        .collect())
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    input: CreateCollectionInput,
) -> Result<Collection, String> {
    let key = Uuid::new_v4().to_string();

    let result = sqlx::query(
        r#"
        INSERT INTO collections (key, name, description, color, icon)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
        "#
    )
    .bind(&key)
    .bind(&input.name)
    .bind(&input.description)
    .bind(&input.color)
    .bind(&input.icon)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let lib = state.library_path.read().await;
    sync_collections_json(&state.db, &lib).await;

    Ok(Collection {
        id: result.get("id"),
        key,
        name: input.name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        parent_id: input.parent_id,
        item_count: 0,
    })
}

#[tauri::command]
pub async fn update_collection(
    state: State<'_, AppState>,
    id: i64,
    name: Option<String>,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    if let Some(n) = name {
        sqlx::query("UPDATE collections SET name = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(n)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(d) = description {
        sqlx::query("UPDATE collections SET description = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(d)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(c) = color {
        sqlx::query("UPDATE collections SET color = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(c)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(i) = icon {
        sqlx::query("UPDATE collections SET icon = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(i)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    let lib = state.library_path.read().await;
    sync_collections_json(&state.db, &lib).await;

    Ok(())
}

#[tauri::command]
pub async fn delete_collection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let lib = state.library_path.read().await;
    sync_collections_json(&state.db, &lib).await;

    Ok(())
}

#[tauri::command]
pub async fn add_item_to_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO collection_entries (collection_id, entry_id, order_index)
        VALUES (?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM collection_entries WHERE collection_id = ?))
        "#
    )
    .bind(collection_id)
    .bind(entry_id)
    .bind(collection_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let lib = state.library_path.read().await;
    sync_entry_json(&state.db, &lib, entry_id).await;

    Ok(())
}

#[tauri::command]
pub async fn remove_item_from_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_entries WHERE collection_id = ? AND entry_id = ?")
        .bind(collection_id)
        .bind(entry_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let lib = state.library_path.read().await;
    sync_entry_json(&state.db, &lib, entry_id).await;

    Ok(())
}

/// Merge multiple collections into a target collection
/// - Moves all entries from source collections to target
/// - Optionally renames the target collection
/// - Optionally changes the target collection's color
/// - Deletes the source collections
#[tauri::command]
pub async fn merge_collections(
    state: State<'_, AppState>,
    target_id: i64,
    source_ids: Vec<i64>,
    new_name: Option<String>,
    new_color: Option<String>,
) -> Result<u32, String> {
    // Move entries from source collections to target (avoiding duplicates)
    for source_id in &source_ids {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO collection_entries (collection_id, entry_id, order_index)
            SELECT ?, entry_id, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM collection_entries WHERE collection_id = ?)
            FROM collection_entries
            WHERE collection_id = ?
            "#
        )
        .bind(target_id)
        .bind(target_id)
        .bind(source_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Update target collection name if provided
    if let Some(name) = new_name {
        sqlx::query("UPDATE collections SET name = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&name)
            .bind(target_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Update target collection color if provided
    if let Some(color) = new_color {
        sqlx::query("UPDATE collections SET color = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&color)
            .bind(target_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Delete source collections
    let merged_count = source_ids.len() as u32;
    for source_id in &source_ids {
        sqlx::query("DELETE FROM collections WHERE id = ?")
            .bind(source_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(merged_count)
}

/// Delete a collection and optionally move its entries to trash
#[tauri::command]
pub async fn delete_collection_with_entries(
    state: State<'_, AppState>,
    id: i64,
    delete_entries: bool,
) -> Result<u32, String> {
    let mut deleted_entries = 0u32;

    if delete_entries {
        // Get all entries in this collection
        let entry_ids: Vec<i64> = sqlx::query_scalar(
            "SELECT entry_id FROM collection_entries WHERE collection_id = ?"
        )
        .bind(id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Move entries to trash (soft delete)
        for entry_id in &entry_ids {
            sqlx::query(
                "UPDATE entries SET is_deleted = 1, date_modified = datetime('now') WHERE id = ?"
            )
            .bind(entry_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        }
        deleted_entries = entry_ids.len() as u32;
    }

    // Delete the collection (cascade will remove collection_entries)
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(deleted_entries)
}

/// Bulk update color for multiple collections
#[tauri::command]
pub async fn bulk_update_collection_color(
    state: State<'_, AppState>,
    collection_ids: Vec<i64>,
    color: Option<String>,
) -> Result<u32, String> {
    let mut updated = 0u32;

    for id in collection_ids {
        sqlx::query("UPDATE collections SET color = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&color)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        updated += 1;
    }

    Ok(updated)
}

