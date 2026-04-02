use crate::db::models::{Collection, CreateCollectionInput};
use crate::state::AppState;
use sqlx::{Row, FromRow};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct CollectionRow {
    id: i64,
    key: String,
    name: String,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<i64>,
    item_count: i64,
}

#[tauri::command]
pub async fn get_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    let collections: Vec<CollectionRow> = sqlx::query_as::<_, CollectionRow>(
        r#"
        SELECT
            c.id,
            c.key,
            c.name,
            c.description,
            c.color,
            c.icon,
            c.parent_id,
            COALESCE((
                SELECT COUNT(*)
                FROM collection_entries ce
                INNER JOIN entries e ON e.id = ce.entry_id
                WHERE ce.collection_id = c.id AND e.is_deleted = 0
            ), 0) as item_count
        FROM collections c
        ORDER BY c.name
        "#
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(collections
        .into_iter()
        .map(|c| Collection {
            id: c.id,
            key: c.key,
            name: c.name,
            description: c.description,
            color: c.color,
            icon: c.icon,
            parent_id: c.parent_id,
            item_count: c.item_count,
        })
        .collect())
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    input: CreateCollectionInput,
) -> Result<Collection, String> {
    let key = Uuid::new_v4().to_string();

    let result = sqlx::query(
        r#"
        INSERT INTO collections (key, name, description, color, icon)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
        "#
    )
    .bind(&key)
    .bind(&input.name)
    .bind(&input.description)
    .bind(&input.color)
    .bind(&input.icon)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Collection {
        id: result.get("id"),
        key,
        name: input.name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        parent_id: input.parent_id,
        item_count: 0,
    })
}

#[tauri::command]
pub async fn update_collection(
    state: State<'_, AppState>,
    id: i64,
    name: Option<String>,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    if let Some(n) = name {
        sqlx::query("UPDATE collections SET name = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(n)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(d) = description {
        sqlx::query("UPDATE collections SET description = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(d)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(c) = color {
        sqlx::query("UPDATE collections SET color = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(c)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(i) = icon {
        sqlx::query("UPDATE collections SET icon = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(i)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_collection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Clean up cross-doc RAPTOR summaries for this collection in background
    {
        let db = state.db.clone();
        let library_path = state.library_path.clone();
        let collection_id = id;
        tokio::spawn(async move {
            tracing::debug!("Background task started: cleanup_collection_raptor for collection {}", collection_id);
            let result = std::panic::AssertUnwindSafe(
                cleanup_collection_raptor(&db, &library_path, collection_id)
            );
            match futures::FutureExt::catch_unwind(result).await {
                Ok(()) => tracing::debug!("Background task completed: cleanup_collection_raptor for collection {}", collection_id),
                Err(_) => tracing::error!("Background task panicked: cleanup_collection_raptor for collection {}", collection_id),
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn add_item_to_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO collection_entries (collection_id, entry_id, order_index)
        VALUES (?, ?, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM collection_entries WHERE collection_id = ?))
        "#
    )
    .bind(collection_id)
    .bind(entry_id)
    .bind(collection_id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    crate::commands::rag::spawn_collection_raptor_rebuild(
        state.db.clone(), state.library_path.clone(), collection_id,
    );

    Ok(())
}

#[tauri::command]
pub async fn remove_item_from_collection(
    state: State<'_, AppState>,
    entry_id: i64,
    collection_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_entries WHERE collection_id = ? AND entry_id = ?")
        .bind(collection_id)
        .bind(entry_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    crate::commands::rag::spawn_collection_raptor_rebuild(
        state.db.clone(), state.library_path.clone(), collection_id,
    );

    Ok(())
}

/// Merge multiple collections into a target collection
/// - Moves all entries from source collections to target
/// - Optionally renames the target collection
/// - Optionally changes the target collection's color
/// - Deletes the source collections
#[tauri::command]
pub async fn merge_collections(
    state: State<'_, AppState>,
    target_id: i64,
    source_ids: Vec<i64>,
    new_name: Option<String>,
    new_color: Option<String>,
) -> Result<u32, String> {
    // Move entries from source collections to target (avoiding duplicates)
    for source_id in &source_ids {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO collection_entries (collection_id, entry_id, order_index)
            SELECT ?, entry_id, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM collection_entries WHERE collection_id = ?)
            FROM collection_entries
            WHERE collection_id = ?
            "#
        )
        .bind(target_id)
        .bind(target_id)
        .bind(source_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Update target collection name if provided
    if let Some(name) = new_name {
        sqlx::query("UPDATE collections SET name = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&name)
            .bind(target_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Update target collection color if provided
    if let Some(color) = new_color {
        sqlx::query("UPDATE collections SET color = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&color)
            .bind(target_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Delete source collections and their cross-doc RAPTOR summaries
    let merged_count = source_ids.len() as u32;
    for source_id in &source_ids {
        sqlx::query("DELETE FROM collections WHERE id = ?")
            .bind(source_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Rebuild cross-doc RAPTOR for the target (merged) collection
    crate::commands::rag::spawn_collection_raptor_rebuild(
        state.db.clone(), state.library_path.clone(), target_id,
    );

    Ok(merged_count)
}

/// Delete a collection and optionally move its entries to trash
#[tauri::command]
pub async fn delete_collection_with_entries(
    state: State<'_, AppState>,
    id: i64,
    delete_entries: bool,
) -> Result<u32, String> {
    let mut deleted_entries = 0u32;

    if delete_entries {
        // Get all entries in this collection
        let entry_ids: Vec<i64> = sqlx::query_scalar(
            "SELECT entry_id FROM collection_entries WHERE collection_id = ?"
        )
        .bind(id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;

        // Move entries to trash (soft delete)
        for entry_id in &entry_ids {
            sqlx::query(
                "UPDATE entries SET is_deleted = 1, date_modified = datetime('now') WHERE id = ?"
            )
            .bind(entry_id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        }
        deleted_entries = entry_ids.len() as u32;
    }

    // Delete the collection (cascade will remove collection_entries)
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Clean up cross-doc RAPTOR summaries
    let db = state.db.clone();
    let library_path = state.library_path.clone();
    tokio::spawn(async move {
        tracing::debug!("Background task started: cleanup_collection_raptor for collection {} (bulk delete)", id);
        let result = std::panic::AssertUnwindSafe(
            cleanup_collection_raptor(&db, &library_path, id)
        );
        match futures::FutureExt::catch_unwind(result).await {
            Ok(()) => tracing::debug!("Background task completed: cleanup_collection_raptor for collection {} (bulk delete)", id),
            Err(_) => tracing::error!("Background task panicked: cleanup_collection_raptor for collection {} (bulk delete)", id),
        }
    });

    Ok(deleted_entries)
}

/// Bulk update color for multiple collections
#[tauri::command]
pub async fn bulk_update_collection_color(
    state: State<'_, AppState>,
    collection_ids: Vec<i64>,
    color: Option<String>,
) -> Result<u32, String> {
    let mut updated = 0u32;

    for id in collection_ids {
        sqlx::query("UPDATE collections SET color = ?, date_modified = datetime('now') WHERE id = ?")
            .bind(&color)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        updated += 1;
    }

    Ok(updated)
}

/// Clean up all cross-doc RAPTOR summaries for a collection from the vector store.
/// Deletes both `collection_{id}` and `__corpus__` (legacy) document IDs.
async fn cleanup_collection_raptor(
    db: &sqlx::SqlitePool,
    library_path: &std::sync::Arc<tokio::sync::RwLock<std::path::PathBuf>>,
    collection_id: i64,
) {
    let lib_path = library_path.read().await;
    let lance_path = lib_path.join(".wren").join("rag_vectors");
    if let Ok(embed_config) = crate::rag::embeddings::resolve_embedding_config(db).await {
        let dim = crate::rag::embeddings::known_dimension(
            &embed_config.provider_type, &embed_config.model,
        ).unwrap_or(1536);
        if let Ok(store) = crate::rag::store::VectorStore::new(&lance_path, dim).await {
            let scope_id = format!("collection_{}", collection_id);
            if let Err(e) = store.delete_document(&scope_id).await {
                tracing::warn!("Failed to delete RAG vectors for collection {}: {}", collection_id, e);
            }
            if let Err(e) = store.delete_document("__corpus__").await {
                tracing::warn!("Failed to delete corpus RAG vectors for collection {}: {}", collection_id, e);
            }
            tracing::info!("Cleaned up cross-doc RAPTOR for collection {}", collection_id);
        }
    }
}

/// Clean up per-document RAPTOR summaries + vector chunks for a deleted entry.
pub async fn cleanup_entry_vectors(
    db: &sqlx::SqlitePool,
    library_path: &std::sync::Arc<tokio::sync::RwLock<std::path::PathBuf>>,
    entry_id: i64,
) {
    let att_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM attachments WHERE entry_id = ?",
    )
    .bind(entry_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    if att_ids.is_empty() {
        return;
    }

    let lib_path = library_path.read().await;
    let lance_path = lib_path.join(".wren").join("rag_vectors");
    if let Ok(embed_config) = crate::rag::embeddings::resolve_embedding_config(db).await {
        let dim = crate::rag::embeddings::known_dimension(
            &embed_config.provider_type, &embed_config.model,
        ).unwrap_or(1536);
        if let Ok(store) = crate::rag::store::VectorStore::new(&lance_path, dim).await {
            for att_id in &att_ids {
                let _ = store.delete_document(&att_id.to_string()).await;
            }
            tracing::info!("Cleaned up vectors for entry {} ({} attachments)", entry_id, att_ids.len());
        }
    }
}
