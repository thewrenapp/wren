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
            COALESCE((
                SELECT COUNT(*)
                FROM entry_tags et
                INNER JOIN entries e ON e.id = et.entry_id
                WHERE et.tag_id = t.id AND e.is_deleted = 0
            ), 0) as item_count
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
    entry_id: i64,
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

    // Add to entry
    sqlx::query("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
        .bind(entry_id)
        .bind(tag.id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(tag)
}

#[tauri::command]
pub async fn remove_tag_from_item(
    state: State<'_, AppState>,
    entry_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?")
        .bind(entry_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Add a tag to multiple entries at once
#[tauri::command]
pub async fn add_tag_to_entries(
    state: State<'_, AppState>,
    tag_name: String,
    entry_ids: Vec<i64>,
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

    // Add tag to all entries
    for entry_id in entry_ids {
        sqlx::query("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
            .bind(entry_id)
            .bind(tag.id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(tag)
}

/// Update tag name and/or color
#[tauri::command]
pub async fn update_tag(
    state: State<'_, AppState>,
    id: i64,
    name: Option<String>,
    color: Option<String>,
) -> Result<Tag, String> {
    // Build dynamic update query
    let mut updates = Vec::new();
    if name.is_some() {
        updates.push("name = ?");
    }
    if color.is_some() {
        updates.push("color = ?");
    }

    if updates.is_empty() {
        // Nothing to update, just return the current tag
        let tag: TagRow2 = sqlx::query_as::<_, TagRow2>(
            "SELECT id, name, color FROM tags WHERE id = ?"
        )
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        return Ok(Tag {
            id: tag.id,
            name: tag.name,
            color: tag.color,
            item_count: 0,
        });
    }

    let query = format!("UPDATE tags SET {} WHERE id = ?", updates.join(", "));

    let mut q = sqlx::query(&query);
    if let Some(ref n) = name {
        q = q.bind(n);
    }
    if let Some(ref c) = color {
        q = q.bind(c);
    }
    q = q.bind(id);

    q.execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Fetch updated tag
    let tag: TagRow2 = sqlx::query_as::<_, TagRow2>(
        "SELECT id, name, color FROM tags WHERE id = ?"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Tag {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        item_count: 0,
    })
}
