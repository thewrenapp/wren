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

    let title = format!("Parse Document #{}", attachment_id);

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

            let title = format!("Parse Document #{}", att.id);

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

    Ok(row.map(|r| ParsedContentFull {
        attachment_id: r.attachment_id,
        entry_id: r.entry_id,
        document_type: r.document_type,
        language: r.language,
        sections_json: r.sections_json,
        structured_markdown: r.structured_markdown,
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

/// List available models from the configured LLM provider.
#[tauri::command]
pub async fn list_llm_models(
    state: State<'_, AppState>,
) -> Result<Vec<crate::llm::provider::ModelInfo>, String> {
    use crate::commands::settings::get_setting_value;
    use crate::llm::openai::OpenAiProvider;
    use crate::llm::provider::LlmProvider;

    let api_key = get_setting_value(&state.db, "llm_api_key")
        .await
        .unwrap_or_default();
    let base_url = get_setting_value(&state.db, "llm_base_url")
        .await
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());

    if api_key.is_empty() {
        return Err("API key not configured".to_string());
    }

    let provider = OpenAiProvider::new(api_key, base_url);
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
    use crate::llm::openai::OpenAiProvider;
    use crate::llm::provider::LlmProvider;

    let api_key = get_setting_value(&state.db, "llm_api_key")
        .await
        .unwrap_or_default();
    let base_url = get_setting_value(&state.db, "llm_base_url")
        .await
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());

    if api_key.is_empty() {
        return Ok(false);
    }

    let provider = OpenAiProvider::new(api_key, base_url);
    match provider.list_models().await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
