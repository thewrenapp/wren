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
    is_imported: bool,
}

#[derive(Debug, FromRow)]
struct TagRow2 {
    id: i64,
    name: String,
    color: Option<String>,
    is_imported: bool,
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
            ), 0) as item_count,
            t.is_imported
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
            is_imported: t.is_imported,
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
        is_imported: false,
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

/// Merge multiple tags into a target tag
/// All entries with source tags will have the target tag added (if not already present)
/// Then source tags are deleted
/// Optionally rename the target tag
#[tauri::command]
pub async fn merge_tags(
    state: State<'_, AppState>,
    target_id: i64,
    source_ids: Vec<i64>,
    new_name: Option<String>,
    new_color: Option<String>,
) -> Result<u32, String> {
    let mut merged_count: u32 = 0;

    // Optionally rename the target tag first
    if let Some(name) = &new_name {
        sqlx::query("UPDATE tags SET name = ? WHERE id = ?")
            .bind(name)
            .bind(target_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Optionally update color
    if new_color.is_some() {
        sqlx::query("UPDATE tags SET color = ? WHERE id = ?")
            .bind(&new_color)
            .bind(target_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    for source_id in &source_ids {
        if *source_id == target_id {
            continue; // Skip if source is the same as target
        }

        // Get all entries that have the source tag
        let entry_ids: Vec<i64> = sqlx::query_scalar(
            "SELECT entry_id FROM entry_tags WHERE tag_id = ?"
        )
        .bind(source_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Add target tag to each entry (ignore if already exists)
        for entry_id in entry_ids {
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)"
            )
            .bind(entry_id)
            .bind(target_id)
            .execute(&state.db)
            .await;
        }

        // Delete the source tag (this will cascade delete entry_tags)
        sqlx::query("DELETE FROM tags WHERE id = ?")
            .bind(source_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;

        merged_count += 1;
    }

    Ok(merged_count)
}

/// Update color for multiple tags at once
#[tauri::command]
pub async fn bulk_update_tag_color(
    state: State<'_, AppState>,
    tag_ids: Vec<i64>,
    color: Option<String>,
) -> Result<u32, String> {
    let mut updated_count: u32 = 0;

    for tag_id in tag_ids {
        let result = sqlx::query("UPDATE tags SET color = ? WHERE id = ?")
            .bind(&color)
            .bind(tag_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;

        if result.rows_affected() > 0 {
            updated_count += 1;
        }
    }

    Ok(updated_count)
}

#[tauri::command]
pub async fn add_tag_to_item(
    state: State<'_, AppState>,
    entry_id: i64,
    tag_name: String,
) -> Result<Tag, String> {
    // Get or create tag
    let existing: Option<TagRow2> = sqlx::query_as::<_, TagRow2>(
        "SELECT id, name, color, is_imported FROM tags WHERE name = ? COLLATE NOCASE"
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
            is_imported: t.is_imported,
        }
    } else {
        // Create new tag (user-created, not imported)
        let result = sqlx::query("INSERT INTO tags (name, is_imported) VALUES (?, 0) RETURNING id")
            .bind(&tag_name)
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

        Tag {
            id: result.get("id"),
            name: tag_name,
            color: None,
            item_count: 0,
            is_imported: false,
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
        "SELECT id, name, color, is_imported FROM tags WHERE name = ? COLLATE NOCASE"
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
            is_imported: t.is_imported,
        }
    } else {
        // Create new tag (user-created, not imported)
        let result = sqlx::query("INSERT INTO tags (name, is_imported) VALUES (?, 0) RETURNING id")
            .bind(&tag_name)
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

        Tag {
            id: result.get("id"),
            name: tag_name,
            color: None,
            item_count: 0,
            is_imported: false,
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
            "SELECT id, name, color, is_imported FROM tags WHERE id = ?"
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
            is_imported: tag.is_imported,
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
        "SELECT id, name, color, is_imported FROM tags WHERE id = ?"
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
        is_imported: tag.is_imported,
    })
}
