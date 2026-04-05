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

/// Parameters for creating a new share.
pub struct CreateShareParams<'a> {
    pub pool: &'a SqlitePool,
    pub library_path: &'a std::path::Path,
    pub firestore: &'a FirestoreClient,
    pub r2: &'a R2Relay,
    pub id_token: &'a str,
    pub owner_uid: &'a str,
    pub share_type: &'a str,
    pub collection_key: Option<&'a str>,
    pub entry_keys: &'a [String],
    pub invitee_email: &'a str,
    pub role: &'a str,
}

/// Create a new share for entries/collection. Uploads to Firestore + R2.
pub async fn create_share(params: CreateShareParams<'_>) -> Result<String> {
    let CreateShareParams {
        pool,
        library_path,
        firestore,
        r2,
        id_token,
        owner_uid,
        share_type,
        collection_key,
        entry_keys,
        invitee_email,
        role,
    } = params;
    let share_id = uuid::Uuid::new_v4().to_string();

    // 1. Create share document in Firestore
    let share_fields = serde_json::json!({
        "ownerUid": to_firestore_string(owner_uid),
        "type": to_firestore_string(share_type),
        "collectionName": to_firestore_string(collection_key.unwrap_or("")),
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

    // 2. Create invitation by email
    let invitation_fields = serde_json::json!({
        "email": to_firestore_string(invitee_email),
        "role": to_firestore_string(role),
        "status": to_firestore_string("pending"),
        "invitedAt": to_firestore_timestamp(&chrono::Utc::now().to_rfc3339()),
        "invitedBy": to_firestore_string(owner_uid),
    });

    firestore
        .add_document(
            &format!("shares/{}/invitations", share_id),
            &invitation_fields,
            id_token,
        )
        .await?;

    // 3. Batch-fetch all entry JSONs (avoids N+1 queries)
    let mut entry_jsons: Vec<(String, super::entry_json::EntryJson)> = Vec::new();
    for key in entry_keys {
        if let Ok(entry_id) = get_entry_id_by_key(pool, key).await
            && let Ok(ej) = entry_to_json(pool, entry_id).await {
                entry_jsons.push((key.clone(), ej));
            }
    }

    // 4. Upload entry manifests to Firestore
    for (key, entry_json) in &entry_jsons {
        let manifest = serde_json::json!({
            "title": to_firestore_string(&entry_json.title.v),
            "itemType": to_firestore_string(&entry_json.item_type.v),
            "updatedAt": to_firestore_timestamp(&chrono::Utc::now().to_rfc3339()),
            "updatedBy": to_firestore_string(owner_uid),
        });

        if let Err(e) = firestore
            .set_document(
                &format!("shares/{}/manifest", share_id),
                key,
                &manifest,
                id_token,
            )
            .await
        {
            tracing::warn!("Failed to upload manifest for {}: {}", key, e);
        }
    }

    // 5. Upload files to R2 relay
    let change_id = "initial";
    for (key, entry_json) in &entry_jsons {
        let json_bytes = serde_json::to_vec_pretty(entry_json)?;

        // Collect files for this entry
        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        for att in &entry_json.attachments {
            if let Some(ref fname) = att.file_name {
                let file_path = library_path.join("library").join("entries").join(key).join(fname);
                if file_path.exists()
                    && let Ok(data) = std::fs::read(&file_path) {
                        files.push((fname.clone(), data));
                    }
            }
        }

        let file_refs: Vec<(&str, &[u8])> =
            files.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();

        r2.upload_entry_for_share(&share_id, &format!("{}/{}", change_id, key), &json_bytes, &file_refs)
            .await?;
    }

    // 6. Store share locally
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

    // Resolve the user's role from the invitation
    let my_email_lower = {
        let row: Option<String> = sqlx::query_scalar("SELECT email FROM user_account LIMIT 1")
            .fetch_optional(pool)
            .await?;
        row.unwrap_or_default().to_lowercase()
    };
    let mut resolved_role: Option<String> = None;
    // Query invitations to find our role
    let invitations_query = serde_json::json!({
        "from": [{ "collectionId": "invitations" }],
        "where": {
            "fieldFilter": {
                "field": { "fieldPath": "email" },
                "op": "EQUAL",
                "value": { "stringValue": my_email_lower }
            }
        }
    });
    if let Ok(inv_results) = firestore.query(&invitations_query, id_token).await {
        for inv in &inv_results {
            if let Some(doc) = inv.get("document") {
                let name = doc.get("name").and_then(|n| n.as_str()).unwrap_or("");
                // Only match invitations for THIS share
                if name.contains(&format!("shares/{}/invitations/", share_id))
                    && let Some(fields) = doc.get("fields")
                        && let Some(r) = fields.get("role").and_then(|v| v.get("stringValue")).and_then(|v| v.as_str()) {
                            resolved_role = Some(r.to_string());
                        }
            }
        }
    }
    let resolved_role = resolved_role.unwrap_or_else(|| {
        tracing::warn!("Could not resolve role for share {}, defaulting to viewer", share_id);
        "viewer".to_string()
    });

    // 3. Download entries from R2 relay
    let mut imported_keys = Vec::new();
    for key in &entry_keys {
        let entry_json_path = format!("relay/{}/initial/{}/entry.json", share_id, key);
        match r2.download(&entry_json_path).await {
            Ok(data) => {
                if let Ok(mut entry_json) = serde_json::from_slice::<EntryJson>(&data) {
                    // Add sharing metadata with resolved role
                    entry_json.sharing = Some(super::entry_json::SharingInfo {
                        share_id: share_id.to_string(),
                        origin_user_id: owner_uid.clone(),
                        origin_entry_key: key.clone(),
                        role: resolved_role.clone(),
                        received_at: chrono::Utc::now().to_rfc3339(),
                        last_remote_sync: Some(chrono::Utc::now().to_rfc3339()),
                        detached: false,
                    });

                    // Strip tombstones from incoming shared entries
                    entry_json.tombstones.clear();

                    // Write entry.json to local library
                    let entry_dir = library_path.join("library").join("entries").join(key);
                    tokio::fs::create_dir_all(&entry_dir).await?;
                    entry_json.write_atomic(&entry_dir)?;

                    // Download associated files (async)
                    for att in &entry_json.attachments {
                        if let Some(ref fname) = att.file_name {
                            let relay_path = format!(
                                "relay/{}/initial/{}/{}",
                                share_id, key, fname
                            );
                            match r2.download(&relay_path).await {
                                Ok(file_data) => {
                                    if let Err(e) = tokio::fs::write(entry_dir.join(fname), &file_data).await {
                                        tracing::warn!("Failed to write file {}: {}", fname, e);
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!("Failed to download {} from relay: {}", fname, e);
                                }
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

/// Parameters for propagating a change to a shared entry.
pub struct PropagateChangeParams<'a> {
    pub firestore: &'a FirestoreClient,
    pub id_token: &'a str,
    pub my_uid: &'a str,
    pub device_id: &'a str,
    pub share_id: &'a str,
    pub entry_key: &'a str,
    pub change_type: &'a str,
    pub delta: &'a serde_json::Value,
}

/// Push a local change to a shared entry via Firestore change feed.
pub async fn propagate_change(params: PropagateChangeParams<'_>) -> Result<()> {
    let PropagateChangeParams {
        firestore,
        id_token,
        my_uid,
        device_id,
        share_id,
        entry_key,
        change_type,
        delta,
    } = params;
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

        match propagate_change(PropagateChangeParams {
            firestore,
            id_token,
            my_uid,
            device_id,
            share_id: &entry.share_id,
            entry_key: &entry.entry_key,
            change_type: &entry.change_type,
            delta: &delta,
        })
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

// ── Background sync loop ────────────────────────────────────────────

/// Start a background loop that:
/// 1. Flushes outbox (push local changes to Firestore)
/// 2. Consumes incoming changes from active shares
///
/// Runs every 30 seconds while signed in.
pub fn start_share_sync_loop(
    pool: SqlitePool,
    library_path: std::sync::Arc<tokio::sync::RwLock<std::path::PathBuf>>,
    app_handle: tauri::AppHandle,
) {
    tokio::spawn(async move {
        let mut backoff_secs = 30u64;
        let max_backoff = 300u64; // 5 minutes max

        loop {
            tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;

            // Check if signed in
            let token_result =
                crate::commands::auth::get_valid_id_token(&pool).await;
            let (id_token, uid, _email) = match token_result {
                Ok(t) => {
                    backoff_secs = 30; // Reset backoff on success
                    t
                }
                Err(_) => {
                    backoff_secs = (backoff_secs * 2).min(max_backoff);
                    continue;
                }
            };

            let firestore = FirestoreClient::new(crate::config::FIREBASE_PROJECT_ID);

            // 1. Flush outbox
            match flush_outbox(&pool, &firestore, &id_token, &uid, "desktop").await {
                Ok(count) if count > 0 => {
                    tracing::debug!("Share sync: flushed {} outbox entries", count);
                }
                Err(e) => {
                    tracing::warn!("Share sync: outbox flush failed: {}", e);
                }
                _ => {}
            }

            // 2. Consume incoming changes for active shares
            let active = match get_active_shares(&pool).await {
                Ok(shares) => shares,
                Err(_) => continue,
            };

            let lib_path = library_path.read().await.clone();

            for share in &active {
                if let Err(e) = consume_share_changes(
                    &pool, &lib_path, &firestore, &id_token, &uid, &share.share_id, &app_handle,
                )
                .await
                {
                    tracing::warn!(
                        "Share sync: failed to consume changes for {}: {}",
                        share.share_id, e
                    );
                }
            }
        }
    });
}

/// Consume incoming changes for a specific share from Firestore.
async fn consume_share_changes(
    pool: &SqlitePool,
    library_path: &std::path::Path,
    firestore: &FirestoreClient,
    id_token: &str,
    my_uid: &str,
    share_id: &str,
    app_handle: &tauri::AppHandle,
) -> Result<()> {
    // Query changes subcollection for this share
    let query = serde_json::json!({
        "from": [{ "collectionId": "changes" }],
        "orderBy": [{ "field": { "fieldPath": "createdAt" }, "direction": "ASCENDING" }],
        "limit": 50
    });

    // Query scoped to this share's changes subcollection
    // The Firestore REST query runs against the parent path
    let results = firestore
        .query(&query, id_token)
        .await?;

    let share_path_prefix = format!("shares/{}/changes/", share_id);

    for result in &results {
        if let Some(doc) = result.get("document") {
            // Only process changes belonging to this share
            let doc_name = doc.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if !doc_name.contains(&share_path_prefix) {
                continue;
            }

            let fields = doc.get("fields").cloned().unwrap_or(serde_json::Value::Null);

            // Check if already consumed by us
            if let Some(consumed) = fields.get("consumed")
                && let Some(map) = consumed.get("mapValue").and_then(|m| m.get("fields"))
                    && map.get(my_uid).is_some() {
                        continue; // Already consumed
                    }

            let entry_key = fields.get("entryKey")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let change_type = fields.get("changeType")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if entry_key.is_empty() {
                continue;
            }

            match change_type {
                "update" => {
                    // The delta contains the full entry.json — merge with local
                    if let Some(delta) = fields.get("delta")
                        && let Some(delta_str) = delta.get("stringValue").and_then(|v| v.as_str()) {
                            match serde_json::from_str::<super::entry_json::EntryJson>(delta_str) {
                            Err(e) => {
                                tracing::warn!("Failed to parse shared entry delta for {}: {}", entry_key, e);
                            }
                            Ok(remote_entry) => {
                                let existing_id: Option<i64> = sqlx::query_scalar(
                                    "SELECT id FROM entries WHERE key = ?",
                                )
                                .bind(entry_key)
                                .fetch_optional(pool)
                                .await?;

                                if let Some(id) = existing_id {
                                    let local = super::writer::entry_to_json(pool, id).await?;
                                    let merged = super::merge::merge_entries(&local, &remote_entry);
                                    if merged.changed {
                                        super::reader::upsert_entry_from_json(pool, &merged.merged).await?;
                                        let dir = library_path.join("library").join("entries").join(entry_key);
                                        merged.merged.write_atomic(&dir)?;

                                        use tauri::Emitter;
                                        let _ = app_handle.emit("sync:entry-updated", entry_key);
                                    }
                                }
                            }}
                        }
                }
                _ => {
                    tracing::debug!("Ignoring change type: {}", change_type);
                }
            }

            // Mark change as consumed so we don't reprocess it
            let doc_name = doc.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if let Some(doc_path) = doc_name.split("/documents/").nth(1) {
                let parts: Vec<&str> = doc_path.rsplitn(2, '/').collect();
                if parts.len() == 2 {
                    let update = serde_json::json!({
                        "consumed": {
                            "mapValue": {
                                "fields": {
                                    my_uid: { "booleanValue": true }
                                }
                            }
                        }
                    });
                    let _ = firestore.set_document(parts[1], parts[0], &update, id_token).await;
                }
            }
        }
    }

    Ok(())
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
