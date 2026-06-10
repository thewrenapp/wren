use anyhow::Result;
use sqlx::SqlitePool;

use super::entry_json::EntryJson;
use super::r2::R2Relay;
use super::sharing::{flush_outbox, get_active_shares, get_entry_id_by_key, ShareInfo};
use super::writer::entry_to_json;
use crate::firebase::firestore::{
    to_firestore_string, to_firestore_timestamp, FirestoreClient,
};

// ── Background sync loop ────────────────────────────────────────────

/// Start a background loop that:
/// 1. Flushes outbox (push local changes to Firestore)
/// 2. Auto-adds new entries for library shares we own
/// 3. Consumes incoming changes from active shares
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
            let token_result = crate::commands::auth::get_valid_id_token(&pool).await;
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

            // 0. Ensure user profile exists in Firestore
            crate::commands::auth::ensure_user_profile(&pool).await;

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

            // 3. Auto-add new entries for library shares we own
            let r2 = R2Relay::new(
                &crate::config::r2_account_id(),
                &crate::config::r2_access_key_id(),
                &crate::config::r2_secret_access_key(),
                &crate::config::r2_bucket_name(),
            );

            for share in &active {
                // Owner of a library share: push new entries
                if share.share_type == "library"
                    && share.role == "owner"
                    && let Ok(ref r2) = r2
                    && let Err(e) = sync_new_library_entries(
                        &pool, &lib_path, &firestore, r2, &id_token, &uid, share,
                    )
                    .await
                {
                    tracing::warn!(
                        "Share sync: failed to sync new entries for {}: {}",
                        share.share_id, e
                    );
                }

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

// ── Auto-add new entries to library shares ─────────────────────────

/// For library shares where we are the owner, detect entries not yet in
/// `share_entries` and propagate them as "add" changes so recipients
/// pick them up automatically.
async fn sync_new_library_entries(
    pool: &SqlitePool,
    library_path: &std::path::Path,
    firestore: &FirestoreClient,
    r2: &R2Relay,
    id_token: &str,
    owner_uid: &str,
    share: &ShareInfo,
) -> Result<()> {
    // Find entry keys that exist locally but aren't yet in this share
    let new_keys: Vec<String> = sqlx::query_scalar(
        "SELECT e.key FROM entries e \
         WHERE e.is_deleted = 0 \
           AND e.key NOT IN (SELECT entry_key FROM share_entries WHERE share_id = ?)",
    )
    .bind(&share.share_id)
    .fetch_all(pool)
    .await?;

    if new_keys.is_empty() {
        return Ok(());
    }

    tracing::info!(
        "Library share {}: adding {} new entries",
        share.share_id,
        new_keys.len()
    );

    for key in &new_keys {
        let entry_id = match get_entry_id_by_key(pool, key).await {
            Ok(id) => id,
            Err(_) => continue,
        };

        let entry_json = match entry_to_json(pool, entry_id).await {
            Ok(ej) => ej,
            Err(e) => {
                tracing::warn!("Failed to build entry JSON for {}: {}", key, e);
                continue;
            }
        };

        // Upload to R2
        let change_id = uuid::Uuid::new_v4().to_string();
        let json_bytes = serde_json::to_vec_pretty(&entry_json)?;

        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        for att in &entry_json.attachments {
            if let Some(ref fname) = att.file_name {
                let file_path = library_path
                    .join("library")
                    .join("entries")
                    .join(key)
                    .join(fname);
                if file_path.exists()
                    && let Ok(data) = std::fs::read(&file_path)
                {
                    files.push((fname.clone(), data));
                }
            }
        }

        let file_refs: Vec<(&str, &[u8])> = files
            .iter()
            .map(|(n, d)| (n.as_str(), d.as_slice()))
            .collect();

        if let Err(e) = r2
            .upload_entry_for_share(
                &share.share_id,
                &format!("{}/{}", change_id, key),
                &json_bytes,
                &file_refs,
            )
            .await
        {
            tracing::warn!("Failed to upload new entry {} to R2: {}", key, e);
            continue;
        }

        // Push "add" change to Firestore
        let entry_json_str = serde_json::to_string(&entry_json).unwrap_or_default();
        let change_fields = serde_json::json!({
            "entryKey": to_firestore_string(key),
            "authorUid": to_firestore_string(owner_uid),
            "deviceId": to_firestore_string("desktop"),
            "changeType": to_firestore_string("add"),
            "changeId": to_firestore_string(&change_id),
            "delta": to_firestore_string(&entry_json_str),
            "consumed": { "mapValue": { "fields": {} } },
        });

        if let Err(e) = firestore
            .add_document(
                &format!("shares/{}/changes", share.share_id),
                &change_fields,
                id_token,
            )
            .await
        {
            tracing::warn!("Failed to push add change for {}: {}", key, e);
            continue;
        }

        // Update Firestore manifest
        let manifest = serde_json::json!({
            "title": to_firestore_string(&entry_json.title.v),
            "itemType": to_firestore_string(&entry_json.item_type.v),
            "updatedAt": to_firestore_timestamp(&chrono::Utc::now().to_rfc3339()),
            "updatedBy": to_firestore_string(owner_uid),
        });
        let _ = firestore
            .set_document(
                &format!("shares/{}/manifest", share.share_id),
                key,
                &manifest,
                id_token,
            )
            .await;

        // Register in share_entries
        sqlx::query("INSERT OR IGNORE INTO share_entries (share_id, entry_key) VALUES (?, ?)")
            .bind(&share.share_id)
            .bind(key)
            .execute(pool)
            .await?;

        tracing::debug!("Added entry {} to library share {}", key, share.share_id);
    }

    Ok(())
}

// ── Consume incoming changes ───────────────────────────────────────

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

    let results = firestore.query(&query, id_token).await?;
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
                && map.get(my_uid).is_some()
            {
                continue; // Already consumed
            }

            let entry_key = fields
                .get("entryKey")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let change_type = fields
                .get("changeType")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if entry_key.is_empty() {
                continue;
            }

            // Parse delta string from Firestore
            let delta_str = fields
                .get("delta")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str());

            match change_type {
                "update" => {
                    consume_update(pool, library_path, entry_key, delta_str, app_handle).await;
                }
                "add" => {
                    consume_add(pool, library_path, share_id, entry_key, &fields, delta_str, app_handle).await;
                }
                _ => {
                    tracing::debug!("Ignoring change type: {}", change_type);
                }
            }

            // Mark change as consumed so we don't reprocess it
            mark_consumed(firestore, id_token, my_uid, doc_name).await;
        }
    }

    Ok(())
}

async fn consume_update(
    pool: &SqlitePool,
    library_path: &std::path::Path,
    entry_key: &str,
    delta_str: Option<&str>,
    app_handle: &tauri::AppHandle,
) {
    let Some(delta_str) = delta_str else { return };
    let remote_entry = match serde_json::from_str::<EntryJson>(delta_str) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("Failed to parse shared entry delta for {}: {}", entry_key, e);
            return;
        }
    };

    let existing_id: Option<i64> = sqlx::query_scalar("SELECT id FROM entries WHERE key = ?")
        .bind(entry_key)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

    if let Some(id) = existing_id
        && let Ok(local) = super::writer::entry_to_json(pool, id).await
    {
        let merged = super::merge::merge_entries(&local, &remote_entry);
        if merged.changed {
            let _ = super::reader::upsert_entry_from_json(pool, &merged.merged).await;
            let dir = library_path.join("library").join("entries").join(entry_key);
            let _ = merged.merged.write_atomic(&dir);

            use tauri::Emitter;
            let _ = app_handle.emit("sync:entry-updated", entry_key);
        }
    }
}

async fn consume_add(
    pool: &SqlitePool,
    library_path: &std::path::Path,
    share_id: &str,
    entry_key: &str,
    fields: &serde_json::Value,
    delta_str: Option<&str>,
    app_handle: &tauri::AppHandle,
) {
    let change_id = fields
        .get("changeId")
        .and_then(|v| v.get("stringValue"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let author_uid = fields
        .get("authorUid")
        .and_then(|v| v.get("stringValue"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Skip if this entry already exists locally
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM entries WHERE key = ?")
        .bind(entry_key)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

    if exists.is_some() {
        return;
    }

    // Try to parse from delta first (inline JSON)
    let mut entry_json = delta_str.and_then(|ds| serde_json::from_str::<EntryJson>(ds).ok());

    // Fall back to R2 download
    if entry_json.is_none()
        && !change_id.is_empty()
        && let Ok(r2) = make_r2()
        && let Ok(data) = r2.download(&format!("relay/{}/{}/{}/entry.json", share_id, change_id, entry_key)).await
    {
        entry_json = serde_json::from_slice(&data).ok();
    }

    let Some(mut ej) = entry_json else { return };

    // Resolve our role from the local share record
    let my_role: String = sqlx::query_scalar("SELECT role FROM shares WHERE share_id = ?")
        .bind(share_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| "viewer".to_string());

    ej.sharing = Some(super::entry_json::SharingInfo {
        share_id: share_id.to_string(),
        origin_user_id: author_uid.to_string(),
        origin_entry_key: entry_key.to_string(),
        role: my_role,
        received_at: chrono::Utc::now().to_rfc3339(),
        last_remote_sync: Some(chrono::Utc::now().to_rfc3339()),
        detached: false,
    });
    ej.tombstones.clear();

    let entry_dir = library_path.join("library").join("entries").join(entry_key);
    if tokio::fs::create_dir_all(&entry_dir).await.is_err() {
        return;
    }
    if ej.write_atomic(&entry_dir).is_err() {
        return;
    }

    // Download attachment files from R2
    if !change_id.is_empty()
        && let Ok(r2) = make_r2()
    {
        for att in &ej.attachments {
            if let Some(ref fname) = att.file_name {
                let relay_path = format!(
                    "relay/{}/{}/{}/{}",
                    share_id, change_id, entry_key, fname
                );
                if let Ok(file_data) = r2.download(&relay_path).await {
                    let _ = tokio::fs::write(entry_dir.join(fname), &file_data).await;
                }
            }
        }
    }

    if super::reader::upsert_entry_from_json(pool, &ej).await.is_ok() {
        // Register in share_entries
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO share_entries (share_id, entry_key) VALUES (?, ?)",
        )
        .bind(share_id)
        .bind(entry_key)
        .execute(pool)
        .await;

        use tauri::Emitter;
        let _ = app_handle.emit("sync:entry-added", entry_key);
        tracing::debug!("Imported new shared entry {} from share {}", entry_key, share_id);
    }
}

async fn mark_consumed(
    firestore: &FirestoreClient,
    id_token: &str,
    my_uid: &str,
    doc_name: &str,
) {
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

fn make_r2() -> Result<R2Relay> {
    R2Relay::new(
        &crate::config::r2_account_id(),
        &crate::config::r2_access_key_id(),
        &crate::config::r2_secret_access_key(),
        &crate::config::r2_bucket_name(),
    )
}
