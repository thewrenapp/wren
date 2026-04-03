# Wren REST API

Wren exposes a local REST API through its Connector Server for integration with external tools (LaunchBar, Shortcuts, scripts, etc.).

## Setup

1. Open Wren **Settings > Connector**
2. Enable the Connector Server
3. Note the **Port** (default: `1289`) and **Auth Token**

## Authentication

All API requests require the `X-Wren-Token` header:

```bash
curl -H "X-Wren-Token: YOUR_TOKEN" http://127.0.0.1:1289/api/...
```

## URL Scheme (Deep Links)

Wren also registers the `wren://` URL scheme for navigation from external apps:

| URL | Action |
|-----|--------|
| `wren://select/library/items/<entryKey>` | Select item in library |
| `wren://open-pdf/library/items/<entryKey>/<attachmentKey>?page=N` | Open PDF at page |
| `wren://open-pdf/library/items/<entryKey>/<attachmentKey>?annotation=<annotKey>` | Open PDF at annotation |

Usage from Terminal:
```bash
open "wren://select/library/items/b0e13351-0ee9-43c1-8c52-c3001f72686c"
open "wren://open-pdf/library/items/b0e13351-0ee9-43c1-8c52-c3001f72686c/f235008a-31ae-42de-aec3-0ef640ea31fd?page=5"
```

> URL scheme requires a bundled `.app` build (not `tauri dev`).

---

## Single-Item Endpoints

All single-item endpoints use the entry's UUID **key** (available via "Copy Item Key" in the Info panel, or from the `/api/items` listing).

### Get Citation

Returns a plain-text APA-style citation.

```
GET /api/items/{key}/cite
```

```bash
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/ab0e2e23-c664-41ab-b360-7eda45b6c190/cite
```

Response (`text/plain`):
```
Jiang, X., Zhou, Y., Wells, A., & Brufsky, A. (2024). Coalitions of AI-based Methods Predict 15-Year Risks of Breast Cancer Metastasis. Journal Name, 12(3), 45-67. https://doi.org/10.1234/example
```

### Get BibTeX

Returns a BibTeX entry.

```
GET /api/items/{key}/bibtex
```

```bash
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/ab0e2e23-c664-41ab-b360-7eda45b6c190/bibtex
```

Response (`text/plain`):
```bibtex
@article{ab0e2e23-c664-41ab-b360-7eda45b6c190,
  author = {Xia Jiang and Yijun Zhou},
  title = {Coalitions of AI-based Methods...},
  journaltitle = {Journal Name},
  date = {2024},
}
```

### Get CSL JSON

Returns a CSL JSON object.

```
GET /api/items/{key}/json
```

```bash
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/ab0e2e23-c664-41ab-b360-7eda45b6c190/json
```

Response (`application/json`):
```json
{
  "id": "ab0e2e23-c664-41ab-b360-7eda45b6c190",
  "type": "article-journal",
  "title": "Coalitions of AI-based Methods...",
  "author": [{"family": "Jiang", "given": "Xia"}],
  "issued": {"date-parts": [[2024]], "raw": "2024"},
  "container-title": "Journal Name",
  "DOI": "10.1234/example"
}
```

### Get Attachments

Returns all attachments for an entry with absolute file paths.

```
GET /api/items/{key}/attachments
```

```bash
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/ab0e2e23-c664-41ab-b360-7eda45b6c190/attachments
```

Response:
```json
[
  {
    "id": 15,
    "key": "f235008a-31ae-42de-aec3-0ef640ea31fd",
    "attachmentType": "pdf",
    "title": "Document.pdf",
    "filePath": "/Users/you/Wren/storage/ab0e2e23/Document.pdf",
    "url": null,
    "pageCount": 12,
    "fileSize": 1048576,
    "markdownPath": "/Users/you/Wren/extracted/ab0e2e23/Document.md"
  }
]
```

---

## Library Browsing Endpoints

### List All Items

Paginated list of all entries.

```
GET /api/items?offset=0&limit=50
```

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `offset` | `0` | — | Skip N entries |
| `limit` | `50` | `200` | Entries per page |

```bash
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/items?limit=10"
```

Response:
```json
{
  "items": [
    {
      "id": 13,
      "key": "b0e13351-0ee9-43c1-8c52-c3001f72686c",
      "itemType": "journalArticle",
      "title": "Deep Learning-Based Breast Cancer Detection...",
      "creators": "Chamveha et al.",
      "year": "2024",
      "dateAdded": "2026-03-31 22:16:13",
      "hasPdf": true
    }
  ],
  "total": 9,
  "offset": 0,
  "limit": 10
}
```

### Search

Full-text search across document content. Results are deduplicated by entry.

```
GET /api/search?q=QUERY&offset=0&limit=50
```

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `q` | (required) | — | Search query |
| `offset` | `0` | — | Skip N results |
| `limit` | `50` | `200` | Results per page |

```bash
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/search?q=breast+cancer&limit=5"
```

Response:
```json
{
  "query": "breast cancer",
  "results": [
    {
      "entryId": 10,
      "entryKey": "0518fc85-bd80-49b1-abd9-b60c603368c5",
      "attachmentId": 10,
      "title": "Subgroup Performance of a Commercial...",
      "snippet": null,
      "contentSource": "pdf",
      "score": 14.26
    }
  ],
  "total": 7,
  "offset": 0,
  "limit": 5
}
```

### List Collections

Returns all collections.

```
GET /api/collections
```

```bash
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/collections
```

Response:
```json
[
  {
    "id": 1,
    "name": "Breast Cancer",
    "parentId": null,
    "color": "#ec4899"
  }
]
```

### List Collection Items

Paginated entries in a collection. Accepts collection ID or name (case-insensitive).

```
GET /api/collections/{id_or_name}/items?offset=0&limit=50
```

```bash
# By name
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/collections/Breast%20Cancer/items"

# By ID
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/collections/1/items"
```

Response: same paginated format as `/api/items`.

### List Tag Items

Paginated entries with a given tag.

```
GET /api/tags/{name}/items?offset=0&limit=50
```

```bash
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/tags/machine-learning/items"
```

Response: same paginated format as `/api/items`.

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `401` | Missing or invalid `X-Wren-Token` |
| `404` | Entry, collection, or tag not found |
| `400` | Missing required parameter (e.g. `q` for search) |
| `500` | Internal server error |

---

## Quick Reference

```bash
TOKEN="your-token-here"
KEY="entry-uuid-key"

# Single item
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/$KEY/cite
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/$KEY/bibtex
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/$KEY/json
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/items/$KEY/attachments

# Browse
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/items?limit=10&offset=0"
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/search?q=deep+learning"
curl -H "X-Wren-Token: $TOKEN" http://127.0.0.1:1289/api/collections
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/collections/Breast%20Cancer/items"
curl -H "X-Wren-Token: $TOKEN" "http://127.0.0.1:1289/api/tags/machine-learning/items"
```
