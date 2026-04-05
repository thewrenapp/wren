use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row, SqlitePool};

/// A pending change to push to Firebase for shared entries.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OutboxEntry {
    pub id: i64,
    pub share_id: String,
    pub entry_key: String,
    pub change_type: String,
    pub delta_json: String,
    pub file_path: Option<String>,
    pub created_at: String,
    pub retry_count: i64,
    pub last_error: Option<String>,
    pub status: String,
}

/// Enqueue a change for a shared entry.
pub async fn enqueue_change(
    pool: &SqlitePool,
    share_id: &str,
    entry_key: &str,
    change_type: &str,
    delta_json: &str,
    file_path: Option<&str>,
) -> Result<i64> {
    let row = sqlx::query(
        "INSERT INTO sync_outbox (share_id, entry_key, change_type, delta_json, file_path) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(share_id)
    .bind(entry_key)
    .bind(change_type)
    .bind(delta_json)
    .bind(file_path)
    .fetch_one(pool)
    .await?;

    Ok(row.get("id"))
}

/// Get all pending outbox entries, oldest first.
pub async fn get_pending(pool: &SqlitePool) -> Result<Vec<OutboxEntry>> {
    Ok(sqlx::query_as(
        "SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await?)
}

/// Mark an outbox entry as completed (will be cleaned up later).
pub async fn mark_completed(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("UPDATE sync_outbox SET status = 'complete' WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Mark an outbox entry as failed with an error message.
pub async fn mark_failed(pool: &SqlitePool, id: i64, error: &str) -> Result<()> {
    sqlx::query(
        "UPDATE sync_outbox SET status = 'failed', last_error = ?, \
         retry_count = retry_count + 1 WHERE id = ?",
    )
    .bind(error)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Reset a failed entry back to pending for retry.
pub async fn retry_entry(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("UPDATE sync_outbox SET status = 'pending' WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Clean up completed outbox entries.
pub async fn clear_completed(pool: &SqlitePool) -> Result<u64> {
    let result = sqlx::query("DELETE FROM sync_outbox WHERE status = 'complete'")
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

/// Discard all outbox entries for a specific share (e.g., when access is revoked).
pub async fn discard_for_share(pool: &SqlitePool, share_id: &str) -> Result<u64> {
    let result = sqlx::query("DELETE FROM sync_outbox WHERE share_id = ?")
        .bind(share_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
