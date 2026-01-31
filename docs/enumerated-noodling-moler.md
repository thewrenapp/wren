# Etal - macOS Reference Management App Implementation Plan

## Overview

Etal is a Tauri-based macOS reference management application with React frontend. It manages PDFs and Markdown notes with bidirectional wiki-style linking, Graph RAG for semantic search, and a Slack-inspired UI.

## Confirmed Requirements Summary

| Feature | Decision |
|---------|----------|
| PDF Storage | Copy into managed folder |
| Markdown Editor | CodeMirror 6 |
| PDF Viewer | react-pdf-highlighter-extended (annotations stored in DB, Zotero-style) |
| Link Syntax | Wiki-style `[[Title]]` with typed links |
| Vector Store | LanceDB |
| Collections | Flat (use tags for hierarchy) |
| Tags | Flat structure |
| View Mode | List/Card toggle |
| Note Metadata | YAML frontmatter |
| Embedding Model | User-configurable (default: all-MiniLM-L6-v2) |
| Search Modes | Quick + Full-text + Semantic |
| Tab Persistence | Yes, restore on startup |
| Data Location | Default ~/Etal, user-configurable |
| Keyboard Nav | Essential - full keyboard navigation |
| Sidebar | Library + Tags + Smart Filters |
| App Icon | `/Users/sadanand/Develop/Apps/etal/etal.png` |

---

## Project Structure

```
etal/
├── src/                              # React Frontend
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx
│   │   │   ├── Sidebar/
│   │   │   │   ├── ProfileBar.tsx
│   │   │   │   ├── LibrarySidebar.tsx
│   │   │   │   ├── TagList.tsx
│   │   │   │   └── SmartFilters.tsx
│   │   │   ├── MiddlePane/
│   │   │   │   ├── ItemList.tsx
│   │   │   │   ├── ItemCard.tsx
│   │   │   │   └── ViewToggle.tsx
│   │   │   ├── RightPane/
│   │   │   │   ├── MetadataPanel.tsx
│   │   │   │   ├── LinkedDocs.tsx
│   │   │   │   └── GraphView.tsx
│   │   │   └── TabBar/
│   │   │       ├── TabBar.tsx
│   │   │       └── Tab.tsx
│   │   ├── pdf/
│   │   │   ├── PDFViewer.tsx
│   │   │   ├── PDFHighlighter.tsx
│   │   │   └── AnnotationSidebar.tsx
│   │   ├── markdown/
│   │   │   ├── MarkdownEditor.tsx
│   │   │   ├── WikiLinkExtension.ts
│   │   │   └── FrontmatterParser.ts
│   │   ├── search/
│   │   │   └── CommandPalette.tsx
│   │   └── ui/                       # shadcn/ui components
│   ├── hooks/
│   ├── stores/                       # Zustand stores
│   │   ├── libraryStore.ts
│   │   ├── tabStore.ts
│   │   ├── uiStore.ts
│   │   └── settingsStore.ts
│   ├── services/tauri/
│   │   ├── commands.ts
│   │   └── events.ts
│   ├── types/
│   └── utils/
├── src-tauri/                        # Rust Backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   │   ├── items.rs
│   │   │   ├── collections.rs
│   │   │   ├── tags.rs
│   │   │   ├── annotations.rs
│   │   │   ├── links.rs
│   │   │   ├── search.rs
│   │   │   ├── import.rs
│   │   │   └── settings.rs
│   │   ├── db/
│   │   │   ├── connection.rs
│   │   │   ├── migrations.rs
│   │   │   ├── models/
│   │   │   └── queries/
│   │   ├── files/
│   │   │   ├── storage.rs
│   │   │   ├── watcher.rs
│   │   │   └── importer.rs
│   │   ├── pdf/
│   │   │   ├── parser.rs
│   │   │   ├── metadata.rs
│   │   │   └── text.rs
│   │   ├── markdown/
│   │   │   ├── parser.rs
│   │   │   ├── frontmatter.rs
│   │   │   └── wiki_links.rs
│   │   ├── search/
│   │   │   ├── fulltext.rs
│   │   │   ├── semantic.rs
│   │   │   └── quick.rs
│   │   ├── embeddings/
│   │   │   ├── generator.rs
│   │   │   ├── store.rs
│   │   │   └── config.rs
│   │   └── state/
│   │       └── app_state.rs
│   ├── migrations/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/                        # Generated from etal.png
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── etal.png                          # App icon source
```

---

## Tech Stack

### Rust Backend (Cargo.toml)
```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "chrono", "uuid"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
lopdf = "0.34"
pdf-extract = "0.7"
comrak = { version = "0.28", features = ["syntect"] }
tantivy = "0.22"
fastembed = "4"
lancedb = "0.15"
arrow = "53"
notify = "7"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
thiserror = "2"
anyhow = "1"
sha2 = "0.10"
```

### React Frontend (package.json)
```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "react": "^18",
    "zustand": "^4",
    "@codemirror/lang-markdown": "^6",
    "@codemirror/theme-one-dark": "^6",
    "codemirror": "^6",
    "react-pdf-highlighter-extended": "^7",
    "cmdk": "^1",
    "react-force-graph-2d": "^1",
    "tailwindcss": "^3",
    "class-variance-authority": "^0.7",
    "clsx": "^2",
    "lucide-react": "^0.400"
  }
}
```

---

## Database Schema (SQLite)

### Core Tables

```sql
-- Item types
CREATE TABLE item_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL
);

-- Core items
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type_id INTEGER NOT NULL REFERENCES item_types(id),
    key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0
);

-- PDF-specific data
CREATE TABLE pdf_items (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    page_count INTEGER,
    author TEXT,
    abstract TEXT,
    doi TEXT,
    publication_date TEXT,
    publisher TEXT,
    journal TEXT,
    text_extracted INTEGER DEFAULT 0,
    embedded INTEGER DEFAULT 0
);

-- Markdown notes
CREATE TABLE markdown_items (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    frontmatter TEXT,
    embedded INTEGER DEFAULT 0
);

-- Collections (flat)
CREATE TABLE collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    color TEXT,
    icon TEXT
);

CREATE TABLE collection_items (
    collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, item_id)
);

-- Tags (flat)
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
);

CREATE TABLE item_tags (
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

-- Typed bidirectional links
CREATE TABLE link_types (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    inverse_name TEXT
);

CREATE TABLE item_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    target_item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    link_type_id INTEGER REFERENCES link_types(id),
    context TEXT,
    UNIQUE(source_item_id, target_item_id, link_type_id)
);

-- PDF Annotations (Zotero-style, DB-stored)
CREATE TABLE annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    annotation_type TEXT NOT NULL, -- highlight, underline, note, area
    page_number INTEGER NOT NULL,
    position_json TEXT NOT NULL,
    selected_text TEXT,
    comment TEXT,
    color TEXT DEFAULT '#FFEB3B'
);

-- Settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT DEFAULT 'string'
);

-- Tab state persistence
CREATE TABLE tab_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    tab_type TEXT NOT NULL,
    tab_data TEXT,
    order_index INTEGER NOT NULL,
    is_active INTEGER DEFAULT 0
);

-- FTS5 for quick search
CREATE VIRTUAL TABLE items_fts USING fts5(title, content, item_id UNINDEXED);
```

---

## Implementation Phases

### Phase 1: Foundation
**Files to create:**
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json` (include icon from etal.png)
- `src-tauri/src/main.rs`
- `src-tauri/migrations/001_initial_schema.sql`
- `src/App.tsx`
- `src/components/layout/AppLayout.tsx`
- `package.json`, `vite.config.ts`, `tailwind.config.js`

**Goals:**
- Initialize Tauri 2.x + React + Vite project
- Set up shadcn/ui + Tailwind
- Basic SQLite schema
- Three-pane resizable layout
- Theme support (system/light/dark)
- Generate app icons from etal.png

### Phase 2: Library Management
**Files to create:**
- `src-tauri/src/commands/items.rs`
- `src-tauri/src/commands/import.rs`
- `src-tauri/src/files/importer.rs`
- `src-tauri/src/pdf/parser.rs`
- `src/stores/libraryStore.ts`
- `src/components/layout/MiddlePane/ItemList.tsx`
- `src/components/layout/RightPane/MetadataPanel.tsx`

**Goals:**
- PDF import (single + folder)
- PDF metadata extraction (lopdf + pdf-extract)
- Item CRUD operations
- Collections and tags
- List/card view toggle
- Metadata panel

### Phase 3: PDF Viewer & Annotations
**Files to create:**
- `src/components/pdf/PDFViewer.tsx`
- `src/components/pdf/PDFHighlighter.tsx`
- `src-tauri/src/commands/annotations.rs`

**Goals:**
- Integrate react-pdf-highlighter-extended
- Text highlighting
- Area annotations
- Comments on annotations
- Annotations stored in SQLite (not in PDF)

### Phase 4: Markdown Notes
**Files to create:**
- `src/components/markdown/MarkdownEditor.tsx`
- `src/components/markdown/WikiLinkExtension.ts`
- `src-tauri/src/markdown/parser.rs`
- `src-tauri/src/markdown/frontmatter.rs`
- `src-tauri/src/markdown/wiki_links.rs`
- `src-tauri/src/commands/links.rs`

**Goals:**
- CodeMirror 6 markdown editor
- YAML frontmatter parsing (comrak)
- Wiki-style `[[links]]` with syntax highlighting
- Typed links (cites, summarizes, etc.)
- Bidirectional link tracking
- Linked documents panel

### Phase 5: Search System
**Files to create:**
- `src/components/search/CommandPalette.tsx`
- `src-tauri/src/search/quick.rs`
- `src-tauri/src/search/fulltext.rs`
- `src-tauri/src/search/semantic.rs`
- `src-tauri/src/embeddings/generator.rs`
- `src-tauri/src/embeddings/store.rs`

**Goals:**
- Command palette (Cmd+K) with cmdk
- Quick search: SQLite FTS5 (title/metadata)
- Full-text search: Tantivy index
- Semantic search: fastembed + LanceDB
- User-configurable embedding model

### Phase 6: Graph & Polish
**Files to create:**
- `src/components/layout/RightPane/GraphView.tsx`
- `src/utils/keyboardShortcuts.ts`
- `src-tauri/src/files/watcher.rs`

**Goals:**
- Graph visualization (react-force-graph)
- Full keyboard navigation
- File watcher for external changes
- Settings panel
- Tab persistence

---

## Key Data Flows

### PDF Import
```
File picker → Copy to ~/Etal/files/pdfs/{uuid}/ → Extract metadata (lopdf)
→ Create DB records → Queue async indexing → Extract text (pdf-extract)
→ Index in Tantivy → Generate embeddings (fastembed) → Store in LanceDB
```

### Wiki Link Resolution
```
Type [[Title]] → CodeMirror decoration → Click handler
→ Search items by title → Open in new tab OR offer to create new note
→ Create item_link record with link type
```

### Semantic Search
```
Query input → Generate embedding (fastembed) → Vector search (LanceDB)
→ Deduplicate by item_id → Enrich with metadata → Display with snippets
```

---

## Verification Plan

1. **Phase 1**: App launches, shows three-pane layout, theme toggle works
2. **Phase 2**: Can import PDF, view in list/card, edit metadata
3. **Phase 3**: Can highlight PDF text, add notes, annotations persist
4. **Phase 4**: Can create/edit markdown notes, wiki links resolve
5. **Phase 5**: Cmd+K opens palette, all three search modes work
6. **Phase 6**: Graph shows connections, keyboard nav complete

**Test commands:**
```bash
# Development
cd /Users/sadanand/Develop/Apps/etal
npm run tauri dev

# Build
npm run tauri build
```

---

## App Icon

Source: `/Users/sadanand/Develop/Apps/etal/etal.png`

Generate required sizes using Tauri's icon generation:
```bash
npm run tauri icon /Users/sadanand/Develop/Apps/etal/etal.png
```

This creates icons in `src-tauri/icons/` for macOS (icns, various PNG sizes).
