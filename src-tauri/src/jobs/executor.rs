use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use sqlx::{FromRow, SqlitePool};
use tauri::AppHandle;

use super::queue::CancelFlag;
use super::types::*;
use crate::search::extractor::{is_worth_saving, markdown_path_for, save_markdown, ExtractionConfig};
use crate::search::SearchIndex;

/// Dispatch a job to the appropriate handler
pub async fn run_job(
    db: &SqlitePool,
    app_handle: &AppHandle,
    search_index: &Arc<SearchIndex>,
    library_path: &Arc<tokio::sync::RwLock<PathBuf>>,
    job_id: &str,
    job_type_str: &str,
    payload_json: &str,
    cancel_flag: CancelFlag,
) -> Result<Option<String>, String> {
    match job_type_str {
        "reindex_library" => {
            let payload: ReindexPayload =
                serde_json::from_str(payload_json).map_err(|e| format!("Invalid payload: {}", e))?;
            execute_reindex(db, app_handle, search_index, library_path, job_id, &payload, cancel_flag)
                .await
        }
        "bulk_import_pdfs" => {
            let payload: BulkImportPdfsPayload =
                serde_json::from_str(payload_json).map_err(|e| format!("Invalid payload: {}", e))?;
            execute_bulk_import_pdfs(db, app_handle, search_index, library_path, job_id, &payload, cancel_flag)
                .await
        }
        "bulk_import_folder" => {
            let payload: BulkImportFolderPayload =
                serde_json::from_str(payload_json).map_err(|e| format!("Invalid payload: {}", e))?;
            execute_bulk_import_folder(db, app_handle, search_index, library_path, job_id, &payload, cancel_flag)
                .await
        }
        "ocr_extract" => {
            let payload: OcrExtractPayload =
                serde_json::from_str(payload_json).map_err(|e| format!("Invalid payload: {}", e))?;
            execute_ocr_extract(db, app_handle, search_index, library_path, job_id, &payload, cancel_flag)
                .await
        }
        _ => Err(format!("Unknown job type: {}", job_type_str)),
    }
}

// Helper to get queue reference and update progress
async fn update_progress(
    app_handle: &AppHandle,
    db: &SqlitePool,
    job_id: &str,
    current: i64,
    total: i64,
    message: Option<String>,
) {
    let _ = sqlx::query(
        "UPDATE jobs SET progress_current = ?, progress_total = ?, progress_message = ? WHERE id = ?",
    )
    .bind(current)
    .bind(total)
    .bind(&message)
    .bind(job_id)
    .execute(db)
    .await;

    // Emit event
    use tauri::Emitter;
    if let Ok(job) = sqlx::query_as::<_, super::types::Job>(
        "SELECT id, job_type, status, title, payload_json, result_json, error_message, progress_current, progress_total, progress_message, priority, max_retries, retry_count, created_at, started_at, completed_at FROM jobs WHERE id = ?",
    )
    .bind(job_id)
    .fetch_one(db)
    .await
    {
        let _ = app_handle.emit("job:updated", &job);
    }
}

// Row types for queries
#[derive(Debug, FromRow)]
struct EntrySearchRow {
    id: i64,
    key: String,
    item_type: String,
    title: Option<String>,
}

#[derive(Debug, FromRow)]
struct CreatorNamesRow {
    full_name: Option<String>,
}

#[derive(Debug, FromRow)]
struct AbstractRow {
    value: Option<String>,
}

#[derive(Debug, FromRow)]
struct AttachmentRow {
    id: i64,
    file_path: Option<String>,
    attachment_type: String,
}

#[derive(Debug, FromRow)]
struct AnnotationRow {
    selected_text: Option<String>,
    comment: Option<String>,
}

/// Execute a full library reindex
async fn execute_reindex(
    db: &SqlitePool,
    app_handle: &AppHandle,
    search_index: &Arc<SearchIndex>,
    library_path: &Arc<tokio::sync::RwLock<PathBuf>>,
    job_id: &str,
    payload: &ReindexPayload,
    cancel_flag: CancelFlag,
) -> Result<Option<String>, String> {
    let config = ExtractionConfig {
        enable_ocr: payload.enable_ocr,
        force_ocr: payload.force_ocr,
    };

    // Get all entries
    let entries: Vec<EntrySearchRow> = sqlx::query_as(
        r#"
        SELECT e.id, e.key, it.name as item_type, e.title
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 0
        "#,
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;

    let total = entries.len() as i64;
    update_progress(app_handle, db, job_id, 0, total, Some("Starting reindex...".to_string())).await;

    let lib_path = library_path.read().await.clone();

    for (i, entry) in entries.iter().enumerate() {
        // Check cancellation
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Job cancelled".to_string());
        }

        let entry_title = entry.title.as_deref().unwrap_or("Untitled");
        update_progress(
            app_handle,
            db,
            job_id,
            i as i64,
            total,
            Some(format!("Reindexing: {}", entry_title)),
        )
        .await;

        // Delete existing documents for this entry
        let _ = search_index.delete_entry(entry.id).await;

        // Get creators
        let creators: Vec<CreatorNamesRow> = sqlx::query_as(
            r#"
            SELECT COALESCE(
                NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
                name
            ) as full_name
            FROM entry_creators WHERE entry_id = ? ORDER BY sort_order
            "#,
        )
        .bind(entry.id)
        .fetch_all(db)
        .await
        .unwrap_or_default();

        let creators_str = creators
            .into_iter()
            .filter_map(|c| c.full_name)
            .collect::<Vec<_>>()
            .join("; ");

        // Get abstract
        let abstract_row: Option<AbstractRow> = sqlx::query_as(
            r#"
            SELECT ef.value FROM entry_fields ef
            JOIN fields f ON ef.field_id = f.id
            WHERE ef.entry_id = ? AND f.name = 'abstractNote'
            "#,
        )
        .bind(entry.id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten();

        let abstract_text = abstract_row.and_then(|r| r.value);

        // Index metadata
        let metadata = crate::search::indexer::EntryMetadata {
            entry_id: entry.id,
            entry_key: entry.key.clone(),
            title: entry.title.clone(),
            creators: if creators_str.is_empty() {
                None
            } else {
                Some(creators_str)
            },
            abstract_text,
            item_type: entry.item_type.clone(),
        };

        let _ = search_index.index_entry_metadata(&metadata).await;

        // Get attachments
        let attachments: Vec<AttachmentRow> = sqlx::query_as(
            r#"
            SELECT a.id, a.file_path, at.name as attachment_type
            FROM attachments a
            JOIN attachment_types at ON a.attachment_type_id = at.id
            WHERE a.entry_id = ? AND a.file_path IS NOT NULL
            "#,
        )
        .bind(entry.id)
        .fetch_all(db)
        .await
        .unwrap_or_default();

        for attachment in &attachments {
            if let Some(ref file_path) = attachment.file_path {
                let full_path = lib_path.join(file_path);

                if full_path.exists() {
                    let attachment_data = crate::search::indexer::AttachmentData {
                        entry_id: entry.id,
                        entry_key: entry.key.clone(),
                        attachment_id: attachment.id,
                        title: entry.title.clone(),
                        file_path: full_path.to_string_lossy().to_string(),
                        content_source: attachment.attachment_type.clone(),
                    };

                    match search_index
                        .index_attachment_content(&attachment_data, &config)
                        .await
                    {
                        Ok(result) => {
                            let worth_saving = result
                                .extracted_text
                                .as_ref()
                                .map_or(false, |t| is_worth_saving(t));
                            if worth_saving {
                                if let Some(ref text) = result.extracted_text {
                                    if let Ok(md_path) = save_markdown(&full_path, text) {
                                        let relative_md = md_path
                                            .strip_prefix(&lib_path)
                                            .ok()
                                            .map(|p| p.to_string_lossy().to_string());
                                        if let Some(rel) = relative_md {
                                            let _ = sqlx::query(
                                                "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                                            )
                                            .bind(&rel)
                                            .bind(attachment.id)
                                            .execute(db)
                                            .await;
                                        }
                                    }
                                }
                            } else {
                                let stale_md = markdown_path_for(&full_path);
                                let _ = std::fs::remove_file(&stale_md);
                                let _ = sqlx::query(
                                    "UPDATE attachments SET markdown_path = NULL WHERE id = ?",
                                )
                                .bind(attachment.id)
                                .execute(db)
                                .await;
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                "Failed to index attachment {} for entry {}: {}",
                                attachment.id,
                                entry.id,
                                e
                            );
                        }
                    }
                }
            }

            // Index annotations for this attachment
            let annotations: Vec<AnnotationRow> = sqlx::query_as(
                r#"
                SELECT selected_text, comment
                FROM attachment_annotations
                WHERE attachment_id = ?
                "#,
            )
            .bind(attachment.id)
            .fetch_all(db)
            .await
            .unwrap_or_default();

            if !annotations.is_empty() {
                let selected_texts: Vec<String> = annotations
                    .iter()
                    .filter_map(|a| a.selected_text.clone())
                    .filter(|t| !t.trim().is_empty())
                    .collect();
                let comments: Vec<String> = annotations
                    .iter()
                    .filter_map(|a| a.comment.clone())
                    .filter(|c| !c.trim().is_empty())
                    .collect();

                if !selected_texts.is_empty() || !comments.is_empty() {
                    let annotation_data = crate::search::indexer::AnnotationData {
                        entry_id: entry.id,
                        entry_key: entry.key.clone(),
                        attachment_id: attachment.id,
                        title: entry.title.clone(),
                        selected_text: if selected_texts.is_empty() {
                            None
                        } else {
                            Some(selected_texts.join("\n"))
                        },
                        comment: if comments.is_empty() {
                            None
                        } else {
                            Some(comments.join("\n"))
                        },
                    };

                    let _ = search_index.index_annotations(&annotation_data).await;
                }
            }
        }

        // Commit every 100 entries
        if (i + 1) % 100 == 0 {
            if let Err(e) = search_index.commit().await {
                tracing::error!("Failed to commit search index at batch {}: {}", i + 1, e);
            }
        }
    }

    // Final commit
    search_index.commit().await.map_err(|e| e.to_string())?;

    Ok(Some(
        serde_json::json!({"totalIndexed": total}).to_string(),
    ))
}

/// Execute bulk PDF import (placeholder — will be wired to import system later)
async fn execute_bulk_import_pdfs(
    _db: &SqlitePool,
    _app_handle: &AppHandle,
    _search_index: &Arc<SearchIndex>,
    _library_path: &Arc<tokio::sync::RwLock<PathBuf>>,
    _job_id: &str,
    _payload: &BulkImportPdfsPayload,
    _cancel_flag: CancelFlag,
) -> Result<Option<String>, String> {
    // TODO: Extract import_single_pdf logic into a core function callable from here
    Err("Bulk import via job queue is not yet implemented. Use the import dialog instead.".to_string())
}

/// Execute folder import (placeholder — will be wired to import system later)
async fn execute_bulk_import_folder(
    _db: &SqlitePool,
    _app_handle: &AppHandle,
    _search_index: &Arc<SearchIndex>,
    _library_path: &Arc<tokio::sync::RwLock<PathBuf>>,
    _job_id: &str,
    _payload: &BulkImportFolderPayload,
    _cancel_flag: CancelFlag,
) -> Result<Option<String>, String> {
    // TODO: Extract import_folder logic into a core function callable from here
    Err("Folder import via job queue is not yet implemented. Use the import dialog instead.".to_string())
}

/// Extract text from a single attachment, index it, and save markdown.
/// This is the core OCR/extraction job enqueued by import commands.
async fn execute_ocr_extract(
    db: &SqlitePool,
    app_handle: &AppHandle,
    search_index: &Arc<SearchIndex>,
    library_path: &Arc<tokio::sync::RwLock<PathBuf>>,
    job_id: &str,
    payload: &OcrExtractPayload,
    cancel_flag: CancelFlag,
) -> Result<Option<String>, String> {
    // Look up attachment + entry info from DB
    #[derive(Debug, FromRow)]
    struct OcrAttachmentInfo {
        id: i64,
        entry_id: i64,
        entry_key: String,
        file_path: Option<String>,
        attachment_type: String,
        entry_title: Option<String>,
    }

    let info: OcrAttachmentInfo = sqlx::query_as(
        r#"
        SELECT a.id, a.entry_id, e.key as entry_key, a.file_path,
               at.name as attachment_type, e.title as entry_title
        FROM attachments a
        JOIN entries e ON a.entry_id = e.id
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.id = ?
        "#,
    )
    .bind(payload.attachment_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Attachment {} not found", payload.attachment_id))?;

    let rel_path = info
        .file_path
        .ok_or_else(|| format!("Attachment {} has no file path", payload.attachment_id))?;

    let lib_path = library_path.read().await.clone();
    let full_path = lib_path.join(&rel_path);

    if !full_path.exists() {
        return Err(format!("File not found: {}", full_path.display()));
    }

    if cancel_flag.load(Ordering::Relaxed) {
        return Err("Job cancelled".to_string());
    }

    update_progress(
        app_handle,
        db,
        job_id,
        0,
        1,
        Some("Extracting text...".to_string()),
    )
    .await;

    // Read OCR settings from DB
    let enable_ocr = sqlx::query_scalar::<_, Option<String>>(
        "SELECT value FROM settings WHERE key = 'enable_ocr'",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten()
    .map(|v| v == "true")
    .unwrap_or(true);

    let force_ocr = sqlx::query_scalar::<_, Option<String>>(
        "SELECT value FROM settings WHERE key = 'force_ocr'",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten()
    .map(|v| v == "true")
    .unwrap_or(false);

    let config = ExtractionConfig {
        enable_ocr,
        force_ocr,
    };

    let attachment_data = crate::search::indexer::AttachmentData {
        entry_id: info.entry_id,
        entry_key: info.entry_key,
        attachment_id: info.id,
        title: info.entry_title,
        file_path: full_path.to_string_lossy().to_string(),
        content_source: info.attachment_type,
    };

    // Extract text, index, and save markdown
    match search_index
        .index_attachment_content(&attachment_data, &config)
        .await
    {
        Ok(result) => {
            let worth_saving = result
                .extracted_text
                .as_ref()
                .map_or(false, |t| is_worth_saving(t));
            if worth_saving {
                if let Some(ref text) = result.extracted_text {
                    if let Ok(md_path) = save_markdown(&full_path, text) {
                        let relative_md = md_path
                            .strip_prefix(&lib_path)
                            .ok()
                            .map(|p| p.to_string_lossy().to_string());
                        if let Some(rel) = relative_md {
                            let _ = sqlx::query(
                                "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                            )
                            .bind(&rel)
                            .bind(payload.attachment_id)
                            .execute(db)
                            .await;
                        }
                    }
                }
            } else {
                // Clear stale markdown
                let stale_md = markdown_path_for(&full_path);
                let _ = std::fs::remove_file(&stale_md);
                let _ = sqlx::query(
                    "UPDATE attachments SET markdown_path = NULL WHERE id = ?",
                )
                .bind(payload.attachment_id)
                .execute(db)
                .await;
            }

            search_index.commit().await.map_err(|e| e.to_string())?;

            update_progress(app_handle, db, job_id, 1, 1, Some("Done".to_string())).await;

            Ok(Some(
                serde_json::json!({
                    "indexed": result.indexed,
                    "method": result.method.as_str(),
                })
                .to_string(),
            ))
        }
        Err(e) => Err(format!("Extraction failed: {}", e)),
    }
}
