use crate::db::models::{Item, Tag, CreateItemInput, UpdateItemInput, PdfItemDetails};
use crate::state::AppState;
use sqlx::{Row, FromRow};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct ItemRow {
    id: i64,
    key: String,
    item_type: String,
    title: String,
    date_added: String,
    date_modified: String,
}

#[derive(Debug, FromRow)]
struct TagRow {
    id: i64,
    name: String,
    color: Option<String>,
}

#[tauri::command]
pub async fn get_items(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
    tag_id: Option<i64>,
) -> Result<Vec<Item>, String> {
    let items: Vec<ItemRow> = if let Some(coll_id) = collection_id {
        sqlx::query_as::<_, ItemRow>(
            r#"
            SELECT i.id, i.key, it.name as item_type, i.title, i.date_added, i.date_modified
            FROM items i
            JOIN item_types it ON i.item_type_id = it.id
            JOIN collection_items ci ON i.id = ci.item_id
            WHERE ci.collection_id = ? AND i.is_deleted = 0
            ORDER BY i.date_added DESC
            "#
        )
        .bind(coll_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    } else if let Some(t_id) = tag_id {
        sqlx::query_as::<_, ItemRow>(
            r#"
            SELECT i.id, i.key, it.name as item_type, i.title, i.date_added, i.date_modified
            FROM items i
            JOIN item_types it ON i.item_type_id = it.id
            JOIN item_tags itg ON i.id = itg.item_id
            WHERE itg.tag_id = ? AND i.is_deleted = 0
            ORDER BY i.date_added DESC
            "#
        )
        .bind(t_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, ItemRow>(
            r#"
            SELECT i.id, i.key, it.name as item_type, i.title, i.date_added, i.date_modified
            FROM items i
            JOIN item_types it ON i.item_type_id = it.id
            WHERE i.is_deleted = 0
            ORDER BY i.date_added DESC
            "#
        )
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    };

    let mut result = Vec::new();
    for item in items {
        let tags = get_item_tags(&state, item.id).await?;
        let collections = get_item_collections(&state, item.id).await?;

        result.push(Item {
            id: item.id,
            key: item.key,
            item_type: item.item_type,
            title: item.title,
            date_added: item.date_added,
            date_modified: item.date_modified,
            tags,
            collections,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_item(state: State<'_, AppState>, id: i64) -> Result<Item, String> {
    let item: ItemRow = sqlx::query_as::<_, ItemRow>(
        r#"
        SELECT i.id, i.key, it.name as item_type, i.title, i.date_added, i.date_modified
        FROM items i
        JOIN item_types it ON i.item_type_id = it.id
        WHERE i.id = ? AND i.is_deleted = 0
        "#
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Item not found".to_string())?;

    let tags = get_item_tags(&state, item.id).await?;
    let collections = get_item_collections(&state, item.id).await?;

    Ok(Item {
        id: item.id,
        key: item.key,
        item_type: item.item_type,
        title: item.title,
        date_added: item.date_added,
        date_modified: item.date_modified,
        tags,
        collections,
    })
}

#[tauri::command]
pub async fn create_item(
    state: State<'_, AppState>,
    input: CreateItemInput,
) -> Result<Item, String> {
    let key = Uuid::new_v4().to_string();
    let item_type_id: i64 = match input.item_type.as_str() {
        "pdf" => 1,
        "markdown" => 2,
        _ => return Err("Invalid item type".to_string()),
    };

    let result = sqlx::query(
        r#"
        INSERT INTO items (key, item_type_id, title)
        VALUES (?, ?, ?)
        RETURNING id, date_added, date_modified
        "#
    )
    .bind(&key)
    .bind(item_type_id)
    .bind(&input.title)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Item {
        id: result.get("id"),
        key,
        item_type: input.item_type,
        title: input.title,
        date_added: result.get("date_added"),
        date_modified: result.get("date_modified"),
        tags: vec![],
        collections: vec![],
    })
}

#[tauri::command]
pub async fn update_item(
    state: State<'_, AppState>,
    id: i64,
    input: UpdateItemInput,
) -> Result<(), String> {
    if let Some(title) = input.title {
        sqlx::query(
            r#"
            UPDATE items
            SET title = ?, date_modified = datetime('now')
            WHERE id = ?
            "#
        )
        .bind(title)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_item(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query(
        r#"
        UPDATE items
        SET is_deleted = 1, date_modified = datetime('now')
        WHERE id = ?
        "#
    )
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

async fn get_item_tags(state: &State<'_, AppState>, item_id: i64) -> Result<Vec<Tag>, String> {
    let tags: Vec<TagRow> = sqlx::query_as::<_, TagRow>(
        r#"
        SELECT t.id, t.name, t.color
        FROM tags t
        JOIN item_tags it ON t.id = it.tag_id
        WHERE it.item_id = ?
        "#
    )
    .bind(item_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(tags
        .into_iter()
        .map(|t| Tag {
            id: t.id,
            name: t.name,
            color: t.color,
            item_count: 0,
        })
        .collect())
}

async fn get_item_collections(
    state: &State<'_, AppState>,
    item_id: i64,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        r#"
        SELECT c.key
        FROM collections c
        JOIN collection_items ci ON c.id = ci.collection_id
        WHERE ci.item_id = ?
        "#
    )
    .bind(item_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| r.get("key")).collect())
}

#[derive(Debug, FromRow)]
struct PdfItemRow {
    file_path: String,
    file_size: i64,
    page_count: Option<i32>,
    author: Option<String>,
    abstract_text: Option<String>,
    doi: Option<String>,
    publication_date: Option<String>,
    publisher: Option<String>,
    journal: Option<String>,
}

#[tauri::command]
pub async fn get_pdf_details(
    state: State<'_, AppState>,
    item_id: i64,
) -> Result<PdfItemDetails, String> {
    let pdf: PdfItemRow = sqlx::query_as::<_, PdfItemRow>(
        r#"
        SELECT file_path, file_size, page_count, author, abstract_text,
               doi, publication_date, publisher, journal
        FROM pdf_items
        WHERE item_id = ?
        "#
    )
    .bind(item_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "PDF details not found".to_string())?;

    Ok(PdfItemDetails {
        file_path: pdf.file_path,
        page_count: pdf.page_count,
        author: pdf.author,
        abstract_text: pdf.abstract_text,
        doi: pdf.doi,
        publication_date: pdf.publication_date,
        publisher: pdf.publisher,
        journal: pdf.journal,
    })
}
