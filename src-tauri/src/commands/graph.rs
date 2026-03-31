use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

// ── Response types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphStatus {
    pub papers_indexed: usize,
    pub total_parseable: usize,
    pub entity_count: usize,
    pub claim_count: usize,
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperKnowledgeGraph {
    pub entities: Vec<EntityInfo>,
    pub claims: Vec<ClaimInfo>,
    pub related_papers: Vec<RelatedPaperInfo>,
    pub graph_indexed: bool,
    pub indexed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityInfo {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub relation_type: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimInfo {
    pub id: i64,
    pub statement: String,
    pub evidence_text: Option<String>,
    pub section_name: Option<String>,
    pub claim_type: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedPaperInfo {
    pub entry_id: i64,
    pub title: String,
    pub creators: String,
    pub link_type: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRelationInfo {
    pub relation_id: i64,
    pub source_claim_id: i64,
    pub source_statement: String,
    pub source_entry_id: i64,
    pub source_entry_title: String,
    pub target_claim_id: i64,
    pub target_statement: String,
    pub target_entry_id: i64,
    pub target_entry_title: String,
    pub relation_type: String,
    pub confidence: f64,
    pub reasoning: Option<String>,
}

// ── Commands ─────────────────────────────────────────────────────────

/// Concept search — find papers by semantic query.
#[tauri::command]
pub async fn graph_concept_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<crate::graph::search::ConceptSearchResult>, String> {
    let limit = limit.unwrap_or(20);

    crate::graph::search::concept_search(
        &state.db,
        &state.graph_service.vector_store,
        &state.graph_service.embedding_service,
        &query,
        limit,
    )
    .await
    .map_err(|e| format!("Concept search failed: {e}"))
}

/// Get knowledge graph data for a specific entry.
#[tauri::command]
pub async fn graph_get_paper_knowledge(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<PaperKnowledgeGraph, String> {
    // Check if this entry is indexed
    let indexed_row = sqlx::query(
        "SELECT graph_indexed, graph_indexed_at FROM parsed_content WHERE entry_id = ? AND graph_indexed = 1 LIMIT 1",
    )
    .bind(entry_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let (graph_indexed, indexed_at) = match indexed_row {
        Some(row) => (
            row.get::<i32, _>("graph_indexed") == 1,
            row.get::<Option<String>, _>("graph_indexed_at"),
        ),
        None => (false, None),
    };

    // Get entities
    let entity_rows = sqlx::query(
        r#"SELECT ent.id, ent.name, ent.description, ent.category,
                  ee.relation_type, ee.weight
           FROM entry_entities ee
           JOIN entities ent ON ent.id = ee.entity_id
           WHERE ee.entry_id = ?
           ORDER BY ee.weight DESC"#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let entities: Vec<EntityInfo> = entity_rows
        .iter()
        .map(|r| EntityInfo {
            id: r.get("id"),
            name: r.get("name"),
            description: r.get("description"),
            category: r.get("category"),
            relation_type: r.get("relation_type"),
            weight: r.get("weight"),
        })
        .collect();

    // Get claims
    let claim_rows = sqlx::query(
        r#"SELECT id, statement, evidence_text, section_name, claim_type, confidence
           FROM claims WHERE entry_id = ?
           ORDER BY confidence DESC"#,
    )
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let claims: Vec<ClaimInfo> = claim_rows
        .iter()
        .map(|r| ClaimInfo {
            id: r.get("id"),
            statement: r.get("statement"),
            evidence_text: r.get("evidence_text"),
            section_name: r.get("section_name"),
            claim_type: r.get("claim_type"),
            confidence: r.get("confidence"),
        })
        .collect();

    // Get related papers via entry_links
    let related_rows = sqlx::query(
        r#"SELECT
               CASE WHEN el.source_entry_id = ? THEN el.target_entry_id ELSE el.source_entry_id END as related_entry_id,
               e.title,
               e.creators_sort,
               lt.display_name as link_type,
               el.context
           FROM entry_links el
           JOIN link_types lt ON lt.id = el.link_type_id
           JOIN entries e ON e.id = CASE WHEN el.source_entry_id = ? THEN el.target_entry_id ELSE el.source_entry_id END
           WHERE (el.source_entry_id = ? OR el.target_entry_id = ?)
             AND e.is_deleted = 0
           ORDER BY el.date_added DESC"#,
    )
    .bind(entry_id)
    .bind(entry_id)
    .bind(entry_id)
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let related_papers: Vec<RelatedPaperInfo> = related_rows
        .iter()
        .map(|r| RelatedPaperInfo {
            entry_id: r.get("related_entry_id"),
            title: r.get("title"),
            creators: r.get::<Option<String>, _>("creators_sort").unwrap_or_default(),
            link_type: r.get("link_type"),
            context: r.get("context"),
        })
        .collect();

    Ok(PaperKnowledgeGraph {
        entities,
        claims,
        related_papers,
        graph_indexed,
        indexed_at,
    })
}

/// Get graph status — counts and progress.
#[tauri::command]
pub async fn graph_status(
    state: State<'_, AppState>,
) -> Result<GraphStatus, String> {
    let papers_indexed: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT entry_id) FROM parsed_content WHERE graph_indexed = 1",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let total_parseable: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT entry_id) FROM parsed_content WHERE status = 'success'",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let entity_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM entities")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let claim_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM claims")
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let chunk_count = state
        .graph_service
        .vector_store
        .count_rows("paper_chunks")
        .await
        .unwrap_or(0);

    Ok(GraphStatus {
        papers_indexed: papers_indexed as usize,
        total_parseable: total_parseable as usize,
        entity_count: entity_count as usize,
        claim_count: claim_count as usize,
        chunk_count,
    })
}

/// Enqueue a graph_index job for a single entry.
#[tauri::command]
pub async fn graph_index_entry(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<String, String> {
    use crate::jobs::types::JobType;
    let payload = serde_json::json!({ "entryId": entry_id });
    state
        .job_queue
        .enqueue(
            JobType::GraphIndex,
            Some(format!("Index Knowledge Graph #{entry_id}")),
            payload,
            0,
        )
        .await
}

/// Enqueue a graph_index_all job.
#[tauri::command]
pub async fn graph_index_all(
    state: State<'_, AppState>,
) -> Result<String, String> {
    use crate::jobs::types::JobType;
    state
        .job_queue
        .enqueue(
            JobType::GraphIndexAll,
            Some("Build Knowledge Graph".to_string()),
            serde_json::json!({}),
            0,
        )
        .await
}

/// Enqueue a graph_relate job.
#[tauri::command]
pub async fn graph_auto_relate(
    state: State<'_, AppState>,
    entry_ids: Option<Vec<i64>>,
) -> Result<String, String> {
    use crate::jobs::types::JobType;
    let payload = serde_json::json!({ "entryIds": entry_ids });
    state
        .job_queue
        .enqueue(
            JobType::GraphRelate,
            Some("Find Related Papers".to_string()),
            payload,
            0,
        )
        .await
}

/// Re-embed all graph data using the current embedding model.
///
/// This does NOT re-run LLM extraction. Entities and claims stay intact.
/// Only the vector embeddings in LanceDB are regenerated.
/// Used when the user changes embedding model/source.
#[tauri::command]
pub async fn graph_reembed(
    state: State<'_, AppState>,
) -> Result<String, String> {
    use crate::jobs::types::JobType;
    state
        .job_queue
        .enqueue(
            JobType::GraphReembed,
            Some("Re-embed Knowledge Graph".to_string()),
            serde_json::json!({}),
            0,
        )
        .await
}

/// Clear all graph data (SQLite + LanceDB) and re-index everything.
///
/// This is a full rebuild — re-runs LLM extraction from scratch.
/// Steps:
/// 1. Clear all SQLite graph tables (entities, claims, entry_entities, auto-created links)
/// 2. Drop and recreate LanceDB vector tables
/// 3. Reset graph_indexed flags on parsed_content
/// 4. Enqueue a graph_index_all job
#[tauri::command]
pub async fn graph_rebuild(
    state: State<'_, AppState>,
) -> Result<String, String> {
    use crate::jobs::types::JobType;

    // 1. Clear SQLite graph data
    sqlx::query("DELETE FROM entry_entities")
        .execute(&state.db).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM claims")
        .execute(&state.db).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM entities")
        .execute(&state.db).await.map_err(|e| e.to_string())?;
    // Delete auto-created "related" links (keep user-created links)
    let _ = sqlx::query(
        "DELETE FROM entry_links WHERE link_type_id IN (SELECT id FROM link_types WHERE name = 'related')"
    ).execute(&state.db).await;

    // 2. Drop and recreate LanceDB vector tables
    state.graph_service.vector_store
        .drop_and_recreate_tables()
        .await
        .map_err(|e| format!("Failed to reset vector store: {e}"))?;

    // 3. Reset graph_indexed flags (and graph_related_at so relate runs fresh)
    sqlx::query("UPDATE parsed_content SET graph_indexed = 0, graph_indexed_at = NULL, graph_related_at = NULL")
        .execute(&state.db).await.map_err(|e| e.to_string())?;

    tracing::info!("Graph data cleared — enqueuing rebuild job");

    // 4. Enqueue rebuild
    state
        .job_queue
        .enqueue(
            JobType::GraphIndexAll,
            Some("Rebuild Knowledge Graph".to_string()),
            serde_json::json!({}),
            0,
        )
        .await
}

/// Get claim relations for a specific entry — claims from this paper that
/// support, contradict, or refine claims in other papers.
#[tauri::command]
pub async fn graph_get_claim_relations(
    state: State<'_, AppState>,
    entry_id: i64,
) -> Result<Vec<ClaimRelationInfo>, String> {
    let rows = sqlx::query(
        r#"SELECT
               cr.id as relation_id,
               cr.source_claim_id,
               sc.statement as source_statement,
               sc.entry_id as source_entry_id,
               COALESCE(se.title, 'Untitled') as source_entry_title,
               cr.target_claim_id,
               tc.statement as target_statement,
               tc.entry_id as target_entry_id,
               COALESCE(te.title, 'Untitled') as target_entry_title,
               cr.relation_type,
               cr.confidence,
               cr.reasoning
           FROM claim_relations cr
           JOIN claims sc ON sc.id = cr.source_claim_id
           JOIN claims tc ON tc.id = cr.target_claim_id
           JOIN entries se ON se.id = sc.entry_id
           JOIN entries te ON te.id = tc.entry_id
           WHERE sc.entry_id = ? OR tc.entry_id = ?
           ORDER BY cr.confidence DESC"#,
    )
    .bind(entry_id)
    .bind(entry_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let relations: Vec<ClaimRelationInfo> = rows
        .iter()
        .map(|r| ClaimRelationInfo {
            relation_id: r.get("relation_id"),
            source_claim_id: r.get("source_claim_id"),
            source_statement: r.get("source_statement"),
            source_entry_id: r.get("source_entry_id"),
            source_entry_title: r.get("source_entry_title"),
            target_claim_id: r.get("target_claim_id"),
            target_statement: r.get("target_statement"),
            target_entry_id: r.get("target_entry_id"),
            target_entry_title: r.get("target_entry_title"),
            relation_type: r.get("relation_type"),
            confidence: r.get("confidence"),
            reasoning: r.get("reasoning"),
        })
        .collect();

    Ok(relations)
}
