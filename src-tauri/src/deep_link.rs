use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;
use crate::tray::show_main_window;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SelectItemPayload {
    pub entry_id: i64,
    pub entry_key: String,
    pub title: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenPdfPayload {
    pub entry_id: i64,
    pub entry_key: String,
    pub title: String,
    pub attachment_id: i64,
    pub attachment_key: String,
    pub page: Option<i32>,
    pub annotation_key: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ErrorPayload {
    pub message: String,
}

/// Handle an incoming `wren://` deep link URL.
///
/// Supported formats:
///   wren://select/library/items/<entryKey>
///   wren://open-pdf/library/items/<entryKey>/<attachmentKey>?page=N&annotation=<annotKey>
pub async fn handle_deep_link(app_handle: &AppHandle, url: &str) {
    tracing::info!("Deep link received: {url}");

    // Bring window to front
    show_main_window(app_handle);

    // Parse the URL
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!("Failed to parse deep link URL: {e}");
            emit_error(app_handle, &format!("Invalid URL: {url}"));
            return;
        }
    };

    // The "host" of wren://select/... is "select"
    let action = parsed.host_str().unwrap_or("");
    // Path segments after the host, e.g. /library/items/<key>
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.collect())
        .unwrap_or_default();

    let state = app_handle.state::<AppState>();
    let db = &state.db;

    match action {
        "select" => handle_select(app_handle, db, &segments).await,
        "open-pdf" => {
            let query_params: std::collections::HashMap<String, String> =
                parsed.query_pairs().into_owned().collect();
            handle_open_pdf(app_handle, db, &segments, &query_params).await;
        }
        "auth-callback" => {
            let query_params: std::collections::HashMap<String, String> =
                parsed.query_pairs().into_owned().collect();
            // Also check fragment (some OAuth flows put token in #fragment)
            let fragment_params: std::collections::HashMap<String, String> = parsed
                .fragment()
                .map(|f| url::form_urlencoded::parse(f.as_bytes()).into_owned().collect())
                .unwrap_or_default();

            let id_token = query_params.get("id_token")
                .or_else(|| fragment_params.get("id_token"))
                .cloned();
            let provider = query_params.get("providerId")
                .or_else(|| fragment_params.get("providerId"))
                .cloned()
                .unwrap_or_else(|| "google.com".to_string());

            if let Some(token) = id_token {
                if let Err(e) = crate::commands::auth::handle_oauth_callback(
                    &state, app_handle, &provider, &token,
                ).await {
                    emit_error(app_handle, &format!("OAuth sign-in failed: {e}"));
                }
            } else {
                emit_error(app_handle, "No token received from OAuth callback");
            }
        }
        _ => {
            emit_error(app_handle, &format!("Unknown action: {action}"));
        }
    }
}

/// Handle wren://select/library/items/<entryKey>
async fn handle_select(app_handle: &AppHandle, db: &SqlitePool, segments: &[&str]) {
    // Expect: ["library", "items", "<entryKey>"]
    if segments.len() < 3 || segments[0] != "library" || segments[1] != "items" {
        emit_error(app_handle, "Invalid select URL format");
        return;
    }

    let entry_key = segments[2];

    match resolve_entry(db, entry_key).await {
        Some((id, key, title)) => {
            let _ = app_handle.emit(
                "deep-link:select-item",
                SelectItemPayload {
                    entry_id: id,
                    entry_key: key,
                    title,
                },
            );
        }
        None => {
            emit_error(app_handle, &format!("Entry not found: {entry_key}"));
        }
    }
}

/// Handle wren://open-pdf/library/items/<entryKey>/<attachmentKey>?page=N&annotation=<key>
async fn handle_open_pdf(
    app_handle: &AppHandle,
    db: &SqlitePool,
    segments: &[&str],
    params: &std::collections::HashMap<String, String>,
) {
    // Expect: ["library", "items", "<entryKey>", "<attachmentKey>"]
    if segments.len() < 4 || segments[0] != "library" || segments[1] != "items" {
        emit_error(app_handle, "Invalid open-pdf URL format");
        return;
    }

    let entry_key = segments[2];
    let attachment_key = segments[3];

    let entry = match resolve_entry(db, entry_key).await {
        Some(e) => e,
        None => {
            emit_error(app_handle, &format!("Entry not found: {entry_key}"));
            return;
        }
    };

    let attachment = match resolve_attachment(db, attachment_key, entry.0).await {
        Some(a) => a,
        None => {
            emit_error(
                app_handle,
                &format!("Attachment not found: {attachment_key}"),
            );
            return;
        }
    };

    // Resolve page number: try annotation first, fall back to page param
    let annotation_key = params.get("annotation").cloned();
    let page_from_param = params.get("page").and_then(|p| p.parse::<i32>().ok());
    let page = if let Some(ref annot_key) = annotation_key {
        resolve_annotation_page(db, annot_key, attachment.0)
            .await
            .or(page_from_param)
    } else {
        page_from_param
    };

    let _ = app_handle.emit(
        "deep-link:open-pdf",
        OpenPdfPayload {
            entry_id: entry.0,
            entry_key: entry.1,
            title: entry.2,
            attachment_id: attachment.0,
            attachment_key: attachment.1,
            page,
            annotation_key,
        },
    );
}

/// Resolve an entry key to (id, key, title).
async fn resolve_entry(db: &SqlitePool, key: &str) -> Option<(i64, String, String)> {
    sqlx::query_as::<_, (i64, String, String)>(
        "SELECT id, key, title FROM entries WHERE key = ? AND is_deleted = 0",
    )
    .bind(key)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

/// Resolve an attachment key to (id, key) for a given entry.
async fn resolve_attachment(db: &SqlitePool, key: &str, entry_id: i64) -> Option<(i64, String)> {
    sqlx::query_as::<_, (i64, String)>(
        "SELECT id, key FROM attachments WHERE key = ? AND entry_id = ?",
    )
    .bind(key)
    .bind(entry_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

/// Resolve an annotation key to its page number.
async fn resolve_annotation_page(db: &SqlitePool, key: &str, attachment_id: i64) -> Option<i32> {
    sqlx::query_scalar::<_, i32>(
        "SELECT page_number FROM attachment_annotations WHERE key = ? AND attachment_id = ?",
    )
    .bind(key)
    .bind(attachment_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

fn emit_error(app_handle: &AppHandle, message: &str) {
    tracing::warn!("Deep link error: {message}");
    let _ = app_handle.emit(
        "deep-link:error",
        ErrorPayload {
            message: message.to_string(),
        },
    );
}
