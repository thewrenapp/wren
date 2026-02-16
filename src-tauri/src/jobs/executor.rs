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
        "llm_parse" => {
            let payload: LlmParsePayload =
                serde_json::from_str(payload_json).map_err(|e| format!("Invalid payload: {}", e))?;
            execute_llm_parse(db, app_handle, library_path, job_id, &payload, cancel_flag)
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

            // Auto-parse hook: if LLM auto-parse is enabled and we have extracted text,
            // enqueue an LlmParse job
            if worth_saving {
                let auto_parse = crate::commands::settings::is_setting_enabled(db, "llm_auto_parse").await;
                let has_api_key = crate::commands::settings::get_setting_value(db, "llm_api_key")
                    .await
                    .map(|k| !k.is_empty())
                    .unwrap_or(false);

                if auto_parse && has_api_key {
                    let parse_payload = serde_json::json!({
                        "attachmentId": payload.attachment_id,
                        "entryId": info.entry_id,
                    });
                    let parse_job_id = uuid::Uuid::new_v4().to_string();
                    let _ = sqlx::query(
                        r#"INSERT INTO jobs (id, job_type, status, title, payload_json, priority)
                           VALUES (?, 'llm_parse', 'pending', ?, ?, 0)"#,
                    )
                    .bind(&parse_job_id)
                    .bind(format!("Parse Document #{}", payload.attachment_id))
                    .bind(parse_payload.to_string())
                    .execute(db)
                    .await;

                    tracing::info!(
                        "Auto-enqueued LLM parse job {} for attachment {}",
                        parse_job_id,
                        payload.attachment_id
                    );
                }
            }

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

/// Execute LLM-powered document parsing for a single attachment.
async fn execute_llm_parse(
    db: &SqlitePool,
    app_handle: &AppHandle,
    library_path: &Arc<tokio::sync::RwLock<PathBuf>>,
    job_id: &str,
    payload: &LlmParsePayload,
    cancel_flag: CancelFlag,
) -> Result<Option<String>, String> {
    use crate::commands::settings::get_setting_value;
    use crate::llm::context_windows;
    use crate::llm::openai::OpenAiProvider;
    use crate::llm::pipeline;
    use crate::llm::pipeline::classifier::EntryMetadata;

    // ── Read LLM settings from DB ──────────────────────────────────
    let provider_name = get_setting_value(db, "llm_provider")
        .await
        .unwrap_or_else(|| "openai".to_string());
    let api_key = get_setting_value(db, "llm_api_key")
        .await
        .unwrap_or_default();
    let model = get_setting_value(db, "llm_model")
        .await
        .unwrap_or_else(|| "gpt-4o-mini".to_string());
    let base_url = get_setting_value(db, "llm_base_url")
        .await
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let token_budget: u32 = get_setting_value(db, "llm_token_budget")
        .await
        .and_then(|v| v.parse().ok())
        .unwrap_or(200_000);
    let concurrent: usize = get_setting_value(db, "llm_concurrent_extractions")
        .await
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);

    if api_key.is_empty() {
        return Err("LLM API key not configured. Go to Settings → AI & Search to set it up.".to_string());
    }

    // ── Create provider ────────────────────────────────────────────
    let provider = OpenAiProvider::new(api_key, base_url);

    // ── Read extracted text from markdown file ─────────────────────
    let markdown_path: Option<String> = sqlx::query_scalar(
        "SELECT markdown_path FROM attachments WHERE id = ?",
    )
    .bind(payload.attachment_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?
    .flatten();

    let markdown_path = markdown_path
        .ok_or_else(|| "No extracted text found. Run text extraction first.".to_string())?;

    let lib_path = library_path.read().await.clone();
    let full_md_path = lib_path.join(&markdown_path);

    let extracted_text = tokio::fs::read_to_string(&full_md_path)
        .await
        .map_err(|e| format!("Failed to read extracted text: {e}"))?;

    if extracted_text.trim().is_empty() {
        return Err("Extracted text is empty. Nothing to parse.".to_string());
    }

    // ── Gather entry metadata ──────────────────────────────────────
    #[derive(FromRow)]
    struct EntryInfo {
        title: Option<String>,
        item_type_name: Option<String>,
    }

    let entry_info: Option<EntryInfo> = sqlx::query_as(
        r#"
        SELECT e.title, it.name as item_type_name
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ?
        "#,
    )
    .bind(payload.entry_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;

    let abstract_text: Option<String> = sqlx::query_scalar(
        r#"
        SELECT ef.value FROM entry_fields ef
        JOIN fields f ON ef.field_id = f.id
        WHERE ef.entry_id = ? AND f.name = 'abstractNote'
        LIMIT 1
        "#,
    )
    .bind(payload.entry_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten();

    let authors: Option<String> = sqlx::query_scalar(
        r#"
        SELECT GROUP_CONCAT(
            CASE WHEN last_name IS NOT NULL AND last_name != ''
                 THEN last_name || COALESCE(', ' || first_name, '')
                 ELSE COALESCE(name, '')
            END, '; '
        ) FROM entry_creators WHERE entry_id = ? ORDER BY sort_order
        "#,
    )
    .bind(payload.entry_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten();

    let entry_metadata = EntryMetadata {
        title: entry_info.as_ref().and_then(|i| i.title.clone()),
        authors,
        abstract_text,
        item_type: entry_info.as_ref().and_then(|i| i.item_type_name.clone()),
    };

    // ── Build pipeline config ──────────────────────────────────────
    let model_ctx = context_windows::default_context(&provider_name, &model);

    let config = pipeline::PipelineConfig {
        provider_name: provider_name.clone(),
        model: model.clone(),
        context_window: model_ctx.context_window,
        max_token_budget: token_budget,
        max_concurrent_extractions: concurrent,
        retry_max: 3,
    };

    // ── Check for existing checkpoint ──────────────────────────────
    let checkpoint: Option<pipeline::PipelineCheckpoint> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT checkpoint_json FROM parsed_content WHERE attachment_id = ? AND status = 'in_progress'",
    )
    .bind(payload.attachment_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten()
    .and_then(|json| serde_json::from_str(&json).ok());

    // ── Create or update parsed_content row ────────────────────────
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        r#"
        INSERT INTO parsed_content (attachment_id, entry_id, model_used, provider, status, date_started)
        VALUES (?, ?, ?, ?, 'in_progress', ?)
        ON CONFLICT(attachment_id) DO UPDATE SET
            model_used = excluded.model_used,
            provider = excluded.provider,
            status = 'in_progress',
            date_started = excluded.date_started,
            date_completed = NULL
        "#,
    )
    .bind(payload.attachment_id)
    .bind(payload.entry_id)
    .bind(&model)
    .bind(&provider_name)
    .bind(&now)
    .execute(db)
    .await
    .map_err(|e| format!("Failed to create parsed_content row: {e}"))?;

    // ── Progress adapter ───────────────────────────────────────────
    struct JobProgressAdapter {
        app_handle: AppHandle,
        db: SqlitePool,
        job_id: String,
    }

    impl pipeline::ProgressCallback for JobProgressAdapter {
        fn update(&self, current: u32, total: u32, message: &str) {
            let app = self.app_handle.clone();
            let db = self.db.clone();
            let jid = self.job_id.clone();
            let msg = message.to_string();
            tokio::spawn(async move {
                update_progress(&app, &db, &jid, current as i64, total as i64, Some(msg)).await;
            });
        }
    }

    // ── Checkpoint saver ───────────────────────────────────────────
    struct DbCheckpointSaver {
        db: SqlitePool,
        attachment_id: i64,
    }

    #[async_trait::async_trait]
    impl pipeline::CheckpointSaver for DbCheckpointSaver {
        async fn save(&self, checkpoint: &pipeline::PipelineCheckpoint) -> Result<(), String> {
            let json = serde_json::to_string(checkpoint).map_err(|e| e.to_string())?;
            sqlx::query(
                "UPDATE parsed_content SET checkpoint_json = ? WHERE attachment_id = ?",
            )
            .bind(&json)
            .bind(self.attachment_id)
            .execute(&self.db)
            .await
            .map_err(|e| format!("Failed to save checkpoint: {e}"))?;
            Ok(())
        }
    }

    let progress_adapter = JobProgressAdapter {
        app_handle: app_handle.clone(),
        db: db.clone(),
        job_id: job_id.to_string(),
    };

    let checkpoint_saver = DbCheckpointSaver {
        db: db.clone(),
        attachment_id: payload.attachment_id,
    };

    // ── Run pipeline ───────────────────────────────────────────────
    let result = pipeline::run_pipeline(
        &provider,
        &config,
        &extracted_text,
        &entry_metadata,
        checkpoint,
        &progress_adapter,
        &cancel_flag,
        &checkpoint_saver,
    )
    .await;

    match result {
        Ok(parsed) => {
            let sections_json = serde_json::to_string(&parsed.sections).unwrap_or_default();
            let stages_json = serde_json::to_string(&parsed.pipeline_stages).unwrap_or_default();
            let completed_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

            sqlx::query(
                r#"
                UPDATE parsed_content SET
                    document_type = ?,
                    language = ?,
                    sections_json = ?,
                    structured_markdown = ?,
                    total_tokens_used = ?,
                    discovery_chunks = ?,
                    sections_count = ?,
                    pipeline_stages_json = ?,
                    checkpoint_json = NULL,
                    status = ?,
                    date_completed = ?
                WHERE attachment_id = ?
                "#,
            )
            .bind(&parsed.document_type)
            .bind(&parsed.language)
            .bind(&sections_json)
            .bind(&parsed.structured_markdown)
            .bind(parsed.token_usage.total_tokens as i64)
            .bind(parsed.discovery_chunks as i64)
            .bind(parsed.sections_extracted as i64)
            .bind(&stages_json)
            .bind(&parsed.status)
            .bind(&completed_at)
            .bind(payload.attachment_id)
            .execute(db)
            .await
            .map_err(|e| format!("Failed to save parsed content: {e}"))?;

            // Save structured markdown alongside the original .pdf.md
            let structured_md_path = full_md_path.with_extension("structured.md");
            let _ = tokio::fs::write(&structured_md_path, &parsed.structured_markdown).await;

            update_progress(app_handle, db, job_id, 1, 1, Some("Done".to_string())).await;

            Ok(Some(
                serde_json::json!({
                    "status": parsed.status,
                    "document_type": parsed.document_type,
                    "sections": parsed.sections_extracted,
                    "tokens_used": parsed.token_usage.total_tokens,
                })
                .to_string(),
            ))
        }
        Err(pipeline::PipelineError::Cancelled) => {
            // Keep parsed_content as 'in_progress' with checkpoint intact for resume
            // (checkpoint was saved incrementally during the pipeline)
            Err("Pipeline paused".to_string())
        }
        Err(pipeline::PipelineError::TooShort) => {
            sqlx::query(
                "UPDATE parsed_content SET status = 'failed', checkpoint_json = NULL WHERE attachment_id = ?",
            )
            .bind(payload.attachment_id)
            .execute(db)
            .await
            .ok();
            Err("Document too short to parse (< 500 characters)".to_string())
        }
        Err(pipeline::PipelineError::BudgetExceeded(cp)) => {
            // Save checkpoint for resume
            let cp_json = serde_json::to_string(&cp).unwrap_or_default();
            sqlx::query(
                "UPDATE parsed_content SET status = 'partial', checkpoint_json = ? WHERE attachment_id = ?",
            )
            .bind(&cp_json)
            .bind(payload.attachment_id)
            .execute(db)
            .await
            .ok();
            Err("Token budget exceeded. Partial results saved — you can resume later.".to_string())
        }
        Err(e) => {
            sqlx::query(
                "UPDATE parsed_content SET status = 'failed', checkpoint_json = NULL WHERE attachment_id = ?",
            )
            .bind(payload.attachment_id)
            .execute(db)
            .await
            .ok();
            Err(format!("LLM parsing failed: {e}"))
        }
    }
}
