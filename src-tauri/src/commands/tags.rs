use crate::db::models::Tag;
use crate::state::AppState;
use sqlx::{Row, FromRow};
use tauri::State;

#[derive(Debug, FromRow)]
struct TagRow {
    id: i64,
    name: String,
    color: Option<String>,
    item_count: i64,
}

#[derive(Debug, FromRow)]
struct TagRow2 {
    id: i64,
    name: String,
    color: Option<String>,
}

#[tauri::command]
pub async fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let tags: Vec<TagRow> = sqlx::query_as::<_, TagRow>(
        r#"
        SELECT
            t.id,
            t.name,
            t.color,
            COALESCE((SELECT COUNT(*) FROM item_tags WHERE tag_id = t.id), 0) as item_count
        FROM tags t
        ORDER BY t.name
        "#
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(tags
        .into_iter()
        .map(|t| Tag {
            id: t.id,
            name: t.name,
            color: t.color,
            item_count: t.item_count,
        })
        .collect())
}

#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let result = sqlx::query(
        r#"
        INSERT INTO tags (name, color)
        VALUES (?, ?)
        RETURNING id
        "#
    )
    .bind(&name)
    .bind(&color)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Tag {
        id: result.get("id"),
        name,
        color,
        item_count: 0,
    })
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn add_tag_to_item(
    state: State<'_, AppState>,
    item_id: i64,
    tag_name: String,
) -> Result<Tag, String> {
    // Get or create tag
    let existing: Option<TagRow2> = sqlx::query_as::<_, TagRow2>(
        "SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE"
    )
    .bind(&tag_name)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let tag = if let Some(t) = existing {
        Tag {
            id: t.id,
            name: t.name,
            color: t.color,
            item_count: 0,
        }
    } else {
        // Create new tag
        let result = sqlx::query("INSERT INTO tags (name) VALUES (?) RETURNING id")
            .bind(&tag_name)
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

        Tag {
            id: result.get("id"),
            name: tag_name,
            color: None,
            item_count: 0,
        }
    };

    // Add to item
    sqlx::query("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)")
        .bind(item_id)
        .bind(tag.id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(tag)
}

#[tauri::command]
pub async fn remove_tag_from_item(
    state: State<'_, AppState>,
    item_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?")
        .bind(item_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
