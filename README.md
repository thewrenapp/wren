# Wren

**A modern, local-first reference manager — a fast, programmable alternative to Zotero.**

Wren keeps your research papers, PDFs, notes, and annotations on your own machine,
in plain files plus a local database. It uses a Zotero-style data model (40+ item
types, creators, BibTeX / BibLaTeX / CSL-JSON in and out) and is Zotero-*compatible*
enough that the standard Zotero browser connector works against it. Unlike Zotero,
your library is **open and programmable** — a local REST API, a `wren://` URL
scheme, and clean text extraction make it a first-class data source for your own
scripts, tools, and AI/agent workflows.

> Status: early development (v0.1.0), macOS only for now.

---

## Features

### Your library
- **Zotero-style items** — 40+ item types with type-aware bibliographic fields
  (DOI, ISBN, ISSN, PMID, abstract, publication, volume/issue/pages, …) and
  structured creators (authors, editors, translators, …).
- **Attachments** — PDFs, EPUBs, HTML web snapshots, images, notes, and weblinks,
  stored as plain files on disk alongside a local SQLite database.
- **Trash** with soft-delete, restore, and permanent delete.

### Read & annotate
- **PDF viewer** (pdf.js) — outline/TOC, thumbnails, in-document search, zoom and
  fit modes, print. Annotation tools: text highlights, area highlights, free-text
  notes, freehand drawing, and shapes, each with color presets. Annotations are
  stored in your local database (your original PDFs are never modified), with an
  **optional export that embeds highlights into a PDF copy** — and import of
  highlights from existing PDFs.
- **EPUB reader** — chapters/TOC, in-book search, font sizing, light/dark theming.
- **HTML snapshot viewer** — read saved web pages with highlighting and annotations.
- **Image viewer** for image attachments.

### Notes
- **Markdown editor** (CodeMirror) with live in-place rendering, **KaTeX** math,
  and **Shiki** syntax highlighting (60+ themes).
- **Slash commands** (`/`) for headings, tables, callouts, lists, code/math blocks,
  and **reference links** to entries, attachments, tags, and collections.
- **Anchored comments** on note text and **backlinks** between entries.

### Organize
- **Collections** — hierarchical, colorable folders.
- **Tags** — colorable, with AND/OR ("All"/"Any") filtering.
- **Smart filters** — a saved, rule-based search builder (field/operator/value,
  match all/any, scoped to the library or a collection).
- **Duplicate detection** by DOI and title, with merge.
- **Typed entry links** (cites, supports, contradicts, extends, …) and backlinks.

### Search
- **Full-text search** over extracted document content (Tantivy).
- **Semantic search** — vector retrieval of relevant passages over your library's
  embeddings, with optional cross-encoder reranking, returning the source passages
  and jumping you to the exact page. (Retrieval, not a chatbot.)
- Both are available from the **command palette** (`⌘K`: Quick / Full-text /
  Semantic), plus an **Advanced Search** dialog you can save as a smart filter.

### Import & export
- **Import** — PDFs, whole folders (recursive, SHA-256 dedup), BibTeX, CSL-JSON,
  and **Zotero BibLaTeX-with-files exports** (with a preview/dedup dialog).
- **Export** — BibTeX, BibLaTeX-with-files (optionally including annotations),
  CSL-JSON, and a portable native **`.wren` archive** for backing up or moving
  your whole library. (Formatted citations are also available via the local API.)

### Document text extraction
Every PDF — including **scanned** ones — is turned into clean Markdown using an
on-device pipeline: deep-learning **layout analysis**, **OCR**, and **table
recognition** (PP-DocLayout + PP-OCRv5 + SLANet via ONNX Runtime, with pdfium for
rasterization). This powers search and feeds the open API below.

---

## Open & programmable

This is what makes Wren more than a local Zotero: your library is accessible to
*other* software, so you can build on top of it instead of being locked in.

- **Local REST API** (`127.0.0.1`) — list items, run searches, fetch citations
  (BibTeX / CSL-JSON / formatted), browse collections and tags, and add notes.
- **`wren://` URL scheme** — deep-link straight to an entry, or open a specific
  PDF at a given page or annotation.
- **Structured Markdown extraction** — clean, structured text for every document,
  ready to pipe into your own AI tools, agents, and scripts.

Wren is designed to be the **open, local data source your AI workflows read from**
— not a walled garden.

## Optional on-device AI

AI in Wren is a set of *optional background helpers*, not the product — and it can
run with **no cloud and no API key**. Pluggable providers: **OpenAI, Anthropic,
Google Gemini**, **Ollama** (local or cloud), and an **Apple-MLX-style (oMLX)**
local server. Ollama and oMLX can also serve embeddings and a reranker locally.

- **AI metadata extraction** — fills in title, authors, year, abstract, venue,
  DOI, and keywords from a PDF's text on import.
- **AI document structuring** — reorganizes extracted text into clean, structured
  Markdown sections (with a configurable per-document token budget).
- **Embeddings + reranking** — power the semantic search described above.

There is no chat or answer-generation feature; the LLM is used to enrich and
structure your library, and the results are yours, on disk.

## Sync

Bring your own cloud — no Wren account or server. Point Wren at a cloud-synced
folder (one-click **iCloud Drive**, or choose any **Dropbox / Google Drive /
OneDrive** folder) and it symlinks your library there.

- **Synced** (via your cloud service): entry metadata, PDFs & attachments,
  annotations & notes, tags & collections.
- **Per-device** (stays local): full-text search index, vector embeddings,
  database cache, and API keys.

## Browser connector

**Wren Connector** is a Zotero-Connector-style Chrome extension that saves
references (and PDFs/snapshots) from the web in one click — it talks to Wren's
local connector server. It's distributed as a downloadable zip (no Chrome Web
Store needed):

1. **Download:** [Wren Connector (.zip)](https://github.com/thewrenapp/wren/releases/latest/download/wren-connector.zip)
2. Unzip it, then in Chrome go to `chrome://extensions`, enable **Developer mode**,
   and click **Load unpacked** → select the unzipped folder.
3. Make sure the connector server is enabled in Wren (**Settings → Connector**).

> The connector is a separate project derived from the Zotero Connector and is
> licensed AGPL-3.0; it is not part of the MIT-licensed app.

## Privacy

Local-first by default. Your documents, notes, annotations, and metadata never
leave your machine. The only outbound network calls are: (1) a one-time download
of the document-analysis models (see below), and (2) any cloud AI provider you
explicitly configure — choose Ollama or oMLX and even that stays on-device.

## Background tasks

Heavy work runs in a visible, persistent task queue with progress, cancel, retry,
and resume: Import PDFs, Import Folder, OCR/text extraction, Parse Document
Structure (LLM, checkpointed), Extract Metadata with AI, Build Semantic Index, and
Reindex Library.

---

## Roadmap

Wren today is a solid local-first reference manager with optional AI helpers. The
goal is to grow it into a genuinely **AI-native** research tool — one that doesn't
just store your papers but helps you understand the literature: what each paper
says, how papers relate, and where they agree or disagree. Feedback and
contributions on any of this are very welcome.

### Shipping today

- [x] Local-first library with Zotero-style items and attachments (PDF, EPUB, HTML, images)
- [x] PDF & EPUB readers with database-backed highlights/annotations (optional embed-on-export)
- [x] Markdown notes with math, code highlighting, slash commands, and backlinks
- [x] Full-text search (Tantivy) + semantic search over embeddings
- [x] AI metadata extraction and AI document structuring
- [x] On-device layout analysis, OCR, and table extraction
- [x] BibTeX / BibLaTeX / CSL-JSON and portable archive import/export
- [x] Browser connector (Zotero-compatible), local REST API, and `wren://` deep links
- [x] Bring-your-own-model AI — OpenAI, Anthropic, Gemini, Ollama, oMLX (cloud or fully local)

### Next: an AI-native research layer

Turning your library into a knowledge layer you can actually reason over:

- [ ] **Automatic paper summaries** — AI TL;DRs and structured abstracts, kept up to date as you add papers
- [ ] **Concepts** — extract and index the key concepts/entities across your library; browse and search by concept
- [ ] **Linked & related papers** — surface connections via citations, shared concepts, and embeddings
- [ ] **Agreements & disagreements** — find where papers support or contradict each other on a claim, and show both sides
- [ ] **Knowledge graph (GraphRAG)** — a graph of entities, claims, and relations across your library, for deeper retrieval than flat vector search
- [ ] **Ask your library** — natural-language questions answered from your own papers, with citations to the source passages
- [ ] **Literature-review assistant** — synthesize themes, gaps, and timelines across a collection
- [ ] **Citation & concept network view** — visualize how papers and ideas connect

### Platform & ecosystem

- [ ] Windows and Linux builds
- [ ] **Companion iOS & Android app** — read, annotate, and search your library on the go, synced with the desktop (Tauri 2 targets mobile from the same Rust core)
- [ ] Bundle-based sharing (`.wren` packs) and peer-to-peer / encrypted sync
- [ ] Smarter auto-tagging and collections
- [ ] A documented plugin / automation API on top of the local server

> Several of the AI-native items above (concepts, claims, agreements/disagreements,
> a knowledge graph) were prototyped early on and intentionally reset so they can be
> rebuilt on Wren's current document-RAG foundation. They're the heart of where Wren
> is headed.

---

## Tech stack

- **Shell:** [Tauri 2](https://tauri.app) — Rust backend, web frontend
- **Frontend:** React 19, TypeScript, Tailwind CSS, Radix UI, CodeMirror
- **Data & search:** SQLite (via SQLx), Tantivy (full-text), LanceDB (vectors)
- **Document extraction:** pdfium + [oar-ocr](https://github.com/GreatV/oar-ocr) /
  ONNX Runtime (layout analysis, OCR, table recognition)
- **AI providers (optional):** OpenAI, Anthropic, Gemini, Ollama, oMLX

## Requirements

- **macOS** (Apple Silicon or Intel)
- **Rust** 1.96+ (`rustup`)
- **Node.js** 20+ ([nvm](https://github.com/nvm-sh/nvm) recommended)
- **Xcode Command Line Tools** (`xcode-select --install`)

## Development

```bash
npm install            # install JS dependencies
npm run tauri:dev      # run with hot-reload
npx tsc --noEmit       # type-check the frontend
npm run tauri:build    # build a release bundle (.app / .dmg)
```

For a signed, notarized macOS release, use `./scripts/build-macos.sh` after
exporting your Apple credentials (`APPLE_SIGNING_IDENTITY`; plus `APPLE_API_KEY`,
`APPLE_API_ISSUER`, and `APPLE_API_KEY_PATH` to notarize).

If you use nvm, source it first (e.g. `source ~/.nvm/nvm.sh`) so the right Node
version is on your `PATH`.

### Native dependency: pdfium

Wren's document-extraction pipeline uses
[pdfium](https://pdfium.googlesource.com/pdfium/) to **rasterize PDF pages into
images** — the input to the on-device layout/OCR/table models. (The in-app PDF
*viewer* is pdf.js; pdfium is used only for parsing.) It's loaded at runtime from
`src-tauri/resources/libpdfium.dylib`. This prebuilt library is **not
committed to the repo** — fetch it once before building, from
[bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries):

```bash
mkdir -p src-tauri/resources
# Apple Silicon. Use pdfium-mac-x64 on Intel, or pdfium-mac-univ for a universal build.
curl -L https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-mac-arm64.tgz \
  | tar -xzf - -C src-tauri/resources --strip-components=1 lib/libpdfium.dylib
```

> **First-run note:** the first time Wren parses a PDF it downloads ~40 MB of
> document-analysis models (layout, OCR, table recognition) into your
> application-data directory and caches them. After that, extraction works offline.

## Contributing

Contributions are welcome — bug reports, features, docs, and code. Please read
[CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md) first.

**One hard rule: no vibe-coded contributions.** You may use AI tools, but don't
open a PR with code you haven't read, don't understand, and can't explain — you're
accountable for every line you submit. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for the full policy.

Found a security issue? Please report it privately — see [SECURITY.md](./SECURITY.md).

## License

Wren is released under the [MIT License](./LICENSE). It bundles and depends on
third-party open-source components (pdfium, ONNX Runtime, PaddleOCR models, and
many Rust and JavaScript libraries); their licenses and required notices are in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
