use serde::Serialize;
use sqlx::FromRow;
use tauri::State;

use crate::search::extractor::{is_worth_saving, markdown_path_for, save_markdown, ExtractionConfig};
use crate::search::searcher::FullSearchResult;
use crate::state::AppState;

// =====================================================
// PROGRESS EVENT TYPES
// =====================================================

/// Detailed progress event for reindexing
#[derive(Debug, Clone, Serialize)]
pub struct ReindexProgress {
    /// Current entry index (0-based)
    pub current: usize,
    /// Total number of entries
    pub total: usize,
    /// Entry title being processed
    pub entry_title: Option<String>,
    /// Current file being processed (if any)
    pub file_name: Option<String>,
    /// Current step: "metadata", "extracting", "indexing", "annotations"
    pub step: String,
    /// Method being used: "kreuzberg", "direct"
    pub method: Option<String>,
    /// Status: "processing", "success", "skipped", "failed"
    pub status: String,
    /// Optional message (e.g., error reason)
    pub message: Option<String>,
}

// =====================================================
// ROW TYPES (for sqlx queries)
// =====================================================

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

#[derive(Debug, FromRow)]
struct MarkdownPathRow {
    markdown_path: Option<String>,
}

// =====================================================
// TAURI COMMANDS
// =====================================================

/// Full-text search across document content
#[tauri::command]
pub async fn full_text_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<FullSearchResult>, String> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    state
        .search_index
        .search(&query, limit, offset)
        .map_err(|e| e.to_string())
}

/// Get markdown content for an attachment
#[tauri::command]
pub async fn get_markdown_content(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> Result<Option<String>, String> {
    let row: Option<MarkdownPathRow> = sqlx::query_as(
        "SELECT markdown_path FROM attachments WHERE id = ?",
    )
    .bind(attachment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let markdown_path = match row.and_then(|r| r.markdown_path) {
        Some(p) => p,
        None => return Ok(None),
    };

    // Resolve path relative to library
    let library_path = state.library_path.read().await;
    let full_path = library_path.join(&markdown_path);

    if full_path.exists() {
        let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

/// Reindex a single attachment (re-extract text, update index, save/clear markdown)
#[tauri::command]
pub async fn reindex_attachment(
    state: State<'_, AppState>,
    attachment_id: i64,
    enable_ocr: Option<bool>,
    force_ocr: Option<bool>,
) -> Result<(), String> {
    let config = ExtractionConfig {
        enable_ocr: enable_ocr.unwrap_or(true),
        force_ocr: force_ocr.unwrap_or(false),
    };

    // Get attachment info
    #[derive(Debug, FromRow)]
    struct AttachmentInfoRow {
        id: i64,
        entry_id: i64,
        entry_key: String,
        file_path: Option<String>,
        attachment_type: String,
        entry_title: Option<String>,
    }

    let attachment: AttachmentInfoRow = sqlx::query_as(
        r#"
        SELECT a.id, a.entry_id, e.key as entry_key, a.file_path,
               at.name as attachment_type, e.title as entry_title
        FROM attachments a
        JOIN entries e ON a.entry_id = e.id
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.id = ?
        "#,
    )
    .bind(attachment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Attachment not found".to_string())?;

    let file_path = attachment
        .file_path
        .ok_or_else(|| "Attachment has no file path".to_string())?;

    let library_path = state.library_path.read().await;
    let full_path = library_path.join(&file_path);

    if !full_path.exists() {
        return Err(format!("File not found: {}", full_path.display()));
    }

    // Delete existing index document for this attachment
    state
        .search_index
        .delete_attachment(attachment_id)
        .await
        .map_err(|e| e.to_string())?;

    // Re-extract and index
    let attachment_data = crate::search::indexer::AttachmentData {
        entry_id: attachment.entry_id,
        entry_key: attachment.entry_key,
        attachment_id: attachment.id,
        title: attachment.entry_title,
        file_path: full_path.to_string_lossy().to_string(),
        content_source: attachment.attachment_type,
    };

    match state
        .search_index
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
                            .strip_prefix(&*library_path)
                            .ok()
                            .map(|p| p.to_string_lossy().to_string());
                        if let Some(rel) = relative_md {
                            let _ = sqlx::query(
                                "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                            )
                            .bind(&rel)
                            .bind(attachment_id)
                            .execute(&state.db)
                            .await;
                        }
                    }
                }
            } else {
                // Clear stale markdown_path and remove old .md file
                let stale_md = markdown_path_for(&full_path);
                let _ = std::fs::remove_file(&stale_md);
                let _ = sqlx::query(
                    "UPDATE attachments SET markdown_path = NULL WHERE id = ?",
                )
                .bind(attachment_id)
                .execute(&state.db)
                .await;
            }
            tracing::info!(
                "Reindexed attachment {}: method={}, chars={}",
                attachment_id,
                result.method.as_str(),
                result
                    .extracted_text
                    .as_ref()
                    .map_or(0, |t| t.len())
            );
        }
        Err(e) => {
            tracing::warn!("Failed to reindex attachment {}: {}", attachment_id, e);
            return Err(format!("Extraction failed: {}", e));
        }
    }

    // Commit changes
    state
        .search_index
        .commit()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reindex a single entry and its attachments
#[tauri::command]
pub async fn reindex_entry(
    state: State<'_, AppState>,
    entry_id: i64,
    enable_ocr: Option<bool>,
    force_ocr: Option<bool>,
) -> Result<(), String> {
    let config = ExtractionConfig {
        enable_ocr: enable_ocr.unwrap_or(true),
        force_ocr: force_ocr.unwrap_or(false),
    };

    // First delete existing documents for this entry
    state
        .search_index
        .delete_entry(entry_id)
        .await
        .map_err(|e| e.to_string())?;

    // Get entry from database
    let entry: Option<EntrySearchRow> = sqlx::query_as(
        r#"
        SELECT e.id, e.key, it.name as item_type, e.title
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ? AND e.is_deleted = 0
        "#,
    )
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let entry = match entry {
        Some(e) => e,
        None => return Ok(()), // Entry not found or trashed
    };

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
    .bind(entry_id)
    .fetch_all(&state.db)
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
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let abstract_text = abstract_row.and_then(|r| r.value);

    // Index metadata
    let metadata = crate::search::indexer::EntryMetadata {
        entry_id,
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

    state
        .search_index
        .index_entry_metadata(&metadata)
        .await
        .map_err(|e| e.to_string())?;

    // Get attachments
    let library_path = state.library_path.read().await;
    let attachments: Vec<AttachmentRow> = sqlx::query_as(
        r#"
        SELECT a.id, a.file_path, at.name as attachment_type
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id = ? AND a.file_path IS NOT NULL
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for attachment in attachments {
        if let Some(file_path) = attachment.file_path {
            let full_path = library_path.join(&file_path);
            if full_path.exists() {
                let attachment_data = crate::search::indexer::AttachmentData {
                    entry_id,
                    entry_key: entry.key.clone(),
                    attachment_id: attachment.id,
                    title: entry.title.clone(),
                    file_path: full_path.to_string_lossy().to_string(),
                    content_source: attachment.attachment_type.clone(),
                };

                match state
                    .search_index
                    .index_attachment_content(&attachment_data, &config)
                    .await
                {
                    Ok(result) => {
                        // Save markdown alongside original if extraction is substantial
                        let worth_saving = result.extracted_text.as_ref().map_or(false, |t| is_worth_saving(t));
                        if worth_saving {
                            if let Some(ref text) = result.extracted_text {
                                if let Ok(md_path) = save_markdown(&full_path, text) {
                                    let relative_md =
                                        md_path.strip_prefix(&*library_path).ok().map(|p| {
                                            p.to_string_lossy().to_string()
                                        });
                                    if let Some(rel) = relative_md {
                                        let _ = sqlx::query(
                                            "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                                        )
                                        .bind(&rel)
                                        .bind(attachment.id)
                                        .execute(&state.db)
                                        .await;
                                    }
                                }
                            }
                        } else {
                            // Clear stale markdown_path and remove old .md file
                            let stale_md = markdown_path_for(&full_path);
                            let _ = std::fs::remove_file(&stale_md);
                            let _ = sqlx::query(
                                "UPDATE attachments SET markdown_path = NULL WHERE id = ?",
                            )
                            .bind(attachment.id)
                            .execute(&state.db)
                            .await;
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to index attachment {}: {}", attachment.id, e);
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
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        if !annotations.is_empty() {
            // Combine all annotations for this attachment
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
                    entry_id,
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

                if let Err(e) = state.search_index.index_annotations(&annotation_data).await {
                    tracing::warn!(
                        "Failed to index annotations for attachment {}: {}",
                        attachment.id,
                        e
                    );
                }
            }
        }
    }

    // Commit changes
    state
        .search_index
        .commit()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reindex all entries in the library (background task)
#[tauri::command]
pub async fn reindex_library(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    enable_ocr: Option<bool>,
) -> Result<(), String> {
    use tauri::Emitter;

    let config = ExtractionConfig {
        enable_ocr: enable_ocr.unwrap_or(true),
        force_ocr: false,
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
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let total = entries.len();
    let _ = app_handle.emit("reindex:start", total);

    let library_path = state.library_path.read().await.clone();

    for (i, entry) in entries.iter().enumerate() {
        // Emit progress
        let _ = app_handle.emit("reindex:progress", (i, total));

        // Delete existing documents for this entry
        let _ = state.search_index.delete_entry(entry.id).await;

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
        .fetch_all(&state.db)
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
        .fetch_optional(&state.db)
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

        let _ = state.search_index.index_entry_metadata(&metadata).await;

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
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        for attachment in attachments {
            if let Some(file_path) = attachment.file_path {
                let full_path = library_path.join(&file_path);
                let file_name = full_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                if full_path.exists() {
                    // Emit progress: extracting
                    let _ = app_handle.emit(
                        "reindex:detail",
                        ReindexProgress {
                            current: i,
                            total,
                            entry_title: entry.title.clone(),
                            file_name: Some(file_name.clone()),
                            step: "extracting".to_string(),
                            method: Some("kreuzberg".to_string()),
                            status: "processing".to_string(),
                            message: None,
                        },
                    );

                    let attachment_data = crate::search::indexer::AttachmentData {
                        entry_id: entry.id,
                        entry_key: entry.key.clone(),
                        attachment_id: attachment.id,
                        title: entry.title.clone(),
                        file_path: full_path.to_string_lossy().to_string(),
                        content_source: attachment.attachment_type.clone(),
                    };

                    match state
                        .search_index
                        .index_attachment_content(&attachment_data, &config)
                        .await
                    {
                        Ok(result) => {
                            // Save markdown alongside original if extraction is substantial
                            let worth_saving = result.extracted_text.as_ref().map_or(false, |t| is_worth_saving(t));
                            if worth_saving {
                                if let Some(ref text) = result.extracted_text {
                                    if let Ok(md_path) = save_markdown(&full_path, text) {
                                        let relative_md = md_path
                                            .strip_prefix(&library_path)
                                            .ok()
                                            .map(|p| p.to_string_lossy().to_string());
                                        if let Some(rel) = relative_md {
                                            let _ = sqlx::query(
                                                "UPDATE attachments SET markdown_path = ? WHERE id = ?",
                                            )
                                            .bind(&rel)
                                            .bind(attachment.id)
                                            .execute(&state.db)
                                            .await;
                                        }
                                    }
                                }
                            } else {
                                // Clear stale markdown_path and remove old .md file
                                let stale_md = markdown_path_for(&full_path);
                                let _ = std::fs::remove_file(&stale_md);
                                let _ = sqlx::query(
                                    "UPDATE attachments SET markdown_path = NULL WHERE id = ?",
                                )
                                .bind(attachment.id)
                                .execute(&state.db)
                                .await;
                            }

                            let _ = app_handle.emit(
                                "reindex:detail",
                                ReindexProgress {
                                    current: i,
                                    total,
                                    entry_title: entry.title.clone(),
                                    file_name: Some(file_name.clone()),
                                    step: "indexing".to_string(),
                                    method: Some(result.method.as_str().to_string()),
                                    status: if result.indexed {
                                        "success"
                                    } else {
                                        "skipped"
                                    }
                                    .to_string(),
                                    message: result.message,
                                },
                            );
                        }
                        Err(e) => {
                            let _ = app_handle.emit(
                                "reindex:detail",
                                ReindexProgress {
                                    current: i,
                                    total,
                                    entry_title: entry.title.clone(),
                                    file_name: Some(file_name.clone()),
                                    step: "indexing".to_string(),
                                    method: None,
                                    status: "failed".to_string(),
                                    message: Some(e.to_string()),
                                },
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
            .fetch_all(&state.db)
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

                    let _ = state
                        .search_index
                        .index_annotations(&annotation_data)
                        .await;
                }
            }
        }

        // Commit every 100 entries
        if (i + 1) % 100 == 0 {
            let _ = state.search_index.commit().await;
        }
    }

    // Final commit
    state
        .search_index
        .commit()
        .await
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("reindex:complete", total);

    Ok(())
}
