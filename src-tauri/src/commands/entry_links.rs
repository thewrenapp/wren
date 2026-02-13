use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklinkInfo {
    pub id: i64,
    #[serde(rename = "sourceEntryId")]
    pub source_entry_id: i64,
    #[serde(rename = "sourceEntryTitle")]
    pub source_entry_title: String,
    #[serde(rename = "sourceEntryKey")]
    pub source_entry_key: String,
    #[serde(rename = "noteAttachmentId")]
    pub note_attachment_id: Option<i64>,
    pub context: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryLinkInfo {
    pub id: i64,
    #[serde(rename = "sourceEntryId")]
    pub source_entry_id: i64,
    #[serde(rename = "targetEntryId")]
    pub target_entry_id: i64,
    #[serde(rename = "linkType")]
    pub link_type: String,
    #[serde(rename = "linkTypeDisplay")]
    pub link_type_display: String,
    pub context: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
}

/// Get all backlinks for an entry (notes that reference this entry).
#[tauri::command]
pub async fn get_entry_backlinks(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<BacklinkInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            el.id,
            el.source_entry_id,
            e.title as source_entry_title,
            e.key as source_entry_key,
            el.context,
            el.date_added,
            (SELECT a.id FROM attachments a
             WHERE a.entry_id = el.source_entry_id
             AND a.attachment_type_id = (SELECT id FROM attachment_types WHERE name = 'note')
             LIMIT 1) as note_attachment_id
        FROM entry_links el
        JOIN entries e ON e.id = el.source_entry_id
        WHERE el.target_entry_id = ?
        ORDER BY el.date_added DESC
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("Failed to get backlinks: {}", e))?;

    let backlinks = rows
        .iter()
        .map(|row| BacklinkInfo {
            id: row.get("id"),
            source_entry_id: row.get("source_entry_id"),
            source_entry_title: row.get("source_entry_title"),
            source_entry_key: row.get("source_entry_key"),
            note_attachment_id: row.get("note_attachment_id"),
            context: row.get("context"),
            date_added: row.get("date_added"),
        })
        .collect();

    Ok(backlinks)
}

/// Sync entry links from a note's markdown content.
/// Parses wren-entry:ID and wren-attachment:ID links, adds new links and removes stale ones.
#[tauri::command]
pub async fn sync_note_entry_links(
    state: State<'_, AppState>,
    attachment_id: i64,
    markdown_content: String,
) -> Result<(), String> {
    // 1. Find the entry that owns this attachment
    let entry_row = sqlx::query("SELECT entry_id FROM attachments WHERE id = ?")
        .bind(attachment_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| format!("Failed to find attachment: {}", e))?;

    let source_entry_id: i64 = match entry_row {
        Some(row) => row.get("entry_id"),
        None => return Err("Attachment not found".to_string()),
    };

    // 2. Parse markdown for wren-entry:ID and wren-attachment:ID links
    let entry_re = regex::Regex::new(r"\]\(wren-entry:(\d+)\)")
        .map_err(|e| format!("Regex error: {}", e))?;
    let attachment_re = regex::Regex::new(r"\]\(wren-attachment:(\d+)\)")
        .map_err(|e| format!("Regex error: {}", e))?;

    let mut target_ids: Vec<i64> = Vec::new();

    // Direct entry links
    for cap in entry_re.captures_iter(&markdown_content) {
        if let Ok(id) = cap[1].parse::<i64>() {
            if id != source_entry_id && !target_ids.contains(&id) {
                target_ids.push(id);
            }
        }
    }

    // Attachment links — resolve to parent entry
    let mut attachment_ids: Vec<i64> = Vec::new();
    for cap in attachment_re.captures_iter(&markdown_content) {
        if let Ok(id) = cap[1].parse::<i64>() {
            if !attachment_ids.contains(&id) {
                attachment_ids.push(id);
            }
        }
    }
    if !attachment_ids.is_empty() {
        for att_id in &attachment_ids {
            let att_row = sqlx::query("SELECT entry_id FROM attachments WHERE id = ?")
                .bind(att_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| format!("Failed to look up attachment: {}", e))?;
            if let Some(row) = att_row {
                let entry_id: i64 = row.get("entry_id");
                if entry_id != source_entry_id && !target_ids.contains(&entry_id) {
                    target_ids.push(entry_id);
                }
            }
        }
    }

    // 3. Get the "references" link type id
    let link_type_row =
        sqlx::query("SELECT id FROM link_types WHERE name = 'references'")
            .fetch_optional(&state.db)
            .await
            .map_err(|e| format!("Failed to get link type: {}", e))?;

    let link_type_id: i64 = match link_type_row {
        Some(row) => row.get("id"),
        None => return Err("Link type 'references' not found".to_string()),
    };

    // 4. Get existing links from this source entry with this link type
    let existing_rows = sqlx::query(
        "SELECT id, target_entry_id FROM entry_links WHERE source_entry_id = ? AND link_type_id = ?",
    )
    .bind(source_entry_id)
    .bind(link_type_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("Failed to get existing links: {}", e))?;

    let existing_targets: Vec<(i64, i64)> = existing_rows
        .iter()
        .map(|r| (r.get::<i64, _>("id"), r.get::<i64, _>("target_entry_id")))
        .collect();

    // 5. Add new links
    for target_id in &target_ids {
        if !existing_targets.iter().any(|(_, t)| t == target_id) {
            sqlx::query(
                "INSERT OR IGNORE INTO entry_links (source_entry_id, target_entry_id, link_type_id) VALUES (?, ?, ?)",
            )
            .bind(source_entry_id)
            .bind(target_id)
            .bind(link_type_id)
            .execute(&state.db)
            .await
            .map_err(|e| format!("Failed to create link: {}", e))?;
        }
    }

    // 6. Remove stale links
    for (link_id, target_id) in &existing_targets {
        if !target_ids.contains(target_id) {
            sqlx::query("DELETE FROM entry_links WHERE id = ?")
                .bind(link_id)
                .execute(&state.db)
                .await
                .map_err(|e| format!("Failed to delete stale link: {}", e))?;
        }
    }

    Ok(())
}

/// Create a manual entry link.
#[tauri::command]
pub async fn create_entry_link(
    state: State<'_, AppState>,
    source_entry_id: i64,
    target_entry_id: i64,
    link_type: String,
    context: Option<String>,
) -> Result<i64, String> {
    let link_type_row = sqlx::query("SELECT id FROM link_types WHERE name = ?")
        .bind(&link_type)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| format!("Failed to get link type: {}", e))?;

    let link_type_id: i64 = match link_type_row {
        Some(row) => row.get("id"),
        None => return Err(format!("Link type '{}' not found", link_type)),
    };

    let result = sqlx::query(
        "INSERT OR IGNORE INTO entry_links (source_entry_id, target_entry_id, link_type_id, context) VALUES (?, ?, ?, ?)",
    )
    .bind(source_entry_id)
    .bind(target_entry_id)
    .bind(link_type_id)
    .bind(&context)
    .execute(&state.db)
    .await
    .map_err(|e| format!("Failed to create entry link: {}", e))?;

    Ok(result.last_insert_rowid())
}

/// Delete an entry link by id.
#[tauri::command]
pub async fn delete_entry_link(
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM entry_links WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to delete entry link: {}", e))?;

    Ok(())
}
