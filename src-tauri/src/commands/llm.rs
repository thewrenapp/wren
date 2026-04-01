use serde::Serialize;
use sqlx::FromRow;
use tauri::State;

use crate::jobs::types::{JobType, LlmParsePayload};
use crate::state::AppState;

// ── Response types ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedContentSummary {
    pub attachment_id: i64,
    pub document_type: Option<String>,
    pub language: Option<String>,
    pub sections_count: i64,
    pub total_tokens_used: i64,
    pub model_used: String,
    pub provider: String,
    pub status: String,
    pub date_started: String,
    pub date_completed: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedContentFull {
    pub attachment_id: i64,
    pub entry_id: i64,
    pub document_type: Option<String>,
    pub language: Option<String>,
    pub sections_json: Option<String>,
    pub structured_markdown: Option<String>,
    pub model_used: String,
    pub provider: String,
    pub total_tokens_used: i64,
    pub discovery_chunks: i64,
    pub sections_count: i64,
    pub pipeline_stages_json: Option<String>,
    pub status: String,
    pub date_started: String,
    pub date_completed: Option<String>,
}

#[derive(Debug, FromRow)]
struct ParsedContentRow {
    attachment_id: i64,
    entry_id: i64,
    document_type: Option<String>,
    language: Option<String>,
    sections_json: Option<String>,
    structured_markdown: Option<String>,
    model_used: String,
    provider: String,
    total_tokens_used: i64,
    discovery_chunks: i64,
    sections_count: i64,
    pipeline_stages_json: Option<String>,
    status: String,
    date_started: String,
    date_completed: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────

/// Derive the structured markdown file path for an attachment.
/// Returns the absolute path to the `.structured.md` file (sibling of the `.pdf.md` file).
async fn structured_md_path(
    db: &sqlx::SqlitePool,
    library_path: &std::path::Path,
    attachment_id: i64,
) -> Option<std::path::PathBuf> {
    let md_path: Option<String> = sqlx::query_scalar(
        "SELECT markdown_path FROM attachments WHERE id = ?",
    )
    .bind(attachment_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten();

    md_path.map(|p| library_path.join(p).with_extension("structured.md"))
}

// ── Commands ───────────────────────────────────────────────────────

/// Enqueue an LLM parse job for a single attachment.
#[tauri::command]
pub async fn parse_document(
    state: State<'_, AppState>,
    attachment_id: i64,
    entry_id: i64,
) -> Result<String, String> {
    // Validate that the attachment has extracted text before enqueuing
    let markdown_path: Option<String> = sqlx::query_scalar(
        "SELECT markdown_path FROM attachments WHERE id = ? AND entry_id = ?",
    )
    .bind(attachment_id)
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .flatten();

    if markdown_path.is_none() {
        return Err("No extracted text available. Run text extraction first.".to_string());
    }

    let payload = LlmParsePayload {
        attachment_id,
        entry_id,
    };

    let entry_title: Option<String> = sqlx::query_scalar(
        "SELECT title FROM entries WHERE id = ?",
    )
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .flatten();

    let title = match entry_title {
        Some(t) if !t.is_empty() => format!("Parse: {}", t),
        _ => format!("Parse Document #{}", attachment_id),
    };

    state
        .job_queue
        .enqueue(
            JobType::LlmParse,
            Some(title),
            serde_json::to_value(&payload).map_err(|e| e.to_string())?,
            0,
        )
        .await
}

/// Bulk parse: enqueue LLM parse jobs for all attachments of given entries.
#[tauri::command]
pub async fn parse_entries(
    state: State<'_, AppState>,
    entry_ids: Vec<i64>,
) -> Result<Vec<String>, String> {
    #[derive(FromRow)]
    struct AttInfo {
        id: i64,
        entry_id: i64,
    }

    let mut job_ids = Vec::new();

    for entry_id in &entry_ids {
        let entry_title: Option<String> = sqlx::query_scalar(
            "SELECT title FROM entries WHERE id = ?",
        )
        .bind(entry_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .flatten();

        let attachments: Vec<AttInfo> = sqlx::query_as(
            r#"
            SELECT a.id, a.entry_id
            FROM attachments a
            WHERE a.entry_id = ? AND a.markdown_path IS NOT NULL
            "#,
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        for att in attachments {
            let payload = LlmParsePayload {
                attachment_id: att.id,
                entry_id: att.entry_id,
            };

            let title = match &entry_title {
                Some(t) if !t.is_empty() => format!("Parse: {}", t),
                _ => format!("Parse Document #{}", att.id),
            };

            let job_id = state
                .job_queue
                .enqueue(
                    JobType::LlmParse,
                    Some(title),
                    serde_json::to_value(&payload).map_err(|e| e.to_string())?,
                    0,
                )
                .await?;

            job_ids.push(job_id);
        }
    }

    Ok(job_ids)
}

/// Get full parsed content for an attachment.
/// Structured markdown is read from the `.structured.md` file on disk (source of truth).
/// If the disk version differs from the DB, the DB is updated silently.
#[tauri::command]
pub async fn get_parsed_content(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> Result<Option<ParsedContentFull>, String> {
    let row: Option<ParsedContentRow> = sqlx::query_as(
        r#"
        SELECT attachment_id, entry_id, document_type, language, sections_json,
               structured_markdown, model_used, provider, total_tokens_used,
               discovery_chunks, sections_count, pipeline_stages_json,
               status, date_started, date_completed
        FROM parsed_content
        WHERE attachment_id = ?
        "#,
    )
    .bind(attachment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let Some(r) = row else {
        return Ok(None);
    };

    // Try to read structured markdown from disk (source of truth)
    let library_path = state.library_path.read().await;
    let disk_content = structured_md_path(&state.db, &library_path, attachment_id)
        .await
        .and_then(|path| std::fs::read_to_string(&path).ok());

    let structured_markdown = if let Some(ref disk_md) = disk_content {
        // Disk is source of truth — sync to DB if different
        if r.structured_markdown.as_deref() != Some(disk_md.as_str()) {
            let _ = sqlx::query(
                "UPDATE parsed_content SET structured_markdown = ? WHERE attachment_id = ?",
            )
            .bind(disk_md)
            .bind(attachment_id)
            .execute(&state.db)
            .await;
        }
        Some(disk_md.clone())
    } else {
        // No file on disk — fall back to DB value
        r.structured_markdown
    };

    Ok(Some(ParsedContentFull {
        attachment_id: r.attachment_id,
        entry_id: r.entry_id,
        document_type: r.document_type,
        language: r.language,
        sections_json: r.sections_json,
        structured_markdown,
        model_used: r.model_used,
        provider: r.provider,
        total_tokens_used: r.total_tokens_used,
        discovery_chunks: r.discovery_chunks,
        sections_count: r.sections_count,
        pipeline_stages_json: r.pipeline_stages_json,
        status: r.status,
        date_started: r.date_started,
        date_completed: r.date_completed,
    }))
}

/// Get parsed content summary for all attachments of an entry.
#[tauri::command]
pub async fn get_entry_parsed_content(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<ParsedContentSummary>, String> {
    #[derive(FromRow)]
    struct SummaryRow {
        attachment_id: i64,
        document_type: Option<String>,
        language: Option<String>,
        sections_count: i64,
        total_tokens_used: i64,
        model_used: String,
        provider: String,
        status: String,
        date_started: String,
        date_completed: Option<String>,
    }

    let rows: Vec<SummaryRow> = sqlx::query_as(
        r#"
        SELECT attachment_id, document_type, language, sections_count,
               total_tokens_used, model_used, provider, status,
               date_started, date_completed
        FROM parsed_content
        WHERE entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| ParsedContentSummary {
            attachment_id: r.attachment_id,
            document_type: r.document_type,
            language: r.language,
            sections_count: r.sections_count,
            total_tokens_used: r.total_tokens_used,
            model_used: r.model_used,
            provider: r.provider,
            status: r.status,
            date_started: r.date_started,
            date_completed: r.date_completed,
        })
        .collect())
}

/// Update structured markdown for an attachment's parsed content (user edits).
/// Writes to disk first (source of truth), then updates the DB backup.
#[tauri::command]
pub async fn update_parsed_content(
    state: State<'_, AppState>,
    attachment_id: i64,
    structured_markdown: String,
) -> Result<(), String> {
    // Write to disk (source of truth)
    let library_path = state.library_path.read().await;
    if let Some(path) = structured_md_path(&state.db, &library_path, attachment_id).await {
        std::fs::write(&path, &structured_markdown).map_err(|e| e.to_string())?;
    }

    // Update DB backup
    sqlx::query(
        "UPDATE parsed_content SET structured_markdown = ?, date_completed = datetime('now') WHERE attachment_id = ?",
    )
    .bind(&structured_markdown)
    .bind(attachment_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete parsed content for an attachment (to allow re-parsing).
#[tauri::command]
pub async fn delete_parsed_content(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM parsed_content WHERE attachment_id = ?")
        .bind(attachment_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the API key for a given provider (e.g. llm_api_key_openai).
async fn get_api_key(pool: &sqlx::SqlitePool, provider: &str) -> String {
    use crate::commands::settings::get_setting_value;

    get_setting_value(pool, &format!("llm_api_key_{provider}"))
        .await
        .unwrap_or_default()
}

/// List available models from the configured LLM provider.
#[tauri::command]
pub async fn list_llm_models(
    state: State<'_, AppState>,
) -> Result<Vec<crate::llm::provider::ModelInfo>, String> {
    use crate::commands::settings::get_setting_value;

    let provider_name = get_setting_value(&state.db, "llm_provider")
        .await
        .unwrap_or_else(|| "openai".to_string());
    let api_key = get_api_key(&state.db, &provider_name).await;
    let base_url = get_setting_value(&state.db, "llm_base_url")
        .await
        .unwrap_or_default();

    tracing::info!(
        "[list_models] provider={}, api_key_len={}, base_url={}",
        provider_name,
        api_key.len(),
        base_url,
    );

    if crate::llm::provider_requires_api_key(&provider_name) && api_key.is_empty() {
        return Err("API key not configured".to_string());
    }

    let provider = crate::llm::create_provider(&provider_name, api_key, base_url);
    provider
        .list_models()
        .await
        .map_err(|e| format!("{e}"))
}

/// Validate LLM configuration by testing the connection.
#[tauri::command]
pub async fn validate_llm_config(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    use crate::commands::settings::get_setting_value;

    let provider_name = get_setting_value(&state.db, "llm_provider")
        .await
        .unwrap_or_else(|| "openai".to_string());
    let api_key = get_api_key(&state.db, &provider_name).await;
    let base_url = get_setting_value(&state.db, "llm_base_url")
        .await
        .unwrap_or_default();

    tracing::info!(
        "[validate] provider={}, api_key_len={}, base_url={}",
        provider_name,
        api_key.len(),
        base_url,
    );

    if crate::llm::provider_requires_api_key(&provider_name) && api_key.is_empty() {
        tracing::warn!("[validate] API key empty for provider {}", provider_name);
        return Ok(false);
    }

    let provider = crate::llm::create_provider(&provider_name, api_key, base_url);
    match provider.list_models().await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
