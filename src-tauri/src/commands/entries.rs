use crate::db::models::{
    Attachment, CreateAttachmentInput, CreateEntryInput, Creator, CreatorInput, Entry,
    EntrySummary, SavedSearch, SavedSearchCriterion, Tag, UpdateEntryInput,
};
use crate::search::extractor::ExtractionConfig;
use crate::search::indexer::{AttachmentData, EntryMetadata};
use crate::state::AppState;
use sqlx::{FromRow, Row, Sqlite, SqlitePool, QueryBuilder};
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;
use serde::Deserialize;

// =====================================================
// ROW TYPES (for sqlx queries)
// =====================================================

#[derive(Debug, FromRow)]
struct SavedSearchRow {
    id: i64,
    name: String,
    match_mode: String,
    criteria_json: String,
    scope: String,
    collection_id: Option<i64>,
    sort_order: i32,
    date_added: String,
    date_modified: String,
}

/// Load all saved searches from the database (internal helper)
async fn load_saved_searches(pool: &SqlitePool) -> Vec<SavedSearch> {
    let rows: Vec<SavedSearchRow> = sqlx::query_as(
        r#"
        SELECT id, name, match_mode, criteria_json, scope, collection_id, sort_order, date_added, date_modified
        FROM saved_searches
        ORDER BY sort_order, name
        "#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .filter_map(|row| {
            let criteria: Vec<SavedSearchCriterion> = serde_json::from_str(&row.criteria_json).ok()?;
            Some(SavedSearch {
                id: row.id,
                name: row.name,
                match_mode: row.match_mode,
                criteria,
                scope: row.scope,
                collection_id: row.collection_id,
                sort_order: row.sort_order,
                date_added: row.date_added,
                date_modified: row.date_modified,
            })
        })
        .collect()
}

#[derive(Debug, FromRow)]
struct EntryRow {
    id: i64,
    key: String,
    item_type: String,
    item_type_display: String,
    title: String,
    date: Option<String>,
    url: Option<String>,
    access_date: Option<String>,
    date_added: String,
    date_modified: String,
}

#[derive(Debug, FromRow)]
struct EntrySummaryRow {
    id: i64,
    key: String,
    item_type: String,
    item_type_display: String,
    title: String,
    date: Option<String>,
    date_added: String,
    date_modified: Option<String>,
    attachment_count: i64,
    has_pdf: bool,
    has_note: bool,
    has_weblink: bool,
    thumbnail_path: Option<String>,
}

#[derive(Debug, FromRow)]
struct CreatorRow {
    id: i64,
    creator_type: String,
    creator_type_display: String,
    first_name: Option<String>,
    last_name: Option<String>,
    name: Option<String>,
    sort_order: i32,
}

#[derive(Debug, FromRow)]
struct FieldRow {
    field_name: String,
    value: String,
}

#[derive(Debug, FromRow)]
struct AttachmentRow {
    id: i64,
    key: String,
    entry_id: i64,
    attachment_type: String,
    attachment_type_display: String,
    title: Option<String>,
    file_path: Option<String>,
    file_hash: Option<String>,
    file_size: Option<i64>,
    url: Option<String>,
    page_count: Option<i32>,
    frontmatter: Option<String>,
    thumbnail_path: Option<String>,
    markdown_path: Option<String>,
    date_added: String,
    date_modified: String,
}

#[derive(Debug, FromRow)]
struct TagRow {
    id: i64,
    name: String,
    color: Option<String>,
    is_imported: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EntriesPage {
    pub entries: Vec<EntrySummary>,
    pub total: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EntryCounts {
    pub total: i64,
    pub pdf: i64,
    pub note: i64,
    pub recent: i64,
    pub untagged: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedCriterion {
    pub field: String,
    pub operator: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSearch {
    pub match_mode: String,
    pub criteria: Vec<AdvancedCriterion>,
}

fn apply_entry_filters(
    qb: &mut QueryBuilder<Sqlite>,
    collection_id: Option<i64>,
    tag_ids: Option<Vec<i64>>,
    tag_mode: &str,
    attachment_type: Option<String>,
    search_query: Option<String>,
    search_scope: Option<&str>,
    advanced_search: Option<&AdvancedSearch>,
    filter_type: Option<&str>,
    saved_searches: &[SavedSearch],
) {
    if let Some(coll_id) = collection_id {
        qb.push(" AND e.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
        qb.push_bind(coll_id);
        qb.push(")");
    }

    if let Some(t_ids) = tag_ids {
        if !t_ids.is_empty() {
            if t_ids.len() == 1 {
                let only_id = t_ids[0];
                qb.push(" AND e.id IN (SELECT entry_id FROM entry_tags WHERE tag_id = ");
                qb.push_bind(only_id);
                qb.push(")");
            } else {
                let count = t_ids.len() as i64;
                qb.push(" AND e.id IN (SELECT entry_id FROM entry_tags WHERE tag_id IN (");
                let mut separated = qb.separated(", ");
                for id in t_ids {
                    separated.push_bind(id);
                }
                qb.push(")");
                if tag_mode == "and" {
                    qb.push(" GROUP BY entry_id HAVING COUNT(DISTINCT tag_id) = ");
                    qb.push_bind(count);
                }
                qb.push(")");
            }
        }
    }

    if let Some(att_type) = attachment_type {
        qb.push(" AND e.id IN (SELECT a.entry_id FROM attachments a JOIN attachment_types at ON a.attachment_type_id = at.id WHERE at.name = ");
        qb.push_bind(att_type);
        qb.push(")");
    }

    if let Some(advanced) = advanced_search {
        if !advanced.criteria.is_empty() {
            let joiner = if advanced.match_mode == "any" { " OR " } else { " AND " };
            qb.push(" AND (");
            let mut first = true;
            for criterion in &advanced.criteria {
                if !first {
                    qb.push(joiner);
                }
                first = false;
                apply_advanced_criterion(qb, criterion, saved_searches);
            }
            qb.push(")");
        }
    } else if let Some(search) = search_query {
        let scope = search_scope.unwrap_or("title_creator_year");
        let pattern = format!("%{}%", search);

        qb.push(" AND (e.title LIKE ");
        qb.push_bind(pattern.clone());
        qb.push(" OR COALESCE(e.creators_sort, '') LIKE ");
        qb.push_bind(pattern.clone());
        qb.push(" OR COALESCE(e.date, '') LIKE ");
        qb.push_bind(pattern.clone());
        qb.push(
            " OR EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e.id AND f.name = 'publicationTitle' AND ef.value LIKE ",
        );
        qb.push_bind(pattern.clone());
        qb.push(")");

        if scope == "fields_tags" {
            // Search all fields including abstractNote
            qb.push(
                " OR EXISTS(SELECT 1 FROM entry_fields ef WHERE ef.entry_id = e.id AND ef.value LIKE ",
            );
            qb.push_bind(pattern.clone());
            qb.push(")");
            qb.push(
                " OR EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e.id AND t.name LIKE ",
            );
            qb.push_bind(pattern);
            qb.push(")");
        }

        qb.push(")");
    }

    match filter_type {
        Some("recent") => {
            qb.push(" AND e.date_added >= datetime('now', '-7 days')");
        }
        Some("untagged") => {
            qb.push(" AND e.id NOT IN (SELECT entry_id FROM entry_tags)");
        }
        _ => {}
    }
}

fn apply_advanced_criterion(qb: &mut QueryBuilder<Sqlite>, criterion: &AdvancedCriterion, saved_searches: &[SavedSearch]) {
    let field = criterion.field.as_str();
    let operator = criterion.operator.as_str();
    let value = criterion.value.clone().unwrap_or_default();
    let has_value = !value.is_empty();

    let (op_kind, pattern) = match operator {
        "contains" => ("like", format!("%{}%", value)),
        "does_not_contain" => ("not_like", format!("%{}%", value)),
        "is" => ("eq", value.clone()),
        "is_not" => ("neq", value.clone()),
        "begins_with" => ("like", format!("{}%", value)),
        "ends_with" => ("like", format!("%{}", value)),
        "is_before" => ("before", value.clone()),
        "is_after" => ("after", value.clone()),
        "is_empty" => ("empty", value.clone()),
        "is_not_empty" => ("not_empty", value.clone()),
        _ => ("like", format!("%{}%", value)),
    };

    match field {
        "title" => apply_text_column(qb, "e.title", op_kind, pattern.clone(), has_value),
        "creator" => apply_text_column(qb, "COALESCE(e.creators_sort, '')", op_kind, pattern.clone(), has_value),
        "year" => apply_text_column(qb, "SUBSTR(COALESCE(e.date, ''), 1, 4)", op_kind, pattern.clone(), has_value),
        "publication_title" => apply_field_match(qb, "publicationTitle", op_kind, pattern.clone(), has_value),
        "abstract" => apply_field_match(qb, "abstractNote", op_kind, pattern.clone(), has_value),
        "tags" => apply_tag_match(qb, op_kind, pattern.clone(), has_value),
        "item_type" => apply_text_column(qb, "it.display_name", op_kind, pattern.clone(), has_value),
        "date_added" => apply_date_column(qb, "e.date_added", op_kind, pattern.clone(), has_value),
        "collection" => apply_collection_match(qb, op_kind, &value, has_value),
        "saved_search" => apply_saved_search_match(qb, op_kind, &value, saved_searches),
        _ => apply_text_column(qb, "e.title", op_kind, pattern, has_value),
    }
}

fn apply_text_column(
    qb: &mut QueryBuilder<Sqlite>,
    column: &'static str,
    op_kind: &str,
    pattern: String,
    has_value: bool,
) {
    match op_kind {
        "eq" => {
            qb.push(column);
            qb.push(" = ");
            qb.push_bind(pattern);
        }
        "neq" => {
            qb.push(column);
            qb.push(" != ");
            qb.push_bind(pattern);
        }
        "not_like" => {
            qb.push(column);
            qb.push(" NOT LIKE ");
            qb.push_bind(pattern);
        }
        "empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') = ''");
        }
        "not_empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') != ''");
        }
        "before" | "after" => {
            if has_value {
                qb.push("DATE(");
                qb.push(column);
                qb.push(") ");
                qb.push(if op_kind == "before" { "<" } else { ">" });
                qb.push(" DATE(");
                qb.push_bind(pattern);
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        _ => {
            qb.push(column);
            qb.push(" LIKE ");
            qb.push_bind(pattern);
        }
    }
}

fn apply_field_match(
    qb: &mut QueryBuilder<Sqlite>,
    field_name: &'static str,
    op_kind: &str,
    pattern: String,
    has_value: bool,
) {
    match op_kind {
        "empty" => {
            qb.push("e.id NOT IN (SELECT entry_id FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE f.name = ");
            qb.push_bind(field_name);
            qb.push(" AND COALESCE(ef.value, '') != '')");
        }
        "not_empty" => {
            qb.push("e.id IN (SELECT entry_id FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE f.name = ");
            qb.push_bind(field_name);
            qb.push(" AND COALESCE(ef.value, '') != '')");
        }
        "eq" => {
            qb.push("e.id IN (SELECT entry_id FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE f.name = ");
            qb.push_bind(field_name);
            qb.push(" AND ef.value = ");
            qb.push_bind(pattern);
            qb.push(")");
        }
        "neq" => {
            qb.push("e.id NOT IN (SELECT entry_id FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE f.name = ");
            qb.push_bind(field_name);
            qb.push(" AND ef.value = ");
            qb.push_bind(pattern);
            qb.push(")");
        }
        "not_like" => {
            qb.push("e.id NOT IN (SELECT entry_id FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE f.name = ");
            qb.push_bind(field_name);
            qb.push(" AND ef.value LIKE ");
            qb.push_bind(pattern);
            qb.push(")");
        }
        "before" | "after" => {
            if has_value {
                qb.push("e.id IN (SELECT entry_id FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE f.name = ");
                qb.push_bind(field_name);
                qb.push(" AND DATE(ef.value) ");
                qb.push(if op_kind == "before" { "<" } else { ">" });
                qb.push(" DATE(");
                qb.push_bind(pattern);
                qb.push("))");
            } else {
                qb.push("1=1");
            }
        }
        _ => {
            qb.push("e.id IN (SELECT entry_id FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE f.name = ");
            qb.push_bind(field_name);
            qb.push(" AND ef.value LIKE ");
            qb.push_bind(pattern);
            qb.push(")");
        }
    }
}

fn apply_tag_match(
    qb: &mut QueryBuilder<Sqlite>,
    op_kind: &str,
    pattern: String,
    has_value: bool,
) {
    match op_kind {
        "empty" => {
            qb.push("e.id NOT IN (SELECT entry_id FROM entry_tags)");
        }
        "not_empty" => {
            qb.push("e.id IN (SELECT entry_id FROM entry_tags)");
        }
        "eq" => {
            qb.push("e.id IN (SELECT entry_id FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE t.name = ");
            qb.push_bind(pattern);
            qb.push(")");
        }
        "neq" => {
            qb.push("e.id NOT IN (SELECT entry_id FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE t.name = ");
            qb.push_bind(pattern);
            qb.push(")");
        }
        "not_like" => {
            qb.push("e.id NOT IN (SELECT entry_id FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE t.name LIKE ");
            qb.push_bind(pattern);
            qb.push(")");
        }
        "before" | "after" => {
            if has_value {
                qb.push("e.id IN (SELECT entry_id FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE DATE(t.name) ");
                qb.push(if op_kind == "before" { "<" } else { ">" });
                qb.push(" DATE(");
                qb.push_bind(pattern);
                qb.push("))");
            } else {
                qb.push("1=1");
            }
        }
        _ => {
            qb.push("e.id IN (SELECT entry_id FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE t.name LIKE ");
            qb.push_bind(pattern);
            qb.push(")");
        }
    }
}

fn apply_date_column(
    qb: &mut QueryBuilder<Sqlite>,
    column: &'static str,
    op_kind: &str,
    pattern: String,
    has_value: bool,
) {
    match op_kind {
        "before" | "after" => {
            if has_value {
                qb.push("DATE(");
                qb.push(column);
                qb.push(") ");
                qb.push(if op_kind == "before" { "<" } else { ">" });
                qb.push(" DATE(");
                qb.push_bind(pattern);
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        _ => apply_text_column(qb, column, op_kind, pattern, has_value),
    }
}

fn apply_collection_match(
    qb: &mut QueryBuilder<Sqlite>,
    op_kind: &str,
    raw_value: &str,
    has_value: bool,
) {
    if !has_value {
        qb.push("1=1");
        return;
    }
    let id: Option<i64> = raw_value.parse().ok();
    match op_kind {
        "eq" => {
            if let Some(collection_id) = id {
                qb.push("e.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=0");
            }
        }
        "neq" => {
            if let Some(collection_id) = id {
                qb.push("e.id NOT IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        _ => {
            if let Some(collection_id) = id {
                qb.push("e.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=0");
            }
        }
    }
}

/// Match entries against a saved search (Smart Filter)
fn apply_saved_search_match(
    qb: &mut QueryBuilder<Sqlite>,
    op_kind: &str,
    raw_value: &str,
    saved_searches: &[SavedSearch],
) {
    let search_id: Option<i64> = raw_value.parse().ok();

    let Some(id) = search_id else {
        qb.push("1=0");
        return;
    };

    let Some(saved_search) = saved_searches.iter().find(|s| s.id == id) else {
        qb.push("1=0");
        return;
    };

    if saved_search.criteria.is_empty() {
        // Empty criteria - if "is" match nothing, if "is_not" match everything
        if op_kind == "neq" {
            qb.push("1=1");
        } else {
            qb.push("1=0");
        }
        return;
    }

    let in_or_not = if op_kind == "neq" { "NOT IN" } else { "IN" };

    qb.push("e.id ");
    qb.push(in_or_not);
    qb.push(" (SELECT e2.id FROM entries e2 JOIN item_types it2 ON e2.item_type_id = it2.id WHERE e2.is_deleted = 0 AND (");

    let joiner = if saved_search.match_mode == "any" { " OR " } else { " AND " };

    let mut first = true;
    for criterion in &saved_search.criteria {
        if !first {
            qb.push(joiner);
        }
        first = false;
        apply_subquery_criterion(qb, criterion, saved_searches, id);
    }

    qb.push(")");

    // Handle collection scope
    if saved_search.scope == "collection" {
        if let Some(coll_id) = saved_search.collection_id {
            qb.push(" AND e2.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
            qb.push_bind(coll_id);
            qb.push(")");
        }
    }

    qb.push(")");
}

/// Apply a criterion within a saved search subquery (uses e2/it2 aliases)
fn apply_subquery_criterion(
    qb: &mut QueryBuilder<Sqlite>,
    criterion: &SavedSearchCriterion,
    saved_searches: &[SavedSearch],
    exclude_search_id: i64,
) {
    let field = criterion.field.as_str();
    let operator = criterion.operator.as_str();
    let value = criterion.value.clone().unwrap_or_default();
    let has_value = !value.is_empty();

    let (op_kind, pattern) = match operator {
        "contains" => ("like", format!("%{}%", value)),
        "does_not_contain" => ("not_like", format!("%{}%", value)),
        "is" => ("eq", value.clone()),
        "is_not" => ("neq", value.clone()),
        "begins_with" => ("like", format!("{}%", value)),
        "ends_with" => ("like", format!("%{}", value)),
        "is_before" => ("before", value.clone()),
        "is_after" => ("after", value.clone()),
        "is_empty" => ("empty", value.clone()),
        "is_not_empty" => ("not_empty", value.clone()),
        _ => ("like", format!("%{}%", value)),
    };

    match field {
        "title" => apply_subquery_text(qb, "e2.title", op_kind, &pattern, has_value),
        "creator" => apply_subquery_text(qb, "COALESCE(e2.creators_sort, '')", op_kind, &pattern, has_value),
        "year" => apply_subquery_text(qb, "SUBSTR(COALESCE(e2.date, ''), 1, 4)", op_kind, &pattern, has_value),
        "publication_title" => apply_subquery_field(qb, "publicationTitle", op_kind, &pattern, has_value),
        "abstract" => apply_subquery_field(qb, "abstractNote", op_kind, &pattern, has_value),
        "tags" => apply_subquery_tag(qb, op_kind, &pattern, has_value),
        "item_type" => apply_subquery_text(qb, "it2.display_name", op_kind, &pattern, has_value),
        "date_added" => apply_subquery_date(qb, "e2.date_added", op_kind, &pattern, has_value),
        "collection" => apply_subquery_collection(qb, op_kind, &value, has_value),
        "saved_search" => {
            // Prevent infinite self-reference
            if let Ok(ref_id) = value.parse::<i64>() {
                if ref_id == exclude_search_id {
                    qb.push("1=0");
                    return;
                }
                // Find and apply the referenced saved search (one level of nesting)
                if let Some(ref_search) = saved_searches.iter().find(|s| s.id == ref_id) {
                    apply_nested_saved_search(qb, op_kind, ref_search, saved_searches, exclude_search_id);
                    return;
                }
            }
            qb.push("1=0");
        }
        _ => apply_subquery_text(qb, "e2.title", op_kind, &pattern, has_value),
    }
}

/// Apply a nested saved search reference (uses e3/it3 aliases to avoid conflicts)
fn apply_nested_saved_search(
    qb: &mut QueryBuilder<Sqlite>,
    op_kind: &str,
    saved_search: &SavedSearch,
    saved_searches: &[SavedSearch],
    exclude_search_id: i64,
) {
    if saved_search.criteria.is_empty() {
        if op_kind == "neq" {
            qb.push("1=1");
        } else {
            qb.push("1=0");
        }
        return;
    }

    let in_or_not = if op_kind == "neq" { "NOT IN" } else { "IN" };

    qb.push("e2.id ");
    qb.push(in_or_not);
    qb.push(" (SELECT e3.id FROM entries e3 JOIN item_types it3 ON e3.item_type_id = it3.id WHERE e3.is_deleted = 0 AND (");

    let joiner = if saved_search.match_mode == "any" { " OR " } else { " AND " };

    let mut first = true;
    for criterion in &saved_search.criteria {
        if !first {
            qb.push(joiner);
        }
        first = false;
        // Use e3/it3 for nested level - simplified handling (no deeper recursion)
        apply_nested_criterion(qb, criterion, saved_searches, exclude_search_id, saved_search.id);
    }

    qb.push(")");

    if saved_search.scope == "collection" {
        if let Some(coll_id) = saved_search.collection_id {
            qb.push(" AND e3.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
            qb.push_bind(coll_id);
            qb.push(")");
        }
    }

    qb.push(")");
}

/// Apply criterion at nested level (e3/it3 aliases, no further saved_search recursion)
fn apply_nested_criterion(
    qb: &mut QueryBuilder<Sqlite>,
    criterion: &SavedSearchCriterion,
    _saved_searches: &[SavedSearch],
    exclude_search_id: i64,
    current_search_id: i64,
) {
    let field = criterion.field.as_str();
    let operator = criterion.operator.as_str();
    let value = criterion.value.clone().unwrap_or_default();
    let has_value = !value.is_empty();

    let (op_kind, pattern) = match operator {
        "contains" => ("like", format!("%{}%", value)),
        "does_not_contain" => ("not_like", format!("%{}%", value)),
        "is" => ("eq", value.clone()),
        "is_not" => ("neq", value.clone()),
        "begins_with" => ("like", format!("{}%", value)),
        "ends_with" => ("like", format!("%{}", value)),
        "is_before" => ("before", value.clone()),
        "is_after" => ("after", value.clone()),
        "is_empty" => ("empty", value.clone()),
        "is_not_empty" => ("not_empty", value.clone()),
        _ => ("like", format!("%{}%", value)),
    };

    match field {
        "title" => apply_nested_text(qb, "e3.title", op_kind, &pattern, has_value),
        "creator" => apply_nested_text(qb, "COALESCE(e3.creators_sort, '')", op_kind, &pattern, has_value),
        "year" => apply_nested_text(qb, "SUBSTR(COALESCE(e3.date, ''), 1, 4)", op_kind, &pattern, has_value),
        "publication_title" => apply_nested_field(qb, "publicationTitle", op_kind, &pattern, has_value),
        "abstract" => apply_nested_field(qb, "abstractNote", op_kind, &pattern, has_value),
        "tags" => apply_nested_tag(qb, op_kind, &pattern, has_value),
        "item_type" => apply_nested_text(qb, "it3.display_name", op_kind, &pattern, has_value),
        "date_added" => apply_nested_date(qb, "e3.date_added", op_kind, &pattern, has_value),
        "collection" => apply_nested_collection(qb, op_kind, &value, has_value),
        "saved_search" => {
            // Prevent deeper recursion - no saved_search references at this level
            if let Ok(ref_id) = value.parse::<i64>() {
                if ref_id == exclude_search_id || ref_id == current_search_id {
                    qb.push("1=0");
                    return;
                }
            }
            // Don't allow deeper nesting - would be too complex
            qb.push("1=0");
        }
        _ => apply_nested_text(qb, "e3.title", op_kind, &pattern, has_value),
    }
}

// =====================================================
// SUBQUERY HELPERS (e2 alias)
// =====================================================

fn apply_subquery_text(qb: &mut QueryBuilder<Sqlite>, column: &str, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "eq" => {
            qb.push(column);
            qb.push(" = ");
            qb.push_bind(pattern.to_string());
        }
        "neq" => {
            qb.push(column);
            qb.push(" != ");
            qb.push_bind(pattern.to_string());
        }
        "not_like" => {
            qb.push(column);
            qb.push(" NOT LIKE ");
            qb.push_bind(pattern.to_string());
        }
        "empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') = ''");
        }
        "not_empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') != ''");
        }
        _ => {
            if has_value {
                qb.push(column);
                qb.push(" LIKE ");
                qb.push_bind(pattern.to_string());
            } else {
                qb.push("1=1");
            }
        }
    }
}

fn apply_subquery_field(qb: &mut QueryBuilder<Sqlite>, field_name: &str, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "empty" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e2.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND COALESCE(ef.value, '') != '')");
        }
        "not_empty" => {
            qb.push("EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e2.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND COALESCE(ef.value, '') != '')");
        }
        "not_like" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e2.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND ef.value LIKE ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "eq" => {
            qb.push("EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e2.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND ef.value = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "neq" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e2.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND ef.value = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        _ => {
            if has_value {
                qb.push("EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e2.id AND f.name = ");
                qb.push_bind(field_name.to_string());
                qb.push(" AND ef.value LIKE ");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
    }
}

fn apply_subquery_tag(qb: &mut QueryBuilder<Sqlite>, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "empty" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_tags et WHERE et.entry_id = e2.id)");
        }
        "not_empty" => {
            qb.push("EXISTS(SELECT 1 FROM entry_tags et WHERE et.entry_id = e2.id)");
        }
        "not_like" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e2.id AND t.name LIKE ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "eq" => {
            qb.push("EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e2.id AND t.name = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "neq" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e2.id AND t.name = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        _ => {
            if has_value {
                qb.push("EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e2.id AND t.name LIKE ");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
    }
}

fn apply_subquery_date(qb: &mut QueryBuilder<Sqlite>, column: &str, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "before" => {
            if has_value {
                qb.push("DATE(");
                qb.push(column);
                qb.push(") < DATE(");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        "after" => {
            if has_value {
                qb.push("DATE(");
                qb.push(column);
                qb.push(") > DATE(");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        "empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') = ''");
        }
        "not_empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') != ''");
        }
        _ => apply_subquery_text(qb, column, op_kind, pattern, has_value),
    }
}

fn apply_subquery_collection(qb: &mut QueryBuilder<Sqlite>, op_kind: &str, raw_value: &str, has_value: bool) {
    if !has_value {
        qb.push("1=1");
        return;
    }
    let id: Option<i64> = raw_value.parse().ok();
    match op_kind {
        "eq" => {
            if let Some(collection_id) = id {
                qb.push("e2.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=0");
            }
        }
        "neq" => {
            if let Some(collection_id) = id {
                qb.push("e2.id NOT IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        _ => {
            if let Some(collection_id) = id {
                qb.push("e2.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=0");
            }
        }
    }
}

// =====================================================
// NESTED HELPERS (e3 alias)
// =====================================================

fn apply_nested_text(qb: &mut QueryBuilder<Sqlite>, column: &str, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "eq" => {
            qb.push(column);
            qb.push(" = ");
            qb.push_bind(pattern.to_string());
        }
        "neq" => {
            qb.push(column);
            qb.push(" != ");
            qb.push_bind(pattern.to_string());
        }
        "not_like" => {
            qb.push(column);
            qb.push(" NOT LIKE ");
            qb.push_bind(pattern.to_string());
        }
        "empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') = ''");
        }
        "not_empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') != ''");
        }
        _ => {
            if has_value {
                qb.push(column);
                qb.push(" LIKE ");
                qb.push_bind(pattern.to_string());
            } else {
                qb.push("1=1");
            }
        }
    }
}

fn apply_nested_field(qb: &mut QueryBuilder<Sqlite>, field_name: &str, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "empty" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e3.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND COALESCE(ef.value, '') != '')");
        }
        "not_empty" => {
            qb.push("EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e3.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND COALESCE(ef.value, '') != '')");
        }
        "not_like" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e3.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND ef.value LIKE ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "eq" => {
            qb.push("EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e3.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND ef.value = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "neq" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e3.id AND f.name = ");
            qb.push_bind(field_name.to_string());
            qb.push(" AND ef.value = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        _ => {
            if has_value {
                qb.push("EXISTS(SELECT 1 FROM entry_fields ef JOIN fields f ON ef.field_id = f.id WHERE ef.entry_id = e3.id AND f.name = ");
                qb.push_bind(field_name.to_string());
                qb.push(" AND ef.value LIKE ");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
    }
}

fn apply_nested_tag(qb: &mut QueryBuilder<Sqlite>, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "empty" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_tags et WHERE et.entry_id = e3.id)");
        }
        "not_empty" => {
            qb.push("EXISTS(SELECT 1 FROM entry_tags et WHERE et.entry_id = e3.id)");
        }
        "not_like" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e3.id AND t.name LIKE ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "eq" => {
            qb.push("EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e3.id AND t.name = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        "neq" => {
            qb.push("NOT EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e3.id AND t.name = ");
            qb.push_bind(pattern.to_string());
            qb.push(")");
        }
        _ => {
            if has_value {
                qb.push("EXISTS(SELECT 1 FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE et.entry_id = e3.id AND t.name LIKE ");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
    }
}

fn apply_nested_date(qb: &mut QueryBuilder<Sqlite>, column: &str, op_kind: &str, pattern: &str, has_value: bool) {
    match op_kind {
        "before" => {
            if has_value {
                qb.push("DATE(");
                qb.push(column);
                qb.push(") < DATE(");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        "after" => {
            if has_value {
                qb.push("DATE(");
                qb.push(column);
                qb.push(") > DATE(");
                qb.push_bind(pattern.to_string());
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        "empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') = ''");
        }
        "not_empty" => {
            qb.push("COALESCE(");
            qb.push(column);
            qb.push(", '') != ''");
        }
        _ => apply_nested_text(qb, column, op_kind, pattern, has_value),
    }
}

fn apply_nested_collection(qb: &mut QueryBuilder<Sqlite>, op_kind: &str, raw_value: &str, has_value: bool) {
    if !has_value {
        qb.push("1=1");
        return;
    }
    let id: Option<i64> = raw_value.parse().ok();
    match op_kind {
        "eq" => {
            if let Some(collection_id) = id {
                qb.push("e3.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=0");
            }
        }
        "neq" => {
            if let Some(collection_id) = id {
                qb.push("e3.id NOT IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=1");
            }
        }
        _ => {
            if let Some(collection_id) = id {
                qb.push("e3.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ");
                qb.push_bind(collection_id);
                qb.push(")");
            } else {
                qb.push("1=0");
            }
        }
    }
}

// =====================================================
// GET ENTRIES (List View)
// =====================================================

/// Get all entries with optional filtering
#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_entries(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
    tag_ids: Option<Vec<i64>>,
    tag_mode: Option<String>,
    attachment_type: Option<String>,
    search_query: Option<String>,
    search_scope: Option<String>,
    advanced_search: Option<AdvancedSearch>,
    filter_type: Option<String>,
    collectionId: Option<i64>,
    tagIds: Option<Vec<i64>>,
    tagMode: Option<String>,
    attachmentType: Option<String>,
    searchQuery: Option<String>,
    searchScope: Option<String>,
    advancedSearch: Option<AdvancedSearch>,
    filterType: Option<String>,
) -> Result<Vec<EntrySummary>, String> {
    let collection_id = collection_id.or(collectionId);
    let tag_ids = tag_ids.or(tagIds);
    let tag_mode = tag_mode.or(tagMode).unwrap_or_else(|| "or".to_string());
    let attachment_type = attachment_type.or(attachmentType);
    let search_query = search_query.or(searchQuery);
    let search_scope = search_scope.or(searchScope);
    let advanced_search = advanced_search.or(advancedSearch);
    let filter_type = filter_type.or(filterType);

    let mut effective_attachment_type = attachment_type;
    let filter_type_str = filter_type.as_deref();
    if effective_attachment_type.is_none() {
        if matches!(filter_type_str, Some("pdfs")) {
            effective_attachment_type = Some("pdf".to_string());
        } else if matches!(filter_type_str, Some("notes")) {
            effective_attachment_type = Some("note".to_string());
        }
    }

    // Load saved searches for Smart Filter support in advanced search
    let saved_searches = load_saved_searches(&state.db).await;

    let mut qb = QueryBuilder::<Sqlite>::new(
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.date_added, e.date_modified,
            (SELECT COUNT(*) FROM attachments WHERE entry_id = e.id) as attachment_count,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'pdf') as has_pdf,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'note') as has_note,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'weblink') as has_weblink,
            (SELECT a.thumbnail_path FROM attachments a
             JOIN attachment_types at ON a.attachment_type_id = at.id
             WHERE a.entry_id = e.id AND at.name = 'pdf'
             LIMIT 1) as thumbnail_path
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 0
        "#,
    );

    apply_entry_filters(
        &mut qb,
        collection_id,
        tag_ids.clone(),
        &tag_mode,
        effective_attachment_type.clone(),
        search_query.clone(),
        search_scope.as_deref(),
        advanced_search.as_ref(),
        filter_type_str,
        &saved_searches,
    );

    qb.push(" ORDER BY e.date_added DESC");

    let entries: Vec<EntrySummaryRow> = qb
        .build_query_as()
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Collect all entry IDs for batch queries
    let entry_ids: Vec<i64> = entries.iter().map(|e| e.id).collect();

    if entry_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Batch fetch all tags for all entries in ONE query
    let tags_map = batch_get_entry_tags(&state, &entry_ids).await?;

    // Batch fetch all creators for all entries in ONE query
    let creators_map = batch_get_entry_creators(&state, &entry_ids).await?;

    let mut result = Vec::new();
    for entry in entries {
        let tags = tags_map.get(&entry.id).cloned().unwrap_or_default();
        let creators = creators_map.get(&entry.id).cloned().unwrap_or_default();
        let creators_display = format_creators_display(&creators);
        let year = entry
            .date
            .as_ref()
            .map(|d| d.split('-').next().unwrap_or(d).to_string());

        result.push(EntrySummary {
            id: entry.id,
            key: entry.key,
            item_type: entry.item_type,
            item_type_display: entry.item_type_display,
            title: entry.title,
            creators_display,
            year,
            date_added: entry.date_added,
            date_modified: entry.date_modified,
            tags,
            attachment_count: entry.attachment_count,
            has_pdf: entry.has_pdf,
            has_note: entry.has_note,
            has_weblink: entry.has_weblink,
            thumbnail_path: entry.thumbnail_path,
        });
    }

    Ok(result)
}

/// Get entries with pagination (lazy loading)
#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_entries_paged(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
    tag_ids: Option<Vec<i64>>,
    tag_mode: Option<String>,
    attachment_type: Option<String>,
    search_query: Option<String>,
    search_scope: Option<String>,
    advanced_search: Option<AdvancedSearch>,
    filter_type: Option<String>,
    sort_field: Option<String>,
    sort_direction: Option<String>,
    secondary_sort_field: Option<String>,
    secondary_sort_direction: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    collectionId: Option<i64>,
    tagIds: Option<Vec<i64>>,
    tagMode: Option<String>,
    attachmentType: Option<String>,
    searchQuery: Option<String>,
    searchScope: Option<String>,
    advancedSearch: Option<AdvancedSearch>,
    filterType: Option<String>,
    sortField: Option<String>,
    sortDirection: Option<String>,
    secondarySortField: Option<String>,
    secondarySortDirection: Option<String>,
    limitValue: Option<i64>,
    offsetValue: Option<i64>,
) -> Result<EntriesPage, String> {
    let collection_id = collection_id.or(collectionId);
    let tag_ids = tag_ids.or(tagIds);
    let tag_mode = tag_mode.or(tagMode).unwrap_or_else(|| "or".to_string());
    let attachment_type = attachment_type.or(attachmentType);
    let search_query = search_query.or(searchQuery);
    let search_scope = search_scope.or(searchScope);
    let advanced_search = advanced_search.or(advancedSearch);
    let filter_type = filter_type.or(filterType);
    let sort_field = sort_field.or(sortField).unwrap_or_else(|| "dateAdded".to_string());
    let sort_direction = sort_direction.or(sortDirection).unwrap_or_else(|| "desc".to_string());
    let secondary_sort_field = secondary_sort_field.or(secondarySortField);
    let secondary_sort_direction = secondary_sort_direction.or(secondarySortDirection).unwrap_or_else(|| "asc".to_string());
    let limit = limit.or(limitValue).unwrap_or(20);
    let offset = offset.or(offsetValue).unwrap_or(0);

    let mut effective_attachment_type = attachment_type;
    let filter_type_str = filter_type.as_deref();
    if effective_attachment_type.is_none() {
        if matches!(filter_type_str, Some("pdfs")) {
            effective_attachment_type = Some("pdf".to_string());
        } else if matches!(filter_type_str, Some("notes")) {
            effective_attachment_type = Some("note".to_string());
        }
    }

    // Load saved searches for Smart Filter support in advanced search
    let saved_searches = load_saved_searches(&state.db).await;

    let mut count_qb = QueryBuilder::<Sqlite>::new(
        "SELECT COUNT(*) FROM entries e JOIN item_types it ON e.item_type_id = it.id WHERE e.is_deleted = 0",
    );
    apply_entry_filters(
        &mut count_qb,
        collection_id,
        tag_ids.clone(),
        &tag_mode,
        effective_attachment_type.clone(),
        search_query.clone(),
        search_scope.as_deref(),
        advanced_search.as_ref(),
        filter_type_str,
        &saved_searches,
    );

    let total: i64 = count_qb
        .build_query_scalar()
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let mut qb = QueryBuilder::<Sqlite>::new(
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.date_added, e.date_modified,
            (SELECT COUNT(*) FROM attachments WHERE entry_id = e.id) as attachment_count,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'pdf') as has_pdf,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'note') as has_note,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'weblink') as has_weblink,
            (SELECT a.thumbnail_path FROM attachments a
             JOIN attachment_types at ON a.attachment_type_id = at.id
             WHERE a.entry_id = e.id AND at.name = 'pdf'
             LIMIT 1) as thumbnail_path
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 0
        "#,
    );

    apply_entry_filters(
        &mut qb,
        collection_id,
        tag_ids.clone(),
        &tag_mode,
        effective_attachment_type.clone(),
        search_query.clone(),
        search_scope.as_deref(),
        advanced_search.as_ref(),
        filter_type_str,
        &saved_searches,
    );

    let sort_dir = if sort_direction.to_lowercase() == "asc" { "ASC" } else { "DESC" };
    let secondary_dir = if secondary_sort_direction.to_lowercase() == "desc" { "DESC" } else { "ASC" };

    let primary_sort = match sort_field.as_str() {
        "title" => "LOWER(e.title)",
        "creator" => "LOWER(COALESCE(e.creators_sort, ''))",
        "year" => "SUBSTR(COALESCE(e.date, ''), 1, 4)",
        "dateModified" => "e.date_modified",
        "itemType" => "it.display_name",
        "dateAdded" | _ => "e.date_added",
    };

    qb.push(" ORDER BY ");
    qb.push(primary_sort);
    qb.push(" ");
    qb.push(sort_dir);

    if let Some(secondary) = secondary_sort_field {
        let secondary_sort = match secondary.as_str() {
            "title" => "LOWER(e.title)",
            "creator" => "LOWER(COALESCE(e.creators_sort, ''))",
            "year" => "SUBSTR(COALESCE(e.date, ''), 1, 4)",
            "dateModified" => "e.date_modified",
            "itemType" => "it.display_name",
            "dateAdded" | _ => "e.date_added",
        };
        qb.push(", ");
        qb.push(secondary_sort);
        qb.push(" ");
        qb.push(secondary_dir);
    }

    qb.push(" LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);

    let entries: Vec<EntrySummaryRow> = qb
        .build_query_as()
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let entry_ids: Vec<i64> = entries.iter().map(|e| e.id).collect();

    if entry_ids.is_empty() {
        return Ok(EntriesPage { entries: Vec::new(), total });
    }

    let tags_map = batch_get_entry_tags(&state, &entry_ids).await?;
    let creators_map = batch_get_entry_creators(&state, &entry_ids).await?;

    let mut result = Vec::new();
    for entry in entries {
        let tags = tags_map.get(&entry.id).cloned().unwrap_or_default();
        let creators = creators_map.get(&entry.id).cloned().unwrap_or_default();
        let creators_display = format_creators_display(&creators);
        let year = entry
            .date
            .as_ref()
            .map(|d| d.split('-').next().unwrap_or(d).to_string());

        result.push(EntrySummary {
            id: entry.id,
            key: entry.key,
            item_type: entry.item_type,
            item_type_display: entry.item_type_display,
            title: entry.title,
            creators_display,
            year,
            date_added: entry.date_added,
            date_modified: entry.date_modified,
            tags,
            attachment_count: entry.attachment_count,
            has_pdf: entry.has_pdf,
            has_note: entry.has_note,
            has_weblink: entry.has_weblink,
            thumbnail_path: entry.thumbnail_path,
        });
    }

    Ok(EntriesPage { entries: result, total })
}

/// Get counts for top-level filters (All, PDFs, Notes, Recent, Untagged)
#[tauri::command]
pub async fn get_entry_counts(state: State<'_, AppState>) -> Result<EntryCounts, String> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM entries e WHERE e.is_deleted = 0"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let pdf: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM entries e
        WHERE e.is_deleted = 0
          AND EXISTS (
            SELECT 1 FROM attachments a
            JOIN attachment_types at ON a.attachment_type_id = at.id
            WHERE a.entry_id = e.id AND at.name = 'pdf'
          )
        "#
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let note: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM entries e
        WHERE e.is_deleted = 0
          AND EXISTS (
            SELECT 1 FROM attachments a
            JOIN attachment_types at ON a.attachment_type_id = at.id
            WHERE a.entry_id = e.id AND at.name = 'note'
          )
        "#
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM entries e WHERE e.is_deleted = 0 AND e.date_added >= datetime('now', '-7 days')"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let untagged: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM entries e WHERE e.is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id)"
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(EntryCounts { total, pdf, note, recent, untagged })
}

// =====================================================
// GET ENTRY (Full Detail with EAV fields)
// =====================================================

/// Get a single entry with full details including dynamic fields
#[tauri::command]
pub async fn get_entry(
    state: State<'_, AppState>,
    id: i64,
    include_deleted: Option<bool>,
) -> Result<Entry, String> {
    tracing::info!("get_entry called with id: {}", id);

    // Build query based on whether to include deleted entries
    let query = if include_deleted.unwrap_or(false) {
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.url, e.access_date, e.date_added, e.date_modified
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ?
        "#
    } else {
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.url, e.access_date, e.date_added, e.date_modified
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ? AND e.is_deleted = 0
        "#
    };

    // Get core entry data
    let entry: EntryRow = sqlx::query_as::<_, EntryRow>(query)
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found".to_string())?;

    // Get dynamic fields from EAV table
    let fields = get_entry_fields(&state, id).await?;

    // Get creators
    let creators = get_entry_creators(&state, id).await?;

    // Get tags, collections, attachments
    let tags = get_entry_tags(&state, id).await?;
    let collections = get_entry_collections(&state, id).await?;
    let attachments = get_entry_attachments_internal(&state, id).await?;

    tracing::info!(
        "Found {} fields, {} creators, {} attachments for entry {}",
        fields.len(),
        creators.len(),
        attachments.len(),
        id
    );

    Ok(Entry {
        id: entry.id,
        key: entry.key,
        item_type: entry.item_type,
        item_type_display: entry.item_type_display,
        title: entry.title,
        date: entry.date,
        url: entry.url,
        access_date: entry.access_date,
        creators,
        fields,
        date_added: entry.date_added,
        date_modified: entry.date_modified,
        tags,
        collections,
        attachments,
    })
}

// =====================================================
// CREATE ENTRY
// =====================================================

/// Create a new entry with dynamic fields
#[tauri::command]
pub async fn create_entry(
    state: State<'_, AppState>,
    input: CreateEntryInput,
) -> Result<Entry, String> {
    let key = Uuid::new_v4().to_string();

    // Start transaction for atomic operation
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // Get item type ID
    let item_type_id: i64 = sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
        .bind(&input.item_type)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Invalid item type: {}", input.item_type))?;

    // Insert core entry
    let result = sqlx::query(
        r#"
        INSERT INTO entries (key, item_type_id, title, date, url)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id, date_added, date_modified
        "#,
    )
    .bind(&key)
    .bind(item_type_id)
    .bind(&input.title)
    .bind(&input.date)
    .bind(&input.url)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create entry: {}", e))?;

    let entry_id: i64 = result.get("id");

    // Insert dynamic fields
    if let Some(ref fields) = input.fields {
        insert_entry_fields_tx(&mut tx, entry_id, fields).await?;
    }

    // Insert creators
    if let Some(ref creators) = input.creators {
        insert_entry_creators_tx(&mut tx, entry_id, creators).await?;
    }

    // Commit transaction
    tx.commit().await.map_err(|e| e.to_string())?;

    if let Err(e) = refresh_entry_creators_sort(&state.db, entry_id).await {
        tracing::warn!("Failed to refresh creators_sort for entry {}: {}", entry_id, e);
    }
    if let Err(e) = refresh_entry_fts(&state.db, entry_id).await {
        tracing::warn!("Failed to refresh entries_fts for entry {}: {}", entry_id, e);
    }

    get_entry(state, entry_id, None).await
}

// =====================================================
// UPDATE ENTRY
// =====================================================

/// Update an entry with dynamic fields
#[tauri::command]
pub async fn update_entry(
    state: State<'_, AppState>,
    id: i64,
    input: UpdateEntryInput,
) -> Result<Entry, String> {
    // Start transaction for atomic operation
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // Build dynamic UPDATE query for core fields (single query instead of multiple)
    let mut set_clauses: Vec<String> = vec![];
    let mut needs_update = false;

    // Resolve item_type_id if changing
    let item_type_id: Option<i64> = if let Some(ref item_type) = input.item_type {
        let type_id: i64 = sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
            .bind(item_type)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Invalid item type: {}", item_type))?;
        set_clauses.push("item_type_id = ?".to_string());
        needs_update = true;
        Some(type_id)
    } else {
        None
    };

    if input.title.is_some() {
        set_clauses.push("title = ?".to_string());
        needs_update = true;
    }
    if input.date.is_some() {
        set_clauses.push("date = ?".to_string());
        needs_update = true;
    }
    if input.url.is_some() {
        set_clauses.push("url = ?".to_string());
        needs_update = true;
    }

    // Execute single UPDATE for core fields if any changed
    if needs_update {
        set_clauses.push("date_modified = datetime('now')".to_string());
        let query_str = format!("UPDATE entries SET {} WHERE id = ?", set_clauses.join(", "));

        let mut query = sqlx::query(&query_str);

        // Bind values in same order as set_clauses
        if let Some(type_id) = item_type_id {
            query = query.bind(type_id);
        }
        if let Some(ref title) = input.title {
            query = query.bind(title);
        }
        if let Some(ref date) = input.date {
            query = query.bind(date);
        }
        if let Some(ref url) = input.url {
            query = query.bind(url);
        }
        query = query.bind(id);

        query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }

    // Update dynamic fields (replace all)
    if let Some(ref fields) = input.fields {
        // Delete existing fields and insert new ones
        sqlx::query("DELETE FROM entry_fields WHERE entry_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        insert_entry_fields_tx(&mut tx, id, fields).await?;

        // Update modified timestamp if core fields weren't already updated
        if !needs_update {
            sqlx::query("UPDATE entries SET date_modified = datetime('now') WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Update creators (replace all)
    if let Some(ref creators) = input.creators {
        // Delete existing creators and insert new ones
        sqlx::query("DELETE FROM entry_creators WHERE entry_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        insert_entry_creators_tx(&mut tx, id, creators).await?;

        // Update modified timestamp if not already updated
        if !needs_update && input.fields.is_none() {
            sqlx::query("UPDATE entries SET date_modified = datetime('now') WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    // Commit transaction
    tx.commit().await.map_err(|e| e.to_string())?;

    if input.creators.is_some() {
        if let Err(e) = refresh_entry_creators_sort(&state.db, id).await {
            tracing::warn!("Failed to refresh creators_sort for entry {}: {}", id, e);
        }
    }
    if input.title.is_some() || input.fields.is_some() {
        if let Err(e) = refresh_entry_fts(&state.db, id).await {
            tracing::warn!("Failed to refresh entries_fts for entry {}: {}", id, e);
        }
    }

    // Sync attachment filenames if relevant fields changed and auto-rename is enabled
    // Run synchronously so the updated attachment data is included in the response
    let renamed_files = input.title.is_some() || input.date.is_some() || input.creators.is_some();
    if renamed_files {
        if let Err(e) = sync_entry_attachment_filenames(&state.db, &state.library_path, id).await {
            tracing::warn!("Failed to sync attachment filenames for entry {}: {}", id, e);
        }
    }

    get_entry(state, id, None).await
}

/// Sync attachment filenames with entry metadata (Zotero 8-style behavior)
async fn sync_entry_attachment_filenames(
    db: &sqlx::SqlitePool,
    library_path: &tokio::sync::RwLock<std::path::PathBuf>,
    entry_id: i64,
) -> Result<(), String> {
    use crate::filename;
    use crate::commands::settings::is_setting_enabled;

    // Check if auto-rename is enabled
    if !is_setting_enabled(db, "auto_rename_files").await {
        return Ok(());
    }

    // Get library path
    let lib_path = library_path.read().await;

    // Fetch entry metadata
    let entry_row = sqlx::query(
        "SELECT title, date FROM entries WHERE id = ?"
    )
    .bind(entry_id)
    .fetch_one(db)
    .await
    .map_err(|e| format!("Failed to fetch entry: {}", e))?;

    let entry_title: String = entry_row.get("title");
    let entry_date: Option<String> = entry_row.get("date");

    // Fetch creators
    let creator_rows = sqlx::query(
        r#"
        SELECT ec.first_name, ec.last_name, ec.name, ct.name as creator_type, ec.sort_order
        FROM entry_creators ec
        JOIN creator_types ct ON ec.creator_type_id = ct.id
        WHERE ec.entry_id = ?
        ORDER BY ec.sort_order
        "#
    )
    .bind(entry_id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch creators: {}", e))?;

    let creators: Vec<crate::db::models::Creator> = creator_rows
        .iter()
        .map(|row| crate::db::models::Creator {
            id: None,
            creator_type: row.get("creator_type"),
            creator_type_display: None,
            first_name: row.get("first_name"),
            last_name: row.get("last_name"),
            name: row.get("name"),
            sort_order: row.get("sort_order"),
        })
        .collect();

    // Extract year from date
    let year = entry_date
        .as_ref()
        .and_then(|d| filename::extract_year(d));

    // Fetch file attachments for this entry
    let attachments = sqlx::query(
        r#"
        SELECT a.id, a.file_path, a.markdown_path
        FROM attachments a
        WHERE a.entry_id = ? AND a.file_path IS NOT NULL
        "#
    )
    .bind(entry_id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch attachments: {}", e))?;

    for attachment_row in attachments {
        let attachment_id: i64 = attachment_row.get("id");
        let file_path_str: String = attachment_row.get("file_path");
        let mut file_path = std::path::PathBuf::from(&file_path_str);

        // Only rename files inside the library directory
        if !filename::is_in_library(&file_path, &lib_path) {
            tracing::debug!("Skipping file outside library: {}", file_path_str);
            continue;
        }

        // If file doesn't exist at expected path, try to find it in the same directory
        if !file_path.exists() {
            if let Some(dir) = file_path.parent() {
                let expected_ext = file_path
                    .extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase());
                // Try to find a matching file in the same directory
                if let Ok(entries) = std::fs::read_dir(dir) {
                    let candidates: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| {
                            if let Some(ref ext) = expected_ext {
                                e.path().extension()
                                    .map(|entry_ext| entry_ext.to_string_lossy().to_lowercase() == *ext)
                                    .unwrap_or(false)
                            } else {
                                true
                            }
                        })
                        .collect();

                    if candidates.len() == 1 {
                        // Found exactly one candidate - use it and update DB
                        let found_path = candidates[0].path();
                        tracing::info!(
                            "File not found at {}, but found {} - updating DB",
                            file_path_str,
                            found_path.display()
                        );
                        file_path = found_path.clone();

                        // Update the database with the correct path
                        let correct_path_str = found_path.to_string_lossy().to_string();
                        let _ = sqlx::query(
                            "UPDATE attachments SET file_path = ?, date_modified = datetime('now') WHERE id = ?"
                        )
                        .bind(&correct_path_str)
                        .bind(attachment_id)
                        .execute(db)
                        .await;
                    } else {
                        tracing::warn!(
                            "Cannot sync filename for attachment {}: file not found at {} (found {} candidates in dir)",
                            attachment_id,
                            file_path_str,
                            candidates.len()
                        );
                        continue;
                    }
                } else {
                    tracing::warn!(
                        "Cannot sync filename for attachment {}: file not found at {}",
                        attachment_id,
                        file_path_str
                    );
                    continue;
                }
            } else {
                tracing::warn!(
                    "Cannot sync filename for attachment {}: file not found at {}",
                    attachment_id,
                    file_path_str
                );
                continue;
            }
        }

        // Get extension
        let extension = file_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "bin".to_string());

        // Generate new filename
        let generated = filename::generate_filename(
            &entry_title,
            &creators,
            year.as_deref(),
            &extension,
        );

        if generated.is_empty() {
            continue;
        }

        // Check if filename needs to change
        let current_filename = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if generated == current_filename {
            continue;
        }

        // Get the directory
        let dir = file_path.parent().unwrap_or(&file_path);

        // Resolve any conflicts
        let new_path = filename::resolve_conflict(dir, &generated);

        // Rename the file
        match std::fs::rename(&file_path, &new_path) {
            Ok(_) => {
                // Update database with new path
                let new_path_str = new_path.to_string_lossy().to_string();
                let new_title = new_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry_title.clone());

                // Also rename the companion markdown file if it exists (e.g. paper.pdf.md → new_name.pdf.md)
                let markdown_path_str: Option<String> = attachment_row.get("markdown_path");
                let mut new_markdown_rel: Option<String> = None;
                if let Some(ref md_rel) = markdown_path_str {
                    // markdown_path is stored relative to library
                    let old_md_abs = lib_path.join(md_rel);
                    if old_md_abs.exists() {
                        let new_md_abs = crate::search::extractor::markdown_path_for(&new_path);
                        if let Err(e) = std::fs::rename(&old_md_abs, &new_md_abs) {
                            tracing::warn!("Failed to rename markdown file: {}", e);
                        } else {
                            new_markdown_rel = new_md_abs
                                .strip_prefix(&*lib_path)
                                .ok()
                                .map(|p| p.to_string_lossy().to_string());
                            tracing::info!(
                                "Renamed markdown file: {} -> {}",
                                old_md_abs.display(),
                                new_md_abs.display()
                            );
                        }
                    }
                }

                let _ = sqlx::query(
                    "UPDATE attachments SET file_path = ?, title = ?, markdown_path = COALESCE(?, markdown_path), date_modified = datetime('now') WHERE id = ?"
                )
                .bind(&new_path_str)
                .bind(&new_title)
                .bind(&new_markdown_rel)
                .bind(attachment_id)
                .execute(db)
                .await;

                tracing::info!(
                    "Synced attachment filename: {} -> {}",
                    current_filename,
                    new_path.file_name().unwrap_or_default().to_string_lossy()
                );
            }
            Err(e) => {
                tracing::warn!("Failed to rename attachment file: {}", e);
            }
        }
    }

    Ok(())
}

// =====================================================
// DELETE / TRASH OPERATIONS
// =====================================================

/// Delete an entry (soft delete)
#[tauri::command]
pub async fn delete_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("UPDATE entries SET is_deleted = 1, date_modified = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Remove from search index
    if let Err(e) = state.search_index.delete_entry(id).await {
        tracing::warn!("Failed to delete entry from search index: {}", e);
    }
    if let Err(e) = state.search_index.commit().await {
        tracing::warn!("Failed to commit search index: {}", e);
    }

    Ok(())
}

/// Get trashed entries
#[tauri::command]
pub async fn get_trashed_entries(state: State<'_, AppState>) -> Result<Vec<EntrySummary>, String> {
    let entries: Vec<EntrySummaryRow> = sqlx::query_as::<_, EntrySummaryRow>(
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.date_added, e.date_modified,
            (SELECT COUNT(*) FROM attachments WHERE entry_id = e.id) as attachment_count,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'pdf') as has_pdf,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'note') as has_note,
            EXISTS(SELECT 1 FROM attachments a
                   JOIN attachment_types at ON a.attachment_type_id = at.id
                   WHERE a.entry_id = e.id AND at.name = 'weblink') as has_weblink,
            (SELECT a.thumbnail_path FROM attachments a
             JOIN attachment_types at ON a.attachment_type_id = at.id
             WHERE a.entry_id = e.id AND at.name = 'pdf'
             LIMIT 1) as thumbnail_path
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.is_deleted = 1
        ORDER BY e.date_modified DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Collect all entry IDs for batch queries
    let entry_ids: Vec<i64> = entries.iter().map(|e| e.id).collect();

    if entry_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Batch fetch all tags and creators
    let tags_map = batch_get_entry_tags(&state, &entry_ids).await?;
    let creators_map = batch_get_entry_creators(&state, &entry_ids).await?;

    let mut result = Vec::new();
    for entry in entries {
        let tags = tags_map.get(&entry.id).cloned().unwrap_or_default();
        let creators = creators_map.get(&entry.id).cloned().unwrap_or_default();
        let creators_display = format_creators_display(&creators);
        let year = entry
            .date
            .as_ref()
            .map(|d| d.split('-').next().unwrap_or(d).to_string());

        result.push(EntrySummary {
            id: entry.id,
            key: entry.key,
            item_type: entry.item_type,
            item_type_display: entry.item_type_display,
            title: entry.title,
            creators_display,
            year,
            date_added: entry.date_added,
            date_modified: entry.date_modified,
            tags,
            attachment_count: entry.attachment_count,
            has_pdf: entry.has_pdf,
            has_note: entry.has_note,
            has_weblink: entry.has_weblink,
            thumbnail_path: entry.thumbnail_path,
        });
    }

    Ok(result)
}

/// Get trash count
#[tauri::command]
pub async fn get_trash_count(state: State<'_, AppState>) -> Result<i64, String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM entries WHERE is_deleted = 1")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(count)
}

/// Restore an entry from trash
#[tauri::command]
pub async fn restore_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("UPDATE entries SET is_deleted = 0, date_modified = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Re-index entry metadata
    #[derive(FromRow)]
    struct EntryRow {
        key: String,
        title: Option<String>,
        item_type: String,
        creators_sort: Option<String>,
    }

    if let Ok(entry_row) = sqlx::query_as::<_, EntryRow>(
        r#"
        SELECT e.key, e.title, it.name as item_type,
               e.creators_sort
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ?
        "#
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    {
        // Get abstract
        let abstract_text: Option<String> = sqlx::query_scalar(
            r#"
            SELECT ef.value FROM entry_fields ef
            JOIN fields f ON ef.field_id = f.id
            WHERE ef.entry_id = ? AND f.name = 'abstractNote'
            "#
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let entry_metadata = EntryMetadata {
            entry_id: id,
            entry_key: entry_row.key.clone(),
            title: entry_row.title,
            creators: entry_row.creators_sort,
            abstract_text,
            item_type: entry_row.item_type,
        };

        if let Err(e) = state.search_index.index_entry_metadata(&entry_metadata).await {
            tracing::warn!("Failed to re-index entry metadata: {}", e);
        }

        // Re-index attachments
        #[derive(FromRow)]
        struct AttachmentRow {
            id: i64,
            title: Option<String>,
            file_path: Option<String>,
            attachment_type: String,
        }

        let attachments: Vec<AttachmentRow> = sqlx::query_as(
            r#"
            SELECT a.id, a.title, a.file_path, at.name as attachment_type
            FROM attachments a
            JOIN attachment_types at ON a.attachment_type_id = at.id
            WHERE a.entry_id = ?
            "#
        )
        .bind(id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let config = ExtractionConfig {
            enable_ocr: crate::commands::settings::get_setting_value(&state.db, "enable_ocr")
                .await
                .map(|v| v == "true")
                .unwrap_or(true),
            force_ocr: crate::commands::settings::is_setting_enabled(&state.db, "force_ocr").await,
        };
        for att in attachments {
            if let Some(file_path) = att.file_path {
                let attachment_data = AttachmentData {
                    entry_id: id,
                    entry_key: entry_row.key.clone(),
                    attachment_id: att.id,
                    title: att.title,
                    file_path,
                    content_source: att.attachment_type,
                };

                if let Err(e) = state.search_index.index_attachment_content(&attachment_data, &config).await {
                    tracing::warn!("Failed to re-index attachment: {}", e);
                }
            }
        }

        if let Err(e) = state.search_index.commit().await {
            tracing::warn!("Failed to commit search index: {}", e);
        }
    }

    Ok(())
}

/// Permanently delete entry (removes from DB AND files from disk)
#[tauri::command]
pub async fn permanent_delete_entry(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    use std::fs;

    // Get entry key for folder path
    let entry_key: Option<String> = sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let entry_key = entry_key.ok_or("Entry not found")?;

    // Get all attachment file paths before deletion
    let file_paths: Vec<Option<String>> =
        sqlx::query_scalar("SELECT file_path FROM attachments WHERE entry_id = ?")
            .bind(id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    // Delete entry from DB (CASCADE will delete fields, creators, attachments, etc.)
    sqlx::query("DELETE FROM entries WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Delete individual files from disk
    for path in file_paths.into_iter().flatten() {
        if let Err(e) = fs::remove_file(&path) {
            tracing::warn!("Failed to delete file {}: {}", path, e);
        }
    }

    // Delete entry folder
    let library_path = state.library_path.read().await;
    let entry_folder = library_path.join("files").join(&entry_key);
    if entry_folder.exists() {
        if let Err(e) = fs::remove_dir_all(&entry_folder) {
            tracing::warn!("Failed to delete folder {:?}: {}", entry_folder, e);
        }
    }

    Ok(())
}

/// Empty trash - permanently delete all trashed entries
#[tauri::command]
pub async fn empty_trash(state: State<'_, AppState>) -> Result<i64, String> {
    use std::fs;

    // Get all trashed entry IDs and keys
    let trashed: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, key FROM entries WHERE is_deleted = 1")
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let count = trashed.len() as i64;

    for (id, entry_key) in trashed {
        // Get file paths for this entry
        let file_paths: Vec<Option<String>> =
            sqlx::query_scalar("SELECT file_path FROM attachments WHERE entry_id = ?")
                .bind(id)
                .fetch_all(&state.db)
                .await
                .map_err(|e| e.to_string())?;

        // Delete entry from DB
        sqlx::query("DELETE FROM entries WHERE id = ?")
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;

        // Delete files
        for path in file_paths.into_iter().flatten() {
            if let Err(e) = fs::remove_file(&path) {
                tracing::warn!("Failed to delete file {}: {}", path, e);
            }
        }

        // Delete entry folder
        let library_path = state.library_path.read().await;
        let entry_folder = library_path.join("files").join(&entry_key);
        if entry_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&entry_folder) {
                tracing::warn!("Failed to delete folder {:?}: {}", entry_folder, e);
            }
        }
    }

    Ok(count)
}

// =====================================================
// ATTACHMENT OPERATIONS
// =====================================================

/// Get attachments for an entry
#[tauri::command]
pub async fn get_entry_attachments(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<Attachment>, String> {
    get_entry_attachments_internal(&state, entry_id).await
}

async fn get_entry_attachments_internal(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<Attachment>, String> {
    let attachments: Vec<AttachmentRow> = sqlx::query_as::<_, AttachmentRow>(
        r#"
        SELECT
            a.id, a.key, a.entry_id, at.name as attachment_type,
            at.display_name as attachment_type_display,
            a.title, a.file_path, a.file_hash, a.file_size, a.url,
            a.page_count, a.frontmatter, a.thumbnail_path, a.markdown_path,
            a.date_added, a.date_modified
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id = ?
        ORDER BY a.date_added ASC
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(attachments
        .into_iter()
        .map(|a| Attachment {
            id: a.id,
            key: a.key,
            entry_id: a.entry_id,
            attachment_type: a.attachment_type,
            attachment_type_display: a.attachment_type_display,
            title: a.title,
            file_path: a.file_path,
            file_hash: a.file_hash,
            file_size: a.file_size,
            url: a.url,
            page_count: a.page_count,
            frontmatter: a.frontmatter,
            thumbnail_path: a.thumbnail_path,
            markdown_path: a.markdown_path,
            date_added: a.date_added,
            date_modified: a.date_modified,
        })
        .collect())
}

/// Get a single attachment
#[tauri::command]
pub async fn get_attachment(state: State<'_, AppState>, id: i64) -> Result<Attachment, String> {
    let attachment: AttachmentRow = sqlx::query_as::<_, AttachmentRow>(
        r#"
        SELECT
            a.id, a.key, a.entry_id, at.name as attachment_type,
            at.display_name as attachment_type_display,
            a.title, a.file_path, a.file_hash, a.file_size, a.url,
            a.page_count, a.frontmatter, a.thumbnail_path, a.markdown_path,
            a.date_added, a.date_modified
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Attachment not found".to_string())?;

    Ok(Attachment {
        id: attachment.id,
        key: attachment.key,
        entry_id: attachment.entry_id,
        attachment_type: attachment.attachment_type,
        attachment_type_display: attachment.attachment_type_display,
        title: attachment.title,
        file_path: attachment.file_path,
        file_hash: attachment.file_hash,
        file_size: attachment.file_size,
        url: attachment.url,
        page_count: attachment.page_count,
        frontmatter: attachment.frontmatter,
        thumbnail_path: attachment.thumbnail_path,
        markdown_path: attachment.markdown_path,
        date_added: attachment.date_added,
        date_modified: attachment.date_modified,
    })
}

/// Repair attachment file paths for an entry by finding actual files in the directory
#[tauri::command]
pub async fn repair_entry_attachments(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<String>, String> {
    let library_path = state.library_path.read().await;
    let mut repaired = Vec::new();

    // Get entry key for folder path
    let entry_key: String = sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| format!("Entry not found: {}", e))?;

    // Get all attachments for this entry
    let attachments = sqlx::query(
        r#"
        SELECT a.id, a.file_path, at.name as attachment_type
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id = ? AND a.file_path IS NOT NULL
        "#
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("Failed to fetch attachments: {}", e))?;

    for attachment in attachments {
        let attachment_id: i64 = attachment.get("id");
        let file_path_str: String = attachment.get("file_path");
        let file_path = std::path::PathBuf::from(&file_path_str);

        // Skip if file exists
        if file_path.exists() {
            continue;
        }

        // Try to find the file in the expected directory
        let expected_dir = library_path.join("files").join(&entry_key);

        if expected_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&expected_dir) {
                let pdfs: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path().extension()
                            .map(|ext| ext.to_string_lossy().to_lowercase() == "pdf")
                            .unwrap_or(false)
                    })
                    .collect();

                if pdfs.len() == 1 {
                    let found_path = pdfs[0].path();
                    let correct_path_str = found_path.to_string_lossy().to_string();

                    // Update the title from the actual filename
                    let new_title = found_path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "PDF Attachment".to_string());

                    sqlx::query(
                        "UPDATE attachments SET file_path = ?, title = ?, date_modified = datetime('now') WHERE id = ?"
                    )
                    .bind(&correct_path_str)
                    .bind(&new_title)
                    .bind(attachment_id)
                    .execute(&state.db)
                    .await
                    .map_err(|e| format!("Failed to update attachment: {}", e))?;

                    repaired.push(format!(
                        "Repaired attachment {}: {} -> {}",
                        attachment_id,
                        file_path_str,
                        correct_path_str
                    ));
                }
            }
        }
    }

    Ok(repaired)
}

/// Create a new attachment for an entry
#[tauri::command]
pub async fn create_attachment(
    state: State<'_, AppState>,
    input: CreateAttachmentInput,
) -> Result<Attachment, String> {
    let key = Uuid::new_v4().to_string();

    // Get attachment type ID
    let attachment_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = ?")
            .bind(&input.attachment_type)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Invalid attachment type: {}", input.attachment_type))?;

    let result = sqlx::query(
        r#"
        INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, url)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(&key)
    .bind(input.entry_id)
    .bind(attachment_type_id)
    .bind(&input.title)
    .bind(&input.file_path)
    .bind(&input.url)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to create attachment: {}", e))?;

    let attachment_id: i64 = result.get("id");
    get_attachment(state, attachment_id).await
}

/// Delete an attachment (DB record + file from disk)
#[tauri::command]
pub async fn delete_attachment(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    use std::fs;

    // Get file path before deletion
    let file_path: Option<String> =
        sqlx::query_scalar("SELECT file_path FROM attachments WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    // Delete from DB
    sqlx::query("DELETE FROM attachments WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Delete file from disk if it exists
    if let Some(path) = file_path {
        if let Err(e) = fs::remove_file(&path) {
            tracing::warn!("Failed to delete attachment file {}: {}", path, e);
        }
    }

    Ok(())
}

/// Add a PDF file as attachment to an existing entry
#[tauri::command]
pub async fn add_pdf_attachment(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    entry_id: i64,
    file_path: String,
) -> Result<Attachment, String> {
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;
    use tauri::Emitter;
    use crate::filename;
    use crate::commands::settings::is_setting_enabled;
    use crate::search::extractor::ExtractionConfig;
    use crate::search::indexer::AttachmentData;
    use crate::commands::import::ImportDetailProgress;

    let source_path = PathBuf::from(&file_path);
    if !source_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Get entry key for folder structure
    let entry_key: String = sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| format!("Entry not found: {}", e))?;

    // Read file and calculate hash
    let file_content = fs::read(&source_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(&file_content);
    let file_hash = hex::encode(hasher.finalize());
    let file_size = file_content.len() as i64;

    // Create destination path
    let dest_dir = {
        let library_path = state.library_path.read().await;
        library_path.join("files").join(&entry_key)
    };

    fs::create_dir_all(&dest_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    // Get original filename
    let original_file_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.pdf", Uuid::new_v4()));

    // Check if auto-rename is enabled
    let auto_rename = is_setting_enabled(&state.db, "auto_rename_files").await;

    let final_file_name = if auto_rename {
        // Fetch entry metadata for renaming
        let entry_row = sqlx::query(
            "SELECT title, date FROM entries WHERE id = ?"
        )
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| format!("Failed to fetch entry: {}", e))?;

        let entry_title: String = entry_row.get("title");
        let entry_date: Option<String> = entry_row.get("date");

        // Fetch creators
        let creator_rows = sqlx::query(
            r#"
            SELECT ec.first_name, ec.last_name, ec.name, ct.name as creator_type, ec.sort_order
            FROM entry_creators ec
            JOIN creator_types ct ON ec.creator_type_id = ct.id
            WHERE ec.entry_id = ?
            ORDER BY ec.sort_order
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| format!("Failed to fetch creators: {}", e))?;

        let creators: Vec<crate::db::models::Creator> = creator_rows
            .iter()
            .map(|row| crate::db::models::Creator {
                id: None,
                creator_type: row.get("creator_type"),
                creator_type_display: None,
                first_name: row.get("first_name"),
                last_name: row.get("last_name"),
                name: row.get("name"),
                sort_order: row.get("sort_order"),
            })
            .collect();

        // Extract year from date
        let year = entry_date
            .as_ref()
            .and_then(|d| filename::extract_year(d));

        // Get file extension
        let extension = source_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "pdf".to_string());

        // Generate new filename
        let generated = filename::generate_filename(
            &entry_title,
            &creators,
            year.as_deref(),
            &extension,
        );

        if generated.is_empty() {
            original_file_name
        } else {
            generated
        }
    } else {
        original_file_name
    };

    // Resolve any filename conflicts
    let dest_path = filename::resolve_conflict(&dest_dir, &final_file_name);

    // Copy file to library
    fs::copy(&source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let dest_path_str = dest_path.to_string_lossy().to_string();

    // Get attachment type ID for pdf
    let attachment_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = 'pdf'")
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    // Get title from final filename (without extension)
    let title = dest_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "PDF Attachment".to_string());

    // Create attachment record
    let attachment_key = Uuid::new_v4().to_string();
    let result = sqlx::query(
        r#"
        INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, file_hash, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(&attachment_key)
    .bind(entry_id)
    .bind(attachment_type_id)
    .bind(&title)
    .bind(&dest_path_str)
    .bind(&file_hash)
    .bind(file_size)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to create attachment: {}", e))?;

    let attachment_id: i64 = result.get("id");
    tracing::info!(
        "Added PDF attachment {} to entry {} (filename: {})",
        attachment_id,
        entry_id,
        dest_path.file_name().unwrap_or_default().to_string_lossy()
    );

    // Index attachment content for full-text search
    let attachment_data = AttachmentData {
        entry_id,
        entry_key: entry_key.clone(),
        attachment_id,
        title: Some(title.clone()),
        file_path: dest_path_str.clone(),
        content_source: "pdf".to_string(),
    };

    // Read OCR settings from DB
    let config = ExtractionConfig {
        enable_ocr: crate::commands::settings::get_setting_value(&state.db, "enable_ocr")
            .await
            .map(|v| v == "true")
            .unwrap_or(true),
        force_ocr: is_setting_enabled(&state.db, "force_ocr").await,
    };

    // Get file name for progress reporting
    let file_name_for_progress = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Determine expected extraction method based on config
    let expected_method = if config.enable_ocr {
        "kreuzberg (OCR enabled)"
    } else {
        "kreuzberg"
    };

    // Emit progress: extracting
    let _ = app_handle.emit(
        "import:detail",
        ImportDetailProgress {
            file_name: file_name_for_progress.clone(),
            step: "extracting".to_string(),
            method: Some(expected_method.to_string()),
            status: "processing".to_string(),
            message: None,
        },
    );

    match state.search_index.index_attachment_content(&attachment_data, &config).await {
        Ok(result) => {
            let _ = app_handle.emit(
                "import:detail",
                ImportDetailProgress {
                    file_name: file_name_for_progress.clone(),
                    step: "indexing".to_string(),
                    method: Some(result.method.as_str().to_string()),
                    status: if result.indexed { "success" } else { "skipped" }.to_string(),
                    message: result.message,
                },
            );
        }
        Err(e) => {
            tracing::warn!("Failed to index PDF attachment content: {}", e);
            let _ = app_handle.emit(
                "import:detail",
                ImportDetailProgress {
                    file_name: file_name_for_progress.clone(),
                    step: "indexing".to_string(),
                    method: None,
                    status: "failed".to_string(),
                    message: Some(e.to_string()),
                },
            );
        }
    }

    // Commit index changes
    if let Err(e) = state.search_index.commit().await {
        tracing::warn!("Failed to commit search index: {}", e);
    }

    get_attachment(state, attachment_id).await
}

/// Determine attachment type from file extension
fn get_attachment_type_from_extension(path: &str) -> &'static str {
    let path_lower = path.to_lowercase();
    if path_lower.ends_with(".pdf") {
        "pdf"
    } else if path_lower.ends_with(".html") || path_lower.ends_with(".htm") {
        "snapshot"
    } else if path_lower.ends_with(".png") || path_lower.ends_with(".jpg")
        || path_lower.ends_with(".jpeg") || path_lower.ends_with(".gif")
        || path_lower.ends_with(".webp") || path_lower.ends_with(".svg")
        || path_lower.ends_with(".bmp") || path_lower.ends_with(".tiff")
    {
        "image"
    } else if path_lower.ends_with(".epub") {
        "epub"
    } else if path_lower.ends_with(".md") || path_lower.ends_with(".txt") {
        "note"
    } else if path_lower.ends_with(".mp4") || path_lower.ends_with(".mov")
        || path_lower.ends_with(".avi") || path_lower.ends_with(".mkv")
        || path_lower.ends_with(".webm")
    {
        "video"
    } else if path_lower.ends_with(".mp3") || path_lower.ends_with(".wav")
        || path_lower.ends_with(".flac") || path_lower.ends_with(".aac")
        || path_lower.ends_with(".ogg")
    {
        "audio"
    } else {
        "generic"
    }
}

/// Add any file as attachment to an existing entry (auto-detects type)
#[tauri::command]
pub async fn add_file_attachment(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    entry_id: i64,
    file_path: String,
) -> Result<Attachment, String> {
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;
    use crate::filename;
    use crate::commands::settings::is_setting_enabled;

    let source_path = PathBuf::from(&file_path);
    if !source_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // macOS can store some file types (e.g. .epub) as directory packages.
    // If the path is a directory, zip it into a temp file first using ditto.
    let effective_source: PathBuf;
    let temp_zip: Option<PathBuf>;
    if source_path.is_dir() {
        tracing::info!("Source is a directory package, archiving with ditto: {:?}", file_path);
        let tmp = std::env::temp_dir().join(format!("wren-attach-{}.zip", Uuid::new_v4()));
        let output = std::process::Command::new("ditto")
            .args(["-c", "-k", "--sequesterRsrc"])
            .arg(&source_path)
            .arg(&tmp)
            .output()
            .map_err(|e| format!("Failed to archive directory package: {}", e))?;
        if !output.status.success() {
            let _ = fs::remove_file(&tmp);
            return Err(format!(
                "Failed to archive directory package: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        effective_source = tmp.clone();
        temp_zip = Some(tmp);
    } else {
        effective_source = source_path.clone();
        temp_zip = None;
    }

    // Cleanup helper: remove temp zip on any early return
    let cleanup = || {
        if let Some(ref p) = temp_zip {
            let _ = fs::remove_file(p);
        }
    };

    // Auto-detect attachment type from extension (use original path for extension detection)
    let attachment_type = get_attachment_type_from_extension(&file_path);

    // For PDFs, delegate to the specialized handler (includes text extraction)
    if attachment_type == "pdf" {
        cleanup();
        return add_pdf_attachment(state, app_handle, entry_id, file_path).await;
    }

    // Get entry key for folder structure
    let entry_key: String = match sqlx::query_scalar("SELECT key FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_one(&state.db)
        .await
    {
        Ok(key) => key,
        Err(e) => { cleanup(); return Err(format!("Entry not found: {}", e)); }
    };

    // Get file size from metadata
    let file_meta = match fs::metadata(&effective_source) {
        Ok(m) => m,
        Err(e) => { cleanup(); return Err(format!("Failed to read file metadata: {}", e)); }
    };
    let file_size = file_meta.len() as i64;

    // Calculate hash using streaming reader
    let file_hash = {
        use std::io::Read;
        let mut file = match fs::File::open(&effective_source) {
            Ok(f) => f,
            Err(e) => { cleanup(); return Err(format!("Failed to open file: {}", e)); }
        };
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        loop {
            let bytes_read = match file.read(&mut buffer) {
                Ok(n) => n,
                Err(e) => { cleanup(); return Err(format!("Failed to read file: {}", e)); }
            };
            if bytes_read == 0 { break; }
            hasher.update(&buffer[..bytes_read]);
        }
        hex::encode(hasher.finalize())
    };

    // Create destination path
    let dest_dir = {
        let library_path = state.library_path.read().await;
        library_path.join("files").join(&entry_key)
    };

    fs::create_dir_all(&dest_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    // Get original filename
    let original_file_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("attachment-{}", Uuid::new_v4()));

    // Check if auto-rename is enabled
    let auto_rename = is_setting_enabled(&state.db, "auto_rename_files").await;

    let final_file_name = if auto_rename {
        let entry_row = sqlx::query("SELECT title, date FROM entries WHERE id = ?")
            .bind(entry_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| format!("Failed to fetch entry: {}", e))?;

        let entry_title: String = entry_row.get("title");
        let entry_date: Option<String> = entry_row.get("date");

        let creator_rows = sqlx::query(
            r#"
            SELECT ec.first_name, ec.last_name, ec.name, ct.name as creator_type, ec.sort_order
            FROM entry_creators ec
            JOIN creator_types ct ON ec.creator_type_id = ct.id
            WHERE ec.entry_id = ?
            ORDER BY ec.sort_order
            "#
        )
        .bind(entry_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| format!("Failed to fetch creators: {}", e))?;

        let creators: Vec<crate::db::models::Creator> = creator_rows
            .iter()
            .map(|row| crate::db::models::Creator {
                id: None,
                creator_type: row.get("creator_type"),
                creator_type_display: None,
                first_name: row.get("first_name"),
                last_name: row.get("last_name"),
                name: row.get("name"),
                sort_order: row.get("sort_order"),
            })
            .collect();

        let year = entry_date
            .as_ref()
            .and_then(|d| filename::extract_year(d));

        let extension = source_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();

        let generated = filename::generate_filename(
            &entry_title,
            &creators,
            year.as_deref(),
            &extension,
        );

        if generated.is_empty() {
            original_file_name
        } else {
            generated
        }
    } else {
        original_file_name
    };

    // Resolve any filename conflicts
    let dest_path = filename::resolve_conflict(&dest_dir, &final_file_name);

    // Copy file to library (use effective_source which may be a temp zip for directory packages)
    match fs::copy(&effective_source, &dest_path) {
        Ok(_) => {},
        Err(e) => { cleanup(); return Err(format!("Failed to copy file: {}", e)); }
    }
    cleanup(); // Remove temp zip if any

    let dest_path_str = dest_path.to_string_lossy().to_string();

    // Get attachment type ID
    let attachment_type_id: i64 =
        sqlx::query_scalar("SELECT id FROM attachment_types WHERE name = ?")
            .bind(attachment_type)
            .fetch_one(&state.db)
            .await
            .map_err(|e| format!("Unknown attachment type '{}': {}", attachment_type, e))?;

    // Get title from final filename (without extension)
    let title = dest_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Attachment".to_string());

    // Create attachment record
    let attachment_key = Uuid::new_v4().to_string();
    let result = sqlx::query(
        r#"
        INSERT INTO attachments (key, entry_id, attachment_type_id, title, file_path, file_hash, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(&attachment_key)
    .bind(entry_id)
    .bind(attachment_type_id)
    .bind(&title)
    .bind(&dest_path_str)
    .bind(&file_hash)
    .bind(file_size)
    .fetch_one(&state.db)
    .await
    .map_err(|e| format!("Failed to create attachment: {}", e))?;

    let attachment_id: i64 = result.get("id");
    tracing::info!(
        "Added {} attachment {} to entry {} (filename: {})",
        attachment_type,
        attachment_id,
        entry_id,
        dest_path.file_name().unwrap_or_default().to_string_lossy()
    );

    get_attachment(state, attachment_id).await
}

// =====================================================
// TAG / COLLECTION OPERATIONS
// =====================================================

/// Add a tag to an entry
#[tauri::command]
pub async fn add_entry_tag(
    state: State<'_, AppState>,
    entry_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
        .bind(entry_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove a tag from an entry
#[tauri::command]
pub async fn remove_entry_tag(
    state: State<'_, AppState>,
    entry_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?")
        .bind(entry_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Add an entry to a collection
#[tauri::command]
pub async fn add_entry_to_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO collection_entries (entry_id, collection_id, order_index)
         VALUES (?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM collection_entries WHERE collection_id = ?))",
    )
    .bind(entry_id)
    .bind(collection_id)
    .bind(collection_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove an entry from a collection
#[tauri::command]
pub async fn remove_entry_from_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_entries WHERE entry_id = ? AND collection_id = ?")
        .bind(entry_id)
        .bind(collection_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// =====================================================
// TYPE QUERIES
// =====================================================

/// Get item types (renamed from entry_types for Zotero compatibility)
#[tauri::command]
pub async fn get_item_types(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::models::ItemType>, String> {
    let types = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>)>(
        "SELECT id, name, display_name, csl_type, icon FROM item_types ORDER BY sort_order, display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(types
        .into_iter()
        .map(
            |(id, name, display_name, csl_type, icon)| crate::db::models::ItemType {
                id,
                name,
                display_name,
                csl_type,
                icon,
            },
        )
        .collect())
}

/// Get attachment types
#[tauri::command]
pub async fn get_attachment_types(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::models::AttachmentType>, String> {
    let types = sqlx::query_as::<_, (i64, String, String, Option<String>)>(
        "SELECT id, name, display_name, icon FROM attachment_types ORDER BY display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(types
        .into_iter()
        .map(
            |(id, name, display_name, icon)| crate::db::models::AttachmentType {
                id,
                name,
                display_name,
                icon,
            },
        )
        .collect())
}

/// Show entry's attachment in Finder/Explorer
#[tauri::command]
pub async fn show_entry_in_finder(state: State<'_, AppState>, entry_id: i64) -> Result<(), String> {
    // Get the first attachment with a file path
    let file_path: Option<String> = sqlx::query_scalar(
        "SELECT file_path FROM attachments WHERE entry_id = ? AND file_path IS NOT NULL LIMIT 1",
    )
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let path = file_path.ok_or_else(|| "No file attachment found for this entry".to_string())?;

    // Reveal file in Finder (macOS) or Explorer (Windows)
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open on the parent directory
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open file manager: {}", e))?;
        }
    }

    Ok(())
}

/// Show multiple entries' attachments in Finder/Explorer (batch operation)
#[tauri::command]
pub async fn show_entries_in_finder(state: State<'_, AppState>, entry_ids: Vec<i64>) -> Result<(), String> {
    if entry_ids.is_empty() {
        return Ok(());
    }

    // Get file paths for all entries
    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        "SELECT DISTINCT file_path FROM attachments WHERE entry_id IN ({}) AND file_path IS NOT NULL",
        placeholders.join(",")
    );

    let mut query_builder = sqlx::query_scalar::<_, String>(&query);
    for id in &entry_ids {
        query_builder = query_builder.bind(id);
    }

    let file_paths: Vec<String> = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    if file_paths.is_empty() {
        return Err("No file attachments found for the selected entries".to_string());
    }

    // Reveal files in Finder (macOS)
    #[cfg(target_os = "macos")]
    {
        // Use open -R for each file - more reliable than AppleScript
        // and handles special characters in paths correctly
        for path in &file_paths {
            std::process::Command::new("open")
                .args(["-R", path])
                .spawn()
                .map_err(|e| format!("Failed to open Finder: {}", e))?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows Explorer doesn't easily support selecting multiple files
        // Fall back to opening the first file
        if let Some(path) = file_paths.first() {
            std::process::Command::new("explorer")
                .args(["/select,", path])
                .spawn()
                .map_err(|e| format!("Failed to open Explorer: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: open the parent directory of the first file
        if let Some(path) = file_paths.first() {
            if let Some(parent) = std::path::Path::new(path).parent() {
                std::process::Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .map_err(|e| format!("Failed to open file manager: {}", e))?;
            }
        }
    }

    Ok(())
}

/// Open a file in the system default app (used for printing attachments).
#[tauri::command]
pub async fn open_file_with_default_app(file_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err("File not found".to_string());
    }
    if path.is_dir() {
        return Err("Path is a directory".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/// Get entry fields from EAV table
async fn get_entry_fields(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<HashMap<String, String>, String> {
    let fields: Vec<FieldRow> = sqlx::query_as::<_, FieldRow>(
        r#"
        SELECT f.name as field_name, ef.value
        FROM entry_fields ef
        JOIN fields f ON ef.field_id = f.id
        WHERE ef.entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(fields
        .into_iter()
        .map(|f| (f.field_name, f.value))
        .collect())
}

/// Get entry creators
async fn get_entry_creators(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<Creator>, String> {
    let creators: Vec<CreatorRow> = sqlx::query_as::<_, CreatorRow>(
        r#"
        SELECT
            ec.id, ct.name as creator_type, ct.display_name as creator_type_display,
            ec.first_name, ec.last_name, ec.name, ec.sort_order
        FROM entry_creators ec
        JOIN creator_types ct ON ec.creator_type_id = ct.id
        WHERE ec.entry_id = ?
        ORDER BY ec.sort_order
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(creators
        .into_iter()
        .map(|c| Creator {
            id: Some(c.id),
            creator_type: c.creator_type,
            creator_type_display: Some(c.creator_type_display),
            first_name: c.first_name,
            last_name: c.last_name,
            name: c.name,
            sort_order: c.sort_order,
        })
        .collect())
}

/// Get entry tags
async fn get_entry_tags(state: &State<'_, AppState>, entry_id: i64) -> Result<Vec<Tag>, String> {
    let tags: Vec<TagRow> = sqlx::query_as::<_, TagRow>(
        r#"
        SELECT t.id, t.name, t.color, t.is_imported
        FROM tags t
        JOIN entry_tags et ON t.id = et.tag_id
        WHERE et.entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(tags
        .into_iter()
        .map(|t| Tag {
            id: t.id,
            name: t.name,
            color: t.color,
            item_count: 0,
            is_imported: t.is_imported,
        })
        .collect())
}

/// Get entry collections (returns collection IDs)
async fn get_entry_collections(
    state: &State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<i64>, String> {
    let rows = sqlx::query(
        r#"
        SELECT c.id
        FROM collections c
        JOIN collection_entries ce ON c.id = ce.collection_id
        WHERE ce.entry_id = ?
        "#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|r| r.get("id")).collect())
}

/// Insert entry fields into EAV table (transaction version)
async fn insert_entry_fields_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    entry_id: i64,
    fields: &HashMap<String, String>,
) -> Result<(), String> {
    for (field_name, value) in fields {
        if value.is_empty() {
            continue;
        }

        // Get field ID
        let field_id: Option<i64> = sqlx::query_scalar("SELECT id FROM fields WHERE name = ?")
            .bind(field_name)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;

        if let Some(fid) = field_id {
            sqlx::query(
                "INSERT OR REPLACE INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)",
            )
            .bind(entry_id)
            .bind(fid)
            .bind(value)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        } else {
            tracing::warn!("Unknown field name: {}", field_name);
        }
    }
    Ok(())
}

/// Insert entry creators (transaction version)
async fn insert_entry_creators_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    entry_id: i64,
    creators: &[CreatorInput],
) -> Result<(), String> {
    for (sort_order, creator) in creators.iter().enumerate() {
        // Get creator type ID
        let creator_type_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM creator_types WHERE name = ?")
                .bind(&creator.creator_type)
                .fetch_optional(&mut **tx)
                .await
                .map_err(|e| e.to_string())?;

        if let Some(ctid) = creator_type_id {
            sqlx::query(
                r#"
                INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(entry_id)
            .bind(ctid)
            .bind(&creator.first_name)
            .bind(&creator.last_name)
            .bind(&creator.name)
            .bind(sort_order as i32)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        } else {
            tracing::warn!("Unknown creator type: {}", creator.creator_type);
        }
    }
    Ok(())
}

/// Format creators for display (e.g., "Wu" or "Wu & Green" or "Wu et al.")
pub(crate) fn format_creators_display(creators: &[Creator]) -> String {
    // Find primary creators (usually authors)
    let primary: Vec<&Creator> = creators
        .iter()
        .filter(|c| c.creator_type == "author")
        .collect();

    let display_creators = if primary.is_empty() {
        creators.iter().collect::<Vec<_>>()
    } else {
        primary
    };

    match display_creators.len() {
        0 => String::new(),
        1 => display_creators[0].short_name(),
        2 => format!(
            "{} & {}",
            display_creators[0].short_name(),
            display_creators[1].short_name()
        ),
        _ => format!("{} et al.", display_creators[0].short_name()),
    }
}

pub(crate) async fn refresh_entry_creators_sort(
    db: &sqlx::SqlitePool,
    entry_id: i64,
) -> Result<(), String> {
    let creator_rows = sqlx::query(
        r#"
        SELECT ec.first_name, ec.last_name, ec.name, ct.name as creator_type, ec.sort_order
        FROM entry_creators ec
        JOIN creator_types ct ON ec.creator_type_id = ct.id
        WHERE ec.entry_id = ?
        ORDER BY ec.sort_order
        "#
    )
    .bind(entry_id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch creators: {}", e))?;

    let creators: Vec<crate::db::models::Creator> = creator_rows
        .iter()
        .map(|row| crate::db::models::Creator {
            id: None,
            creator_type: row.get("creator_type"),
            creator_type_display: None,
            first_name: row.get("first_name"),
            last_name: row.get("last_name"),
            name: row.get("name"),
            sort_order: row.get("sort_order"),
        })
        .collect();

    let creators_sort = format_creators_display(&creators);

    sqlx::query("UPDATE entries SET creators_sort = ? WHERE id = ?")
        .bind(&creators_sort)
        .bind(entry_id)
        .execute(db)
        .await
        .map_err(|e| format!("Failed to update creators_sort: {}", e))?;

    Ok(())
}

pub(crate) async fn refresh_entry_fts(
    db: &sqlx::SqlitePool,
    entry_id: i64,
) -> Result<(), String> {
    let row = sqlx::query(
        r#"
        SELECT
            e.title,
            (
                SELECT ef.value
                FROM entry_fields ef
                JOIN fields f ON ef.field_id = f.id
                WHERE ef.entry_id = e.id AND f.name = 'abstractNote'
                LIMIT 1
            ) AS abstract_note
        FROM entries e
        WHERE e.id = ?
        "#
    )
    .bind(entry_id)
    .fetch_one(db)
    .await
    .map_err(|e| format!("Failed to fetch entry for FTS: {}", e))?;

    let title: String = row.get("title");
    let abstract_note: Option<String> = row.get("abstract_note");

    sqlx::query(
        "INSERT OR REPLACE INTO entries_fts (rowid, title, abstract_note, entry_id) VALUES (?, ?, ?, ?)"
    )
    .bind(entry_id)
    .bind(&title)
    .bind(&abstract_note)
    .bind(entry_id)
    .execute(db)
    .await
    .map_err(|e| format!("Failed to update entries_fts: {}", e))?;

    Ok(())
}

// =====================================================
// BATCH HELPER FUNCTIONS (for N+1 query optimization)
// =====================================================

/// Row type for batch tag query
#[derive(Debug, FromRow)]
struct BatchTagRow {
    entry_id: i64,
    tag_id: i64,
    tag_name: String,
    tag_color: Option<String>,
    tag_is_imported: bool,
}

/// Row type for batch creator query
#[derive(Debug, FromRow)]
struct BatchCreatorRow {
    entry_id: i64,
    id: i64,
    creator_type: String,
    creator_type_display: String,
    first_name: Option<String>,
    last_name: Option<String>,
    name: Option<String>,
    sort_order: i32,
}

/// Batch fetch tags for multiple entries in ONE query
async fn batch_get_entry_tags(
    state: &State<'_, AppState>,
    entry_ids: &[i64],
) -> Result<HashMap<i64, Vec<Tag>>, String> {
    if entry_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        r#"
        SELECT et.entry_id, t.id as tag_id, t.name as tag_name, t.color as tag_color, t.is_imported as tag_is_imported
        FROM entry_tags et
        JOIN tags t ON et.tag_id = t.id
        WHERE et.entry_id IN ({})
        "#,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, BatchTagRow>(&query);
    for id in entry_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Group by entry_id
    let mut result: HashMap<i64, Vec<Tag>> = HashMap::new();
    for row in rows {
        result.entry(row.entry_id).or_default().push(Tag {
            id: row.tag_id,
            name: row.tag_name,
            color: row.tag_color,
            item_count: 0,
            is_imported: row.tag_is_imported,
        });
    }

    Ok(result)
}

/// Batch fetch creators for multiple entries in ONE query
async fn batch_get_entry_creators(
    state: &State<'_, AppState>,
    entry_ids: &[i64],
) -> Result<HashMap<i64, Vec<Creator>>, String> {
    if entry_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        r#"
        SELECT
            ec.entry_id, ec.id, ct.name as creator_type, ct.display_name as creator_type_display,
            ec.first_name, ec.last_name, ec.name, ec.sort_order
        FROM entry_creators ec
        JOIN creator_types ct ON ec.creator_type_id = ct.id
        WHERE ec.entry_id IN ({})
        ORDER BY ec.entry_id, ec.sort_order
        "#,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, BatchCreatorRow>(&query);
    for id in entry_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Group by entry_id
    let mut result: HashMap<i64, Vec<Creator>> = HashMap::new();
    for row in rows {
        result.entry(row.entry_id).or_default().push(Creator {
            id: Some(row.id),
            creator_type: row.creator_type,
            creator_type_display: Some(row.creator_type_display),
            first_name: row.first_name,
            last_name: row.last_name,
            name: row.name,
            sort_order: row.sort_order,
        });
    }

    Ok(result)
}

/// Batch fetch attachments for multiple entries in ONE query
#[tauri::command]
pub async fn get_entries_attachments(
    state: State<'_, AppState>,
    entry_ids: Vec<i64>,
) -> Result<HashMap<i64, Vec<Attachment>>, String> {
    if entry_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = entry_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        r#"
        SELECT
            a.id, a.key, a.entry_id, at.name as attachment_type,
            at.display_name as attachment_type_display,
            a.title, a.file_path, a.file_hash, a.file_size, a.url,
            a.page_count, a.frontmatter, a.thumbnail_path, a.markdown_path,
            a.date_added, a.date_modified
        FROM attachments a
        JOIN attachment_types at ON a.attachment_type_id = at.id
        WHERE a.entry_id IN ({})
        ORDER BY a.entry_id, a.date_added ASC
        "#,
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, AttachmentRow>(&query);
    for id in &entry_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Group by entry_id
    let mut result: HashMap<i64, Vec<Attachment>> = HashMap::new();
    for a in rows {
        result.entry(a.entry_id).or_default().push(Attachment {
            id: a.id,
            key: a.key,
            entry_id: a.entry_id,
            attachment_type: a.attachment_type,
            attachment_type_display: a.attachment_type_display,
            title: a.title,
            file_path: a.file_path,
            file_hash: a.file_hash,
            file_size: a.file_size,
            url: a.url,
            page_count: a.page_count,
            frontmatter: a.frontmatter,
            thumbnail_path: a.thumbnail_path,
            markdown_path: a.markdown_path,
            date_added: a.date_added,
            date_modified: a.date_modified,
        });
    }

    Ok(result)
}

// =====================================================
// DUPLICATE ENTRY
// =====================================================

/// Duplicate an entry (copies metadata, creators, fields, tags, and collections)
#[tauri::command]
pub async fn duplicate_entry(state: State<'_, AppState>, id: i64) -> Result<Entry, String> {
    let key = Uuid::new_v4().to_string();

    // Start transaction
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // Get original entry
    let original: EntryRow = sqlx::query_as::<_, EntryRow>(
        r#"
        SELECT
            e.id, e.key, it.name as item_type, it.display_name as item_type_display,
            e.title, e.date, e.url, e.access_date, e.date_added, e.date_modified
        FROM entries e
        JOIN item_types it ON e.item_type_id = it.id
        WHERE e.id = ?
        "#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Entry not found: {}", e))?;

    // Get item type ID
    let item_type_id: i64 = sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
        .bind(&original.item_type)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Insert new entry with "(Copy)" suffix
    let new_title = format!("{} (Copy)", original.title);
    let result = sqlx::query(
        r#"
        INSERT INTO entries (key, item_type_id, title, date, url, access_date)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
    )
    .bind(&key)
    .bind(item_type_id)
    .bind(&new_title)
    .bind(&original.date)
    .bind(&original.url)
    .bind(&original.access_date)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create duplicate: {}", e))?;

    let new_id: i64 = result.get("id");

    // Copy fields
    sqlx::query(
        r#"
        INSERT INTO entry_fields (entry_id, field_id, value)
        SELECT ?, field_id, value
        FROM entry_fields
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Copy creators
    sqlx::query(
        r#"
        INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order)
        SELECT ?, creator_type_id, first_name, last_name, name, sort_order
        FROM entry_creators
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Copy tags
    sqlx::query(
        r#"
        INSERT INTO entry_tags (entry_id, tag_id)
        SELECT ?, tag_id
        FROM entry_tags
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Copy collection memberships
    sqlx::query(
        r#"
        INSERT INTO collection_entries (collection_id, entry_id)
        SELECT collection_id, ?
        FROM collection_entries
        WHERE entry_id = ?
        "#,
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Commit transaction
    tx.commit().await.map_err(|e| e.to_string())?;

    // Return the new entry
    get_entry(state, new_id, None).await
}
