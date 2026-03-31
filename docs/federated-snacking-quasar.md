# Graph RAG System — SQLite (graph) + LanceDB (vectors) + fastembed (embeddings)

## Context

Wren extracts structured content from all attachments via the LLM pipeline (classify -> discover -> extract -> assemble), storing hierarchical sections in `parsed_content`. The next step: a knowledge graph + semantic search layer enabling concept search, cross-paper discovery, and AI research assistance.

**Architecture**: Extend existing SQLite for graph structure. LanceDB (embedded, already in Cargo.toml) for vectors. fastembed (already in Cargo.toml) for local embeddings, configurable to cloud APIs. No external processes.

**Document-type agnostic**: The schema handles research papers, legal cases, patents, books, podcasts, webpages — all 40+ item types. Entity categories and claim types are curated per document type, not hardcoded enums.

**Priority use cases**: Concept search + Paper knowledge view + Auto-relate papers.

---

## 1. SQLite Knowledge Graph Schema

### 1.1 Entities — shared knowledge atoms

Entities are the nodes that create cross-paper connections. When Paper A and Paper B both link to Entity "transformer", they're implicitly connected through the graph.

```sql
CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,       -- lowercase, trimmed, for dedup
    description TEXT,                     -- 1-2 sentence description
    category TEXT NOT NULL,              -- from curated list per doc type
    parent_entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
    date_added TEXT DEFAULT (datetime('now')),
    UNIQUE(name_normalized, category)
);
CREATE INDEX IF NOT EXISTS idx_entities_normalized ON entities(name_normalized);
CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);
CREATE INDEX IF NOT EXISTS idx_entities_parent ON entities(parent_entity_id);
```

**UNIQUE constraint is `(name_normalized, category)`** — "transformer" the model and "transformer" the electrical component are different entities if they have different categories. But "Transformer" and "transformer" (same category) deduplicate.

**`parent_entity_id`** enables hierarchy: "multi-head attention" → parent: "attention mechanism" → parent: "neural network component". This supports multi-hop graph traversal: search for "attention" finds all sub-concepts.

### 1.2 Claims — per-attachment assertions with provenance

```sql
CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    statement TEXT NOT NULL,              -- the claim itself
    evidence_text TEXT,                   -- source passage from document
    section_name TEXT,                    -- which section it came from
    claim_type TEXT NOT NULL,             -- from curated list per doc type
    confidence REAL DEFAULT 0.8,          -- LLM's extraction confidence
    date_added TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claims_entry ON claims(entry_id);
CREATE INDEX IF NOT EXISTS idx_claims_attachment ON claims(attachment_id);
CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(claim_type);
```

### 1.3 Entry-Entity edges — typed relationships with per-attachment provenance

The same entity can appear via multiple attachments of the same entry (e.g., "transformer" discussed in both the PDF and user notes). Each gets its own row with distinct evidence.

```sql
CREATE TABLE IF NOT EXISTS entry_entities (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL DEFAULT 'discusses',
    weight REAL DEFAULT 0.5,              -- prominence 0.0-1.0
    evidence_text TEXT,                   -- source passage proving this relationship
    section_name TEXT,                    -- where in the document
    confidence REAL DEFAULT 0.8,
    UNIQUE(entry_id, attachment_id, entity_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_ee_entry ON entry_entities(entry_id);
CREATE INDEX IF NOT EXISTS idx_ee_attachment ON entry_entities(attachment_id);
CREATE INDEX IF NOT EXISTS idx_ee_entity ON entry_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_ee_relation ON entry_entities(relation_type);
```

**Relation types** (curated per document type, see §3):

| Document Type | Relation Types |
|--------------|----------------|
| research_paper | introduces, uses, discusses, extends, critiques, compares, evaluates |
| legal_case | applies, distinguishes, overrules, cites, interprets, discusses |
| patent | claims, discloses, references, improves_upon, discusses |
| book / thesis | introduces, discusses, argues, critiques, synthesizes, defines |
| general | discusses, mentions, references, analyzes |

### 1.4 Entity-Entity edges — structural relationships (Phase 2)

Created now, populated later via LLM or manual curation.

```sql
CREATE TABLE IF NOT EXISTS entity_relations (
    id INTEGER PRIMARY KEY,
    source_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,           -- is_a, part_of, variant_of, related_to, contrasts_with, applied_to
    confidence REAL DEFAULT 0.8,
    source_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
    evidence_text TEXT,                   -- provenance: which paper established this
    UNIQUE(source_entity_id, target_entity_id, relation_type),
    CHECK(source_entity_id != target_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_er_source ON entity_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_er_target ON entity_relations(target_entity_id);
```

### 1.5 Claim-Claim edges — cross-paper reasoning (Phase 3)

Created now, populated later by auto-relate with LLM classification.

```sql
CREATE TABLE IF NOT EXISTS claim_relations (
    id INTEGER PRIMARY KEY,
    source_claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    target_claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,           -- supports, contradicts, extends, refines
    confidence REAL DEFAULT 0.8,
    reasoning TEXT,                        -- LLM explanation of why these are related
    UNIQUE(source_claim_id, target_claim_id, relation_type),
    CHECK(source_claim_id != target_claim_id)
);
CREATE INDEX IF NOT EXISTS idx_cr_source ON claim_relations(source_claim_id);
CREATE INDEX IF NOT EXISTS idx_cr_target ON claim_relations(target_claim_id);
```

### 1.6 Graph indexing tracking

```sql
ALTER TABLE parsed_content ADD COLUMN graph_indexed INTEGER DEFAULT 0;
ALTER TABLE parsed_content ADD COLUMN graph_indexed_at TEXT;
```

---

## 2. LanceDB Vector Store

### 2.1 Dependencies

**Modify**: `src-tauri/Cargo.toml`

```toml
# Uncomment:
fastembed = "4"
lancedb = "0.15"
arrow = "53"

# Add:
chonkie = { version = "0.1", features = ["tokenizers"] }
```

### 2.2 Storage

Location: `~/Wren/.wren/lance_db/`

### 2.3 Vector Tables

**`paper_chunks`** — section-aware semantic chunks for RAG retrieval

| Column | Type | Purpose |
|--------|------|---------|
| entry_id | i64 | FK to SQLite entry |
| attachment_id | i64 | FK to SQLite attachment (source file for citation) |
| attachment_title | string | Cached title/filename for display without joins |
| section_name | string | Section this chunk belongs to |
| section_level | i32 | Heading depth (1=h1, 2=h2...) |
| chunk_index | i32 | Position within section |
| chunk_text | string | The actual text |
| vector | fixed_size_list[f32; DIM] | Embedding |

**`entity_vectors`** — entity embeddings for concept search

| Column | Type | Purpose |
|--------|------|---------|
| entity_id | i64 | FK to SQLite entity |
| name | string | Entity name |
| description | string | Entity description |
| category | string | Entity category |
| vector | fixed_size_list[f32; DIM] | Embedding of name+description |

**`claim_vectors`** — claim embeddings for finding related/contradicting claims

| Column | Type | Purpose |
|--------|------|---------|
| claim_id | i64 | FK to SQLite claim |
| entry_id | i64 | FK to SQLite entry |
| statement | string | The claim statement |
| claim_type | string | finding, holding, etc. |
| vector | fixed_size_list[f32; DIM] | Embedding of statement |

DIM = 384 for fastembed all-MiniLM-L6-v2 (configurable if user switches to cloud embeddings).

---

## 3. Document-Type-Aware Category System

### 3.1 Curated Lists

Defined as Rust constants/maps. The LLM extraction prompt includes the appropriate list based on `document_type` from the classifier stage.

```rust
pub struct DocTypeConfig {
    pub entity_categories: &'static [&'static str],
    pub claim_types: &'static [&'static str],
    pub relation_types: &'static [&'static str],
    pub extraction_guidance: &'static str,
}
```

| Document Type | Entity Categories | Claim Types | Relation Types |
|--------------|-------------------|-------------|----------------|
| research_paper | concept, method, model, dataset, metric, theory, task, material, algorithm, framework | finding, hypothesis, conclusion, limitation, observation | introduces, uses, discusses, extends, critiques, compares, evaluates |
| legal_case | legal_principle, statute, regulation, jurisdiction, party, precedent, doctrine, remedy | holding, ruling, dissent, reasoning, obiter_dictum | applies, distinguishes, overrules, cites, interprets, discusses |
| patent | invention, prior_art, technical_field, application_domain, component, material | claim, disclosure, advantage, limitation | claims, discloses, references, improves_upon, discusses |
| thesis | concept, method, theory, framework, research_question, contribution | finding, hypothesis, conclusion, limitation, definition, argument | introduces, uses, discusses, extends, critiques, defines |
| book / bookSection | theme, concept, theory, argument, framework, person, event, movement | thesis, argument, critique, definition, observation | introduces, discusses, argues, critiques, synthesizes, defines |
| statute / bill | provision, definition, requirement, penalty, exception, jurisdiction | requirement, prohibition, exception, definition | defines, requires, prohibits, amends, references |
| webpage / report | topic, entity, event, statistic, organization, technology | assertion, statistic, prediction, recommendation | discusses, mentions, references, analyzes, reports |
| general (fallback) | concept, entity, topic, method, tool, person, organization | assertion, observation, conclusion, recommendation | discusses, mentions, references, analyzes |

### 3.2 Lookup Logic

```rust
fn get_doc_type_config(document_type: &str) -> &DocTypeConfig {
    // Match against known types, fall back to "general"
    // document_type comes from the classifier stage of the existing pipeline
}
```

---

## 4. Section-Aware Semantic Chunking (chonkie)

Uses the [chonkie](https://crates.io/crates/chonkie) Rust crate for sentence-aware splitting within sections.

**Prerequisite**: Attachment must have `parsed_content`. No parsed content = no graph indexing. Period.

### 4.1 Strategy

Every attachment with `parsed_content` has structured content. Two sources of section structure:

1. **`sections_json` exists** (PDFs, EPUBs processed by LLM pipeline): Use directly
2. **`sections_json` is NULL but `structured_markdown` exists** (notes backfilled via `state.rs`): Parse markdown headings (`#`, `##`, `###`) into section tree — pure Rust, trivial regex, no LLM

Once we have a section tree, the chunking is identical:

```rust
use chonkie::SentenceChunker;

fn chunk_attachment(
    sections: &[Section],       // parsed from sections_json OR markdown headings
    entry_id: i64,
    attachment_id: i64,
    attachment_title: &str,
    max_chunk_tokens: usize,
) -> Vec<DocumentChunk> {
    let chunker = SentenceChunker::new(max_chunk_tokens);
    let mut chunks = Vec::new();

    for section in sections {
        if section.content.len() < max_chunk_tokens * 4 {
            // Short section → single chunk
            chunks.push(DocumentChunk {
                entry_id,
                attachment_id,
                attachment_title: attachment_title.to_string(),
                text: section.content.clone(),
                section_name: section.name.clone(),
                section_level: section.level,
                chunk_index: 0,
            });
        } else {
            // Long section → split at sentence boundaries via chonkie
            for (i, chunk) in chunker.chunk(&section.content).enumerate() {
                chunks.push(DocumentChunk {
                    entry_id,
                    attachment_id,
                    attachment_title: attachment_title.to_string(),
                    text: chunk.text.to_string(),
                    section_name: section.name.clone(),
                    section_level: section.level,
                    chunk_index: i as i32,
                });
            }
        }
    }
    chunks
}
```

Each chunk carries full provenance: `entry_id` + `attachment_id` + `attachment_title` + `section_name` + `section_level`. This enables citations like: *"from [attachment_title], section [section_name]"*.

### 4.2 Markdown Heading Parser (for notes without sections_json)

```rust
fn parse_markdown_sections(markdown: &str) -> Vec<Section> {
    // Split on lines starting with #
    // Track heading level by count of # chars
    // Group content under each heading
    // Returns flat list of Section { name, level, content }
}
```

This is needed because notes backfilled in `state.rs` get `structured_markdown` but not `sections_json`. The heading parser fills that gap cheaply.

### 4.3 Chunk Sizing

- **Target**: ~256 tokens (~1000 chars) per chunk
- **Why**: Small enough for precise retrieval, large enough for meaningful context
- **No fixed overlap**: chonkie's sentence-aware splitting produces coherent boundaries

---

## 5. LLM Knowledge Extraction

### 5.1 New File: `src-tauri/src/graph/knowledge.rs`

Single LLM call per document (JSON mode, ~2000-4000 tokens).

**Input**: `structured_markdown` + entry metadata + `document_type` from classifier

**Output**:

```rust
pub struct KnowledgeExtractionResult {
    pub entities: Vec<ExtractedEntity>,
    pub claims: Vec<ExtractedClaim>,
}

pub struct ExtractedEntity {
    pub name: String,
    pub category: String,
    pub description: String,
    pub relation_type: String,     // how the document relates to this entity
    pub weight: f32,               // 0.0-1.0 prominence
    pub evidence_text: String,     // source passage
    pub section_name: String,
}

pub struct ExtractedClaim {
    pub statement: String,
    pub evidence_text: String,
    pub section_name: String,
    pub claim_type: String,
    pub confidence: f32,
}
```

### 5.2 Prompt Template

```
System: You are a knowledge extractor for {document_type} documents.

Extract entities and claims from the following {document_type} written in {language}.

ENTITIES: Named concepts, methods, tools, datasets, or domain-specific items discussed.
For each entity provide:
- name: specific, reusable name (would appear in other documents too)
- category: one of [{entity_categories}]
- description: 1-2 sentences explaining what this is
- relation_type: how this document relates to it, one of [{relation_types}]
- weight: 0.0-1.0 how central it is to this document
- evidence_text: exact quote from the document (max 200 chars)
- section_name: which section this appears in

CLAIMS: Specific assertions, findings, or arguments the document makes.
For each claim provide:
- statement: the claim in one sentence
- evidence_text: exact quote supporting it (max 300 chars)
- section_name: which section
- claim_type: one of [{claim_types}]
- confidence: 0.0-1.0 how clearly the document states this

{additional_guidance_per_doc_type}

Return JSON with keys "entities" (array) and "claims" (array).
Extract 5-20 entities and 3-10 claims. Focus on the most important ones.

User:
Title: {title}
Authors: {creators}
Abstract: {abstract}
Type: {item_type}

{structured_markdown}
```

### 5.3 Reuse from Existing Code

- `LlmProvider` trait from `src-tauri/src/llm/provider.rs`
- JSON mode via `CompletionRequest { json_mode: true, .. }`
- `parse_json_from_response()` for extracting JSON from LLM output
- Thinking-tag stripping for reasoning models
- Retry logic with exponential backoff
- `EntryMetadata` struct from `src-tauri/src/llm/pipeline/classifier.rs`
- `create_provider()` factory from `src-tauri/src/llm/mod.rs`
- Settings loading from `src-tauri/src/commands/llm.rs`

---

## 6. Rust Module Structure

```
src-tauri/src/graph/
    mod.rs              — GraphService struct, init, re-exports
    embeddings.rs       — EmbeddingService (fastembed + cloud option)
    vectors.rs          — LanceDB table management, search, CRUD
    chunker.rs          — section-aware semantic chunking
    knowledge.rs        — LLM knowledge extraction
    doc_types.rs        — curated category/type lists per document type
    sync.rs             — index_paper_to_graph() orchestration
    search.rs           — concept_search(), find_related()
    relate.rs           — auto_relate_papers()
```

### 6.1 GraphService (`mod.rs`)

```rust
pub struct GraphService {
    db: SqlitePool,
    lance_db: lancedb::Connection,
    embedding_service: Arc<EmbeddingService>,
}

impl GraphService {
    pub async fn new(db: SqlitePool, data_dir: &Path) -> Result<Self>;
    pub async fn ensure_tables(&self) -> Result<()>;  // create LanceDB tables if missing
}
```

### 6.2 EmbeddingService (`embeddings.rs`)

```rust
pub enum EmbeddingProvider {
    Local,                                    // fastembed all-MiniLM-L6-v2
    Cloud { provider: String, model: String, api_key: String },
}

pub struct EmbeddingService {
    local_model: OnceCell<fastembed::TextEmbedding>,  // lazy init
    provider: EmbeddingProvider,
    dimensions: usize,                        // 384 for local, varies for cloud
}

impl EmbeddingService {
    pub fn new_local() -> Result<Self>;
    pub fn new_cloud(provider: &str, model: &str, api_key: &str) -> Result<Self>;
    pub async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>>;
    pub async fn embed_one(&self, text: &str) -> Result<Vec<f32>>;
    pub fn dimensions(&self) -> usize;
}
```

Lazy-init: the fastembed model (~23MB download, ~90MB in memory) loads only on first `embed_*` call.

### 6.3 Sync Orchestration (`sync.rs`)

Graph indexing is **per-attachment** (not per-entry). Each attachment with `parsed_content` is processed independently.

`index_entry_to_graph(entry_id)` — top-level orchestrator:

1. Query all `parsed_content` rows for this entry where `graph_indexed = 0`
2. Load entry metadata (title, creators, abstract, year, item_type)
3. For each unindexed attachment: call `index_attachment_to_graph()`
4. Returns summary of what was indexed

`index_attachment_to_graph(entry_id, attachment_id)` — per-attachment:

1. **Load data**: `parsed_content` (structured_markdown, sections_json, document_type) + attachment title/filename
2. **Build section tree**:
   - If `sections_json` exists → parse it
   - Else → parse markdown headings from `structured_markdown` (notes)
3. **Knowledge extraction**: LLM call → entities + claims
4. **Entity dedup + insert** (SQLite transaction):
   - For each entity: normalize name, check if `(name_normalized, category)` exists
   - If exists: reuse existing entity_id
   - If new: INSERT into `entities`
   - INSERT into `entry_entities` with `attachment_id`, relation_type, weight, evidence, section_name
5. **Claim insert**: INSERT into `claims` with `attachment_id`, statement, evidence, section_name
6. **Chunking**: run section-aware chunking via chonkie `SentenceChunker`
   - Each chunk carries: entry_id, attachment_id, attachment_title, section_name, section_level
7. **Embedding generation**: batch embed all chunks + new entity descriptions + claim statements
8. **LanceDB insert**: batch insert into `paper_chunks`, `entity_vectors` (new entities only), `claim_vectors`
9. **Mark done**: `UPDATE parsed_content SET graph_indexed = 1, graph_indexed_at = datetime('now') WHERE attachment_id = ?`

**Citation trail**: Every extracted fact traces back to: entry (paper) → attachment (file) → section → evidence text. When displaying search results or generating reviews, we can cite: *"Smith et al. (2024), main.pdf, Section 3: Results"* or *"User notes on Smith et al., Section: Key Observations"*.

### 6.4 Concept Search (`search.rs`)

```rust
pub async fn concept_search(
    graph: &GraphService,
    query: &str,
    limit: usize,
) -> Result<Vec<ConceptSearchResult>>
```

**Query flow**:

1. Embed query via `embedding_service.embed_one(query)`
2. **Vector search entities**: `entity_vectors` table → top 3×limit matches (entity_id, name, score)
3. **Vector search chunks**: `paper_chunks` table → top 2×limit matches (entry_id, chunk_text, score)
4. **Get papers for matched entities** (SQL):
   ```sql
   SELECT e.id, e.title, e.creators_sort, ee.weight, ee.evidence_text, ee.relation_type,
          ent.name, ent.category, ent.description
   FROM entries e
   JOIN entry_entities ee ON ee.entry_id = e.id
   JOIN entities ent ON ent.id = ee.entity_id
   WHERE ent.id IN (?)
   ORDER BY ee.weight DESC
   ```
5. **Merge**: combine entity matches + chunk matches, score = `entity_similarity × weight × 0.6 + chunk_similarity × 0.4`
6. **Deduplicate** by entry_id, keep highest score per paper
7. **Return** top `limit` results with matched concepts and evidence snippets

### 6.5 Auto-Relate (`relate.rs`)

```rust
pub async fn auto_relate_papers(
    graph: &GraphService,
    entry_ids: &[i64],
    progress: &dyn ProgressCallback,
) -> Result<Vec<CreatedLink>>
```

**Algorithm for each paper**:

1. Get this paper's entity_ids from `entry_entities`
2. Find papers sharing 2+ entities:
   ```sql
   SELECT e.id, e.title, COUNT(*) as shared,
          GROUP_CONCAT(ent.name) as shared_entities
   FROM entries e
   JOIN entry_entities ee ON ee.entry_id = e.id
   JOIN entities ent ON ent.id = ee.entity_id
   WHERE ee.entity_id IN (SELECT entity_id FROM entry_entities WHERE entry_id = ?)
     AND e.id != ?
   GROUP BY e.id
   HAVING COUNT(*) >= 2
   ORDER BY shared DESC
   ```
3. Get this paper's claims, vector search `claim_vectors` for similar claims in other papers
4. Score: `shared_entities × 0.4 + claim_similarity × 0.6`
5. If score > 0.5: create `entry_link` (SQLite) with:
   - `link_type = "related"` (using existing link_types table)
   - `context = "Shared concepts: X, Y, Z. Similar claims found in sections A, B."`
6. Uses existing `create_entry_link` pattern from `src-tauri/src/commands/entry_links.rs`

---

## 7. AppState & Initialization

### 7.1 AppState

**Modify**: `src-tauri/src/state.rs`

```rust
pub struct AppState {
    pub db: SqlitePool,
    pub library_path: Arc<RwLock<PathBuf>>,
    pub search_index: Arc<SearchIndex>,
    pub job_queue: Arc<JobQueue>,
    pub graph_service: Arc<GraphService>,  // NEW
}
```

In `AppState::new()`:
- After DB migrations, init `GraphService` with SQLite pool + `~/Wren/.wren/lance_db/`
- Call `graph_service.ensure_tables()` to create LanceDB tables if needed
- Pass to JobQueue

### 7.2 Module Registration

**Modify**: `src-tauri/src/lib.rs`

- Add `pub mod graph;`
- Add graph commands to `tauri::generate_handler![]`

---

## 8. Job Queue Integration

### 8.1 New Job Types

**Modify**: `src-tauri/src/jobs/types.rs`

```rust
"graph_index"     => { entry_id: i64 }           // index single paper
"graph_index_all" => {}                            // bulk index all unindexed
"graph_relate"    => { entry_ids: Option<Vec<i64>> }  // auto-relate (None = all)
```

### 8.2 Executors

**Modify**: `src-tauri/src/jobs/executor.rs`

Add to `run_job()` match arms:

- `execute_graph_index(entry_id)` → calls `sync::index_paper_to_graph()`
- `execute_graph_index_all()` → queries `parsed_content WHERE graph_indexed = 0`, processes each
- `execute_graph_relate(entry_ids)` → calls `relate::auto_relate_papers()`

### 8.3 Auto-Trigger After LLM Parse

In existing `execute_llm_parse()`, after successful completion:
- Check `graph_auto_index` setting (default: true)
- If enabled, enqueue `graph_index` job for same entry_id

Chain: import → text extract → LLM parse → **graph index** (auto)

---

## 9. Tauri Commands

**New file**: `src-tauri/src/commands/graph.rs`

```rust
graph_concept_search(query: String, limit: Option<usize>) -> Vec<ConceptSearchResult>
graph_get_paper_knowledge(entry_id: i64) -> PaperKnowledgeGraph
graph_status() -> GraphStatus
graph_index_entry(entry_id: i64) -> String       // job_id
graph_index_all() -> String                       // job_id
graph_auto_relate(entry_ids: Option<Vec<i64>>) -> String  // job_id
```

**Response types**:

```rust
struct ConceptSearchResult {
    entry_id: i64,
    title: String,
    creators: String,
    relevance_score: f32,
    matched_concepts: Vec<MatchedConcept>,   // name, category, weight, description
    evidence_snippets: Vec<EvidenceSnippet>, // text, section_name, source (entity or chunk)
}

struct PaperKnowledgeGraph {
    entities: Vec<EntityInfo>,     // name, description, category, relation_type, weight
    claims: Vec<ClaimInfo>,        // statement, evidence, section, type, confidence
    related_papers: Vec<RelatedPaperInfo>,  // from entry_links with context
    graph_indexed: bool,
    indexed_at: Option<String>,
}

struct GraphStatus {
    papers_indexed: usize,
    total_parseable: usize,
    entity_count: usize,
    claim_count: usize,
    chunk_count: usize,
}
```

---

## 10. Frontend Integration

### 10.1 Command Bindings

**Modify**: `src/services/tauri/commands.ts` — add all `graph_*` command types and invoke wrappers

### 10.2 Settings UI

**Modify**: `src/components/settings/sections/AISearchSection.tsx`

Add "Knowledge Graph" card:
- Status line: "42 of 100 papers indexed" with progress bar
- Embedding model selector (Local: all-MiniLM-L6-v2 / Cloud: use LLM provider's embeddings)
- Toggle: "Auto-index after parsing" (`graph_auto_index`)
- "Build Knowledge Graph" button → `graph_index_all` job
- "Find Related Papers" button → `graph_auto_relate` job
- Progress shown via existing job progress event system

### 10.3 AI Search Mode (existing)

The command palette already has an **AI** search mode button (alongside Quick and Full). Enhance this existing mode to use the knowledge graph as its backend:

- When user clicks **AI** and types a query → calls `graph_concept_search()`
- Results: ranked papers with:
  - Title + creators
  - Matched concepts as colored category tags
  - Evidence snippets with citation (blockquotes from source text + attachment name + section)
  - Relevance score indicator
- If graph is not built yet, show a message prompting user to build the knowledge graph from settings

### 10.4 Paper Knowledge Panel

New tab in entry detail view:
- **Entities**: grouped by category, shown as colored tags
- **Claims**: cards with statement, evidence (expandable), section name, type badge
- **Related Papers**: from entry_links with context explanation
- "Index this paper" button if not yet indexed

### 10.5 Command Palette

**Modify**: `src/components/search/CommandPalette.tsx`
- "Search by Concept..." — opens concept search
- "Build Knowledge Graph" — triggers graph_index_all
- "Find Related Papers" — triggers graph_auto_relate
- "View Paper Knowledge" — opens knowledge panel for current entry

---

## 11. Implementation Order

| Step | What | Files |
|------|------|-------|
| 1 | SQLite migration — all knowledge graph tables | `src-tauri/src/db/migrations.rs` |
| 2 | Cargo.toml — uncomment fastembed/lancedb/arrow, add text-splitter | `src-tauri/Cargo.toml` |
| 3 | graph module — mod.rs, doc_types.rs, embeddings.rs | `src-tauri/src/graph/` |
| 4 | LanceDB setup — vectors.rs (table creation, CRUD, search) | `src-tauri/src/graph/vectors.rs` |
| 5 | Chunking — section-aware semantic chunker | `src-tauri/src/graph/chunker.rs` |
| 6 | Knowledge extraction — LLM prompt, parsing | `src-tauri/src/graph/knowledge.rs` |
| 7 | Graph sync — full orchestration pipeline | `src-tauri/src/graph/sync.rs` |
| 8 | AppState + init | `src-tauri/src/state.rs` |
| 9 | Job types + executors + auto-trigger | `src-tauri/src/jobs/{types,executor}.rs` |
| 10 | Tauri commands | `src-tauri/src/commands/graph.rs`, `lib.rs` |
| 11 | Concept search logic | `src-tauri/src/graph/search.rs` |
| 12 | Auto-relate logic | `src-tauri/src/graph/relate.rs` |
| 13 | Frontend — commands.ts, settings, search UI | `src/services/`, `src/components/` |
| 14 | Frontend — knowledge panel, command palette | `src/components/` |

---

## 12. Files Summary

### Modify

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Uncomment fastembed/lancedb/arrow, add text-splitter |
| `src-tauri/src/lib.rs` | Add `pub mod graph;`, register graph commands |
| `src-tauri/src/state.rs` | Add `graph_service` to AppState, init in new() |
| `src-tauri/src/db/migrations.rs` | Add entities, claims, entry_entities, entity_relations, claim_relations tables |
| `src-tauri/src/jobs/types.rs` | Add GraphIndex, GraphIndexAll, GraphRelate job types |
| `src-tauri/src/jobs/executor.rs` | Add graph job executors, auto-trigger after llm_parse |
| `src-tauri/src/jobs/queue.rs` | Pass graph_service to executor |
| `src/services/tauri/commands.ts` | Add graph command bindings |
| `src/stores/settingsStore.ts` | Add graph settings (graph_auto_index, embedding_provider) |
| `src/components/settings/sections/AISearchSection.tsx` | Add knowledge graph section |
| `src/components/search/CommandPalette.tsx` | Add graph commands |

### Create

| File | Purpose |
|------|---------|
| `src-tauri/src/graph/mod.rs` | GraphService struct, init |
| `src-tauri/src/graph/doc_types.rs` | Curated category/type lists per document type |
| `src-tauri/src/graph/embeddings.rs` | fastembed + cloud embedding service |
| `src-tauri/src/graph/vectors.rs` | LanceDB table management + vector CRUD + search |
| `src-tauri/src/graph/chunker.rs` | Section-aware semantic chunking |
| `src-tauri/src/graph/knowledge.rs` | LLM knowledge extraction |
| `src-tauri/src/graph/sync.rs` | Index paper → SQLite + LanceDB |
| `src-tauri/src/graph/search.rs` | Concept search query logic |
| `src-tauri/src/graph/relate.rs` | Auto-relate papers logic |
| `src-tauri/src/commands/graph.rs` | Tauri commands for frontend |
| `src/stores/graphStore.ts` | Frontend graph state |

### Reuse (existing code)

| What | Where |
|------|-------|
| LLM providers | `src-tauri/src/llm/mod.rs`, `provider.rs`, `{openai,anthropic,...}.rs` |
| JSON parsing | `src-tauri/src/llm/provider.rs` (`parse_json_from_response`) |
| Entry metadata | `src-tauri/src/llm/pipeline/classifier.rs` (`EntryMetadata`) |
| Document type | `parsed_content.document_type` (already extracted by classifier) |
| Section structure | `parsed_content.sections_json` (already extracted by pipeline) |
| Job infrastructure | `src-tauri/src/jobs/queue.rs`, `types.rs` |
| Entry links | `src-tauri/src/commands/entry_links.rs` (`create_entry_link` pattern) |
| Settings | `src-tauri/src/commands/settings.rs` |

---

## 13. Verification

1. **Migration**: Start app → verify 6 new tables created in SQLite
2. **Embeddings**: Call `embed_one("test")` → verify 384-dim vector returned
3. **LanceDB**: Verify 3 tables created at `~/Wren/.wren/lance_db/`
4. **Knowledge extraction**: Parse a paper → trigger `graph_index_entry` → verify entities and claims in SQLite, vectors in LanceDB
5. **Entity dedup**: Index 2 papers discussing "transformer" → verify single entity row, two entry_entities rows
6. **Concept search**: Index 3+ papers → `graph_concept_search("attention mechanism")` → verify relevant papers returned with evidence
7. **Auto-relate**: Index 5+ papers in same field → `graph_auto_relate` → verify `entry_links` created with context
8. **UI**: Settings shows graph status, concept search returns results, knowledge panel shows entities/claims
9. **Doc type handling**: Index a non-paper document (if available) → verify appropriate categories used
