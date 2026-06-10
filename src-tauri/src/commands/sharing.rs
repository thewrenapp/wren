use crate::commands::auth::get_valid_id_token;
use crate::config;
use crate::firebase::firestore::FirestoreClient;
use crate::state::AppState;
use crate::sync::sharing;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct PendingShareInfo {
    #[serde(rename = "shareId")]
    pub share_id: String,
    #[serde(rename = "ownerEmail")]
    pub owner_email: String,
    #[serde(rename = "collectionName")]
    pub collection_name: Option<String>,
    #[serde(rename = "entryCount")]
    pub entry_count: usize,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct AcceptShareResult {
    #[serde(rename = "importedCount")]
    pub imported_count: usize,
}

/// Get active local shares.
#[tauri::command]
pub async fn get_shares(
    state: State<'_, AppState>,
) -> Result<Vec<sharing::ShareInfo>, String> {
    sharing::get_active_shares(&state.db)
        .await
        .map_err(|e| e.to_string())
}

/// Poll Firestore for pending share invitations for the current user.
#[tauri::command]
pub async fn check_pending_shares(
    state: State<'_, AppState>,
) -> Result<Vec<PendingShareInfo>, String> {
    let (id_token, _uid, email) = get_valid_id_token(&state.db).await?;

    if email.is_empty() {
        return Ok(vec![]);
    }

    let firestore = FirestoreClient::new(config::FIREBASE_PROJECT_ID);

    // Query all invitations subcollections where email matches and status is pending
    // This uses a collection group query via runQuery
    let query = serde_json::json!({
        "from": [{ "collectionId": "invitations", "allDescendants": true }],
        "where": {
            "compositeFilter": {
                "op": "AND",
                "filters": [
                    {
                        "fieldFilter": {
                            "field": { "fieldPath": "email" },
                            "op": "EQUAL",
                            "value": { "stringValue": email.to_lowercase() }
                        }
                    },
                    {
                        "fieldFilter": {
                            "field": { "fieldPath": "status" },
                            "op": "EQUAL",
                            "value": { "stringValue": "pending" }
                        }
                    }
                ]
            }
        }
    });

    let results = firestore
        .query(&query, &id_token)
        .await
        .map_err(|e| e.to_string())?;

    let mut pending = Vec::new();

    for result in &results {
        if let Some(doc) = result.get("document") {
            // Extract share_id from the document path: .../shares/{shareId}/invitations/{invId}
            let name = doc.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let parts: Vec<&str> = name.split('/').collect();
            let share_id = parts.iter()
                .position(|&p| p == "shares")
                .and_then(|i| parts.get(i + 1))
                .map(|s| s.to_string())
                .unwrap_or_default();

            if share_id.is_empty() {
                continue;
            }

            let fields = doc.get("fields").cloned().unwrap_or(serde_json::Value::Null);
            let role = fields.get("role")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("viewer")
                .to_string();

            // Fetch the parent share doc for metadata
            let share_doc = firestore
                .get_document(&format!("shares/{}", share_id), &id_token)
                .await
                .ok();

            let (owner_email, collection_name, entry_count) = if let Some(ref sd) = share_doc {
                let sf = sd.get("fields").cloned().unwrap_or(serde_json::Value::Null);
                let owner_uid = sf.get("ownerUid")
                    .and_then(|v| v.get("stringValue"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                // Try to get owner's email from users collection
                let owner_email = firestore
                    .get_document(&format!("users/{}", owner_uid), &id_token)
                    .await
                    .ok()
                    .and_then(|ud| {
                        ud.get("fields")
                            .and_then(|f| f.get("email"))
                            .and_then(|v| v.get("stringValue"))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    })
                    .unwrap_or_else(|| owner_uid.to_string());

                let coll_name = sf.get("collectionName")
                    .and_then(|v| v.get("stringValue"))
                    .and_then(|v| v.as_str())
                    .map(String::from);

                let count = sf.get("entryKeys")
                    .and_then(|v| v.get("arrayValue"))
                    .and_then(|v| v.get("values"))
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);

                (owner_email, coll_name, count)
            } else {
                (String::new(), None, 0)
            };

            pending.push(PendingShareInfo {
                share_id,
                owner_email,
                collection_name,
                entry_count,
                role,
            });
        }
    }

    Ok(pending)
}

/// Accept a pending share invitation.
#[tauri::command]
pub async fn accept_share(
    state: State<'_, AppState>,
    share_id: String,
) -> Result<AcceptShareResult, String> {
    let (id_token, uid, _email) = get_valid_id_token(&state.db).await?;
    let library_path = state.library_path.read().await;

    let firestore = FirestoreClient::new(config::FIREBASE_PROJECT_ID);
    let r2 = crate::sync::r2::R2Relay::new(
        &config::r2_account_id(),
        &config::r2_access_key_id(),
        &config::r2_secret_access_key(),
        &config::r2_bucket_name(),
    )
    .map_err(|e| e.to_string())?;

    let imported = sharing::accept_share(
        &state.db,
        &library_path,
        &firestore,
        &r2,
        &id_token,
        &uid,
        &share_id,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(AcceptShareResult {
        imported_count: imported.len(),
    })
}

/// Decline a pending share invitation.
#[tauri::command]
pub async fn decline_share(
    state: State<'_, AppState>,
    share_id: String,
) -> Result<(), String> {
    let (id_token, _uid, email) = get_valid_id_token(&state.db).await?;
    let firestore = FirestoreClient::new(config::FIREBASE_PROJECT_ID);

    // Query the invitations subcollection to find our invitation doc
    let query = serde_json::json!({
        "from": [{ "collectionId": "invitations", "allDescendants": true }],
        "where": {
            "compositeFilter": {
                "op": "AND",
                "filters": [
                    {
                        "fieldFilter": {
                            "field": { "fieldPath": "email" },
                            "op": "EQUAL",
                            "value": { "stringValue": email.to_lowercase() }
                        }
                    },
                    {
                        "fieldFilter": {
                            "field": { "fieldPath": "status" },
                            "op": "EQUAL",
                            "value": { "stringValue": "pending" }
                        }
                    }
                ]
            }
        }
    });

    let results = firestore.query(&query, &id_token).await.map_err(|e| e.to_string())?;

    // Find the invitation doc that belongs to this share
    for result in &results {
        if let Some(doc) = result.get("document") {
            let name = doc.get("name").and_then(|n| n.as_str()).unwrap_or("");
            // Path looks like: projects/.../shares/{shareId}/invitations/{invId}
            if name.contains(&format!("shares/{}/invitations/", share_id)) {
                // Extract the relative doc path for update
                // name is full path, we need just shares/{shareId}/invitations/{invId}
                if let Some(doc_path) = name.split("/documents/").nth(1) {
                    let update = serde_json::json!({
                        "status": crate::firebase::firestore::to_firestore_string("declined"),
                    });
                    // Extract the collection and doc ID parts
                    let parts: Vec<&str> = doc_path.rsplitn(2, '/').collect();
                    if parts.len() == 2 {
                        let collection = parts[1];
                        let doc_id = parts[0];
                        let _ = firestore.set_document(collection, doc_id, &update, &id_token).await;
                    }
                }
                break;
            }
        }
    }

    Ok(())
}

/// Leave an active share. Keeps local copies as personal entries.
#[tauri::command]
pub async fn leave_share(
    state: State<'_, AppState>,
    share_id: String,
) -> Result<(), String> {
    let (id_token, uid, _email) = get_valid_id_token(&state.db).await?;
    let firestore = FirestoreClient::new(config::FIREBASE_PROJECT_ID);

    sharing::leave_share(&state.db, &firestore, &id_token, &uid, &share_id)
        .await
        .map_err(|e| e.to_string())
}

/// Create a share — upload to Firestore + R2.
#[tauri::command]
pub async fn create_share(
    state: State<'_, AppState>,
    email: String,
    role: String,
    share_type: String,
    collection_id: Option<i64>,
    entry_ids: Option<Vec<i64>>,
) -> Result<String, String> {
    // Validate email format
    if !email.contains('@') || !email.contains('.') || email.len() < 5 {
        return Err("Invalid email address".to_string());
    }

    let (id_token, uid, _my_email) = get_valid_id_token(&state.db).await?;
    let library_path = state.library_path.read().await;

    // Check if trying to re-share entries that were shared with us as viewer
    if share_type == "entries"
        && let Some(ref ids) = entry_ids {
            for id in ids {
                let role: Option<String> = sqlx::query_scalar(
                    "SELECT sharing_role FROM entries WHERE id = ? AND sharing_role = 'viewer'",
                )
                .bind(id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| e.to_string())?;

                if role.is_some() {
                    return Err("Cannot re-share entries you have view-only access to".to_string());
                }
            }
        }

    let firestore = FirestoreClient::new(config::FIREBASE_PROJECT_ID);
    let r2 = crate::sync::r2::R2Relay::new(
        &config::r2_account_id(),
        &config::r2_access_key_id(),
        &config::r2_secret_access_key(),
        &config::r2_bucket_name(),
    )
    .map_err(|e| e.to_string())?;

    // Resolve entry keys based on share type
    let entry_keys: Vec<String> = match share_type.as_str() {
        "library" => {
            sqlx::query_scalar("SELECT key FROM entries WHERE is_deleted = 0")
                .fetch_all(&state.db)
                .await
                .map_err(|e| e.to_string())?
        }
        "collection" => {
            let cid = collection_id.ok_or("collection_id required for collection share")?;
            sqlx::query_scalar(
                "SELECT e.key FROM entries e \
                 JOIN collection_entries ce ON e.id = ce.entry_id \
                 WHERE ce.collection_id = ? AND e.is_deleted = 0",
            )
            .bind(cid)
            .fetch_all(&state.db)
            .await
            .map_err(|e| e.to_string())?
        }
        "entries" => {
            let ids = entry_ids.unwrap_or_default();
            let mut keys = Vec::new();
            for id in ids {
                if let Ok(key) = sqlx::query_scalar::<_, String>(
                    "SELECT key FROM entries WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&state.db)
                .await
                {
                    keys.push(key);
                }
            }
            keys
        }
        _ => return Err(format!("Unknown share type: {}", share_type)),
    };

    if entry_keys.is_empty() && share_type != "library" {
        return Err("No entries to share".to_string());
    }

    // Get collection name for display
    let collection_name = if let Some(cid) = collection_id {
        sqlx::query_scalar::<_, String>("SELECT name FROM collections WHERE id = ?")
            .bind(cid)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
    } else {
        None
    };

    let share_id = sharing::create_share(sharing::CreateShareParams {
        pool: &state.db,
        library_path: &library_path,
        firestore: &firestore,
        r2: &r2,
        id_token: &id_token,
        owner_uid: &uid,
        share_type: &share_type,
        collection_key: collection_name.as_deref(),
        entry_keys: &entry_keys,
        invitee_email: &email.to_lowercase(),
        role: &role,
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(share_id)
}

/// Search Firestore users collection by email prefix for autocomplete.
#[tauri::command]
pub async fn search_users_by_email(
    state: State<'_, AppState>,
    prefix: String,
) -> Result<Vec<UserSuggestion>, String> {
    if prefix.len() < 2 {
        return Ok(vec![]);
    }

    let (id_token, _uid, my_email) = get_valid_id_token(&state.db).await?;
    let firestore = FirestoreClient::new(config::FIREBASE_PROJECT_ID);
    let prefix_lower = prefix.to_lowercase();

    // Firestore range query to simulate prefix matching:
    // email >= "prefix" AND email < "prefix\u{f8ff}"
    // \u{f8ff} is a high Unicode char that sorts after most regular characters
    let end_prefix = format!("{}\u{f8ff}", prefix_lower);

    let query = serde_json::json!({
        "from": [{ "collectionId": "users" }],
        "where": {
            "compositeFilter": {
                "op": "AND",
                "filters": [
                    {
                        "fieldFilter": {
                            "field": { "fieldPath": "email" },
                            "op": "GREATER_THAN_OR_EQUAL",
                            "value": { "stringValue": prefix_lower }
                        }
                    },
                    {
                        "fieldFilter": {
                            "field": { "fieldPath": "email" },
                            "op": "LESS_THAN",
                            "value": { "stringValue": end_prefix }
                        }
                    }
                ]
            }
        },
        "limit": 5
    });

    let results = firestore
        .query(&query, &id_token)
        .await
        .map_err(|e| e.to_string())?;

    let mut suggestions = Vec::new();
    for result in &results {
        if let Some(doc) = result.get("document") {
            let fields = doc.get("fields").cloned().unwrap_or(serde_json::Value::Null);
            let email = fields
                .get("email")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let display_name = fields
                .get("displayName")
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Don't suggest the current user
            if email.eq_ignore_ascii_case(&my_email) {
                continue;
            }

            if !email.is_empty() {
                suggestions.push(UserSuggestion { email, display_name });
            }
        }
    }

    Ok(suggestions)
}

#[derive(Debug, Serialize)]
pub struct UserSuggestion {
    pub email: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
}
