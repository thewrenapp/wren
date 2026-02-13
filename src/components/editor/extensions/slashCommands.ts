import {
  ViewPlugin,
  EditorView,
  ViewUpdate,
} from "@codemirror/view";
import { createInlineTable } from "@/services/tauri/commands";
import "./slashCommands.css";

// =====================================================
// Types
// =====================================================

interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: "blocks" | "lists" | "references";
  keywords: string[];
  action: (view: EditorView, from: number, to: number) => void | Promise<void>;
}

// =====================================================
// Command definitions
// =====================================================

const SLASH_COMMANDS: SlashCommand[] = [
  // --- Blocks ---
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section heading",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v8"/></svg>`,
    category: "blocks",
    keywords: ["h1", "title", "heading"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "# " } });
      view.focus();
    },
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12h4"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>`,
    category: "blocks",
    keywords: ["h2", "subtitle", "heading"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "## " } });
      view.focus();
    },
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>`,
    category: "blocks",
    keywords: ["h3", "heading"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "### " } });
      view.focus();
    },
  },
  {
    id: "blockquote",
    label: "Quote",
    description: "Block quotation",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`,
    category: "blocks",
    keywords: ["quote", "blockquote"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "> " } });
      view.focus();
    },
  },
  {
    id: "code-block",
    label: "Code Block",
    description: "Fenced code block",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    category: "blocks",
    keywords: ["code", "fence", "syntax", "programming"],
    action: (view, from, to) => {
      const insert = "```\n\n```";
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + 4 },
      });
      view.focus();
    },
  },
  {
    id: "math-block",
    label: "Math Equation",
    description: "LaTeX math block",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="22" x2="4" y2="2"/><line x1="20" y1="22" x2="20" y2="2"/><path d="M8 8l4 8 4-8"/></svg>`,
    category: "blocks",
    keywords: ["math", "equation", "latex", "katex", "formula"],
    action: (view, from, to) => {
      const insert = "$$\n\n$$";
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + 3 },
      });
      view.focus();
    },
  },
  {
    id: "horizontal-rule",
    label: "Divider",
    description: "Horizontal rule",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    category: "blocks",
    keywords: ["hr", "divider", "separator", "rule"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "---\n\n" } });
      view.focus();
    },
  },
  {
    id: "table",
    label: "Table",
    description: "Interactive database table",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`,
    category: "blocks",
    keywords: ["table", "database", "grid", "spreadsheet"],
    action: async (view, from, to) => {
      const defaultColumns = [
        { id: crypto.randomUUID().slice(0, 8), name: "Column 1", width: 200 },
        { id: crypto.randomUUID().slice(0, 8), name: "Column 2", width: 200 },
        { id: crypto.randomUUID().slice(0, 8), name: "Column 3", width: 200 },
      ];
      try {
        const table = await createInlineTable("Untitled Table", JSON.stringify(defaultColumns));
        const marker = `<!-- wren-table:${table.key} -->\n`;
        view.dispatch({ changes: { from, to, insert: marker } });
        view.focus();
      } catch (e) {
        console.error("Failed to create database table:", e);
      }
    },
  },

  // --- Lists ---
  {
    id: "bullet-list",
    label: "Bullet List",
    description: "Unordered list",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    category: "lists",
    keywords: ["bullet", "list", "ul", "unordered"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "- " } });
      view.focus();
    },
  },
  {
    id: "numbered-list",
    label: "Numbered List",
    description: "Ordered list",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`,
    category: "lists",
    keywords: ["numbered", "list", "ol", "ordered"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "1. " } });
      view.focus();
    },
  },
  {
    id: "task-list",
    label: "Task List",
    description: "Checklist with checkboxes",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    category: "lists",
    keywords: ["task", "todo", "checkbox", "checklist"],
    action: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "- [ ] " } });
      view.focus();
    },
  },

  // --- Callouts ---
  {
    id: "callout-note",
    label: "Note Callout",
    description: "Informational note",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    category: "blocks",
    keywords: ["callout", "note", "info", "alert"],
    action: (view, from, to) => {
      const insert = "> [!NOTE]\n> ";
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
    },
  },
  {
    id: "callout-tip",
    label: "Tip Callout",
    description: "Helpful tip or advice",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>`,
    category: "blocks",
    keywords: ["callout", "tip", "hint"],
    action: (view, from, to) => {
      const insert = "> [!TIP]\n> ";
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
    },
  },
  {
    id: "callout-warning",
    label: "Warning Callout",
    description: "Warning or caution",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    category: "blocks",
    keywords: ["callout", "warning", "caution"],
    action: (view, from, to) => {
      const insert = "> [!WARNING]\n> ";
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
    },
  },

  // --- Inline formatting ---
  {
    id: "highlight",
    label: "Highlight",
    description: "Highlight selected text",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`,
    category: "blocks",
    keywords: ["highlight", "mark", "yellow"],
    action: (view, from, to) => {
      view.dispatch({
        changes: { from, to, insert: "==highlight==" },
        selection: { anchor: from + 2, head: from + 11 },
      });
      view.focus();
    },
  },

  // --- References (these dispatch events for the search panel) ---
  {
    id: "link-entry",
    label: "Link to Entry",
    description: "Reference a library entry",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    category: "references",
    keywords: ["entry", "paper", "article", "reference", "cite", "link"],
    action: (_view, from, to) => {
      window.dispatchEvent(
        new CustomEvent("wren:slash-search", {
          detail: { type: "entry", replaceFrom: from, replaceTo: to },
        }),
      );
    },
  },
  {
    id: "link-attachment",
    label: "Link to Attachment",
    description: "Reference a PDF, note, or file",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    category: "references",
    keywords: ["attachment", "pdf", "file", "document", "link"],
    action: (_view, from, to) => {
      window.dispatchEvent(
        new CustomEvent("wren:slash-search", {
          detail: { type: "attachment", replaceFrom: from, replaceTo: to },
        }),
      );
    },
  },
  {
    id: "link-tag",
    label: "Link to Tag",
    description: "Reference a tag",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    category: "references",
    keywords: ["tag", "label", "category", "link"],
    action: (_view, from, to) => {
      window.dispatchEvent(
        new CustomEvent("wren:slash-search", {
          detail: { type: "tag", replaceFrom: from, replaceTo: to },
        }),
      );
    },
  },
  {
    id: "link-collection",
    label: "Link to Collection",
    description: "Reference a collection",
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    category: "references",
    keywords: ["collection", "folder", "group", "link"],
    action: (_view, from, to) => {
      window.dispatchEvent(
        new CustomEvent("wren:slash-search", {
          detail: { type: "collection", replaceFrom: from, replaceTo: to },
        }),
      );
    },
  },
];

// =====================================================
// Category labels
// =====================================================

const CATEGORY_LABELS: Record<string, string> = {
  blocks: "Blocks",
  lists: "Lists",
  references: "References",
};

// =====================================================
// Slash Command Plugin
// =====================================================

class SlashCommandPluginClass {
  private popup: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private active = false;
  private slashFrom = 0;
  private selectedIndex = 0;
  private filteredCommands: SlashCommand[] = [];
  private pendingRender: number | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  constructor(_view: EditorView) {}

  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet) return;

    const { state } = update.view;
    const cursor = state.selection.main.head;
    const line = state.doc.lineAt(cursor);
    const lineText = state.doc.sliceString(line.from, cursor);

    if (this.active) {
      if (cursor < this.slashFrom || line.from > this.slashFrom) {
        this.dismiss();
        return;
      }

      const query = state.doc.sliceString(this.slashFrom + 1, cursor);

      if (query.includes(" ")) {
        this.dismiss();
        return;
      }

      this.filteredCommands = this.filterCommands(query);
      this.selectedIndex = this.filteredCommands.length > 0
        ? Math.min(this.selectedIndex, this.filteredCommands.length - 1)
        : 0;
      this.scheduleRender(update.view);
    } else if (update.docChanged) {
      if (lineText === "/" || /^\s*\/$/.test(lineText)) {
        this.activate(update.view, cursor - 1);
      }
    }
  }

  private scheduleRender(view: EditorView) {
    if (this.pendingRender != null) cancelAnimationFrame(this.pendingRender);
    this.pendingRender = requestAnimationFrame(() => {
      this.pendingRender = null;
      if (this.active) this.renderPopup(view);
    });
  }

  private activate(view: EditorView, slashPos: number) {
    this.active = true;
    this.slashFrom = slashPos;
    this.selectedIndex = 0;
    this.filteredCommands = [...SLASH_COMMANDS];
    this.installKeyHandler(view);
    this.scheduleRender(view);
  }

  private installKeyHandler(view: EditorView) {
    this.removeKeyHandler();
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.active) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (this.filteredCommands.length > 0) {
          this.selectedIndex = (this.selectedIndex + 1) % this.filteredCommands.length;
          this.updateSelection();
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (this.filteredCommands.length > 0) {
          this.selectedIndex =
            (this.selectedIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
          this.updateSelection();
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (this.filteredCommands.length > 0) {
          this.executeCommand(view, this.selectedIndex);
        } else {
          this.dismiss();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (this.filteredCommands.length > 0) {
          this.executeCommand(view, this.selectedIndex);
        }
        return;
      }
    };
    document.addEventListener("keydown", this.keyHandler, true);
  }

  private removeKeyHandler() {
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler, true);
      this.keyHandler = null;
    }
  }

  /** Move the .selected class without rebuilding DOM */
  private updateSelection() {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll(".cm-slash-item");
    items.forEach((el, i) => {
      if (i === this.selectedIndex) {
        el.classList.add("selected");
        el.scrollIntoView({ block: "nearest" });
      } else {
        el.classList.remove("selected");
      }
    });
  }

  dismiss() {
    this.active = false;
    this.slashFrom = 0;
    this.selectedIndex = 0;
    this.removeKeyHandler();
    if (this.pendingRender != null) {
      cancelAnimationFrame(this.pendingRender);
      this.pendingRender = null;
    }
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
      this.listEl = null;
    }
  }

  private filterCommands(query: string): SlashCommand[] {
    if (!query) return [...SLASH_COMMANDS];
    const q = query.toLowerCase();
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.keywords.some((kw) => kw.includes(q)),
    );
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private renderPopup(view: EditorView) {
    const coords = view.coordsAtPos(this.slashFrom);
    if (!coords) {
      this.dismiss();
      return;
    }

    // Create popup container once
    if (!this.popup) {
      this.popup = document.createElement("div");
      this.popup.className = "cm-slash-command-popup";

      // Event delegation for clicks — lives for the popup's lifetime
      this.popup.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const item = (e.target as HTMLElement).closest(".cm-slash-item") as HTMLElement | null;
        if (item) {
          const idx = parseInt(item.dataset.index!);
          if (!isNaN(idx)) this.executeCommand(view, idx);
        }
      });

      // Event delegation for hover
      this.popup.addEventListener("mousemove", (e) => {
        const item = (e.target as HTMLElement).closest(".cm-slash-item") as HTMLElement | null;
        if (item) {
          const idx = parseInt(item.dataset.index!);
          if (!isNaN(idx) && idx !== this.selectedIndex) {
            this.selectedIndex = idx;
            this.updateSelection();
          }
        }
      });

      document.body.appendChild(this.popup);
    }

    // Position below the slash character
    let top = coords.bottom + 4;
    let left = coords.left;

    // Current filter query
    const query = view.state.doc.sliceString(this.slashFrom + 1, view.state.selection.main.head);

    // Build header
    const headerHtml = `<div class="cm-slash-header">${query ? `/${this.escapeHtml(query)}` : "Type to filter"}<span class="cm-slash-header-count">${this.filteredCommands.length} commands</span></div>`;

    // Build list
    let listHtml = "";
    if (this.filteredCommands.length === 0) {
      listHtml = `<div class="cm-slash-empty">No matching commands</div>`;
    } else {
      let currentCategory = "";
      for (let i = 0; i < this.filteredCommands.length; i++) {
        const cmd = this.filteredCommands[i];
        if (cmd.category !== currentCategory) {
          currentCategory = cmd.category;
          listHtml += `<div class="cm-slash-category">${CATEGORY_LABELS[currentCategory] || currentCategory}</div>`;
        }
        listHtml += `<div class="cm-slash-item${i === this.selectedIndex ? " selected" : ""}" data-index="${i}">
          <span class="cm-slash-item-icon">${cmd.icon}</span>
          <div class="cm-slash-item-text">
            <span class="cm-slash-item-label">${cmd.label}</span>
            <span class="cm-slash-item-desc">${cmd.description}</span>
          </div>
        </div>`;
      }
    }

    this.popup.innerHTML = `${headerHtml}<div class="cm-slash-list">${listHtml}</div>`;
    this.listEl = this.popup.querySelector(".cm-slash-list") as HTMLElement;

    // Ensure popup doesn't overflow viewport
    const popupWidth = 280;
    const popupHeight = Math.min(this.popup.scrollHeight || 360, 360);

    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 8;
    }
    if (top + popupHeight > window.innerHeight) {
      top = coords.top - popupHeight - 4;
    }

    this.popup.style.top = `${top}px`;
    this.popup.style.left = `${left}px`;

    // Scroll selected into view
    const selectedEl = this.listEl?.querySelector(".cm-slash-item.selected");
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  private executeCommand(view: EditorView, index: number) {
    const cmd = this.filteredCommands[index];
    if (!cmd) return;

    const cursor = view.state.selection.main.head;
    const from = this.slashFrom;
    const to = cursor;

    this.dismiss();
    cmd.action(view, from, to);
  }

  destroy() {
    this.dismiss();
  }
}

export const slashCommandPlugin = ViewPlugin.fromClass(SlashCommandPluginClass, {
  eventHandlers: {
    blur() {
      // Dismiss when editor loses focus (small delay to allow click handlers to fire)
      setTimeout(() => {
        (this as unknown as SlashCommandPluginClass).dismiss();
      }, 150);
    },
  },
});
