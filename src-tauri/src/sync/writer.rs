use anyhow::Result;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::Path;

use super::entry_json::*;

// ── Row types for sqlx queries ──────────────────────────────────────

#[derive(sqlx::FromRow)]
struct EntryRow {
    #[allow(dead_code)]
    id: i64,
    key: String,
    item_type: String,
    title: String,
    date: Option<String>,
    url: Option<String>,
    access_date: Option<String>,
    date_added: String,
    date_modified: String,
}

#[derive(sqlx::FromRow)]
struct CreatorRow {
    creator_type: String,
    first_name: Option<String>,
    last_name: Option<String>,
    name: Option<String>,
    sort_order: i32,
}

#[derive(sqlx::FromRow)]
struct FieldRow {
    field_name: String,
    value: String,
}

#[derive(sqlx::FromRow)]
struct TagRow {
    name: String,
    color: Option<String>,
}

#[derive(sqlx::FromRow)]
struct CollectionRow {
    key: String,
}

#[derive(sqlx::FromRow)]
struct AttachmentRow {
    key: String,
    attachment_type: String,
    title: Option<String>,
    file_path: Option<String>,
    file_hash: Option<String>,
    file_size: Option<i64>,
    url: Option<String>,
    page_count: Option<i32>,
    frontmatter: Option<String>,
    date_added: String,
}

#[derive(sqlx::FromRow)]
struct AnnotationRow {
    key: String,
    attachment_key: String,
    annotation_type: String,
    page_number: i32,
    position_json: String,
    selected_text: Option<String>,
    comment: Option<String>,
    color: String,
    sort_index: Option<String>,
    date_added: String,
    date_modified: String,
}

#[derive(sqlx::FromRow)]
struct LinkRow {
    target_entry_key: String,
    link_type: String,
    context: Option<String>,
    date_added: String,
}

#[derive(sqlx::FromRow)]
struct ParsedContentRow {
    document_type: Option<String>,
    structured_markdown: Option<String>,
    model_used: Option<String>,
    provider: Option<String>,
    status: Option<String>,
    date_completed: Option<String>,
}

// ── Public API ──────────────────────────────────────────────────────

/// Build an EntryJson from SQLite data for the given entry ID.
pub async fn entry_to_json(pool: &SqlitePool, entry_id: i64) -> Result<EntryJson> {
    let entry: EntryRow = sqlx::query_as(
        "SELECT e.id, e.key, it.name as item_type, e.title, e.date, e.url, \
         e.access_date, e.date_added, e.date_modified \
         FROM entries e JOIN item_types it ON e.item_type_id = it.id WHERE e.id = ?",
    )
    .bind(entry_id)
    .fetch_one(pool)
    .await?;

    let modified = &entry.date_modified;
    let added = &entry.date_added;

    // Fetch all related data in parallel
    let (fields, creators, tags, collections, attachments, annotations, links, parsed, inline_tables) = tokio::join!(
        fetch_fields(pool, entry_id),
        fetch_creators(pool, entry_id),
        fetch_tags(pool, entry_id),
        fetch_collections(pool, entry_id),
        fetch_attachments(pool, entry_id),
        fetch_annotations(pool, entry_id),
        fetch_links(pool, entry_id),
        fetch_parsed_content(pool, entry_id),
        fetch_inline_tables(pool, entry_id),
    );

    let fields_map: HashMap<String, Timestamped<String>> = fields?
        .into_iter()
        .map(|f| {
            (
                f.field_name,
                Timestamped::new(f.value, modified.clone()),
            )
        })
        .collect();

    let creators_json: Vec<EntryJsonCreator> = creators?
        .into_iter()
        .map(|c| EntryJsonCreator {
            key: uuid::Uuid::new_v4().to_string(),
            creator_type: c.creator_type,
            first_name: c.first_name,
            last_name: c.last_name,
            name: c.name,
            sort_order: c.sort_order,
        })
        .collect();

    let tags_map: HashMap<String, TagEntry> = tags?
        .into_iter()
        .map(|t| {
            (
                t.name,
                TagEntry {
                    added: added.clone(),
                    color: t.color,
                    removed: None,
                },
            )
        })
        .collect();

    let collections_map: HashMap<String, CollectionEntry> = collections?
        .into_iter()
        .map(|c| {
            (
                c.key,
                CollectionEntry {
                    added: added.clone(),
                    removed: None,
                },
            )
        })
        .collect();

    let attachments_json: Vec<AttachmentJson> = attachments?
        .into_iter()
        .map(|a| {
            let file_name = a.file_path.as_ref().and_then(|p| {
                std::path::Path::new(p)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
            });
            AttachmentJson {
                key: a.key,
                attachment_type: a.attachment_type,
                title: a.title,
                file_name,
                file_hash: a.file_hash,
                file_size: a.file_size,
                url: a.url,
                page_count: a.page_count,
                frontmatter: a.frontmatter,
                created_at: a.date_added,
            }
        })
        .collect();

    let annotations_json: Vec<AnnotationJson> = annotations?
        .into_iter()
        .map(|a| AnnotationJson {
            key: a.key,
            attachment_key: a.attachment_key,
            annotation_type: a.annotation_type,
            page_number: a.page_number,
            position_json: a.position_json,
            selected_text: a.selected_text,
            comment: Timestamped::new(a.comment, a.date_modified.clone()),
            color: Timestamped::new(a.color, a.date_modified),
            sort_index: a.sort_index,
            created_at: a.date_added,
        })
        .collect();

    let links_json: Vec<EntryLinkJson> = links?
        .into_iter()
        .map(|l| EntryLinkJson {
            target_entry_key: l.target_entry_key,
            link_type: l.link_type,
            context: l.context,
            created_at: l.date_added,
        })
        .collect();

    let parsed_content = match parsed? {
        Some(p) => Some(Timestamped::new(
            ParsedContentJson {
                document_type: p.document_type,
                structured_markdown: p.structured_markdown,
                model_used: p.model_used,
                provider: p.provider,
                status: p.status,
            },
            p.date_completed.unwrap_or_else(|| modified.clone()),
        )),
        None => None,
    };

    Ok(EntryJson {
        schema_version: SCHEMA_VERSION,
        key: entry.key,
        _meta: EntryMeta {
            created_at: added.clone(),
            created_by_device: None,
            deleted_at: None,
            deleted_by_device: None,
        },
        item_type: Timestamped::new(entry.item_type, modified.clone()),
        title: Timestamped::new(entry.title, modified.clone()),
        date: Timestamped::new(entry.date, modified.clone()),
        url: Timestamped::new(entry.url, modified.clone()),
        access_date: Timestamped::new(entry.access_date, modified.clone()),
        fields: fields_map,
        creators: Timestamped::new(creators_json, modified.clone()),
        tags: tags_map,
        collections: collections_map,
        attachments: attachments_json,
        annotations: annotations_json,
        links: links_json,
        inline_tables: inline_tables.unwrap_or_default(),
        parsed_content,
        sharing: None,
        private: PrivateData::default(),
        tombstones: vec![],
    })
}

/// Build and write entry.json for an entry to the sync folder.
pub async fn write_entry_json(
    pool: &SqlitePool,
    sync_path: &Path,
    entry_id: i64,
) -> Result<()> {
    let entry_json = entry_to_json(pool, entry_id).await?;
    let dir = sync_path.join("library").join("entries").join(&entry_json.key);
    entry_json.write_atomic(&dir)?;
    Ok(())
}

/// Remove entry.json (and optionally the directory) for a deleted entry.
pub fn remove_entry_json(sync_path: &Path, entry_key: &str) -> Result<()> {
    let path = sync_path.join("library").join("entries").join(entry_key).join("entry.json");
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// Sync entry.json to disk. Logs errors but never fails the caller.
/// Call this after any mutation to entry data.
pub async fn sync_entry_json(pool: &SqlitePool, library_path: &Path, entry_id: i64) {
    if let Err(e) = write_entry_json(pool, library_path, entry_id).await {
        tracing::warn!("Failed to write entry.json for entry {}: {}", entry_id, e);
    }
}

// ── Private fetch helpers ───────────────────────────────────────────

async fn fetch_fields(pool: &SqlitePool, entry_id: i64) -> Result<Vec<FieldRow>> {
    Ok(sqlx::query_as::<_, FieldRow>(
        "SELECT f.name as field_name, ef.value \
         FROM entry_fields ef JOIN fields f ON ef.field_id = f.id \
         WHERE ef.entry_id = ?",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_creators(pool: &SqlitePool, entry_id: i64) -> Result<Vec<CreatorRow>> {
    Ok(sqlx::query_as::<_, CreatorRow>(
        "SELECT ct.name as creator_type, ec.first_name, ec.last_name, ec.name, ec.sort_order \
         FROM entry_creators ec JOIN creator_types ct ON ec.creator_type_id = ct.id \
         WHERE ec.entry_id = ? ORDER BY ec.sort_order",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_tags(pool: &SqlitePool, entry_id: i64) -> Result<Vec<TagRow>> {
    Ok(sqlx::query_as::<_, TagRow>(
        "SELECT t.name, t.color FROM tags t \
         JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ?",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_collections(pool: &SqlitePool, entry_id: i64) -> Result<Vec<CollectionRow>> {
    Ok(sqlx::query_as::<_, CollectionRow>(
        "SELECT c.key FROM collections c \
         JOIN collection_entries ce ON c.id = ce.collection_id WHERE ce.entry_id = ?",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_attachments(pool: &SqlitePool, entry_id: i64) -> Result<Vec<AttachmentRow>> {
    Ok(sqlx::query_as::<_, AttachmentRow>(
        "SELECT a.key, at.name as attachment_type, a.title, a.file_path, \
         a.file_hash, a.file_size, a.url, a.page_count, a.frontmatter, a.date_added \
         FROM attachments a JOIN attachment_types at ON a.attachment_type_id = at.id \
         WHERE a.entry_id = ? ORDER BY a.date_added ASC",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_annotations(pool: &SqlitePool, entry_id: i64) -> Result<Vec<AnnotationRow>> {
    Ok(sqlx::query_as::<_, AnnotationRow>(
        "SELECT aa.key, a.key as attachment_key, ant.name as annotation_type, \
         aa.page_number, aa.position_json, aa.selected_text, aa.comment, aa.color, \
         aa.sort_index, aa.date_added, aa.date_modified \
         FROM attachment_annotations aa \
         JOIN attachments a ON aa.attachment_id = a.id \
         JOIN annotation_types ant ON aa.annotation_type_id = ant.id \
         WHERE a.entry_id = ? ORDER BY aa.sort_index",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_links(pool: &SqlitePool, entry_id: i64) -> Result<Vec<LinkRow>> {
    Ok(sqlx::query_as::<_, LinkRow>(
        "SELECT e.key as target_entry_key, lt.name as link_type, el.context, \
         el.date_added \
         FROM entry_links el \
         JOIN entries e ON el.target_entry_id = e.id \
         JOIN link_types lt ON el.link_type_id = lt.id \
         WHERE el.source_entry_id = ?",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_parsed_content(
    pool: &SqlitePool,
    entry_id: i64,
) -> Result<Option<ParsedContentRow>> {
    Ok(sqlx::query_as::<_, ParsedContentRow>(
        "SELECT document_type, structured_markdown, model_used, provider, status, date_completed \
         FROM parsed_content WHERE entry_id = ? AND status IN ('success', 'partial') \
         ORDER BY date_completed DESC LIMIT 1",
    )
    .bind(entry_id)
    .fetch_optional(pool)
    .await?)
}

async fn fetch_inline_tables(pool: &SqlitePool, entry_id: i64) -> Result<Vec<InlineTableJson>> {
    #[derive(sqlx::FromRow)]
    struct TableRow {
        key: String,
        title: String,
        columns_json: String,
        date_added: String,
        date_modified: String,
    }

    #[derive(sqlx::FromRow)]
    struct RowRow {
        data_json: String,
        sort_order: i64,
    }

    // Get inline tables linked to this entry's attachments
    let tables: Vec<TableRow> = sqlx::query_as(
        "SELECT DISTINCT it.key, it.title, it.columns_json, it.date_added, it.date_modified \
         FROM inline_tables it \
         JOIN inline_table_refs itr ON itr.table_id = it.id \
         JOIN attachments a ON itr.attachment_id = a.id \
         WHERE a.entry_id = ?",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::new();
    for table in tables {
        let rows: Vec<RowRow> = sqlx::query_as(
            "SELECT itr.data_json, itr.sort_order \
             FROM inline_table_rows itr \
             JOIN inline_tables it ON itr.table_id = it.id \
             WHERE it.key = ? ORDER BY itr.sort_order",
        )
        .bind(&table.key)
        .fetch_all(pool)
        .await?;

        result.push(InlineTableJson {
            key: table.key,
            title: table.title,
            columns_json: table.columns_json,
            rows: rows
                .into_iter()
                .map(|r| InlineTableRowJson {
                    data_json: r.data_json,
                    sort_order: r.sort_order,
                })
                .collect(),
            created_at: table.date_added,
            modified_at: table.date_modified,
        });
    }

    Ok(result)
}
