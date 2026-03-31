use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Result;
use serde::Deserialize;
use sqlx::{Row, SqlitePool};

use super::embeddings::EmbeddingService;
use super::sync::GraphProgressCallback;
use super::vectors::VectorStore;
use crate::llm::provider::{
    call_with_retry_cancellable, parse_llm_json, ChatMessage, CompletionRequest, LlmError,
    LlmProvider, MessageRole, TokenUsageSummary,
};

/// Result of auto-relate: a link that was created.
#[derive(Debug, Clone)]
pub struct CreatedLink {
    pub source_entry_id: i64,
    pub target_entry_id: i64,
    pub context: String,
}

/// Auto-relate papers based on shared entities and similar claims.
///
/// For each entry in `entry_ids`:
/// 1. Find papers sharing 2+ entities
/// 2. Embed this paper's claims, vector-search for similar claims in other papers
/// 3. Score: shared_entities × 0.6 + claim_similarity × 0.4
/// 4. If score > threshold → create entry_link with context
pub async fn auto_relate_papers(
    db: &SqlitePool,
    vector_store: &VectorStore,
    embedding_service: &Arc<EmbeddingService>,
    entry_ids: &[i64],
    threshold: f32,
    cancel: &AtomicBool,
) -> Result<Vec<CreatedLink>> {
    let mut created_links = Vec::new();

    // Get the "related" link type id
    let link_type_id: i64 = sqlx::query_scalar(
        "SELECT id FROM link_types WHERE name = 'related'",
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Link type 'related' not found"))?;

    for &entry_id in entry_ids {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        // Find papers sharing 2+ entities
        let shared_entity_papers = find_shared_entity_papers(db, entry_id).await?;

        // Get this paper's claims for vector search
        let claims: Vec<(i64, String)> = sqlx::query(
            "SELECT id, statement FROM claims WHERE entry_id = ?",
        )
        .bind(entry_id)
        .fetch_all(db)
        .await?
        .iter()
        .map(|r| (r.get("id"), r.get("statement")))
        .collect();

        // Build claim similarity map: target_entry_id → best_score
        let mut claim_similarity_map: HashMap<i64, f32> = HashMap::new();

        if !claims.is_empty() {
            // Batch-embed all claim statements
            let claim_texts: Vec<String> = claims.iter().map(|(_, s)| s.clone()).collect();
            match embedding_service.embed_batch(&claim_texts).await {
                Ok(claim_vectors) => {
                    // For each claim, search for similar claims in other papers
                    for (i, (_claim_id, _)) in claims.iter().enumerate() {
                        if let Some(vec) = claim_vectors.get(i) {
                            match vector_store.search_claims(vec, 20).await {
                                Ok(similar) => {
                                    for result in &similar {
                                        if let Some(target_str) = result.extra.get("entry_id") {
                                            if let Ok(target_entry_id) = target_str.parse::<i64>() {
                                                if target_entry_id != entry_id {
                                                    let existing = claim_similarity_map
                                                        .get(&target_entry_id)
                                                        .copied()
                                                        .unwrap_or(0.0);
                                                    if result.score > existing {
                                                        claim_similarity_map
                                                            .insert(target_entry_id, result.score);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!("Claim vector search failed for entry {}: {}", entry_id, e);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to embed claims for entry {}: {}", entry_id, e);
                }
            }
        }

        // Score and create links
        for (target_entry_id, shared_info) in &shared_entity_papers {
            if *target_entry_id == entry_id {
                continue;
            }

            // Logarithmic scaling: 2→0.46, 5→0.75, 10→1.0
            let entity_score = (shared_info.shared_count as f32 + 1.0).ln() / (11.0_f32).ln();
            let claim_score = claim_similarity_map
                .get(target_entry_id)
                .copied()
                .unwrap_or(0.0);

            let final_score = entity_score * 0.6 + claim_score * 0.4;

            if final_score >= threshold {
                // Check if link already exists
                let existing: Option<i64> = sqlx::query_scalar(
                    r#"SELECT id FROM entry_links
                       WHERE ((source_entry_id = ? AND target_entry_id = ?)
                           OR (source_entry_id = ? AND target_entry_id = ?))
                         AND link_type_id = ?"#,
                )
                .bind(entry_id)
                .bind(target_entry_id)
                .bind(target_entry_id)
                .bind(entry_id)
                .bind(link_type_id)
                .fetch_optional(db)
                .await?;

                if existing.is_some() {
                    continue;
                }

                let context = format!(
                    "Shared concepts: {}",
                    shared_info.shared_entities.join(", ")
                );

                sqlx::query(
                    "INSERT OR IGNORE INTO entry_links (source_entry_id, target_entry_id, link_type_id, context) VALUES (?, ?, ?, ?)",
                )
                .bind(entry_id)
                .bind(target_entry_id)
                .bind(link_type_id)
                .bind(&context)
                .execute(db)
                .await?;

                created_links.push(CreatedLink {
                    source_entry_id: entry_id,
                    target_entry_id: *target_entry_id,
                    context,
                });
            }
        }
    }

    tracing::info!(
        "Auto-relate created {} links for {} entries",
        created_links.len(),
        entry_ids.len()
    );

    Ok(created_links)
}

struct SharedEntityInfo {
    shared_count: usize,
    shared_entities: Vec<String>,
}

/// Find papers that share 2+ entities with the given entry.
async fn find_shared_entity_papers(
    db: &SqlitePool,
    entry_id: i64,
) -> Result<HashMap<i64, SharedEntityInfo>> {
    let rows = sqlx::query(
        r#"SELECT e.id as target_entry_id,
                  COUNT(DISTINCT ee2.entity_id) as shared_count,
                  GROUP_CONCAT(DISTINCT ent.name) as shared_entities
           FROM entries e
           JOIN entry_entities ee2 ON ee2.entry_id = e.id
           JOIN entities ent ON ent.id = ee2.entity_id
           WHERE ee2.entity_id IN (
               SELECT entity_id FROM entry_entities WHERE entry_id = ?
           )
             AND e.id != ?
             AND e.is_deleted = 0
           GROUP BY e.id
           HAVING COUNT(DISTINCT ee2.entity_id) >= 2
           ORDER BY shared_count DESC
           LIMIT 50"#,
    )
    .bind(entry_id)
    .bind(entry_id)
    .fetch_all(db)
    .await?;

    let mut map = HashMap::new();
    for row in rows {
        let target_id: i64 = row.get("target_entry_id");
        let shared_count: i64 = row.get("shared_count");
        let shared_entities_str: String = row.get("shared_entities");
        let shared_entities: Vec<String> = shared_entities_str
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        map.insert(
            target_id,
            SharedEntityInfo {
                shared_count: shared_count as usize,
                shared_entities,
            },
        );
    }

    Ok(map)
}

// ── Claim relation extraction ────────────────────────────────────────

/// A candidate pair of claims from different papers to classify.
struct ClaimPair {
    source_claim_id: i64,
    source_statement: String,
    source_entry_title: String,
    target_claim_id: i64,
    target_statement: String,
    target_entry_title: String,
    similarity: f32,
}

/// LLM response for a batch of claim pairs.
#[derive(Debug, Deserialize)]
struct ClaimRelationBatch {
    relations: Vec<ClaimRelationResult>,
}

#[derive(Debug, Deserialize)]
struct ClaimRelationResult {
    pair_index: usize,
    relation: String,
    confidence: f32,
    reasoning: String,
}

/// Discover and classify relationships between claims across papers.
///
/// 1. For each paper, vector-search for similar claims in OTHER papers
/// 2. Filter to high-similarity pairs (> min_similarity)
/// 3. Send pairs to the LLM: supports / contradicts / refines / unrelated
/// 4. Store classified relations in `claim_relations`
pub async fn classify_claim_relations(
    db: &SqlitePool,
    vector_store: &VectorStore,
    embedding_service: &Arc<EmbeddingService>,
    provider: &dyn LlmProvider,
    model: &str,
    entry_ids: &[i64],
    min_similarity: f32,
    cancel: &AtomicBool,
    progress: &dyn GraphProgressCallback,
    usage: &mut TokenUsageSummary,
) -> Result<usize> {
    progress.update("Finding similar claim pairs...");

    // ── Step 1: Collect candidate pairs ────────────────────────────
    let mut candidates: Vec<ClaimPair> = Vec::new();
    let mut seen_pairs = std::collections::HashSet::new();

    for (i, &entry_id) in entry_ids.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        let entry_title: String = sqlx::query_scalar(
            "SELECT COALESCE(title, 'Untitled') FROM entries WHERE id = ?",
        )
        .bind(entry_id)
        .fetch_optional(db)
        .await?
        .unwrap_or_else(|| "Untitled".to_string());

        // Get claims for this entry
        let claims: Vec<(i64, String)> = sqlx::query(
            "SELECT id, statement FROM claims WHERE entry_id = ?",
        )
        .bind(entry_id)
        .fetch_all(db)
        .await?
        .iter()
        .map(|r| (r.get("id"), r.get("statement")))
        .collect();

        if claims.is_empty() {
            continue;
        }

        progress.update(&format!(
            "Finding claim pairs ({}/{})...",
            i + 1,
            entry_ids.len()
        ));

        // Embed claims
        let claim_texts: Vec<String> = claims.iter().map(|(_, s)| s.clone()).collect();
        let claim_vectors = match embedding_service.embed_batch(&claim_texts).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("Failed to embed claims for entry {}: {}", entry_id, e);
                continue;
            }
        };

        // Vector-search for similar claims in other papers
        // Collect raw candidate pairs first, then batch-check DB for existing relations
        let mut raw_pairs: Vec<(i64, String, i64, i64, String, f32)> = Vec::new(); // (claim_id, statement, target_claim_id, target_entry_id, target_statement, score)

        for (j, (claim_id, statement)) in claims.iter().enumerate() {
            if let Some(vec) = claim_vectors.get(j) {
                let similar = vector_store.search_claims(vec, 10).await.unwrap_or_default();
                for result in &similar {
                    let target_claim_id: i64 = result.id;
                    let target_entry_id: i64 = match result.extra.get("entry_id")
                        .and_then(|s| s.parse().ok())
                    {
                        Some(id) => id,
                        None => continue,
                    };

                    // Skip same paper, low similarity, already seen
                    if target_entry_id == entry_id || result.score < min_similarity {
                        continue;
                    }
                    let pair_key = if *claim_id < target_claim_id {
                        (*claim_id, target_claim_id)
                    } else {
                        (target_claim_id, *claim_id)
                    };
                    if !seen_pairs.insert(pair_key) {
                        continue;
                    }

                    let target_statement: String = result.text.clone();

                    raw_pairs.push((*claim_id, statement.clone(), target_claim_id, target_entry_id, target_statement, result.score));
                }
            }
        }

        // Batch-check which pairs already have relations in the DB
        // Build a single query with all pair keys
        if !raw_pairs.is_empty() {
            let mut existing_pairs = std::collections::HashSet::new();
            // Check in chunks to avoid SQL variable limits
            for chunk in raw_pairs.chunks(50) {
                let conditions: Vec<String> = chunk.iter().map(|(cid, _, tcid, _, _, _)| {
                    let (lo, hi) = if *cid < *tcid { (*cid, *tcid) } else { (*tcid, *cid) };
                    format!("(source_claim_id = {lo} AND target_claim_id = {hi})")
                }).collect();

                let query = format!(
                    "SELECT source_claim_id, target_claim_id FROM claim_relations WHERE {}",
                    conditions.join(" OR ")
                );

                if let Ok(rows) = sqlx::query(&query).fetch_all(db).await {
                    for row in &rows {
                        let src: i64 = row.get(0);
                        let tgt: i64 = row.get(1);
                        let key = if src < tgt { (src, tgt) } else { (tgt, src) };
                        existing_pairs.insert(key);
                    }
                }
            }

            // Cache entry titles to avoid repeated queries
            let mut title_cache: HashMap<i64, String> = HashMap::new();

            for (claim_id, statement, target_claim_id, target_entry_id, target_statement, score) in raw_pairs {
                let pair_key = if claim_id < target_claim_id {
                    (claim_id, target_claim_id)
                } else {
                    (target_claim_id, claim_id)
                };
                if existing_pairs.contains(&pair_key) {
                    continue;
                }

                let target_title = match title_cache.get(&target_entry_id) {
                    Some(t) => t.clone(),
                    None => {
                        let t: String = sqlx::query_scalar(
                            "SELECT COALESCE(title, 'Untitled') FROM entries WHERE id = ?",
                        )
                        .bind(target_entry_id)
                        .fetch_optional(db)
                        .await?
                        .unwrap_or_else(|| "Untitled".to_string());
                        title_cache.insert(target_entry_id, t.clone());
                        t
                    }
                };

                candidates.push(ClaimPair {
                    source_claim_id: claim_id,
                    source_statement: statement,
                    source_entry_title: entry_title.clone(),
                    target_claim_id,
                    target_statement,
                    target_entry_title: target_title,
                    similarity: score,
                });
            }
        }
    }

    if candidates.is_empty() {
        progress.update("No similar claim pairs found to classify.");
        return Ok(0);
    }

    tracing::info!(
        "[claim-relations] Found {} candidate pairs to classify",
        candidates.len()
    );

    // ── Step 2: LLM classification in batches ──────────────────────
    let batch_size = 10; // pairs per LLM call
    let total_batches = (candidates.len() + batch_size - 1) / batch_size;
    let mut relations_created = 0;

    for (batch_idx, batch) in candidates.chunks(batch_size).enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        progress.update(&format!(
            "Classifying claim relations (batch {}/{}, {} pairs)...",
            batch_idx + 1,
            total_batches,
            batch.len()
        ));

        match classify_batch(provider, model, batch, usage, cancel).await {
            Ok(results) => {
                for result in &results {
                    if result.pair_index >= batch.len() {
                        continue;
                    }
                    let pair = &batch[result.pair_index];

                    // Skip "unrelated"
                    if result.relation == "unrelated" {
                        continue;
                    }

                    let _ = sqlx::query(
                        r#"INSERT OR IGNORE INTO claim_relations
                           (source_claim_id, target_claim_id, relation_type, confidence, reasoning)
                           VALUES (?, ?, ?, ?, ?)"#,
                    )
                    .bind(pair.source_claim_id)
                    .bind(pair.target_claim_id)
                    .bind(&result.relation)
                    .bind(result.confidence as f64)
                    .bind(&result.reasoning)
                    .execute(db)
                    .await;

                    relations_created += 1;
                }
            }
            Err(e) => {
                tracing::warn!(
                    "[claim-relations] Batch {}/{} failed: {}",
                    batch_idx + 1,
                    total_batches,
                    e
                );
            }
        }
    }

    tracing::info!(
        "[claim-relations] Created {} relations from {} candidates",
        relations_created,
        candidates.len()
    );

    Ok(relations_created)
}

/// Classify a batch of claim pairs via LLM.
async fn classify_batch(
    provider: &dyn LlmProvider,
    model: &str,
    pairs: &[ClaimPair],
    usage: &mut TokenUsageSummary,
    cancel: &AtomicBool,
) -> Result<Vec<ClaimRelationResult>, LlmError> {
    let mut pairs_text = String::new();
    for (i, pair) in pairs.iter().enumerate() {
        pairs_text.push_str(&format!(
            r#"Pair {i}:
  Claim A (from "{}"): "{}"
  Claim B (from "{}"): "{}"
  Vector similarity: {:.2}

"#,
            pair.source_entry_title,
            pair.source_statement,
            pair.target_entry_title,
            pair.target_statement,
            pair.similarity,
        ));
    }

    let system_prompt = r#"You classify relationships between pairs of scientific claims from different papers.

For each pair, determine the relationship:
- "supports": Claim B provides evidence for or agrees with Claim A
- "contradicts": Claim B disagrees with, refutes, or is incompatible with Claim A
- "refines": Claim B adds nuance, qualifies, extends, or specializes Claim A
- "unrelated": Despite surface similarity, the claims are about different things

Return JSON with key "relations" containing an array. For each pair:
- pair_index: the pair number (0-based)
- relation: one of "supports", "contradicts", "refines", "unrelated"
- confidence: 0.0-1.0 how certain you are
- reasoning: 1 sentence explaining why

Be precise. "Contradicts" means the claims genuinely conflict — not just that they discuss different aspects.
"Supports" means real evidential alignment — not just topical overlap.
When in doubt, classify as "unrelated"."#;

    let request = CompletionRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: MessageRole::System,
                content: system_prompt.to_string(),
                tool_call_id: None,
            },
            ChatMessage {
                role: MessageRole::User,
                content: pairs_text,
                tool_call_id: None,
            },
        ],
        temperature: 0.0,
        max_tokens: Some(2000),
        json_mode: true,
        tools: vec![],
    };

    let response =
        call_with_retry_cancellable(provider, request, 2, false, Some(cancel)).await?;
    usage.add(&response);

    let content = response
        .content
        .as_deref()
        .ok_or_else(|| LlmError::ParseError("No content in claim relation response".to_string()))?;

    let batch: ClaimRelationBatch = parse_llm_json(content).map_err(|e| {
        tracing::error!(
            "[claim-relations] Failed to parse LLM response: {e}\nContent: {}",
            &content[..content.len().min(500)]
        );
        LlmError::ParseError(format!("Failed to parse claim relations JSON: {e}"))
    })?;

    Ok(batch.relations)
}
