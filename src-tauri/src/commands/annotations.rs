use crate::pdf::{
    add_highlight_annotation, read_highlight_annotations, remove_highlight_annotation,
    HighlightAnnotation, HighlightColor,
};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row};
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: i64,
    pub key: String,
    #[serde(rename = "attachmentId")]
    pub attachment_id: i64,
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
    #[serde(rename = "attachmentId")]
    pub attachment_id: i64,
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
    attachment_id: i64,
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
            attachment_id: row.attachment_id,
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
    attachment_id: i64,
) -> Result<Vec<Annotation>, String> {
    let annotations: Vec<AnnotationRow> = sqlx::query_as::<_, AnnotationRow>(
        r#"
        SELECT a.id, a.key, a.attachment_id, at.name as annotation_type,
               a.page_number, a.position_json, a.selected_text,
               a.comment, a.color, a.date_added, a.date_modified
        FROM attachment_annotations a
        JOIN annotation_types at ON a.annotation_type_id = at.id
        WHERE a.attachment_id = ?
        ORDER BY a.page_number, a.sort_index
        "#,
    )
    .bind(attachment_id)
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
        INSERT INTO attachment_annotations (
            key, attachment_id, annotation_type_id, page_number,
            position_json, selected_text, comment, color
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, date_added, date_modified
        "#,
    )
    .bind(&key)
    .bind(input.attachment_id)
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
        attachment_id: input.attachment_id,
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
    let mut query = String::from("UPDATE attachment_annotations SET date_modified = datetime('now')");
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
    sqlx::query("DELETE FROM attachment_annotations WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// PDF annotation sync types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfAnnotationData {
    #[serde(rename = "pageNumber")]
    pub page_number: i32,
    pub rect: [f32; 4],
    #[serde(rename = "quadPoints")]
    pub quad_points: Vec<f32>,
    pub color: String,
    pub contents: Option<String>,
}

/// Save a single annotation to the PDF file
/// Coordinates are expected to be normalized (0-1 range) relative to page dimensions
#[tauri::command]
pub async fn save_annotation_to_pdf(
    state: State<'_, AppState>,
    attachment_id: i64,
    annotation_key: String,
    annotation_data: PdfAnnotationData,
) -> Result<(), String> {
    // Get the PDF file path from attachments table
    let file_path: String = sqlx::query_scalar(
        "SELECT file_path FROM attachments WHERE id = ? AND file_path IS NOT NULL"
    )
    .bind(attachment_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to get file path: {}", e))?;

    let path = PathBuf::from(&file_path);

    // Load PDF to get page dimensions
    let doc = lopdf::Document::load(&path)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    // Get page dimensions for the target page
    let page_id = doc.page_iter()
        .nth((annotation_data.page_number - 1) as usize)
        .ok_or_else(|| format!("Page {} not found", annotation_data.page_number))?;

    let page = doc.get_dictionary(page_id)
        .map_err(|e| format!("Failed to get page: {}", e))?;

    // Get MediaBox or CropBox for page dimensions
    let media_box = page.get(b"MediaBox")
        .or_else(|_| page.get(b"CropBox"))
        .map_err(|_| "Failed to get page dimensions".to_string())?;

    let (page_width, page_height) = if let lopdf::Object::Array(arr) = media_box {
        if arr.len() >= 4 {
            let x1 = get_pdf_float(&arr[0]).unwrap_or(0.0);
            let y1 = get_pdf_float(&arr[1]).unwrap_or(0.0);
            let x2 = get_pdf_float(&arr[2]).unwrap_or(612.0);
            let y2 = get_pdf_float(&arr[3]).unwrap_or(792.0);
            (x2 - x1, y2 - y1)
        } else {
            (612.0, 792.0) // Default to letter size
        }
    } else {
        (612.0, 792.0)
    };

    // Convert normalized coordinates to PDF coordinates
    // Note: PDF Y-axis is bottom-up, screen Y-axis is top-down
    let rect = [
        annotation_data.rect[0] * page_width,
        page_height - annotation_data.rect[3] * page_height,
        annotation_data.rect[2] * page_width,
        page_height - annotation_data.rect[1] * page_height,
    ];

    // Convert normalized quad points to PDF coordinates
    // QuadPoints order: top-left, top-right, bottom-right, bottom-left (from frontend)
    // PDF expects: bottom-left, bottom-right, top-right, top-left
    let mut quad_points = Vec::new();
    for chunk in annotation_data.quad_points.chunks(8) {
        if chunk.len() == 8 {
            // Input: [tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y] (normalized, screen coords)
            let tl_x = chunk[0] * page_width;
            let tl_y = page_height - chunk[1] * page_height;
            let tr_x = chunk[2] * page_width;
            let tr_y = page_height - chunk[3] * page_height;
            let br_x = chunk[4] * page_width;
            let br_y = page_height - chunk[5] * page_height;
            let bl_x = chunk[6] * page_width;
            let bl_y = page_height - chunk[7] * page_height;

            // Output: bottom-left, bottom-right, top-right, top-left (PDF QuadPoints order)
            quad_points.extend_from_slice(&[
                bl_x, bl_y, br_x, br_y, tr_x, tr_y, tl_x, tl_y
            ]);
        }
    }

    // Convert color
    let color = HighlightColor::from_hex(&annotation_data.color)
        .map_err(|e| format!("Invalid color: {}", e))?;

    // Create highlight annotation
    let highlight = HighlightAnnotation {
        page_number: annotation_data.page_number as u32,
        rect,
        quad_points,
        color,
        contents: annotation_data.contents,
        id: annotation_key,
    };

    // Add to PDF
    add_highlight_annotation(&path, &highlight)
        .map_err(|e| format!("Failed to save annotation to PDF: {}", e))?;

    Ok(())
}

fn get_pdf_float(obj: &lopdf::Object) -> Option<f32> {
    match obj {
        lopdf::Object::Real(f) => Some(*f),
        lopdf::Object::Integer(i) => Some(*i as f32),
        _ => None,
    }
}

/// Remove an annotation from the PDF file
#[tauri::command]
pub async fn remove_annotation_from_pdf(
    state: State<'_, AppState>,
    attachment_id: i64,
    annotation_key: String,
) -> Result<bool, String> {
    // Get the PDF file path from attachments table
    let file_path: String = sqlx::query_scalar(
        "SELECT file_path FROM attachments WHERE id = ? AND file_path IS NOT NULL"
    )
    .bind(attachment_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to get file path: {}", e))?;

    let path = PathBuf::from(&file_path);

    // Remove from PDF
    let removed = remove_highlight_annotation(&path, &annotation_key)
        .map_err(|e| format!("Failed to remove annotation from PDF: {}", e))?;

    Ok(removed)
}

/// Import annotations from a PDF file into the database
#[tauri::command]
pub async fn import_annotations_from_pdf(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> Result<Vec<Annotation>, String> {
    // Get the PDF file path from attachments table
    let file_path: String = sqlx::query_scalar(
        "SELECT file_path FROM attachments WHERE id = ? AND file_path IS NOT NULL"
    )
    .bind(attachment_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to get file path: {}", e))?;

    let path = PathBuf::from(&file_path);

    // Read annotations from PDF
    let pdf_annotations = read_highlight_annotations(&path)
        .map_err(|e| format!("Failed to read annotations from PDF: {}", e))?;

    // Get highlight annotation type ID
    let annotation_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM annotation_types WHERE name = 'highlight'")
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let mut imported = Vec::new();

    for pdf_ann in pdf_annotations {
        // Check if annotation already exists by key
        let exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM attachment_annotations WHERE key = ? AND attachment_id = ?",
        )
        .bind(&pdf_ann.id)
        .bind(attachment_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        if exists {
            continue;
        }

        // Convert color to hex
        let color = format!(
            "#{:02X}{:02X}{:02X}",
            (pdf_ann.color.r * 255.0) as u8,
            (pdf_ann.color.g * 255.0) as u8,
            (pdf_ann.color.b * 255.0) as u8
        );

        // Create position JSON
        let position_json = serde_json::json!({
            "boundingRect": {
                "x1": pdf_ann.rect[0],
                "y1": pdf_ann.rect[1],
                "x2": pdf_ann.rect[2],
                "y2": pdf_ann.rect[3],
                "pageNumber": pdf_ann.page_number,
            },
            "rects": [{
                "x1": pdf_ann.rect[0],
                "y1": pdf_ann.rect[1],
                "x2": pdf_ann.rect[2],
                "y2": pdf_ann.rect[3],
                "pageNumber": pdf_ann.page_number,
            }],
            "quadPoints": pdf_ann.quad_points,
        })
        .to_string();

        // Insert into database
        let result = sqlx::query(
            r#"
            INSERT INTO attachment_annotations (
                key, attachment_id, annotation_type_id, page_number,
                position_json, selected_text, comment, color
            )
            VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
            RETURNING id, date_added, date_modified
            "#,
        )
        .bind(&pdf_ann.id)
        .bind(attachment_id)
        .bind(annotation_type_id)
        .bind(pdf_ann.page_number as i32)
        .bind(&position_json)
        .bind(&pdf_ann.contents)
        .bind(&color)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        imported.push(Annotation {
            id: result.get("id"),
            key: pdf_ann.id,
            attachment_id,
            annotation_type: "highlight".to_string(),
            page_number: pdf_ann.page_number as i32,
            position_json,
            selected_text: None,
            comment: pdf_ann.contents,
            color,
            date_added: result.get("date_added"),
            date_modified: result.get("date_modified"),
        });
    }

    Ok(imported)
}
