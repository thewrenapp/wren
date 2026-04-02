use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row, Sqlite, QueryBuilder};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateEntry {
    pub id: i64,
    pub key: String,
    pub title: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
    pub date: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: String,
    pub doi: Option<String>,
    #[serde(rename = "creatorsDisplay")]
    pub creators_display: Option<String>,
    #[serde(rename = "attachmentCount")]
    pub attachment_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub entries: Vec<DuplicateEntry>,
    #[serde(rename = "matchReason")]
    pub match_reason: String,
}

#[derive(Debug, FromRow)]
struct EntryWithDoi {
    id: i64,
    key: String,
    title: String,
    item_type: String,
    date: Option<String>,
    date_added: String,
    doi: Option<String>,
    attachment_count: i64,
}

/// Find duplicate entries in the library
/// Duplicates are detected by:
/// 1. Exact DOI match
/// 2. Exact title match (case-insensitive)
#[tauri::command]
pub async fn find_duplicates(
    state: State<'_, AppState>,
) -> Result<Vec<DuplicateGroup>, String> {
    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut processed_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();

    // Find all entries with duplicate DOIs in a single query
    let doi_entries: Vec<EntryWithDoi> = sqlx::query_as::<_, EntryWithDoi>(
        r#"
        SELECT
            e.id, e.key, e.title, it.name as item_type, e.date, e.date_added,
            ef.value as doi,
            (SELECT COUNT(*) FROM attachments WHERE entry_id = e.id) as attachment_count
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        JOIN entry_fields ef ON ef.entry_id = e.id
        JOIN fields f ON ef.field_id = f.id
        WHERE f.name = 'DOI' AND ef.value != '' AND e.is_deleted = 0
        AND LOWER(ef.value) IN (
            SELECT LOWER(ef2.value)
            FROM entry_fields ef2
            JOIN fields f2 ON ef2.field_id = f2.id
            JOIN entries e2 ON ef2.entry_id = e2.id
            WHERE f2.name = 'DOI' AND ef2.value != '' AND e2.is_deleted = 0
            GROUP BY LOWER(ef2.value)
            HAVING COUNT(*) > 1
        )
        ORDER BY LOWER(ef.value), e.date_added DESC
        "#
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Group by lowercase DOI
    let mut doi_groups: std::collections::HashMap<String, Vec<&EntryWithDoi>> = std::collections::HashMap::new();
    for entry in &doi_entries {
        let key = entry.doi.as_ref().map(|d| d.to_lowercase()).unwrap_or_default();
        doi_groups.entry(key).or_default().push(entry);
    }

    // Batch fetch creators for all DOI-duplicate entries
    let all_doi_entry_ids: Vec<i64> = doi_entries.iter().map(|e| e.id).collect();
    let doi_creators = fetch_creators_display(&state, &all_doi_entry_ids).await?;

    for (doi_lower, entries) in &doi_groups {
        if entries.len() > 1 {
            for e in entries {
                processed_ids.insert(e.id);
            }

            let display_doi = entries[0].doi.as_deref().unwrap_or(doi_lower);
            groups.push(DuplicateGroup {
                entries: entries.iter().map(|e| DuplicateEntry {
                    id: e.id,
                    key: e.key.clone(),
                    title: e.title.clone(),
                    item_type: e.item_type.clone(),
                    date: e.date.clone(),
                    date_added: e.date_added.clone(),
                    doi: e.doi.clone(),
                    creators_display: doi_creators.get(&e.id).cloned(),
                    attachment_count: e.attachment_count,
                }).collect(),
                match_reason: format!("Same DOI: {}", display_doi),
            });
        }
    }

    // Find all entries with duplicate titles in a single query
    let title_entries: Vec<EntryWithDoi> = sqlx::query_as::<_, EntryWithDoi>(
        r#"
        SELECT
            e.id, e.key, e.title, it.name as item_type, e.date, e.date_added,
            (SELECT ef.value FROM entry_fields ef JOIN fields f ON ef.field_id = f.id
             WHERE ef.entry_id = e.id AND f.name = 'DOI' LIMIT 1) as doi,
            (SELECT COUNT(*) FROM attachments WHERE entry_id = e.id) as attachment_count
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 0
        AND LOWER(e.title) IN (
            SELECT LOWER(title)
            FROM entries
            WHERE is_deleted = 0
            GROUP BY LOWER(title)
            HAVING COUNT(*) > 1
        )
        ORDER BY LOWER(e.title), e.date_added DESC
        "#
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Group by lowercase title
    let mut title_groups_map: std::collections::HashMap<String, Vec<&EntryWithDoi>> = std::collections::HashMap::new();
    for entry in &title_entries {
        let key = entry.title.to_lowercase();
        title_groups_map.entry(key).or_default().push(entry);
    }

    // Batch fetch creators for all title-duplicate entries
    let all_title_entry_ids: Vec<i64> = title_entries.iter().map(|e| e.id).collect();
    let title_creators = fetch_creators_display(&state, &all_title_entry_ids).await?;

    for (_ltitle, entries) in &title_groups_map {
        // Skip if all entries in this group were already processed (by DOI)
        let unprocessed: Vec<&&EntryWithDoi> = entries.iter()
            .filter(|e| !processed_ids.contains(&e.id))
            .collect();

        if unprocessed.len() > 1 || (unprocessed.len() == 1 && entries.len() > 1) {
            for e in entries {
                processed_ids.insert(e.id);
            }

            groups.push(DuplicateGroup {
                entries: entries.iter().map(|e| DuplicateEntry {
                    id: e.id,
                    key: e.key.clone(),
                    title: e.title.clone(),
                    item_type: e.item_type.clone(),
                    date: e.date.clone(),
                    date_added: e.date_added.clone(),
                    doi: e.doi.clone(),
                    creators_display: title_creators.get(&e.id).cloned(),
                    attachment_count: e.attachment_count,
                }).collect(),
                match_reason: "Same title".to_string(),
            });
        }
    }

    Ok(groups)
}

/// Get count of duplicate groups
#[tauri::command]
pub async fn get_duplicate_count(
    state: State<'_, AppState>,
) -> Result<i64, String> {
    // Count DOI duplicates
    let doi_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM (
            SELECT ef.value
            FROM entry_fields ef
            JOIN fields f ON ef.field_id = f.id
            JOIN entries e ON ef.entry_id = e.id
            WHERE f.name = 'DOI' AND ef.value != '' AND e.is_deleted = 0
            GROUP BY LOWER(ef.value)
            HAVING COUNT(*) > 1
        )
        "#
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Count title duplicates
    let title_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM (
            SELECT LOWER(title)
            FROM entries
            WHERE is_deleted = 0
            GROUP BY LOWER(title)
            HAVING COUNT(*) > 1
        )
        "#
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // This is an approximation - some groups may overlap
    Ok(doi_count.0 + title_count.0)
}

/// Merge multiple entries into one
/// - Copies attachments from source entries to target
/// - Copies tags from source entries to target
/// - Fills empty fields in target from sources
/// - Deletes source entries
#[tauri::command]
pub async fn merge_entries(
    state: State<'_, AppState>,
    target_id: i64,
    source_ids: Vec<i64>,
) -> Result<(), String> {
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    for source_id in &source_ids {
        if *source_id == target_id {
            continue;
        }

        // Move attachments from source to target
        sqlx::query("UPDATE attachments SET entry_id = ? WHERE entry_id = ?")
            .bind(target_id)
            .bind(source_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        // Copy tags (ignore duplicates)
        sqlx::query(
            "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, tag_id FROM entry_tags WHERE entry_id = ?"
        )
        .bind(target_id)
        .bind(source_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        // Copy collection memberships (ignore duplicates)
        sqlx::query(
            "INSERT OR IGNORE INTO collection_entries (entry_id, collection_id) SELECT ?, collection_id FROM collection_entries WHERE entry_id = ?"
        )
        .bind(target_id)
        .bind(source_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        // Copy missing fields from source to target
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO entry_fields (entry_id, field_id, value)
            SELECT ?, field_id, value
            FROM entry_fields
            WHERE entry_id = ?
            AND field_id NOT IN (SELECT field_id FROM entry_fields WHERE entry_id = ?)
            "#
        )
        .bind(target_id)
        .bind(source_id)
        .bind(target_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        // Copy missing creators from source to target
        let max_order: Option<i32> = sqlx::query_scalar(
            "SELECT MAX(sort_order) FROM entry_creators WHERE entry_id = ?"
        )
        .bind(target_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .flatten();

        let next_order = max_order.unwrap_or(-1) + 1;

        // Get source creators that don't exist in target (by name)
        let source_creators: Vec<(i64, String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            r#"
            SELECT ec.creator_type_id, ec.first_name, ec.last_name, ec.name, ec.first_name || ' ' || ec.last_name as full_name
            FROM entry_creators ec
            WHERE ec.entry_id = ?
            AND NOT EXISTS (
                SELECT 1 FROM entry_creators tc
                WHERE tc.entry_id = ?
                AND COALESCE(tc.first_name, '') = COALESCE(ec.first_name, '')
                AND COALESCE(tc.last_name, '') = COALESCE(ec.last_name, '')
            )
            "#
        )
        .bind(source_id)
        .bind(target_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        for (i, (creator_type_id, first_name, last_name, name, _)) in source_creators.iter().enumerate() {
            sqlx::query(
                "INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(target_id)
            .bind(creator_type_id)
            .bind(first_name)
            .bind(last_name)
            .bind(name)
            .bind(next_order + i as i32)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }

        // Soft delete source entry
        sqlx::query("UPDATE entries SET is_deleted = 1, date_modified = datetime('now') WHERE id = ?")
            .bind(source_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Update target's modified date
    sqlx::query("UPDATE entries SET date_modified = datetime('now') WHERE id = ?")
        .bind(target_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

/// Helper to fetch creator display strings for entries
async fn fetch_creators_display(
    state: &State<'_, AppState>,
    entry_ids: &[i64],
) -> Result<std::collections::HashMap<i64, String>, String> {
    if entry_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        r#"
        SELECT entry_id, first_name, last_name, name
        FROM entry_creators
        WHERE entry_id IN ({})
        ORDER BY entry_id, sort_order
        "#,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query(&query);
    for id in entry_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let mut result: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();

    for row in rows {
        let entry_id: i64 = row.get("entry_id");
        let first_name: Option<String> = row.get("first_name");
        let last_name: Option<String> = row.get("last_name");
        let name: Option<String> = row.get("name");

        let display = name.unwrap_or_else(|| {
            [first_name, last_name]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ")
        });

        result.entry(entry_id).or_default().push(display);
    }

    Ok(result.into_iter()
        .map(|(id, names)| (id, names.join(", ")))
        .collect())
}

/// Discard duplicate entries by moving them to trash
/// Keeps the specified entry and soft-deletes all others
#[tauri::command]
pub async fn discard_duplicates(
    state: State<'_, AppState>,
    _keep_id: i64,
    discard_ids: Vec<i64>,
) -> Result<(), String> {
    if discard_ids.is_empty() {
        return Ok(());
    }

    // Soft-delete the discard entries (move to trash) using QueryBuilder
    let mut builder: QueryBuilder<Sqlite> = QueryBuilder::new(
        "UPDATE entries SET is_deleted = 1, date_modified = datetime('now') WHERE id IN ("
    );
    let mut separated = builder.separated(", ");
    for id in &discard_ids {
        separated.push_bind(*id);
    }
    separated.push_unseparated(")");

    builder.build()
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
