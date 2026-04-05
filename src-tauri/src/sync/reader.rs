use anyhow::Result;
use sqlx::{Row, SqlitePool};

use super::entry_json::*;

/// Upsert an EntryJson into SQLite. Creates or updates the entry and all related data.
/// This is the reverse of entry_to_json — it materializes the canonical JSON into the local DB.
pub async fn upsert_entry_from_json(pool: &SqlitePool, entry: &EntryJson) -> Result<i64> {
    let mut tx = pool.begin().await?;

    // Resolve item_type_id
    let item_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM item_types WHERE name = ?",
    )
    .bind(&entry.item_type.v)
    .fetch_one(&mut *tx)
    .await?;

    // Check if entry exists
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM entries WHERE key = ?",
    )
    .bind(&entry.key)
    .fetch_optional(&mut *tx)
    .await?;

    let entry_id = if let Some(id) = existing {
        // Update existing entry
        sqlx::query(
            "UPDATE entries SET item_type_id = ?, title = ?, date = ?, url = ?, \
             access_date = ?, date_modified = datetime('now'), \
             is_deleted = ? WHERE id = ?",
        )
        .bind(item_type_id)
        .bind(&entry.title.v)
        .bind(&entry.date.v)
        .bind(&entry.url.v)
        .bind(&entry.access_date.v)
        .bind(entry._meta.deleted_at.is_some())
        .bind(id)
        .execute(&mut *tx)
        .await?;
        id
    } else {
        // Insert new entry
        let row = sqlx::query(
            "INSERT INTO entries (key, item_type_id, title, date, url, access_date, is_deleted) \
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(&entry.key)
        .bind(item_type_id)
        .bind(&entry.title.v)
        .bind(&entry.date.v)
        .bind(&entry.url.v)
        .bind(&entry.access_date.v)
        .bind(entry._meta.deleted_at.is_some())
        .fetch_one(&mut *tx)
        .await?;
        row.get::<i64, _>("id")
    };

    // Sync EAV fields: delete all, re-insert
    sqlx::query("DELETE FROM entry_fields WHERE entry_id = ?")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;

    for (field_name, field_val) in &entry.fields {
        let field_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM fields WHERE name = ?",
        )
        .bind(field_name)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(fid) = field_id {
            sqlx::query(
                "INSERT INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)",
            )
            .bind(entry_id)
            .bind(fid)
            .bind(&field_val.v)
            .execute(&mut *tx)
            .await?;
        }
    }

    // Sync creators: delete all, re-insert
    sqlx::query("DELETE FROM entry_creators WHERE entry_id = ?")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;

    for creator in &entry.creators.v {
        let ct_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM creator_types WHERE name = ?",
        )
        .bind(&creator.creator_type)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(cid) = ct_id {
            sqlx::query(
                "INSERT INTO entry_creators (entry_id, creator_type_id, first_name, last_name, name, sort_order) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(entry_id)
            .bind(cid)
            .bind(&creator.first_name)
            .bind(&creator.last_name)
            .bind(&creator.name)
            .bind(creator.sort_order)
            .execute(&mut *tx)
            .await?;
        }
    }

    // Sync tags: delete all, re-insert active ones
    sqlx::query("DELETE FROM entry_tags WHERE entry_id = ?")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;

    for (tag_name, tag_entry) in &entry.tags {
        // Skip removed tags
        if let Some(ref removed) = tag_entry.removed
            && removed >= &tag_entry.added {
                continue;
            }
        // Get or create tag
        let tag_id: i64 = match sqlx::query_scalar::<_, i64>(
            "SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
        )
        .bind(tag_name)
        .fetch_optional(&mut *tx)
        .await?
        {
            Some(id) => id,
            None => {
                let row = sqlx::query(
                    "INSERT INTO tags (name, color, is_imported) VALUES (?, ?, 0) RETURNING id",
                )
                .bind(tag_name)
                .bind(&tag_entry.color)
                .fetch_one(&mut *tx)
                .await?;
                row.get("id")
            }
        };

        sqlx::query("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
            .bind(entry_id)
            .bind(tag_id)
            .execute(&mut *tx)
            .await?;
    }

    // Sync collections: delete all, re-insert active ones
    sqlx::query("DELETE FROM collection_entries WHERE entry_id = ?")
        .bind(entry_id)
        .execute(&mut *tx)
        .await?;

    for (coll_key, coll_entry) in &entry.collections {
        if let Some(ref removed) = coll_entry.removed
            && removed >= &coll_entry.added {
                continue;
            }
        let coll_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM collections WHERE key = ?",
        )
        .bind(coll_key)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(cid) = coll_id {
            sqlx::query(
                "INSERT OR IGNORE INTO collection_entries (collection_id, entry_id) VALUES (?, ?)",
            )
            .bind(cid)
            .bind(entry_id)
            .execute(&mut *tx)
            .await?;
        } else {
            tracing::debug!("Sync: collection key {} not found locally, skipping for entry {}", coll_key, entry.key);
        }
    }

    tx.commit().await?;

    // Refresh creators_sort and FTS outside the transaction
    let _ = refresh_creators_sort(pool, entry_id).await;
    let _ = refresh_fts(pool, entry_id).await;

    Ok(entry_id)
}

async fn refresh_creators_sort(pool: &SqlitePool, entry_id: i64) -> Result<()> {
    #[derive(sqlx::FromRow)]
    struct CRow {
        first_name: Option<String>,
        last_name: Option<String>,
        name: Option<String>,
    }

    let creators: Vec<CRow> = sqlx::query_as(
        "SELECT first_name, last_name, name FROM entry_creators \
         WHERE entry_id = ? ORDER BY sort_order",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?;

    let display = creators
        .iter()
        .map(|c| {
            if let Some(ref name) = c.name {
                name.clone()
            } else {
                match (&c.last_name, &c.first_name) {
                    (Some(l), Some(f)) => format!("{}, {}", l, f),
                    (Some(l), None) => l.clone(),
                    (None, Some(f)) => f.clone(),
                    _ => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("; ");

    sqlx::query("UPDATE entries SET creators_sort = ? WHERE id = ?")
        .bind(&display)
        .bind(entry_id)
        .execute(pool)
        .await?;

    Ok(())
}

async fn refresh_fts(pool: &SqlitePool, entry_id: i64) -> Result<()> {
    // Delete existing FTS row
    sqlx::query("DELETE FROM entries_fts WHERE entry_id = ?")
        .bind(entry_id)
        .execute(pool)
        .await?;

    // Get title and abstract
    let title: Option<String> = sqlx::query_scalar("SELECT title FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_optional(pool)
        .await?;

    let abstract_note: Option<String> = sqlx::query_scalar(
        "SELECT ef.value FROM entry_fields ef JOIN fields f ON ef.field_id = f.id \
         WHERE ef.entry_id = ? AND f.name = 'abstractNote'",
    )
    .bind(entry_id)
    .fetch_optional(pool)
    .await?;

    if let Some(t) = title {
        sqlx::query(
            "INSERT INTO entries_fts (entry_id, title, abstract_note) VALUES (?, ?, ?)",
        )
        .bind(entry_id)
        .bind(&t)
        .bind(abstract_note.unwrap_or_default())
        .execute(pool)
        .await?;
    }

    Ok(())
}
