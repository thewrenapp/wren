use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::entry_json::EntryJson;
use super::outbox;
use super::r2::R2Relay;
use super::writer::entry_to_json;
use crate::firebase::firestore::{
    to_firestore_string, to_firestore_timestamp, FirestoreClient,
};

/// Share metadata stored locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareInfo {
    pub share_id: String,
    pub owner_uid: String,
    pub share_type: String,
    pub collection_key: Option<String>,
    pub role: String,
    pub status: String,
}

// ── Create a share ──────────────────────────────────────────────────

/// Create a new share for entries/collection. Uploads to Firestore + R2.
pub async fn create_share(
    pool: &SqlitePool,
    library_path: &std::path::Path,
    firestore: &FirestoreClient,
    r2: &R2Relay,
    id_token: &str,
    owner_uid: &str,
    share_type: &str,
    collection_key: Option<&str>,
    entry_keys: &[String],
    invitee_uid: &str,
    role: &str,
) -> Result<String> {
    let share_id = uuid::Uuid::new_v4().to_string();

    // 1. Create share document in Firestore
    let share_fields = serde_json::json!({
        "ownerUid": to_firestore_string(owner_uid),
        "type": to_firestore_string(share_type),
        "entryKeys": {
            "arrayValue": {
                "values": entry_keys.iter().map(|k| serde_json::json!({"stringValue": k})).collect::<Vec<_>>()
            }
        },
        "createdAt": to_firestore_timestamp(&chrono::Utc::now().to_rfc3339()),
        "updatedAt": to_firestore_timestamp(&chrono::Utc::now().to_rfc3339()),
    });

    firestore
        .set_document("shares", &share_id, &share_fields, id_token)
        .await?;

    // 2. Add invitee as member
    let member_fields = serde_json::json!({
        "role": to_firestore_string(role),
        "status": to_firestore_string("pending"),
        "addedAt": to_firestore_timestamp(&chrono::Utc::now().to_rfc3339()),
        "addedBy": to_firestore_string(owner_uid),
    });

    firestore
        .set_document(
            &format!("shares/{}/members", share_id),
            invitee_uid,
            &member_fields,
            id_token,
        )
        .await?;

    // 3. Upload entry manifests to Firestore
    for key in entry_keys {
        if let Ok(entry_id) = get_entry_id_by_key(pool, key).await {
            if let Ok(entry_json) = entry_to_json(pool, entry_id).await {
                // Lightweight manifest
                let manifest = serde_json::json!({
                    "title": to_firestore_string(&entry_json.title.v),
                    "itemType": to_firestore_string(&entry_json.item_type.v),
                    "updatedAt": to_firestore_timestamp(&chrono::Utc::now().to_rfc3339()),
                    "updatedBy": to_firestore_string(owner_uid),
                });

                let _ = firestore
                    .set_document(
                        &format!("shares/{}/manifest", share_id),
                        key,
                        &manifest,
                        id_token,
                    )
                    .await;
            }
        }
    }

    // 4. Upload files to R2 relay
    let change_id = "initial";
    for key in entry_keys {
        if let Ok(entry_id) = get_entry_id_by_key(pool, key).await {
            if let Ok(entry_json) = entry_to_json(pool, entry_id).await {
                let json_bytes = serde_json::to_vec_pretty(&entry_json)?;

                // Collect files for this entry
                let mut files: Vec<(String, Vec<u8>)> = Vec::new();
                for att in &entry_json.attachments {
                    if let Some(ref fname) = att.file_name {
                        let file_path = library_path.join("library").join("entries").join(key).join(fname);
                        if file_path.exists() {
                            if let Ok(data) = std::fs::read(&file_path) {
                                files.push((fname.clone(), data));
                            }
                        }
                    }
                }

                let file_refs: Vec<(&str, &[u8])> =
                    files.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();

                r2.upload_entry_for_share(&share_id, &format!("{}/{}", change_id, key), &json_bytes, &file_refs)
                    .await?;
            }
        }
    }

    // 5. Store share locally
    sqlx::query(
        "INSERT OR REPLACE INTO shares (share_id, owner_uid, share_type, collection_key, role, status, created_at) \
         VALUES (?, ?, ?, ?, 'owner', 'active', datetime('now'))",
    )
    .bind(&share_id)
    .bind(owner_uid)
    .bind(share_type)
    .bind(collection_key)
    .execute(pool)
    .await?;

    for key in entry_keys {
        sqlx::query("INSERT OR IGNORE INTO share_entries (share_id, entry_key) VALUES (?, ?)")
            .bind(&share_id)
            .bind(key)
            .execute(pool)
            .await?;
    }

    Ok(share_id)
}

// ── Accept a share ──────────────────────────────────────────────────

/// Accept a pending share invitation. Downloads files from R2 relay.
pub async fn accept_share(
    pool: &SqlitePool,
    library_path: &std::path::Path,
    firestore: &FirestoreClient,
    r2: &R2Relay,
    id_token: &str,
    my_uid: &str,
    share_id: &str,
) -> Result<Vec<String>> {
    // 1. Update member status in Firestore
    let status_update = serde_json::json!({
        "status": to_firestore_string("accepted"),
    });

    firestore
        .set_document(
            &format!("shares/{}/members", share_id),
            my_uid,
            &status_update,
            id_token,
        )
        .await?;

    // 2. Get share info from Firestore
    let share_doc = firestore
        .get_document(&format!("shares/{}", share_id), id_token)
        .await?;

    let entry_keys = extract_entry_keys_from_share_doc(&share_doc);
    let owner_uid = extract_string_field(&share_doc, "ownerUid").unwrap_or_default();
    let share_type = extract_string_field(&share_doc, "type").unwrap_or_default();

    // 3. Download entries from R2 relay
    let mut imported_keys = Vec::new();
    for key in &entry_keys {
        let entry_json_path = format!("relay/{}/initial/{}/entry.json", share_id, key);
        match r2.download(&entry_json_path).await {
            Ok(data) => {
                if let Ok(mut entry_json) = serde_json::from_slice::<EntryJson>(&data) {
                    // Add sharing metadata
                    entry_json.sharing = Some(super::entry_json::SharingInfo {
                        share_id: share_id.to_string(),
                        origin_user_id: owner_uid.clone(),
                        origin_entry_key: key.clone(),
                        role: "editor".to_string(), // TODO: read from member doc
                        received_at: chrono::Utc::now().to_rfc3339(),
                        last_remote_sync: Some(chrono::Utc::now().to_rfc3339()),
                        detached: false,
                    });

                    // Write entry.json to local files/
                    let entry_dir = library_path.join("library").join("entries").join(key);
                    std::fs::create_dir_all(&entry_dir)?;
                    entry_json.write_atomic(&entry_dir)?;

                    // Download associated files
                    for att in &entry_json.attachments {
                        if let Some(ref fname) = att.file_name {
                            let relay_path = format!(
                                "relay/{}/initial/{}/{}",
                                share_id, key, fname
                            );
                            if let Ok(file_data) = r2.download(&relay_path).await {
                                let _ = std::fs::write(entry_dir.join(fname), &file_data);
                            }
                        }
                    }

                    // Upsert into SQLite
                    if let Ok(_id) = super::reader::upsert_entry_from_json(pool, &entry_json).await
                    {
                        imported_keys.push(key.clone());
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Failed to download entry {} from relay: {}", key, e);
            }
        }
    }

    // 4. Store share locally
    sqlx::query(
        "INSERT OR REPLACE INTO shares (share_id, owner_uid, share_type, role, status, created_at) \
         VALUES (?, ?, ?, 'editor', 'active', datetime('now'))",
    )
    .bind(share_id)
    .bind(&owner_uid)
    .bind(&share_type)
    .execute(pool)
    .await?;

    for key in &imported_keys {
        sqlx::query("INSERT OR IGNORE INTO share_entries (share_id, entry_key) VALUES (?, ?)")
            .bind(share_id)
            .bind(key)
            .execute(pool)
            .await?;
    }

    Ok(imported_keys)
}

// ── Propagate changes ───────────────────────────────────────────────

/// Push a local change to a shared entry via Firestore change feed.
pub async fn propagate_change(
    _pool: &SqlitePool,
    firestore: &FirestoreClient,
    id_token: &str,
    my_uid: &str,
    device_id: &str,
    share_id: &str,
    entry_key: &str,
    change_type: &str,
    delta: &serde_json::Value,
    _file_relay_path: Option<&str>,
) -> Result<()> {
    let change_fields = serde_json::json!({
        "entryKey": to_firestore_string(entry_key),
        "authorUid": to_firestore_string(my_uid),
        "deviceId": to_firestore_string(device_id),
        "changeType": to_firestore_string(change_type),
        "delta": { "mapValue": { "fields": delta } },
        "consumed": { "mapValue": { "fields": {} } },
    });

    firestore
        .add_document(
            &format!("shares/{}/changes", share_id),
            &change_fields,
            id_token,
        )
        .await?;

    Ok(())
}

/// Queue a change in the outbox (for when Firebase is offline).
pub async fn queue_change(
    pool: &SqlitePool,
    share_id: &str,
    entry_key: &str,
    change_type: &str,
    delta: &serde_json::Value,
) -> Result<()> {
    outbox::enqueue_change(
        pool,
        share_id,
        entry_key,
        change_type,
        &serde_json::to_string(delta)?,
        None,
    )
    .await?;
    Ok(())
}

/// Flush pending outbox entries to Firebase.
pub async fn flush_outbox(
    pool: &SqlitePool,
    firestore: &FirestoreClient,
    id_token: &str,
    my_uid: &str,
    device_id: &str,
) -> Result<usize> {
    let pending = outbox::get_pending(pool).await?;
    let mut flushed = 0;

    for entry in &pending {
        let delta: serde_json::Value =
            serde_json::from_str(&entry.delta_json).unwrap_or(serde_json::Value::Null);

        match propagate_change(
            pool,
            firestore,
            id_token,
            my_uid,
            device_id,
            &entry.share_id,
            &entry.entry_key,
            &entry.change_type,
            &delta,
            entry.file_path.as_deref(),
        )
        .await
        {
            Ok(_) => {
                outbox::mark_completed(pool, entry.id).await?;
                flushed += 1;
            }
            Err(e) => {
                outbox::mark_failed(pool, entry.id, &e.to_string()).await?;
            }
        }
    }

    if flushed > 0 {
        outbox::clear_completed(pool).await?;
    }

    Ok(flushed)
}

// ── Detach / Leave ──────────────────────────────────────────────────

/// Leave a share voluntarily. Keeps local copies as personal entries.
pub async fn leave_share(
    pool: &SqlitePool,
    firestore: &FirestoreClient,
    id_token: &str,
    my_uid: &str,
    share_id: &str,
) -> Result<()> {
    // Update status in Firestore
    let status_update = serde_json::json!({
        "status": to_firestore_string("left"),
    });

    let _ = firestore
        .set_document(
            &format!("shares/{}/members", share_id),
            my_uid,
            &status_update,
            id_token,
        )
        .await;

    // Detach all entries locally
    detach_share(pool, share_id).await?;

    Ok(())
}

/// Revoke a member's access (owner only).
pub async fn revoke_access(
    _pool: &SqlitePool,
    firestore: &FirestoreClient,
    id_token: &str,
    share_id: &str,
    target_uid: &str,
) -> Result<()> {
    // Delete member from Firestore
    let _ = firestore
        .delete_document(
            &format!("shares/{}/members/{}", share_id, target_uid),
            id_token,
        )
        .await;

    Ok(())
}

/// Detach all entries from a share locally (keep files, mark as personal).
pub async fn detach_share(pool: &SqlitePool, share_id: &str) -> Result<()> {
    // Mark entries as detached
    sqlx::query("UPDATE entries SET is_detached = 1 WHERE share_id = ?")
        .bind(share_id)
        .execute(pool)
        .await?;

    // Update local share status
    sqlx::query("UPDATE shares SET status = 'detached' WHERE share_id = ?")
        .bind(share_id)
        .execute(pool)
        .await?;

    // Discard outbox entries
    outbox::discard_for_share(pool, share_id).await?;

    Ok(())
}

// ── Query helpers ───────────────────────────────────────────────────

/// Get all active shares for the current user.
pub async fn get_active_shares(pool: &SqlitePool) -> Result<Vec<ShareInfo>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        share_id: String,
        owner_uid: String,
        share_type: String,
        collection_key: Option<String>,
        role: String,
        status: String,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT share_id, owner_uid, share_type, collection_key, role, status \
         FROM shares WHERE status = 'active'",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| ShareInfo {
            share_id: r.share_id,
            owner_uid: r.owner_uid,
            share_type: r.share_type,
            collection_key: r.collection_key,
            role: r.role,
            status: r.status,
        })
        .collect())
}

// ── Internal helpers ────────────────────────────────────────────────

async fn get_entry_id_by_key(pool: &SqlitePool, key: &str) -> Result<i64> {
    let id: i64 = sqlx::query_scalar("SELECT id FROM entries WHERE key = ?")
        .bind(key)
        .fetch_one(pool)
        .await?;
    Ok(id)
}

fn extract_entry_keys_from_share_doc(doc: &serde_json::Value) -> Vec<String> {
    doc.get("fields")
        .and_then(|f| f.get("entryKeys"))
        .and_then(|ek| ek.get("arrayValue"))
        .and_then(|av| av.get("values"))
        .and_then(|vals| vals.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.get("stringValue").and_then(|s| s.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn extract_string_field(doc: &serde_json::Value, field: &str) -> Option<String> {
    doc.get("fields")
        .and_then(|f| f.get(field))
        .and_then(|v| v.get("stringValue"))
        .and_then(|s| s.as_str())
        .map(String::from)
}
