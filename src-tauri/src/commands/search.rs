use serde::Serialize;
use sqlx::FromRow;
use tauri::State;

use crate::search::extractor::ExtractionConfig;
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
    /// Method being used: "pdf-extract", "ollama", "ocr", "direct"
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

/// Reindex a single entry and its attachments
#[tauri::command]
pub async fn reindex_entry(
    state: State<'_, AppState>,
    entry_id: i64,
    skip_ocr: Option<bool>,
    ollama_enabled: Option<bool>,
    ollama_endpoint: Option<String>,
    ollama_model: Option<String>,
) -> Result<(), String> {
    let config = ExtractionConfig {
        skip_ocr: skip_ocr.unwrap_or(false),
        ollama_enabled: ollama_enabled.unwrap_or(false),
        ollama_endpoint: ollama_endpoint.unwrap_or_else(|| "http://localhost:11434".to_string()),
        ollama_model: ollama_model.unwrap_or_else(|| "llava".to_string()),
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

                if let Err(e) = state
                    .search_index
                    .index_attachment_content(&attachment_data, &config)
                    .await
                {
                    tracing::warn!("Failed to index attachment {}: {}", attachment.id, e);
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
                    tracing::warn!("Failed to index annotations for attachment {}: {}", attachment.id, e);
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
    skip_ocr: Option<bool>,
    ollama_enabled: Option<bool>,
    ollama_endpoint: Option<String>,
    ollama_model: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;

    let config = ExtractionConfig {
        skip_ocr: skip_ocr.unwrap_or(false),
        ollama_enabled: ollama_enabled.unwrap_or(false),
        ollama_endpoint: ollama_endpoint.unwrap_or_else(|| "http://localhost:11434".to_string()),
        ollama_model: ollama_model.unwrap_or_else(|| "llava".to_string()),
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
                    // Determine expected extraction method based on file extension
                    let expected_method = match full_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_lowercase())
                        .as_deref()
                    {
                        Some("pdf") => {
                            if config.skip_ocr {
                                "pdf-extract (OCR disabled)"
                            } else if config.ollama_enabled {
                                "pdf-extract → ollama → ocr"
                            } else {
                                "pdf-extract → ocr"
                            }
                        }
                        Some("md") | Some("txt") | Some("markdown") => "direct",
                        Some("html") | Some("htm") => "html-parse",
                        _ => "unknown",
                    };

                    // Emit progress: extracting with expected method
                    let _ = app_handle.emit(
                        "reindex:detail",
                        ReindexProgress {
                            current: i,
                            total,
                            entry_title: entry.title.clone(),
                            file_name: Some(file_name.clone()),
                            step: "extracting".to_string(),
                            method: Some(expected_method.to_string()),
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
                            let _ = app_handle.emit(
                                "reindex:detail",
                                ReindexProgress {
                                    current: i,
                                    total,
                                    entry_title: entry.title.clone(),
                                    file_name: Some(file_name.clone()),
                                    step: "indexing".to_string(),
                                    method: Some(result.method.as_str().to_string()),
                                    status: if result.indexed { "success" } else { "skipped" }.to_string(),
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
                SELECT attachment_id, selected_text, comment
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

                    let _ = state.search_index.index_annotations(&annotation_data).await;
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

/// Check Ollama connection status
#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    pub connected: bool,
    pub models: Vec<String>,
}

#[tauri::command]
pub async fn check_ollama_status(endpoint: String) -> Result<OllamaStatus, String> {
    let client = reqwest::Client::new();
    let tags_url = format!("{}/api/tags", endpoint);

    match client.get(&tags_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    let models = json["models"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();

                    Ok(OllamaStatus {
                        connected: true,
                        models,
                    })
                } else {
                    Ok(OllamaStatus {
                        connected: true,
                        models: vec![],
                    })
                }
            } else {
                Ok(OllamaStatus {
                    connected: false,
                    models: vec![],
                })
            }
        }
        Err(_) => Ok(OllamaStatus {
            connected: false,
            models: vec![],
        }),
    }
}
