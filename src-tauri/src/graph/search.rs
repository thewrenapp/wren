use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use super::embeddings::EmbeddingService;
use super::vectors::VectorStore;

// ── Result types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptSearchResult {
    pub entry_id: i64,
    pub title: String,
    pub creators: String,
    pub relevance_score: f32,
    pub matched_concepts: Vec<MatchedConcept>,
    pub evidence_snippets: Vec<EvidenceSnippet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedConcept {
    pub name: String,
    pub category: String,
    pub description: String,
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSnippet {
    pub text: String,
    pub section_name: String,
    pub source: String, // "entity_match" or "chunk_match"
    pub attachment_title: String,
}

/// Concept search: find papers by semantic similarity to a query.
///
/// Query flow:
/// 1. Embed query
/// 2. Search entity_vectors → top entity matches
/// 3. Search paper_chunks → top chunk matches
/// 4. Get papers for matched entities (SQL join)
/// 5. Merge + score + deduplicate by entry_id
/// 6. Return top `limit` results
pub async fn concept_search(
    db: &SqlitePool,
    vector_store: &VectorStore,
    embedding_service: &Arc<EmbeddingService>,
    query: &str,
    limit: usize,
) -> Result<Vec<ConceptSearchResult>> {
    let query_vector = embedding_service.embed_one(query).await?;

    // Search entities (3x limit for good coverage)
    let entity_results = vector_store
        .search_entities(&query_vector, limit * 3)
        .await?;

    // Search chunks (2x limit)
    let chunk_results = vector_store
        .search_chunks(&query_vector, limit * 2)
        .await?;

    // Collect matched entity IDs
    let entity_ids: Vec<i64> = entity_results.iter().map(|r| r.id).collect();

    // Get papers for matched entities via SQL
    let entity_paper_map = if !entity_ids.is_empty() {
        get_papers_for_entities(db, &entity_ids).await?
    } else {
        HashMap::new()
    };

    // Build result map keyed by entry_id
    let mut result_map: HashMap<i64, ConceptSearchResult> = HashMap::new();

    // Process entity matches
    for er in &entity_results {
        let entity_id = er.id;
        let entity_score = er.score;
        let entity_name = &er.text;
        let category = er.extra.get("category").cloned().unwrap_or_default();
        let description = er.extra.get("description").cloned().unwrap_or_default();

        if let Some(papers) = entity_paper_map.get(&entity_id) {
            for paper in papers {
                let entry = result_map.entry(paper.entry_id).or_insert_with(|| {
                    ConceptSearchResult {
                        entry_id: paper.entry_id,
                        title: paper.title.clone(),
                        creators: paper.creators.clone(),
                        relevance_score: 0.0,
                        matched_concepts: Vec::new(),
                        evidence_snippets: Vec::new(),
                    }
                });

                // Score contribution: entity_similarity × weight × 0.6
                let contribution = entity_score * paper.weight * 0.6;
                entry.relevance_score += contribution;

                // Add concept if not already present
                if !entry.matched_concepts.iter().any(|c| c.name == *entity_name) {
                    entry.matched_concepts.push(MatchedConcept {
                        name: entity_name.clone(),
                        category: category.clone(),
                        description: description.clone(),
                        weight: paper.weight,
                    });
                }

                // Add evidence snippet
                if let Some(ref evidence) = paper.evidence_text {
                    entry.evidence_snippets.push(EvidenceSnippet {
                        text: evidence.clone(),
                        section_name: paper.section_name.clone().unwrap_or_default(),
                        source: "entity_match".to_string(),
                        attachment_title: String::new(), // filled below
                    });
                }
            }
        }
    }

    // Process chunk matches
    for cr in &chunk_results {
        let entry_id = cr.id;
        let chunk_score = cr.score;
        let section_name = cr.extra.get("section_name").cloned().unwrap_or_default();
        let attachment_title = cr
            .extra
            .get("attachment_title")
            .cloned()
            .unwrap_or_default();

        // Look up entry title if not already in map
        let entry = result_map.entry(entry_id).or_insert_with(|| {
            // We don't have the title yet; will fill in below
            ConceptSearchResult {
                entry_id,
                title: String::new(),
                creators: String::new(),
                relevance_score: 0.0,
                matched_concepts: Vec::new(),
                evidence_snippets: Vec::new(),
            }
        });

        // Score contribution: chunk_similarity × 0.4
        entry.relevance_score += chunk_score * 0.4;

        // Add evidence snippet (truncated to 200 chars)
        let snippet = if cr.text.len() > 200 {
            format!("{}...", &cr.text[..200])
        } else {
            cr.text.clone()
        };

        entry.evidence_snippets.push(EvidenceSnippet {
            text: snippet,
            section_name,
            source: "chunk_match".to_string(),
            attachment_title,
        });
    }

    // Fill in missing titles for chunk-only matches
    let missing_titles: Vec<i64> = result_map
        .values()
        .filter(|r| r.title.is_empty())
        .map(|r| r.entry_id)
        .collect();

    if !missing_titles.is_empty() {
        let placeholders: Vec<String> = missing_titles.iter().map(|_| "?".to_string()).collect();
        let query_str = format!(
            "SELECT id, title, creators_sort FROM entries WHERE id IN ({})",
            placeholders.join(",")
        );
        let mut query = sqlx::query(&query_str);
        for id in &missing_titles {
            query = query.bind(id);
        }
        let rows = query.fetch_all(db).await?;
        for row in rows {
            let id: i64 = row.get("id");
            let title: String = row.get("title");
            let creators: Option<String> = row.get("creators_sort");
            if let Some(entry) = result_map.get_mut(&id) {
                entry.title = title;
                entry.creators = creators.unwrap_or_default();
            }
        }
    }

    // Sort by relevance score, take top `limit`
    let mut results: Vec<ConceptSearchResult> = result_map.into_values().collect();
    results.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());
    results.truncate(limit);

    Ok(results)
}

// ── Internal helpers ─────────────────────────────────────────────────

struct EntityPaperInfo {
    entry_id: i64,
    title: String,
    creators: String,
    weight: f32,
    evidence_text: Option<String>,
    section_name: Option<String>,
}

/// Get all papers linked to the given entity IDs via entry_entities.
async fn get_papers_for_entities(
    db: &SqlitePool,
    entity_ids: &[i64],
) -> Result<HashMap<i64, Vec<EntityPaperInfo>>> {
    if entity_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders: Vec<String> = entity_ids.iter().map(|_| "?".to_string()).collect();
    let query_str = format!(
        r#"SELECT e.id as entry_id, e.title, e.creators_sort,
                  ee.weight, ee.evidence_text, ee.section_name,
                  ee.entity_id
           FROM entries e
           JOIN entry_entities ee ON ee.entry_id = e.id
           WHERE ee.entity_id IN ({})
             AND e.is_deleted = 0
           ORDER BY ee.weight DESC"#,
        placeholders.join(",")
    );

    let mut query = sqlx::query(&query_str);
    for id in entity_ids {
        query = query.bind(id);
    }

    let rows = query.fetch_all(db).await?;

    let mut map: HashMap<i64, Vec<EntityPaperInfo>> = HashMap::new();
    for row in rows {
        let entity_id: i64 = row.get("entity_id");
        let info = EntityPaperInfo {
            entry_id: row.get("entry_id"),
            title: row.get("title"),
            creators: row.get::<Option<String>, _>("creators_sort").unwrap_or_default(),
            weight: row.get::<f64, _>("weight") as f32,
            evidence_text: row.get("evidence_text"),
            section_name: row.get("section_name"),
        };
        map.entry(entity_id).or_default().push(info);
    }

    Ok(map)
}
