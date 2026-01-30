use crate::db::models::{Collection, CreateCollectionInput};
use crate::state::AppState;
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
            COALESCE((SELECT COUNT(*) FROM collection_items WHERE collection_id = c.id), 0) as item_count
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

    Ok(Collection {
        id: result.get("id"),
        key,
        name: input.name,
        description: input.description,
        color: input.color,
        icon: input.icon,
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

    Ok(())
}

#[tauri::command]
pub async fn delete_collection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn add_item_to_collection(
    state: State<'_, AppState>,
    item_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO collection_items (collection_id, item_id, order_index)
        VALUES (?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM collection_items WHERE collection_id = ?))
        "#
    )
    .bind(collection_id)
    .bind(item_id)
    .bind(collection_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn remove_item_from_collection(
    state: State<'_, AppState>,
    item_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?")
        .bind(collection_id)
        .bind(item_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
