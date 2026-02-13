import {
  ViewPlugin,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
  ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { Range, StateField, StateEffect, EditorState } from "@codemirror/state";
import katex from "katex";
import { highlightCode, getShikiVersion } from "./shikiHighlighter";
import { useSettingsStore } from "@/stores/settingsStore";
import type { InlineTable, InlineTableColumn } from "@/services/tauri/commands";
import {
  getInlineTable,
  updateInlineTable,
  addInlineTableRow,
  updateInlineTableRow,
  deleteInlineTableRow,
  reorderInlineTableRows,
  getInlineTableRefs,
  getInlineTableInfo,
} from "@/services/tauri/commands";

// =====================================================
// Inline Table Cache
// =====================================================

const tableCache = new Map<string, InlineTable>();
const tableFetchPromises = new Map<string, Promise<void>>();

// Version counter per UUID — when incremented and refreshBlockDecorations
// dispatched, eq() returns false and CM6 properly recreates the widget via toDOM().
const tableCacheVersion = new Map<string, number>();

// Widget UI state preserved across CM6 widget recreations.
const tableWidgetState = new Map<string, {
  sortCol: string | null;
  sortDir: "asc" | "desc" | null;
  searchQuery: string;
  columnFilters: Map<string, string>;
  filtersVisible: boolean;
}>();

function ensureTableLoaded(uuid: string, view: EditorView): InlineTable | null {
  if (tableCache.has(uuid)) return tableCache.get(uuid)!;
  if (!tableFetchPromises.has(uuid)) {
    const promise = getInlineTable(uuid)
      .then((table) => {
        tableCache.set(uuid, table);
        tableFetchPromises.delete(uuid);
        tableCacheVersion.set(uuid, (tableCacheVersion.get(uuid) || 0) + 1);
        try { view.dispatch({ effects: refreshBlockDecorations.of(null) }); } catch {}
      })
      .catch(() => {
        tableFetchPromises.delete(uuid);
      });
    tableFetchPromises.set(uuid, promise);
  }
  return null;
}

// =====================================================
// Widget types for replaced content
// =====================================================

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-md-hr-widget";
    return hr;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  toDOM(view: EditorView) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = this.checked;
    cb.className = "cm-md-checkbox";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(cb);
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const bracketMatch = text.match(/\[([ xX])\]/);
      if (bracketMatch && bracketMatch.index !== undefined) {
        const from = line.from + bracketMatch.index;
        const to = from + 3;
        const replacement = this.checked ? "[ ]" : "[x]";
        view.dispatch({ changes: { from, to, insert: replacement } });
      }
    });
    return cb;
  }
  eq(other: CheckboxWidget) {
    return this.checked === other.checked;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly width: number | null,
  ) {
    super();
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-image-widget";

    const container = document.createElement("div");
    container.className = "cm-md-image-container";

    const img = document.createElement("img");
    img.src = this.url;
    img.alt = this.alt;
    img.title = this.alt;
    if (this.width) {
      img.style.width = `${this.width}px`;
    }

    // Resize handle
    const handle = document.createElement("div");
    handle.className = "cm-md-image-resize-handle";
    handle.innerHTML = `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 9L9 1M5 9L9 5M9 9L9 9"/></svg>`;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = img.offsetWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(100, startWidth + delta);
        img.style.width = `${newWidth}px`;
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);

        const delta = upEvent.clientX - startX;
        const newWidth = Math.max(100, startWidth + delta);

        // Update the markdown source to include the new width
        const pos = view.posAtDOM(wrapper);
        const tree = syntaxTree(view.state);
        let imageFrom = -1;
        let imageTo = -1;
        tree.iterate({
          from: pos,
          to: pos + 1,
          enter(node) {
            if (node.name === "Image") {
              imageFrom = node.from;
              imageTo = node.to;
            }
          },
        });

        // Fallback: regex when parser doesn't recognize image (e.g. size syntax)
        if (imageFrom < 0) {
          const line = view.state.doc.lineAt(pos);
          const sizedImgRegex = /!\[([^\]]*)\]\((\S+)(?:\s+=\d+x\d*)?\)/;
          const sizedImgMatch = line.text.match(sizedImgRegex);
          if (sizedImgMatch && sizedImgMatch.index !== undefined) {
            imageFrom = line.from + sizedImgMatch.index;
            imageTo = imageFrom + sizedImgMatch[0].length;
          }
        }

        if (imageFrom >= 0) {
          const oldText = view.state.doc.sliceString(imageFrom, imageTo);
          // Replace or add =WIDTHx to the image syntax
          let newText: string;
          const sizeMatch = oldText.match(/^(!\[[^\]]*\]\([^)\s]+)\s*=\d+x?\d*\s*(\))$/);
          if (sizeMatch) {
            newText = `${sizeMatch[1]} =${newWidth}x${sizeMatch[2]}`;
          } else {
            const closeMatch = oldText.match(/^(!\[[^\]]*\]\([^)]+)(\))$/);
            if (closeMatch) {
              newText = `${closeMatch[1]} =${newWidth}x${closeMatch[2]}`;
            } else {
              newText = oldText;
            }
          }
          if (newText !== oldText) {
            view.dispatch({ changes: { from: imageFrom, to: imageTo, insert: newText } });
          }
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    container.appendChild(img);
    container.appendChild(handle);
    wrapper.appendChild(container);

    // Caption from alt text
    if (this.alt) {
      const caption = document.createElement("div");
      caption.className = "cm-md-image-caption";
      caption.textContent = this.alt;
      wrapper.appendChild(caption);
    }

    return wrapper;
  }
  eq(other: ImageWidget) {
    return this.url === other.url && this.alt === other.alt && this.width === other.width;
  }
}

interface GridImage {
  url: string;
  alt: string;
  width: number | null;
}

class ImageGridWidget extends WidgetType {
  constructor(readonly images: GridImage[]) {
    super();
  }
  toDOM() {
    const grid = document.createElement("div");
    grid.className = "cm-md-image-grid";

    for (const imgData of this.images) {
      const cell = document.createElement("div");
      cell.className = "cm-md-image-grid-cell";

      const container = document.createElement("div");
      container.className = "cm-md-image-container";

      const img = document.createElement("img");
      img.src = imgData.url;
      img.alt = imgData.alt;
      img.title = imgData.alt;
      if (imgData.width) {
        img.style.width = `${imgData.width}px`;
      }

      container.appendChild(img);
      cell.appendChild(container);

      if (imgData.alt) {
        const caption = document.createElement("div");
        caption.className = "cm-md-image-caption";
        caption.textContent = imgData.alt;
        cell.appendChild(caption);
      }

      grid.appendChild(cell);
    }

    return grid;
  }
  eq(other: ImageGridWidget) {
    if (this.images.length !== other.images.length) return false;
    return this.images.every(
      (img, i) =>
        img.url === other.images[i].url &&
        img.alt === other.images[i].alt &&
        img.width === other.images[i].width,
    );
  }
}

class ShikiCodeBlockWidget extends WidgetType {
  readonly shikiVersion: number;
  constructor(
    readonly code: string,
    readonly language: string,
    readonly showLineNumbers: boolean,
  ) {
    super();
    this.shikiVersion = getShikiVersion();
  }
  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-codeblock-widget";
    if (this.showLineNumbers) wrapper.classList.add("cm-md-codeblock-numbered");

    // Try Shiki highlighting
    const html = highlightCode(this.code, this.language || "text");

    if (html) {
      const codeContainer = document.createElement("div");
      codeContainer.className = "cm-md-codeblock-shiki";
      codeContainer.innerHTML = html;
      wrapper.appendChild(codeContainer);
    } else {
      // Fallback: plain monospace
      const pre = document.createElement("pre");
      pre.className = "cm-md-codeblock-fallback";
      const code = document.createElement("code");
      code.textContent = this.code;
      pre.appendChild(code);
      wrapper.appendChild(pre);
    }

    // Language label (top-right, hides on hover)
    if (this.language) {
      const langLabel = document.createElement("span");
      langLabel.className = "cm-md-codeblock-lang";
      langLabel.textContent = this.language.toUpperCase();
      wrapper.appendChild(langLabel);
    }

    // Copy button (top-right, shows on hover)
    const copyBtn = document.createElement("button");
    copyBtn.className = "cm-md-codeblock-copy";
    copyBtn.title = "Copy code";
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code).then(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 2000);
      });
    });
    wrapper.appendChild(copyBtn);

    // Line numbers gutter (optional)
    if (this.showLineNumbers) {
      const lines = this.code.split("\n");
      const gutter = document.createElement("div");
      gutter.className = "cm-md-codeblock-gutter";
      for (let i = 0; i < lines.length; i++) {
        const num = document.createElement("div");
        num.textContent = String(i + 1);
        gutter.appendChild(num);
      }
      wrapper.appendChild(gutter);
    }

    return wrapper;
  }
  eq(other: ShikiCodeBlockWidget) {
    return this.code === other.code && this.language === other.language && this.shikiVersion === other.shikiVersion && this.showLineNumbers === other.showLineNumbers;
  }
}

/** Render text content with inline math ($...$) via KaTeX */
function renderInlineContent(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const inlineMathRegex = /(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g;
  let lastIndex = 0;
  let m;
  while ((m = inlineMathRegex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    }
    const span = document.createElement("span");
    span.className = "cm-md-math-inline";
    try {
      span.innerHTML = katex.renderToString(m[1], { throwOnError: false, displayMode: false });
    } catch {
      span.textContent = m[0];
    }
    frag.appendChild(span);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return frag;
}

class TableWidget extends WidgetType {
  constructor(
    readonly headers: string[],
    readonly rows: string[][],
  ) {
    super();
  }
  toDOM() {
    const tableWrapper = document.createElement("div");
    tableWrapper.className = "cm-md-table-wrapper";

    const table = document.createElement("table");
    table.className = "cm-md-table-widget";

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const header of this.headers) {
      const th = document.createElement("th");
      th.appendChild(renderInlineContent(header.trim()));
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    for (const row of this.rows) {
      const tr = document.createElement("tr");
      for (let i = 0; i < this.headers.length; i++) {
        const td = document.createElement("td");
        td.appendChild(renderInlineContent((row[i] || "").trim()));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    tableWrapper.appendChild(table);
    return tableWrapper;
  }
  eq(other: TableWidget) {
    return (
      JSON.stringify(this.headers) === JSON.stringify(other.headers) &&
      JSON.stringify(this.rows) === JSON.stringify(other.rows)
    );
  }
}

// =====================================================
// Shared context menu helper
// =====================================================

let activeContextMenu: HTMLDivElement | null = null;
let activeDismissHandler: ((e: MouseEvent) => void) | null = null;

function showContextMenu(x: number, y: number, items: Array<{ label: string; destructive?: boolean; disabled?: boolean; separator?: boolean; action: () => void }>) {
  dismissContextMenu();
  const menu = document.createElement("div");
  // Inline styles because CM6 theme is scoped to the editor — doesn't reach document.body
  Object.assign(menu.style, {
    position: "fixed",
    left: `${x}px`,
    top: `${y}px`,
    zIndex: "9999",
    minWidth: "180px",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    boxShadow: "0 4px 16px hsl(0 0% 0% / 0.12)",
    fontSize: "0.85em",
  });

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      Object.assign(sep.style, { height: "1px", margin: "4px 8px", backgroundColor: "hsl(var(--border))" });
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement("div");
    Object.assign(el.style, {
      padding: "6px 12px",
      borderRadius: "4px",
      cursor: item.disabled ? "default" : "pointer",
      userSelect: "none",
      color: item.destructive ? "hsl(var(--destructive))" : item.disabled ? "hsl(var(--muted-foreground))" : "inherit",
      opacity: item.disabled ? "0.5" : "1",
      pointerEvents: item.disabled ? "none" : "auto",
    });
    el.textContent = item.label;
    el.addEventListener("mouseenter", () => {
      if (!item.disabled) {
        el.style.backgroundColor = item.destructive ? "hsl(var(--destructive) / 0.08)" : "hsl(var(--accent))";
      }
    });
    el.addEventListener("mouseleave", () => { el.style.backgroundColor = ""; });
    if (!item.disabled) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissContextMenu();
        item.action();
      });
    }
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // Adjust if off-screen
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  });

  const dismiss = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      dismissContextMenu();
    }
  };
  activeDismissHandler = dismiss;
  setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
}

function dismissContextMenu() {
  if (activeDismissHandler) {
    document.removeEventListener("mousedown", activeDismissHandler);
    activeDismissHandler = null;
  }
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

// =====================================================
// InlineTableWidget — database-backed interactive table
// =====================================================

class InlineTableWidget extends WidgetType {
  private sortCol: string | null = null;
  private sortDir: "asc" | "desc" | null = null;
  private searchQuery = "";
  private columnFilters = new Map<string, string>();
  private filtersVisible = false;
  private version: number;

  constructor(readonly uuid: string) {
    super();
    this.version = tableCacheVersion.get(uuid) || 0;
    // Restore preserved state from previous widget instance
    const saved = tableWidgetState.get(uuid);
    if (saved) {
      this.sortCol = saved.sortCol;
      this.sortDir = saved.sortDir;
      this.searchQuery = saved.searchQuery;
      this.columnFilters = new Map(saved.columnFilters);
      this.filtersVisible = saved.filtersVisible;
    }
  }

  eq(other: InlineTableWidget) {
    return this.uuid === other.uuid && this.version === other.version;
  }

  /**
   * Save UI state, bump version, and dispatch refreshBlockDecorations.
   * CM6 sees the version change → eq() returns false → destroys old DOM →
   * calls toDOM() on a new widget → fresh DOM from updated cache.
   * This avoids directly mutating the widget DOM (which confuses CM6's
   * MutationObserver and breaks subsequent renders).
   */
  private invalidate(view: EditorView) {
    tableWidgetState.set(this.uuid, {
      sortCol: this.sortCol,
      sortDir: this.sortDir,
      searchQuery: this.searchQuery,
      columnFilters: new Map(this.columnFilters),
      filtersVisible: this.filtersVisible,
    });
    tableCacheVersion.set(this.uuid, (tableCacheVersion.get(this.uuid) || 0) + 1);
    try { view.dispatch({ effects: refreshBlockDecorations.of(null) }); } catch {}
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-itable-wrapper";
    wrapper.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      const interactive = target.closest("input, button, textarea, select, [contenteditable]");
      // Dismiss any active context menu when clicking inside the widget
      if (activeContextMenu && !activeContextMenu.contains(target)) {
        dismissContextMenu();
      }
      if (!interactive && e.button === 0) {
        // Left-click on non-interactive: prevent CM6 cursor placement
        e.preventDefault();
      }
      // ALWAYS stop propagation — CM6 must never see events from inside the widget.
      // Without this, CM6 handles the mousedown, repositions the cursor,
      // and contextmenu events end up firing on cm-line instead of our elements.
      e.stopPropagation();
    });
    // Stop contextmenu propagation to CM6 as a safety net.
    // Element-specific handlers (th, tr) fire first via bubbling.
    wrapper.addEventListener("contextmenu", (e) => {
      e.stopPropagation();
    });

    const cached = ensureTableLoaded(this.uuid, view);

    if (cached) {
      this.render(wrapper, view);
    } else {
      wrapper.innerHTML = `<div class="cm-md-itable-loading">Loading table...</div>`;
    }

    return wrapper;
  }

  /** Remove the <!-- wren-table:uuid --> marker line from the document */
  private removeMarker(view: EditorView) {
    const doc = view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.trim() === `<!-- wren-table:${this.uuid} -->`) {
        const from = i > 1 ? line.from - 1 : line.from;
        const to = line.to < doc.length ? line.to + 1 : line.to;
        view.dispatch({ changes: { from, to, insert: "" } });
        return;
      }
    }
  }

  private saveColumnOrder(columns: InlineTableColumn[]) {
    updateInlineTable(this.uuid, undefined, JSON.stringify(columns));
  }

  private saveRowOrder(table: InlineTable) {
    reorderInlineTableRows(this.uuid, table.rows.map((r) => r.id));
  }

  private render(wrapper: HTMLDivElement, view: EditorView) {
    const table = tableCache.get(this.uuid);
    if (!table) {
      wrapper.innerHTML = `<div class="cm-md-itable-empty">Table not found</div>`;
      return;
    }
    wrapper.innerHTML = "";

    const columns: InlineTableColumn[] = table.columns as unknown as InlineTableColumn[];

    // --- Title bar ---
    const titleBar = document.createElement("div");
    titleBar.className = "cm-md-itable-titlebar";

    const titleLeft = document.createElement("div");
    titleLeft.className = "cm-md-itable-titlebar-left";

    const titleEl = document.createElement("span");
    titleEl.className = "cm-md-itable-title";
    titleEl.textContent = table.title;
    titleEl.addEventListener("dblclick", () => {
      const input = document.createElement("input");
      input.className = "cm-md-itable-title-input";
      input.value = table.title;
      titleLeft.replaceChild(input, titleEl);
      input.focus();
      input.select();
      const commit = () => {
        const newTitle = input.value.trim() || "Untitled Table";
        table.title = newTitle;
        titleEl.textContent = newTitle;
        titleLeft.replaceChild(titleEl, input);
        updateInlineTable(this.uuid, newTitle);
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          titleEl.textContent = table.title;
          titleLeft.replaceChild(titleEl, input);
        }
      });
    });
    titleLeft.appendChild(titleEl);
    titleBar.appendChild(titleLeft);

    const titleRight = document.createElement("div");
    titleRight.className = "cm-md-itable-titlebar-right";

    // Search input
    const searchInput = document.createElement("input");
    searchInput.className = "cm-md-itable-search";
    searchInput.placeholder = "Search...";
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.renderTableBody(tbody, columns, table, view);
    });
    titleRight.appendChild(searchInput);

    // Filter toggle button
    const filterBtn = document.createElement("button");
    filterBtn.className = "cm-md-itable-toolbar-btn" + (this.filtersVisible ? " cm-md-itable-toolbar-btn-active" : "");
    filterBtn.title = "Toggle column filters";
    filterBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
    filterBtn.addEventListener("click", () => {
      this.filtersVisible = !this.filtersVisible;
      if (!this.filtersVisible) {
        this.columnFilters.clear();
      }
      this.invalidate(view);
    });
    titleRight.appendChild(filterBtn);

    // Row count
    const rowCount = document.createElement("span");
    rowCount.className = "cm-md-itable-row-count";
    rowCount.textContent = `${table.rows.length} rows`;
    titleRight.appendChild(rowCount);

    // Copy Link button
    const copyLinkBtn = document.createElement("button");
    copyLinkBtn.className = "cm-md-itable-toolbar-btn";
    copyLinkBtn.title = "Copy table link";
    copyLinkBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    copyLinkBtn.addEventListener("click", () => {
      const linkText = `[${table.title}](wren-table:${this.uuid})`;
      navigator.clipboard.writeText(linkText);
    });
    titleRight.appendChild(copyLinkBtn);

    // Delete Table button
    const deleteTableBtn = document.createElement("button");
    deleteTableBtn.className = "cm-md-itable-toolbar-btn cm-md-itable-toolbar-btn-danger";
    deleteTableBtn.title = "Delete table";
    deleteTableBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
    deleteTableBtn.addEventListener("click", async () => {
      try {
        const refs = await getInlineTableRefs(this.uuid);
        const refCount = refs.length;
        let msg: string;
        if (refCount <= 1) {
          msg = "Delete this table permanently? This is the only document embedding it. All data will be lost.";
        } else {
          msg = `Remove this table from this document? It's embedded in ${refCount - 1} other document${refCount - 1 > 1 ? "s" : ""} and will remain available there.`;
        }
        if (confirm(msg)) {
          this.removeMarker(view);
        }
      } catch {
        if (confirm("Delete this table from the document?")) {
          this.removeMarker(view);
        }
      }
    });
    titleRight.appendChild(deleteTableBtn);

    titleBar.appendChild(titleRight);
    wrapper.appendChild(titleBar);

    // --- Table element ---
    const tableEl = document.createElement("table");
    tableEl.className = "cm-md-itable";

    // Colgroup for column widths
    const colgroup = document.createElement("colgroup");
    for (const col of columns) {
      const colEl = document.createElement("col");
      colEl.style.width = `${col.width}px`;
      colgroup.appendChild(colEl);
    }
    const addColEl = document.createElement("col");
    addColEl.style.width = "40px";
    colgroup.appendChild(addColEl);
    tableEl.appendChild(colgroup);

    // --- Header ---
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    columns.forEach((col, colIdx) => {
      const th = document.createElement("th");
      const label = document.createElement("span");
      label.textContent = col.name;
      th.appendChild(label);

      // Sort indicator
      const sortIcon = document.createElement("span");
      sortIcon.className = "cm-md-itable-sort-icon";
      if (this.sortCol === col.id) {
        sortIcon.textContent = this.sortDir === "asc" ? " \u25B2" : " \u25BC";
      }
      th.appendChild(sortIcon);

      // Click to sort
      th.addEventListener("click", () => {
        if (this.sortCol === col.id) {
          if (this.sortDir === "asc") this.sortDir = "desc";
          else if (this.sortDir === "desc") { this.sortCol = null; this.sortDir = null; }
        } else {
          this.sortCol = col.id;
          this.sortDir = "asc";
        }
        this.invalidate(view);
      });

      // Right-click for column context menu
      th.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const canDelete = columns.length > 1;
        showContextMenu(e.clientX, e.clientY, [
          { label: "Sort Ascending", action: () => { this.sortCol = col.id; this.sortDir = "asc"; this.invalidate(view); } },
          { label: "Sort Descending", action: () => { this.sortCol = col.id; this.sortDir = "desc"; this.invalidate(view); } },
          { label: "", separator: true, action: () => {} },
          { label: "Rename Column", action: () => {
            const input = document.createElement("input");
            input.className = "cm-md-itable-cell-input";
            input.value = col.name;
            th.textContent = "";
            th.appendChild(input);
            input.focus();
            input.select();
            const commitCol = () => {
              col.name = input.value.trim() || col.name;
              this.saveColumnOrder(columns);
              this.invalidate(view);
            };
            input.addEventListener("blur", commitCol);
            input.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") commitCol();
              if (ev.key === "Escape") this.invalidate(view);
            });
          }},
          { label: "", separator: true, action: () => {} },
          { label: "Insert Column Left", action: () => {
            const newId = "col_" + Math.random().toString(36).slice(2, 8);
            columns.splice(colIdx, 0, { id: newId, name: `Column ${columns.length + 1}`, width: 150 });
            table.columns = columns as unknown as InlineTableColumn[];
            this.saveColumnOrder(columns);
            this.invalidate(view);
          }},
          { label: "Insert Column Right", action: () => {
            const newId = "col_" + Math.random().toString(36).slice(2, 8);
            columns.splice(colIdx + 1, 0, { id: newId, name: `Column ${columns.length + 1}`, width: 150 });
            table.columns = columns as unknown as InlineTableColumn[];
            this.saveColumnOrder(columns);
            this.invalidate(view);
          }},
          { label: "", separator: true, action: () => {} },
          { label: "Move Column Left", disabled: colIdx === 0, action: () => {
            [columns[colIdx - 1], columns[colIdx]] = [columns[colIdx], columns[colIdx - 1]];
            table.columns = columns as unknown as InlineTableColumn[];
            this.saveColumnOrder(columns);
            this.invalidate(view);
          }},
          { label: "Move Column Right", disabled: colIdx === columns.length - 1, action: () => {
            [columns[colIdx], columns[colIdx + 1]] = [columns[colIdx + 1], columns[colIdx]];
            table.columns = columns as unknown as InlineTableColumn[];
            this.saveColumnOrder(columns);
            this.invalidate(view);
          }},
          { label: "", separator: true, action: () => {} },
          { label: "Delete Column", destructive: true, disabled: !canDelete, action: () => {
            columns.splice(colIdx, 1);
            table.columns = columns as unknown as InlineTableColumn[];
            this.saveColumnOrder(columns);
            this.invalidate(view);
          }},
        ]);
      });

      // Double-click to rename column
      label.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.className = "cm-md-itable-cell-input";
        input.value = col.name;
        th.replaceChild(input, label);
        input.focus();
        input.select();
        const commitCol = () => {
          col.name = input.value.trim() || col.name;
          label.textContent = col.name;
          th.replaceChild(label, input);
          th.appendChild(sortIcon);
          this.saveColumnOrder(columns);
        };
        input.addEventListener("blur", commitCol);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") commitCol();
          if (ev.key === "Escape") { th.replaceChild(label, input); th.appendChild(sortIcon); }
        });
      });

      // Resize handle
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "cm-md-itable-resize-handle";
      resizeHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = col.width;
        const colElRef = colgroup.children[colIdx] as HTMLElement;
        const onMove = (me: MouseEvent) => {
          const newWidth = Math.max(60, startWidth + me.clientX - startX);
          colElRef.style.width = `${newWidth}px`;
        };
        const onUp = (me: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          col.width = Math.max(60, startWidth + me.clientX - startX);
          this.saveColumnOrder(columns);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
      th.appendChild(resizeHandle);

      headerRow.appendChild(th);
    });

    // Add column button
    const addColTh = document.createElement("th");
    addColTh.className = "cm-md-itable-add-col";
    addColTh.textContent = "+";
    addColTh.title = "Add column";
    addColTh.addEventListener("click", () => {
      const newId = "col_" + Math.random().toString(36).slice(2, 8);
      columns.push({ id: newId, name: `Column ${columns.length + 1}`, width: 150 });
      table.columns = columns as unknown as InlineTableColumn[];
      this.saveColumnOrder(columns);
      this.invalidate(view);
    });
    headerRow.appendChild(addColTh);
    thead.appendChild(headerRow);

    // Filter row (shown when filters are active)
    if (this.filtersVisible) {
      const filterRow = document.createElement("tr");
      filterRow.className = "cm-md-itable-filter-row";
      columns.forEach((col) => {
        const filterTd = document.createElement("td");
        filterTd.className = "cm-md-itable-filter-cell";
        const filterInput = document.createElement("input");
        filterInput.className = "cm-md-itable-filter-input";
        filterInput.placeholder = `Filter ${col.name}...`;
        filterInput.value = this.columnFilters.get(col.id) || "";
        filterInput.addEventListener("input", () => {
          const val = filterInput.value;
          if (val) {
            this.columnFilters.set(col.id, val);
          } else {
            this.columnFilters.delete(col.id);
          }
          this.renderTableBody(tbody, columns, table, view);
        });
        filterTd.appendChild(filterInput);
        filterRow.appendChild(filterTd);
      });
      // Empty cell for the add-column column
      const emptyFilterTd = document.createElement("td");
      emptyFilterTd.className = "cm-md-itable-filter-cell";
      filterRow.appendChild(emptyFilterTd);
      thead.appendChild(filterRow);
    }

    tableEl.appendChild(thead);

    // --- Body ---
    const tbody = document.createElement("tbody");
    this.renderTableBody(tbody, columns, table, view);
    tableEl.appendChild(tbody);

    wrapper.appendChild(tableEl);

    // --- Add row button ---
    const addRowBtn = document.createElement("div");
    addRowBtn.className = "cm-md-itable-add-row";
    addRowBtn.textContent = "+ New Row";
    addRowBtn.addEventListener("click", () => {
      const emptyData: Record<string, string> = {};
      columns.forEach((c) => (emptyData[c.id] = ""));
      addInlineTableRow(this.uuid, JSON.stringify(emptyData)).then((newRow) => {
        table.rows.push(newRow);
        this.invalidate(view);
      });
    });
    wrapper.appendChild(addRowBtn);
  }

  private renderTableBody(
    tbody: HTMLElement,
    columns: InlineTableColumn[],
    table: InlineTable,
    view: EditorView,
  ) {
    tbody.innerHTML = "";

    // Filter + search + sort
    let filteredRows = [...table.rows];

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filteredRows = filteredRows.filter((row) =>
        columns.some((col) => {
          const val = (row.data as Record<string, string>)[col.id] || "";
          return val.toLowerCase().includes(q);
        }),
      );
    }

    if (this.columnFilters.size > 0) {
      for (const [colId, filterVal] of this.columnFilters) {
        const fv = filterVal.toLowerCase();
        filteredRows = filteredRows.filter((row) => {
          const val = (row.data as Record<string, string>)[colId] || "";
          return val.toLowerCase().includes(fv);
        });
      }
    }

    if (this.sortCol && this.sortDir) {
      const sc = this.sortCol;
      const dir = this.sortDir === "asc" ? 1 : -1;
      filteredRows.sort((a, b) => {
        const av = ((a.data as Record<string, string>)[sc] || "").toLowerCase();
        const bv = ((b.data as Record<string, string>)[sc] || "").toLowerCase();
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }

    if (filteredRows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length + 1;
      td.className = "cm-md-itable-empty-cell";
      td.textContent = (this.searchQuery || this.columnFilters.size > 0) ? "No matching rows" : "No rows yet";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const row of filteredRows) {
      const tr = document.createElement("tr");
      const data = row.data as Record<string, string>;

      columns.forEach((col) => {
        const td = document.createElement("td");
        const cellText = data[col.id] || "";
        td.textContent = cellText;

        // Click to edit cell
        td.addEventListener("click", (e) => {
          e.stopPropagation();
          if (td.querySelector("input")) return;
          const input = document.createElement("input");
          input.className = "cm-md-itable-cell-input";
          input.value = cellText;
          td.textContent = "";
          td.appendChild(input);
          input.focus();
          input.select();

          const commitCell = () => {
            const newVal = input.value;
            data[col.id] = newVal;
            td.textContent = newVal;
            updateInlineTableRow(row.id, JSON.stringify(data));
          };
          input.addEventListener("blur", commitCell);
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") { commitCell(); }
            if (ev.key === "Escape") { td.textContent = cellText; }
            if (ev.key === "Tab") {
              ev.preventDefault();
              commitCell();
              const nextTd = td.nextElementSibling as HTMLElement | null;
              if (nextTd && !nextTd.classList.contains("cm-md-itable-row-actions")) {
                nextTd.click();
              }
            }
          });
        });

        tr.appendChild(td);
      });

      // Row actions cell (context menu trigger + delete button)
      const actionsTd = document.createElement("td");
      actionsTd.className = "cm-md-itable-row-actions";
      const menuBtn = document.createElement("button");
      menuBtn.className = "cm-md-itable-row-menu-btn";
      menuBtn.textContent = "\u22EE";
      menuBtn.title = "Row actions";
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rowIdx = table.rows.findIndex((r) => r.id === row.id);
        this.showRowContextMenu(e.clientX, e.clientY, table, columns, row, rowIdx, view);
      });
      actionsTd.appendChild(menuBtn);
      tr.appendChild(actionsTd);

      // Right-click anywhere on the row also opens context menu
      tr.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rowIdx = table.rows.findIndex((r) => r.id === row.id);
        this.showRowContextMenu(e.clientX, e.clientY, table, columns, row, rowIdx, view);
      });

      tbody.appendChild(tr);
    }
  }

  private showRowContextMenu(
    x: number,
    y: number,
    table: InlineTable,
    columns: InlineTableColumn[],
    row: { id: number; data: unknown },
    rowIdx: number,
    view: EditorView,
  ) {
    showContextMenu(x, y, [
      { label: "Insert Row Above", action: () => {
        const emptyData: Record<string, string> = {};
        columns.forEach((c) => (emptyData[c.id] = ""));
        addInlineTableRow(this.uuid, JSON.stringify(emptyData)).then((newRow) => {
          table.rows.splice(rowIdx, 0, newRow);
          this.saveRowOrder(table);
          this.invalidate(view);
        });
      }},
      { label: "Insert Row Below", action: () => {
        const emptyData: Record<string, string> = {};
        columns.forEach((c) => (emptyData[c.id] = ""));
        addInlineTableRow(this.uuid, JSON.stringify(emptyData)).then((newRow) => {
          table.rows.splice(rowIdx + 1, 0, newRow);
          this.saveRowOrder(table);
          this.invalidate(view);
        });
      }},
      { label: "Duplicate Row", action: () => {
        const dataCopy = JSON.stringify(row.data);
        addInlineTableRow(this.uuid, dataCopy).then((newRow) => {
          table.rows.splice(rowIdx + 1, 0, newRow);
          this.saveRowOrder(table);
          this.invalidate(view);
        });
      }},
      { label: "", separator: true, action: () => {} },
      { label: "Move Row Up", disabled: rowIdx === 0, action: () => {
        [table.rows[rowIdx - 1], table.rows[rowIdx]] = [table.rows[rowIdx], table.rows[rowIdx - 1]];
        this.saveRowOrder(table);
        this.invalidate(view);
      }},
      { label: "Move Row Down", disabled: rowIdx === table.rows.length - 1, action: () => {
        [table.rows[rowIdx], table.rows[rowIdx + 1]] = [table.rows[rowIdx + 1], table.rows[rowIdx]];
        this.saveRowOrder(table);
        this.invalidate(view);
      }},
      { label: "", separator: true, action: () => {} },
      { label: "Delete Row", destructive: true, action: () => {
        table.rows.splice(rowIdx, 1);
        deleteInlineTableRow(row.id);
        this.invalidate(view);
      }},
    ]);
  }

  destroy() {
    // no-op: cleanup handled by CM6 removing DOM
  }
}

// =====================================================
// TableLinkWidget — clickable reference to a table
// =====================================================

class TableLinkWidget extends WidgetType {
  constructor(
    readonly uuid: string,
    readonly label: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-table-link";

    const icon = document.createElement("span");
    icon.className = "cm-md-table-link-icon";
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;
    span.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = this.label;
    span.appendChild(text);

    // Click: navigate to first document embedding this table
    span.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const refs = await getInlineTableRefs(this.uuid);
      if (refs.length > 0) {
        // Dispatch a custom event the app can listen to
        window.dispatchEvent(
          new CustomEvent("wren:open-attachment", {
            detail: { attachmentId: refs[0].attachment_id, entryId: refs[0].entry_id },
          }),
        );
      }
    });

    // Hover: tooltip with table info
    span.addEventListener("mouseenter", async () => {
      try {
        const info = await getInlineTableInfo(this.uuid);
        span.title = `${info.title} — ${info.column_count} columns × ${info.row_count} rows`;
      } catch {
        span.title = "Table not found";
      }
    });

    return span;
  }

  eq(other: TableLinkWidget) {
    return this.uuid === other.uuid && this.label === other.label;
  }
}

// =====================================================
// EntryLinkWidget — clickable reference to a library entry
// =====================================================

class EntryLinkWidget extends WidgetType {
  constructor(
    readonly entryId: string,
    readonly label: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-entry-link";

    const icon = document.createElement("span");
    icon.className = "cm-md-entry-link-icon";
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
    span.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = this.label;
    span.appendChild(text);

    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("wren:open-entry", {
          detail: { entryId: parseInt(this.entryId) },
        }),
      );
    });

    span.addEventListener("mouseenter", () => {
      span.title = this.label;
    });

    return span;
  }

  eq(other: EntryLinkWidget) {
    return this.entryId === other.entryId && this.label === other.label;
  }
}

// =====================================================
// AttachmentLinkWidget — clickable reference to an attachment
// =====================================================

class AttachmentLinkWidget extends WidgetType {
  constructor(
    readonly attachmentId: string,
    readonly label: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-attachment-link";

    const icon = document.createElement("span");
    icon.className = "cm-md-attachment-link-icon";
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
    span.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = this.label;
    span.appendChild(text);

    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("wren:open-attachment", {
          detail: { attachmentId: parseInt(this.attachmentId) },
        }),
      );
    });

    span.addEventListener("mouseenter", () => {
      span.title = this.label;
    });

    return span;
  }

  eq(other: AttachmentLinkWidget) {
    return this.attachmentId === other.attachmentId && this.label === other.label;
  }
}

// =====================================================
// TagLinkWidget — clickable reference to a tag
// =====================================================

class TagLinkWidget extends WidgetType {
  constructor(
    readonly tagId: string,
    readonly label: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-tag-link";

    const icon = document.createElement("span");
    icon.className = "cm-md-tag-link-icon";
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
    span.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = this.label;
    span.appendChild(text);

    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("wren:navigate-tag", {
          detail: { tagId: parseInt(this.tagId) },
        }),
      );
    });

    span.addEventListener("mouseenter", () => {
      span.title = `Tag: ${this.label}`;
    });

    return span;
  }

  eq(other: TagLinkWidget) {
    return this.tagId === other.tagId && this.label === other.label;
  }
}

// =====================================================
// CollectionLinkWidget — clickable reference to a collection
// =====================================================

class CollectionLinkWidget extends WidgetType {
  constructor(
    readonly collectionId: string,
    readonly label: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-collection-link";

    const icon = document.createElement("span");
    icon.className = "cm-md-collection-link-icon";
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    span.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = this.label;
    span.appendChild(text);

    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("wren:navigate-collection", {
          detail: { collectionId: parseInt(this.collectionId) },
        }),
      );
    });

    span.addEventListener("mouseenter", () => {
      span.title = `Collection: ${this.label}`;
    });

    return span;
  }

  eq(other: CollectionLinkWidget) {
    return this.collectionId === other.collectionId && this.label === other.label;
  }
}

const CALLOUT_ICONS: Record<string, string> = {
  note: "\u270F\uFE0F",
  tip: "\uD83D\uDCA1",
  warning: "\u26A0\uFE0F",
  danger: "\uD83D\uDED1",
  info: "\u2139\uFE0F",
  abstract: "\uD83D\uDCCB",
  todo: "\u2611\uFE0F",
  example: "\uD83D\uDCCE",
  quote: "\uD83D\uDCAC",
  bug: "\uD83D\uDC1B",
  success: "\u2705",
  failure: "\u274C",
  question: "\u2753",
};

class CalloutWidget extends WidgetType {
  constructor(
    readonly calloutType: string,
    readonly title: string,
    readonly content: string,
  ) {
    super();
  }
  toDOM() {
    const typeLower = this.calloutType.toLowerCase();
    const container = document.createElement("div");
    container.className = `cm-md-callout cm-md-callout-${typeLower}`;

    // Title row
    const titleRow = document.createElement("div");
    titleRow.className = "cm-md-callout-title";

    const icon = document.createElement("span");
    icon.className = "cm-md-callout-icon";
    icon.textContent = CALLOUT_ICONS[typeLower] || "\uD83D\uDCDD";
    titleRow.appendChild(icon);

    const titleText = document.createElement("span");
    titleText.textContent = this.title || this.calloutType.charAt(0).toUpperCase() + this.calloutType.slice(1).toLowerCase();
    titleRow.appendChild(titleText);
    container.appendChild(titleRow);

    // Content
    if (this.content.trim()) {
      const contentDiv = document.createElement("div");
      contentDiv.className = "cm-md-callout-content";
      contentDiv.appendChild(renderInlineContent(this.content));
      container.appendChild(contentDiv);
    }

    return container;
  }
  eq(other: CalloutWidget) {
    return (
      this.calloutType === other.calloutType &&
      this.title === other.title &&
      this.content === other.content
    );
  }
}

class BulletWidget extends WidgetType {
  constructor(readonly level: number) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    const mod = this.level % 3;
    if (mod === 0) {
      span.className = "cm-md-bullet";
    } else if (mod === 1) {
      span.className = "cm-md-bullet-hollow";
    } else {
      span.className = "cm-md-bullet-square";
    }
    return span;
  }
  eq(other: BulletWidget) {
    return this.level === other.level;
  }
}

class OrderedNumberWidget extends WidgetType {
  constructor(readonly number: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-ordered-number";
    span.textContent = this.number + ".";
    return span;
  }
  eq(other: OrderedNumberWidget) {
    return this.number === other.number;
  }
}

class InlineMathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-math-inline";
    try {
      span.innerHTML = katex.renderToString(this.latex, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      span.textContent = `$${this.latex}$`;
    }
    return span;
  }
  eq(other: InlineMathWidget) {
    return this.latex === other.latex;
  }
}

class BlockMathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }
  toDOM() {
    const div = document.createElement("div");
    div.className = "cm-md-math-block";
    try {
      div.innerHTML = katex.renderToString(this.latex, {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      div.textContent = `$$${this.latex}$$`;
    }
    return div;
  }
  eq(other: BlockMathWidget) {
    return this.latex === other.latex;
  }
}

// =====================================================
// Cursor-aware decoration builder
// =====================================================

function cursorInRange(
  view: EditorView,
  from: number,
  to: number,
  lineLevel: boolean = false,
): boolean {
  const { state } = view;
  let checkFrom = from;
  let checkTo = to;

  if (lineLevel) {
    checkFrom = state.doc.lineAt(from).from;
    checkTo = state.doc.lineAt(to).to;
  }

  for (const range of state.selection.ranges) {
    if (range.from <= checkTo && range.to >= checkFrom) return true;
  }
  return false;
}

/** Same as cursorInRange but takes EditorState (for use in StateField) */
function cursorInRangeState(
  state: EditorState,
  from: number,
  to: number,
  lineLevel: boolean = false,
): boolean {
  let checkFrom = from;
  let checkTo = to;
  if (lineLevel) {
    checkFrom = state.doc.lineAt(from).from;
    checkTo = state.doc.lineAt(to).to;
  }
  for (const range of state.selection.ranges) {
    if (range.from <= checkTo && range.to >= checkFrom) return true;
  }
  return false;
}

// =====================================================
// Decoration CSS classes
// =====================================================

const headingDecos: Record<string, Decoration> = {
  ATXHeading1: Decoration.mark({ class: "cm-md-heading1" }),
  ATXHeading2: Decoration.mark({ class: "cm-md-heading2" }),
  ATXHeading3: Decoration.mark({ class: "cm-md-heading3" }),
  ATXHeading4: Decoration.mark({ class: "cm-md-heading4" }),
  ATXHeading5: Decoration.mark({ class: "cm-md-heading4" }),
  ATXHeading6: Decoration.mark({ class: "cm-md-heading4" }),
};

const boldDeco = Decoration.mark({ class: "cm-md-bold" });
const italicDeco = Decoration.mark({ class: "cm-md-italic" });
const strikethroughDeco = Decoration.mark({ class: "cm-md-strikethrough" });
const inlineCodeDeco = Decoration.mark({ class: "cm-md-inline-code" });
const linkDeco = Decoration.mark({ class: "cm-md-link" });
const blockquoteLineDeco = Decoration.line({ class: "cm-md-blockquote" });

const hideDeco = Decoration.replace({});
const highlightDeco = Decoration.mark({ class: "cm-md-highlight" });

// =====================================================
// Build decorations from syntax tree
// =====================================================

function buildDecorations(view: EditorView): DecorationSet {
  const markDecorations: Range<Decoration>[] = [];
  const lineDecorations: Range<Decoration>[] = [];
  const { state } = view;
  const tree = syntaxTree(state);

  // Track which lines are inside code blocks so we skip inline processing
  const codeBlockLines = new Set<number>();

  // First pass: find code blocks
  tree.iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        const startLine = state.doc.lineAt(node.from).number;
        const endLine = state.doc.lineAt(node.to).number;
        for (let i = startLine; i <= endLine; i++) {
          codeBlockLines.add(i);
        }
      }
    },
  });

  tree.iterate({
    enter(node) {
      const { from, to, name } = node;

      // Skip empty ranges
      if (from === to) return;

      // --- Code blocks (handled by blockDecorationField StateField with Shiki) ---
      if (name === "FencedCode" || name === "CodeBlock") {
        return false;
      }

      // Skip anything inside a code block
      const lineNum = state.doc.lineAt(from).number;
      if (codeBlockLines.has(lineNum)) return;

      // --- Tables (handled by blockDecorationField StateField) ---
      if (name === "Table") {
        return false;
      }

      // --- Headings ---
      if (name in headingDecos) {
        const active = cursorInRange(view, from, to, true);
        if (!active) {
          const line = state.doc.lineAt(from);
          const lineText = line.text;
          const hashMatch = lineText.match(/^(#{1,6})\s/);
          if (hashMatch) {
            const markerEnd = line.from + hashMatch[0].length;
            if (markerEnd > line.from) {
              markDecorations.push(hideDeco.range(line.from, markerEnd));
            }
            if (markerEnd < line.to) {
              markDecorations.push(headingDecos[name].range(markerEnd, line.to));
            }
          } else {
            markDecorations.push(headingDecos[name].range(from, to));
          }
        }
        return false;
      }

      // --- Bold (StrongEmphasis) ---
      if (name === "StrongEmphasis") {
        const active = cursorInRange(view, from, to);
        if (!active) {
          const text = state.doc.sliceString(from, to);
          const marker = text.startsWith("**") ? 2 : 1;
          if (to - from > marker * 2) {
            markDecorations.push(hideDeco.range(from, from + marker));
            markDecorations.push(boldDeco.range(from + marker, to - marker));
            markDecorations.push(hideDeco.range(to - marker, to));
          }
        }
        return false;
      }

      // --- Italic (Emphasis) ---
      if (name === "Emphasis") {
        const active = cursorInRange(view, from, to);
        if (!active) {
          if (to - from > 2) {
            markDecorations.push(hideDeco.range(from, from + 1));
            markDecorations.push(italicDeco.range(from + 1, to - 1));
            markDecorations.push(hideDeco.range(to - 1, to));
          }
        }
        return false;
      }

      // --- Strikethrough ---
      if (name === "Strikethrough") {
        const active = cursorInRange(view, from, to);
        if (!active) {
          if (to - from > 4) {
            markDecorations.push(hideDeco.range(from, from + 2));
            markDecorations.push(strikethroughDeco.range(from + 2, to - 2));
            markDecorations.push(hideDeco.range(to - 2, to));
          }
        }
        return false;
      }

      // --- Inline code ---
      if (name === "InlineCode") {
        const active = cursorInRange(view, from, to);
        if (!active) {
          const text = state.doc.sliceString(from, to);
          const backticks = text.startsWith("``") ? 2 : 1;
          if (to - from > backticks * 2) {
            markDecorations.push(hideDeco.range(from, from + backticks));
            markDecorations.push(
              inlineCodeDeco.range(from + backticks, to - backticks),
            );
            markDecorations.push(hideDeco.range(to - backticks, to));
          }
        }
        return false;
      }

      // --- Links ---
      if (name === "Link") {
        const active = cursorInRange(view, from, to);
        if (!active) {
          let hasURL = false;
          let urlText = "";
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === "URL") {
                hasURL = true;
                urlText = state.doc.sliceString(cursor.from, cursor.to);
              }
            } while (cursor.nextSibling());
          }

          if (hasURL) {
            const text = state.doc.sliceString(from, to);
            const labelMatch = text.match(/^\[([^\]]*)\]\(/);

            // Check for wren-*: protocol — render as styled link widgets
            if (urlText.startsWith("wren-table:") && labelMatch) {
              const uuid = urlText.slice("wren-table:".length);
              const linkLabel = labelMatch[1];
              markDecorations.push(
                Decoration.replace({
                  widget: new TableLinkWidget(uuid, linkLabel),
                }).range(from, to),
              );
            } else if (urlText.startsWith("wren-entry:") && labelMatch) {
              const entryId = urlText.slice("wren-entry:".length);
              markDecorations.push(
                Decoration.replace({
                  widget: new EntryLinkWidget(entryId, labelMatch[1]),
                }).range(from, to),
              );
            } else if (urlText.startsWith("wren-attachment:") && labelMatch) {
              const attachmentId = urlText.slice("wren-attachment:".length);
              markDecorations.push(
                Decoration.replace({
                  widget: new AttachmentLinkWidget(attachmentId, labelMatch[1]),
                }).range(from, to),
              );
            } else if (urlText.startsWith("wren-tag:") && labelMatch) {
              const tagId = urlText.slice("wren-tag:".length);
              markDecorations.push(
                Decoration.replace({
                  widget: new TagLinkWidget(tagId, labelMatch[1]),
                }).range(from, to),
              );
            } else if (urlText.startsWith("wren-collection:") && labelMatch) {
              const collectionId = urlText.slice("wren-collection:".length);
              markDecorations.push(
                Decoration.replace({
                  widget: new CollectionLinkWidget(collectionId, labelMatch[1]),
                }).range(from, to),
              );
            } else if (labelMatch) {
              const labelFrom = from + 1;
              const labelTo = from + 1 + labelMatch[1].length;
              markDecorations.push(hideDeco.range(from, from + 1));
              markDecorations.push(linkDeco.range(labelFrom, labelTo));
              markDecorations.push(hideDeco.range(labelTo, to));
            }
          }
        }
        return false;
      }

      // --- Images (handled by blockDecorationField StateField for grid support) ---
      if (name === "Image") {
        return false;
      }

      // --- Blockquotes (callouts handled by blockDecorationField StateField) ---
      if (name === "Blockquote") {
        const active = cursorInRange(view, from, to, true);
        if (!active) {
          const firstLine = state.doc.lineAt(from);
          const calloutMatch = firstLine.text.match(/^>\s*\[!(\w+)\]\s*(.*)/);

          if (!calloutMatch) {
            // Regular blockquote — use line decorations for full-width background
            const lastLineNum = state.doc.lineAt(to).number;
            for (let lineNo = state.doc.lineAt(from).number; lineNo <= lastLineNum; lineNo++) {
              const line = state.doc.line(lineNo);
              lineDecorations.push(blockquoteLineDeco.range(line.from));
              const quoteMatch = line.text.match(/^>\s?/);
              if (quoteMatch) {
                markDecorations.push(
                  hideDeco.range(line.from, line.from + quoteMatch[0].length),
                );
              }
            }
          }
        }
        return false;
      }

      // --- Horizontal rules ---
      if (name === "HorizontalRule") {
        const active = cursorInRange(view, from, to, true);
        if (!active) {
          markDecorations.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(),
            }).range(from, to),
          );
        }
        return;
      }

      // --- Task lists ---
      if (name === "TaskMarker") {
        const active = cursorInRange(view, from, to, true);
        if (!active) {
          const text = state.doc.sliceString(from, to);
          const checked = text.includes("x") || text.includes("X");
          markDecorations.push(
            Decoration.replace({
              widget: new CheckboxWidget(checked),
            }).range(from, to),
          );
        }
        return;
      }

      // --- List markers (bullet / ordered) ---
      if (name === "ListMark") {
        const active = cursorInRange(view, from, to, true);
        if (!active) {
          // For task list items, hide the marker (- or *) but don't add a bullet
          const lineText = state.doc.lineAt(from).text;
          if (/\[[ xX]\]/.test(lineText)) {
            let hideEnd = to;
            const afterMarker = state.doc.sliceString(to, to + 1);
            if (afterMarker === " ") hideEnd = to + 1;
            markDecorations.push(hideDeco.range(from, hideEnd));
            return;
          }

          const text = state.doc.sliceString(from, to);

          // Calculate nesting level
          let level = 0;
          let p = node.node.parent;
          while (p) {
            if (p.name === "BulletList" || p.name === "OrderedList") level++;
            p = p.parent;
          }
          level = Math.max(0, level - 1);

          // Determine if ordered
          const isOrdered = /^\d+[.)]$/.test(text);

          // Hide marker + trailing space
          let hideEnd = to;
          const afterMarker = state.doc.sliceString(to, to + 1);
          if (afterMarker === " ") hideEnd = to + 1;

          if (isOrdered) {
            const numMatch = text.match(/^(\d+)/);
            const num = numMatch ? numMatch[1] : "1";
            markDecorations.push(
              Decoration.replace({
                widget: new OrderedNumberWidget(num),
              }).range(from, hideEnd),
            );
          } else {
            markDecorations.push(
              Decoration.replace({
                widget: new BulletWidget(level),
              }).range(from, hideEnd),
            );
          }
        }
        return;
      }
    },
  });

  // =====================================================
  // Inline math scanning (block math handled by StateField)
  // =====================================================
  for (const { from: vpFrom, to: vpTo } of view.visibleRanges) {
    const text = state.doc.sliceString(vpFrom, vpTo);

    // Inline math: $...$  (not preceded/followed by $)
    let match;
    const inlineMathRegex = /(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g;
    while ((match = inlineMathRegex.exec(text)) !== null) {
      const matchFrom = vpFrom + match.index;
      const matchTo = matchFrom + match[0].length;
      const matchLineNum = state.doc.lineAt(matchFrom).number;
      if (codeBlockLines.has(matchLineNum)) continue;
      if (cursorInRange(view, matchFrom, matchTo)) continue;

      markDecorations.push(
        Decoration.replace({
          widget: new InlineMathWidget(match[1]),
        }).range(matchFrom, matchTo),
      );
    }
  }

  // =====================================================
  // Highlight scanning (==text==)
  // =====================================================
  for (const { from: vpFrom, to: vpTo } of view.visibleRanges) {
    const text = state.doc.sliceString(vpFrom, vpTo);

    let hlMatch;
    const highlightRegex = /==((?:(?!==).)+)==/g;
    while ((hlMatch = highlightRegex.exec(text)) !== null) {
      const matchFrom = vpFrom + hlMatch.index;
      const matchTo = matchFrom + hlMatch[0].length;
      const matchLineNum = state.doc.lineAt(matchFrom).number;
      if (codeBlockLines.has(matchLineNum)) continue;
      if (cursorInRange(view, matchFrom, matchTo)) continue;

      // Hide opening ==
      markDecorations.push(hideDeco.range(matchFrom, matchFrom + 2));
      // Apply highlight to inner text
      markDecorations.push(highlightDeco.range(matchFrom + 2, matchTo - 2));
      // Hide closing ==
      markDecorations.push(hideDeco.range(matchTo - 2, matchTo));
    }
  }

  // =====================================================
  // Build final decoration set
  // =====================================================

  // Sort mark decorations by position
  markDecorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);

  // Build mark RangeSet, filtering out overlapping decorations
  const allDecos: Range<Decoration>[] = [];
  let lastTo = 0;
  for (const deco of markDecorations) {
    if (deco.from >= lastTo) {
      allDecos.push(deco);
      if (deco.to > deco.from) {
        lastTo = deco.to;
      }
    }
  }

  // Add line decorations (they don't overlap with mark decorations)
  for (const lineDeco of lineDecorations) {
    allDecos.push(lineDeco);
  }

  // Re-sort everything together
  allDecos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);

  return Decoration.set(allDecos);
}

// =====================================================
// ViewPlugin
// =====================================================

export const markdownRenderPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

// =====================================================
// Click handler for links
// =====================================================

export const markdownClickHandler = EditorView.domEventHandlers({
  click(event: MouseEvent, view: EditorView) {
    if (!event.metaKey && !event.ctrlKey) return false;

    const target = event.target as HTMLElement;
    if (!target.closest(".cm-md-link")) return false;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    const tree = syntaxTree(view.state);
    let url: string | null = null;

    tree.iterate({
      from: pos,
      to: pos,
      enter(node) {
        if (node.name === "Link") {
          const text = view.state.doc.sliceString(node.from, node.to);
          const urlMatch = text.match(/\]\(([^)]+)\)/);
          if (urlMatch) {
            url = urlMatch[1];
          }
        }
      },
    });

    const resolvedUrl = url as string | null;
    if (resolvedUrl) {
      if (resolvedUrl.startsWith("wren-entry:")) {
        window.dispatchEvent(new CustomEvent("wren:open-entry", { detail: { entryId: parseInt(resolvedUrl.slice("wren-entry:".length)) } }));
      } else if (resolvedUrl.startsWith("wren-attachment:")) {
        window.dispatchEvent(new CustomEvent("wren:open-attachment", { detail: { attachmentId: parseInt(resolvedUrl.slice("wren-attachment:".length)) } }));
      } else if (resolvedUrl.startsWith("wren-tag:")) {
        window.dispatchEvent(new CustomEvent("wren:navigate-tag", { detail: { tagId: parseInt(resolvedUrl.slice("wren-tag:".length)) } }));
      } else if (resolvedUrl.startsWith("wren-collection:")) {
        window.dispatchEvent(new CustomEvent("wren:navigate-collection", { detail: { collectionId: parseInt(resolvedUrl.slice("wren-collection:".length)) } }));
      } else if (resolvedUrl.startsWith("wren-table:")) {
        // Table links are handled by the widget click handler
      } else {
        window.open(resolvedUrl, "_blank");
      }
      return true;
    }
    return false;
  },
});

// =====================================================
// StateField for multi-line replace decorations
// (ViewPlugins cannot have replace decorations that
//  span across line breaks — StateFields can)
// =====================================================

/** Dispatch a transaction with this effect to force block decorations to rebuild (e.g. after Shiki loads or theme changes) */
export const refreshBlockDecorations = StateEffect.define<null>();

function buildBlockDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const showLineNumbers = useSettingsStore.getState().showCodeLineNumbers;

  // Track code block lines so we skip block math inside them
  const codeBlockLines = new Set<number>();
  tree.iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        const startLine = state.doc.lineAt(node.from).number;
        const endLine = state.doc.lineAt(node.to).number;
        for (let i = startLine; i <= endLine; i++) {
          codeBlockLines.add(i);
        }
      }
    },
  });

  // Find tables and callout blockquotes
  tree.iterate({
    enter(node) {
      const { from, to, name } = node;
      if (from === to) return;

      // --- Code blocks (Shiki-rendered widget) ---
      if (name === "FencedCode" || name === "CodeBlock") {
        if (!cursorInRangeState(state, from, to, true)) {
          // Extract language and code content
          let language = "";
          let codeContent = "";
          if (name === "FencedCode") {
            const cursor = node.node.cursor();
            if (cursor.firstChild()) {
              do {
                if (cursor.name === "CodeInfo") {
                  language = state.doc.sliceString(cursor.from, cursor.to).trim();
                }
                if (cursor.name === "CodeText") {
                  codeContent += state.doc.sliceString(cursor.from, cursor.to);
                }
              } while (cursor.nextSibling());
            }
          } else {
            // Indented code block — no language
            codeContent = state.doc.sliceString(from, to);
          }

          if (codeContent) {
            decos.push(
              Decoration.replace({
                widget: new ShikiCodeBlockWidget(codeContent.trim(), language, showLineNumbers),
              }).range(from, to),
            );
          }
        }
        return false;
      }

      // --- Tables ---
      if (name === "Table") {
        if (!cursorInRangeState(state, from, to, true)) {
          const headers: string[] = [];
          const rows: string[][] = [];
          const tableText = state.doc.sliceString(from, to);
          const tableLines = tableText.split("\n");

          if (tableLines.length >= 2) {
            const headerCells = tableLines[0].split("|").filter((c) => c.trim() !== "");
            headers.push(...headerCells);
            for (let i = 2; i < tableLines.length; i++) {
              if (tableLines[i].trim()) {
                const cells = tableLines[i].split("|").filter((c) => c.trim() !== "");
                rows.push(cells);
              }
            }
            if (headers.length > 0) {
              decos.push(
                Decoration.replace({
                  widget: new TableWidget(headers, rows),
                }).range(from, to),
              );
            }
          }
        }
        return false;
      }

      // --- Callout blockquotes ---
      if (name === "Blockquote") {
        if (!cursorInRangeState(state, from, to, true)) {
          const firstLine = state.doc.lineAt(from);
          const calloutMatch = firstLine.text.match(/^>\s*\[!(\w+)\]\s*(.*)/);
          if (calloutMatch) {
            const calloutType = calloutMatch[1];
            const calloutTitle = calloutMatch[2] || "";
            const lines: string[] = [];
            const lastLineNum = state.doc.lineAt(to).number;
            for (let lineNo = firstLine.number + 1; lineNo <= lastLineNum; lineNo++) {
              const line = state.doc.line(lineNo);
              const stripped = line.text.replace(/^>\s?/, "");
              lines.push(stripped);
            }
            decos.push(
              Decoration.replace({
                widget: new CalloutWidget(calloutType, calloutTitle, lines.join("\n")),
              }).range(from, to),
            );
          }
        }
        return false;
      }
    },
  });

  // Block math: $$...$$ (scan full document)
  const text = state.doc.toString();
  const blockMathRegex = /\$\$\n?([\s\S]+?)\n?\$\$/g;
  let match;
  while ((match = blockMathRegex.exec(text)) !== null) {
    const matchFrom = match.index;
    const matchTo = matchFrom + match[0].length;
    const matchLineNum = state.doc.lineAt(matchFrom).number;
    if (codeBlockLines.has(matchLineNum)) continue;
    if (cursorInRangeState(state, matchFrom, matchTo, true)) continue;

    decos.push(
      Decoration.replace({
        widget: new BlockMathWidget(match[1].trim()),
      }).range(matchFrom, matchTo),
    );
  }

  // Images: scan line by line, group consecutive image-only lines into grids
  const imageLineRegex = /^!\[([^\]]*)\]\((\S+)(?:\s+=(\d+)x(\d*))?\)\s*$/;
  const totalLines = state.doc.lines;
  let lineNo = 1;
  while (lineNo <= totalLines) {
    if (codeBlockLines.has(lineNo)) {
      lineNo++;
      continue;
    }
    const line = state.doc.line(lineNo);
    const imgMatch = line.text.match(imageLineRegex);
    if (imgMatch) {
      // Found an image line — collect consecutive image lines
      const images: Array<GridImage & { from: number; to: number }> = [
        {
          url: imgMatch[2],
          alt: imgMatch[1],
          width: imgMatch[3] ? parseInt(imgMatch[3], 10) : null,
          from: line.from,
          to: line.to,
        },
      ];
      let nextLineNo = lineNo + 1;
      while (nextLineNo <= totalLines && !codeBlockLines.has(nextLineNo)) {
        const nextLine = state.doc.line(nextLineNo);
        const nextMatch = nextLine.text.match(imageLineRegex);
        if (nextMatch) {
          images.push({
            url: nextMatch[2],
            alt: nextMatch[1],
            width: nextMatch[3] ? parseInt(nextMatch[3], 10) : null,
            from: nextLine.from,
            to: nextLine.to,
          });
          nextLineNo++;
        } else {
          break;
        }
      }

      const rangeFrom = images[0].from;
      const rangeTo = images[images.length - 1].to;

      if (!cursorInRangeState(state, rangeFrom, rangeTo, true)) {
        if (images.length >= 2) {
          decos.push(
            Decoration.replace({
              widget: new ImageGridWidget(
                images.map((i) => ({ url: i.url, alt: i.alt, width: i.width })),
              ),
            }).range(rangeFrom, rangeTo),
          );
        } else {
          decos.push(
            Decoration.replace({
              widget: new ImageWidget(images[0].url, images[0].alt, images[0].width),
            }).range(rangeFrom, rangeTo),
          );
        }
      }

      lineNo = nextLineNo;
    } else {
      lineNo++;
    }
  }

  // Inline tables: scan for <!-- wren-table:uuid --> markers
  const tableMarkerRegex = /^<!--\s*wren-table:([a-f0-9-]+)\s*-->$/;
  for (let ln = 1; ln <= totalLines; ln++) {
    if (codeBlockLines.has(ln)) continue;
    const line = state.doc.line(ln);
    const tableMatch = line.text.trim().match(tableMarkerRegex);
    if (tableMatch) {
      const uuid = tableMatch[1];
      if (!cursorInRangeState(state, line.from, line.to, false)) {
        decos.push(
          Decoration.replace({
            widget: new InlineTableWidget(uuid),
            block: true,
          }).range(line.from, line.to),
        );
      }
    }
  }

  decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(decos);
}

export const blockDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state);
  },
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(refreshBlockDecorations))
    ) {
      return buildBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
