use crate::db::models::{CreatorType, CreatorTypeInfo, FieldDefinition, ItemType, ItemTypeInfo};
use crate::state::AppState;
use sqlx::FromRow;
use tauri::State;

// =====================================================
// SCHEMA INTROSPECTION COMMANDS
// =====================================================

/// Get all item types
#[tauri::command]
pub async fn get_all_item_types(state: State<'_, AppState>) -> Result<Vec<ItemType>, String> {
    let types = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>)>(
        "SELECT id, name, display_name, csl_type, icon FROM item_types ORDER BY sort_order, display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(types
        .into_iter()
        .map(|(id, name, display_name, csl_type, icon)| ItemType {
            id,
            name,
            display_name,
            csl_type,
            icon,
        })
        .collect())
}

/// Get all creator types
#[tauri::command]
pub async fn get_all_creator_types(state: State<'_, AppState>) -> Result<Vec<CreatorType>, String> {
    let types = sqlx::query_as::<_, (i64, String, String, Option<String>)>(
        "SELECT id, name, display_name, csl_type FROM creator_types ORDER BY display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(types
        .into_iter()
        .map(|(id, name, display_name, csl_type)| CreatorType {
            id,
            name,
            display_name,
            csl_type,
        })
        .collect())
}

/// Get all field definitions
#[tauri::command]
pub async fn get_all_fields(state: State<'_, AppState>) -> Result<Vec<FieldDefinition>, String> {
    #[derive(FromRow)]
    struct FieldRow {
        id: i64,
        name: String,
        display_name: String,
        csl_field: Option<String>,
        field_type: String,
    }

    let fields = sqlx::query_as::<_, FieldRow>(
        "SELECT id, name, display_name, csl_field, field_type FROM fields ORDER BY display_name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(fields
        .into_iter()
        .map(|f| FieldDefinition {
            id: f.id,
            name: f.name,
            display_name: f.display_name,
            csl_field: f.csl_field,
            field_type: f.field_type,
            sort_order: 0,
            is_required: false,
        })
        .collect())
}

/// Get complete item type info with valid fields and creator types
#[tauri::command]
pub async fn get_item_type_info(
    state: State<'_, AppState>,
    item_type: String,
) -> Result<ItemTypeInfo, String> {
    // Get the item type
    let type_row = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>)>(
        "SELECT id, name, display_name, csl_type, icon FROM item_types WHERE name = ?",
    )
    .bind(&item_type)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Item type not found: {}", item_type))?;

    let (id, name, display_name, csl_type, icon) = type_row;

    // Get valid fields for this item type
    #[derive(FromRow)]
    struct FieldInfoRow {
        id: i64,
        name: String,
        display_name: String,
        csl_field: Option<String>,
        field_type: String,
        sort_order: i32,
        is_required: i32,
    }

    let fields = sqlx::query_as::<_, FieldInfoRow>(
        r#"
        SELECT f.id, f.name, f.display_name, f.csl_field, f.field_type,
               itf.sort_order, itf.is_required
        FROM fields f
        JOIN item_type_fields itf ON f.id = itf.field_id
        WHERE itf.item_type_id = ?
        ORDER BY itf.sort_order
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Get valid creator types for this item type
    #[derive(FromRow)]
    struct CreatorInfoRow {
        id: i64,
        name: String,
        display_name: String,
        is_primary: i32,
    }

    let creator_types = sqlx::query_as::<_, CreatorInfoRow>(
        r#"
        SELECT ct.id, ct.name, ct.display_name, itct.is_primary
        FROM creator_types ct
        JOIN item_type_creator_types itct ON ct.id = itct.creator_type_id
        WHERE itct.item_type_id = ?
        ORDER BY itct.sort_order
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(ItemTypeInfo {
        id,
        name,
        display_name,
        csl_type,
        icon,
        fields: fields
            .into_iter()
            .map(|f| FieldDefinition {
                id: f.id,
                name: f.name,
                display_name: f.display_name,
                csl_field: f.csl_field,
                field_type: f.field_type,
                sort_order: f.sort_order,
                is_required: f.is_required != 0,
            })
            .collect(),
        creator_types: creator_types
            .into_iter()
            .map(|c| CreatorTypeInfo {
                id: c.id,
                name: c.name,
                display_name: c.display_name,
                is_primary: c.is_primary != 0,
            })
            .collect(),
    })
}

/// Get fields valid for a specific item type
#[tauri::command]
pub async fn get_item_type_fields(
    state: State<'_, AppState>,
    item_type: String,
) -> Result<Vec<FieldDefinition>, String> {
    // Get item type ID
    let item_type_id: i64 = sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
        .bind(&item_type)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Item type not found: {}", item_type))?;

    #[derive(FromRow)]
    struct FieldRow {
        id: i64,
        name: String,
        display_name: String,
        csl_field: Option<String>,
        field_type: String,
        sort_order: i32,
        is_required: i32,
    }

    let fields = sqlx::query_as::<_, FieldRow>(
        r#"
        SELECT f.id, f.name, f.display_name, f.csl_field, f.field_type,
               itf.sort_order, itf.is_required
        FROM fields f
        JOIN item_type_fields itf ON f.id = itf.field_id
        WHERE itf.item_type_id = ?
        ORDER BY itf.sort_order
        "#,
    )
    .bind(item_type_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(fields
        .into_iter()
        .map(|f| FieldDefinition {
            id: f.id,
            name: f.name,
            display_name: f.display_name,
            csl_field: f.csl_field,
            field_type: f.field_type,
            sort_order: f.sort_order,
            is_required: f.is_required != 0,
        })
        .collect())
}

/// Get creator types valid for a specific item type
#[tauri::command]
pub async fn get_item_type_creator_types(
    state: State<'_, AppState>,
    item_type: String,
) -> Result<Vec<CreatorTypeInfo>, String> {
    // Get item type ID
    let item_type_id: i64 = sqlx::query_scalar("SELECT id FROM item_types WHERE name = ?")
        .bind(&item_type)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Item type not found: {}", item_type))?;

    #[derive(FromRow)]
    struct CreatorRow {
        id: i64,
        name: String,
        display_name: String,
        is_primary: i32,
    }

    let creators = sqlx::query_as::<_, CreatorRow>(
        r#"
        SELECT ct.id, ct.name, ct.display_name, itct.is_primary
        FROM creator_types ct
        JOIN item_type_creator_types itct ON ct.id = itct.creator_type_id
        WHERE itct.item_type_id = ?
        ORDER BY itct.sort_order
        "#,
    )
    .bind(item_type_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(creators
        .into_iter()
        .map(|c| CreatorTypeInfo {
            id: c.id,
            name: c.name,
            display_name: c.display_name,
            is_primary: c.is_primary != 0,
        })
        .collect())
}
