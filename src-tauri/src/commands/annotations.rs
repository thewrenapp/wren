use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: i64,
    pub key: String,
    #[serde(rename = "itemId")]
    pub item_id: i64,
    #[serde(rename = "annotationType")]
    pub annotation_type: String,
    #[serde(rename = "pageNumber")]
    pub page_number: i32,
    #[serde(rename = "positionJson")]
    pub position_json: String,
    #[serde(rename = "selectedText")]
    pub selected_text: Option<String>,
    pub comment: Option<String>,
    pub color: String,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    #[serde(rename = "dateModified")]
    pub date_modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAnnotationInput {
    #[serde(rename = "itemId")]
    pub item_id: i64,
    #[serde(rename = "annotationType")]
    pub annotation_type: String,
    #[serde(rename = "pageNumber")]
    pub page_number: i32,
    #[serde(rename = "positionJson")]
    pub position_json: String,
    #[serde(rename = "selectedText")]
    pub selected_text: Option<String>,
    pub comment: Option<String>,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAnnotationInput {
    #[serde(rename = "positionJson")]
    pub position_json: Option<String>,
    pub comment: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, FromRow)]
struct AnnotationRow {
    id: i64,
    key: String,
    item_id: i64,
    annotation_type: String,
    page_number: i32,
    position_json: String,
    selected_text: Option<String>,
    comment: Option<String>,
    color: String,
    date_added: String,
    date_modified: String,
}

impl From<AnnotationRow> for Annotation {
    fn from(row: AnnotationRow) -> Self {
        Self {
            id: row.id,
            key: row.key,
            item_id: row.item_id,
            annotation_type: row.annotation_type,
            page_number: row.page_number,
            position_json: row.position_json,
            selected_text: row.selected_text,
            comment: row.comment,
            color: row.color,
            date_added: row.date_added,
            date_modified: row.date_modified,
        }
    }
}

#[tauri::command]
pub async fn get_annotations(
    state: State<'_, AppState>,
    item_id: i64,
) -> Result<Vec<Annotation>, String> {
    let annotations: Vec<AnnotationRow> = sqlx::query_as::<_, AnnotationRow>(
        r#"
        SELECT a.id, a.key, a.item_id, at.name as annotation_type,
               a.page_number, a.position_json, a.selected_text,
               a.comment, a.color, a.date_added, a.date_modified
        FROM annotations a
        JOIN annotation_types at ON a.annotation_type_id = at.id
        WHERE a.item_id = ?
        ORDER BY a.page_number, a.sort_index
        "#,
    )
    .bind(item_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(annotations.into_iter().map(Annotation::from).collect())
}

#[tauri::command]
pub async fn create_annotation(
    state: State<'_, AppState>,
    input: CreateAnnotationInput,
) -> Result<Annotation, String> {
    let key = Uuid::new_v4().to_string();

    // Get annotation type ID
    let annotation_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM annotation_types WHERE name = ?"
    )
    .bind(&input.annotation_type)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .unwrap_or(1); // Default to 'highlight'

    let result = sqlx::query(
        r#"
        INSERT INTO annotations (
            key, item_id, annotation_type_id, page_number,
            position_json, selected_text, comment, color
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, date_added, date_modified
        "#,
    )
    .bind(&key)
    .bind(input.item_id)
    .bind(annotation_type_id)
    .bind(input.page_number)
    .bind(&input.position_json)
    .bind(&input.selected_text)
    .bind(&input.comment)
    .bind(&input.color)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Annotation {
        id: result.get("id"),
        key,
        item_id: input.item_id,
        annotation_type: input.annotation_type,
        page_number: input.page_number,
        position_json: input.position_json,
        selected_text: input.selected_text,
        comment: input.comment,
        color: input.color,
        date_added: result.get("date_added"),
        date_modified: result.get("date_modified"),
    })
}

#[tauri::command]
pub async fn update_annotation(
    state: State<'_, AppState>,
    id: i64,
    input: UpdateAnnotationInput,
) -> Result<(), String> {
    let mut query = String::from("UPDATE annotations SET date_modified = datetime('now')");
    let mut has_updates = false;

    if input.position_json.is_some() {
        query.push_str(", position_json = ?");
        has_updates = true;
    }
    if input.comment.is_some() {
        query.push_str(", comment = ?");
        has_updates = true;
    }
    if input.color.is_some() {
        query.push_str(", color = ?");
        has_updates = true;
    }

    if !has_updates {
        return Ok(());
    }

    query.push_str(" WHERE id = ?");

    let mut q = sqlx::query(&query);

    if let Some(ref pos) = input.position_json {
        q = q.bind(pos);
    }
    if let Some(ref comment) = input.comment {
        q = q.bind(comment);
    }
    if let Some(ref color) = input.color {
        q = q.bind(color);
    }
    q = q.bind(id);

    q.execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_annotation(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM annotations WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
