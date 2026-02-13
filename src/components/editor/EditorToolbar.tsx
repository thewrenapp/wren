import { useState, useEffect, useCallback, useRef } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Link,
  List,
  ListChecks,
  Quote,
  Minus,
  RefreshCw,
  Table2,
  Braces,
  Sigma,
  AlertTriangle,
  Plus,
  Search,
  Link2,
  TableProperties,
  PanelRight,
  PanelRightClose,
  ChevronUp,
  ChevronDown,
  X,
  Highlighter,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";
import {
  createInlineTable,
  getInlineTables,
  type InlineTableSummary,
} from "@/services/tauri";
import { useUIStore } from "@/stores/uiStore";
import type { SearchOptions } from "./useMarkdownSearch";

// =====================================================
// Formatting commands that dispatch CM6 transactions
// =====================================================

function wrapSelection(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);

  // Check if already wrapped — toggle off
  if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length >= before.length + after.length
  ) {
    view.dispatch({
      changes: {
        from,
        to,
        insert: selected.slice(before.length, selected.length - after.length),
      },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: {
        anchor: from + before.length,
        head: to + before.length,
      },
    });
  }
  view.focus();
}

function toggleLinePrefix(view: EditorView, prefix: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const text = line.text;

  if (text.startsWith(prefix)) {
    view.dispatch({
      changes: { from: line.from, to: line.from + prefix.length, insert: "" },
    });
  } else {
    // Remove existing heading prefixes before adding new one
    const existingPrefix = text.match(/^#{1,6}\s/);
    const removeLen = existingPrefix ? existingPrefix[0].length : 0;
    view.dispatch({
      changes: {
        from: line.from,
        to: line.from + removeLen,
        insert: prefix,
      },
    });
  }
  view.focus();
}

function insertAtLineStart(view: EditorView, prefix: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);

  if (line.text.startsWith(prefix)) {
    view.dispatch({
      changes: { from: line.from, to: line.from + prefix.length, insert: "" },
    });
  } else {
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: prefix },
    });
  }
  view.focus();
}

function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);

  if (selected) {
    view.dispatch({
      changes: { from, to, insert: `[${selected}](url)` },
      selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: "[text](url)" },
      selection: { anchor: from + 1, head: from + 5 },
    });
  }
  view.focus();
}

function insertHorizontalRule(view: EditorView) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const insertAt = line.to;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: "\n\n---\n\n" },
  });
  view.focus();
}

async function insertDatabaseTable(view: EditorView) {
  const defaultColumns = [
    { id: crypto.randomUUID().slice(0, 8), name: "Column 1", width: 200 },
    { id: crypto.randomUUID().slice(0, 8), name: "Column 2", width: 200 },
    { id: crypto.randomUUID().slice(0, 8), name: "Column 3", width: 200 },
  ];
  try {
    const table = await createInlineTable("Untitled Table", JSON.stringify(defaultColumns));
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const marker = `\n<!-- wren-table:${table.key} -->\n`;
    view.dispatch({
      changes: { from: line.to, insert: marker },
    });
    view.focus();
  } catch (e) {
    console.error("Failed to create database table:", e);
  }
}

function insertCodeBlock(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);
  if (selected) {
    const insert = `\n\`\`\`\n${selected}\n\`\`\`\n`;
    view.dispatch({
      changes: { from, to, insert },
    });
  } else {
    const insert = "\n```\n\n```\n";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + 5 },
    });
  }
  view.focus();
}

function insertCallout(view: EditorView, type: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const callout = `\n> [!${type.toUpperCase()}]\n> \n\n`;
  view.dispatch({
    changes: { from: line.to, insert: callout },
    selection: { anchor: line.to + callout.length - 2 },
  });
  view.focus();
}

function insertInlineMath(view: EditorView) {
  wrapSelection(view, "$", "$");
}

// =====================================================
// Toolbar component
// =====================================================

interface EditorToolbarProps {
  editorView: EditorView | null;
  saveStatus?: "idle" | "saving" | "saved";
  showReindex?: boolean;
  onReindex?: () => void;
  infoPaneOpen?: boolean;
  onToggleInfoPane?: () => void;
  onSearch?: (query: string, options: SearchOptions) => void;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onSearchClear?: () => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
}

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onClick: () => void;
  isActive?: boolean;
}

function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  isActive,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7", isActive && "bg-accent")}
          onClick={onClick}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
        {shortcut && (
          <span className="ml-2 text-muted-foreground">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-border mx-1" />;
}

const CALLOUT_TYPES = [
  { type: "Note", icon: "\u270F\uFE0F" },
  { type: "Tip", icon: "\uD83D\uDCA1" },
  { type: "Warning", icon: "\u26A0\uFE0F" },
  { type: "Danger", icon: "\uD83D\uDED1" },
  { type: "Info", icon: "\u2139\uFE0F" },
  { type: "Todo", icon: "\u2611\uFE0F" },
  { type: "Bug", icon: "\uD83D\uDC1B" },
  { type: "Example", icon: "\uD83D\uDCCE" },
];

function insertExistingTable(
  view: EditorView,
  table: InlineTableSummary,
  mode: "embed" | "link",
) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  if (mode === "embed") {
    const marker = `\n<!-- wren-table:${table.key} -->\n`;
    view.dispatch({ changes: { from: line.to, insert: marker } });
  } else {
    const link = `[${table.title}](wren-table:${table.key})`;
    view.dispatch({
      changes: { from, to: from, insert: link },
    });
  }
  view.focus();
}

export function EditorToolbar({
  editorView,
  saveStatus = "idle",
  showReindex = false,
  onReindex,
  infoPaneOpen: infoPaneOpenProp,
  onToggleInfoPane,
  onSearch,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  searchMatchCount = 0,
  searchCurrentMatch = 0,
}: EditorToolbarProps) {
  const v = editorView;
  const { infoPaneOpen: globalInfoPaneOpen, toggleInfoPane: globalToggleInfoPane, libraryLayout } = useUIStore();
  const infoPaneOpen = infoPaneOpenProp ?? globalInfoPaneOpen;
  const toggleInfoPane = onToggleInfoPane ?? globalToggleInfoPane;
  const isStackedLayout = libraryLayout === "stacked";
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [existingTables, setExistingTables] = useState<InlineTableSummary[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const [tablePickerLoading, setTablePickerLoading] = useState(false);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightAll, setHighlightAll] = useState(true);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const openTablePicker = useCallback(async () => {
    setTablePickerOpen(true);
    setTableSearch("");
    setTablePickerLoading(true);
    try {
      const tables = await getInlineTables();
      setExistingTables(tables);
    } catch {
      setExistingTables([]);
    } finally {
      setTablePickerLoading(false);
    }
  }, []);

  // Search handlers
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (value) {
        onSearch?.(value, { highlightAll, matchCase, wholeWords });
      } else {
        onSearchClear?.();
      }
    },
    [onSearch, onSearchClear, highlightAll, matchCase, wholeWords],
  );

  const handleHighlightAllChange = useCallback(
    (checked: boolean) => {
      setHighlightAll(checked);
      if (searchQuery) {
        onSearch?.(searchQuery, { highlightAll: checked, matchCase, wholeWords });
      }
    },
    [searchQuery, onSearch, matchCase, wholeWords],
  );

  const handleMatchCaseChange = useCallback(
    (checked: boolean) => {
      setMatchCase(checked);
      if (searchQuery) {
        onSearch?.(searchQuery, { highlightAll, matchCase: checked, wholeWords });
      }
    },
    [searchQuery, onSearch, highlightAll, wholeWords],
  );

  const handleWholeWordsChange = useCallback(
    (checked: boolean) => {
      setWholeWords(checked);
      if (searchQuery) {
        onSearch?.(searchQuery, { highlightAll, matchCase, wholeWords: checked });
      }
    },
    [searchQuery, onSearch, highlightAll, matchCase],
  );

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    onSearchClear?.();
  }, [onSearchClear]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  // Keyboard shortcuts for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && searchOpen) {
        handleCloseSearch();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, handleCloseSearch]);

  // Listen for Command Palette search event
  useEffect(() => {
    const handleMdSearch = () => setSearchOpen(true);
    window.addEventListener("wren:md-search", handleMdSearch);
    return () => window.removeEventListener("wren:md-search", handleMdSearch);
  }, []);

  // Listen for Command Palette events
  useEffect(() => {
    const handleInsertNewTable = () => { if (v) insertDatabaseTable(v); };
    const handleBrowseTables = () => { openTablePicker(); };
    const handleBold = () => { if (v) wrapSelection(v, "**", "**"); };
    const handleItalic = () => { if (v) wrapSelection(v, "*", "*"); };
    const handleStrikethrough = () => { if (v) wrapSelection(v, "~~", "~~"); };
    const handleCode = () => { if (v) wrapSelection(v, "`", "`"); };
    const handleLink = () => { if (v) insertLink(v); };
    const handleH1 = () => { if (v) toggleLinePrefix(v, "# "); };
    const handleH2 = () => { if (v) toggleLinePrefix(v, "## "); };
    const handleH3 = () => { if (v) toggleLinePrefix(v, "### "); };
    const handleBulletList = () => { if (v) insertAtLineStart(v, "- "); };
    const handleTaskList = () => { if (v) insertAtLineStart(v, "- [ ] "); };
    const handleBlockquote = () => { if (v) insertAtLineStart(v, "> "); };
    const handleCodeBlock = () => { if (v) insertCodeBlock(v); };
    const handleMath = () => { if (v) insertInlineMath(v); };
    const handleCallout = () => { if (v) insertCallout(v, "Note"); };
    const handleHr = () => { if (v) insertHorizontalRule(v); };
    const handleHighlight = () => { if (v) wrapSelection(v, "==", "=="); };
    const handleLinkEntry = () => {
      if (!v) return;
      const cursor = v.state.selection.main.head;
      window.dispatchEvent(new CustomEvent("wren:slash-search", { detail: { type: "entry", replaceFrom: cursor, replaceTo: cursor } }));
    };
    const handleLinkTag = () => {
      if (!v) return;
      const cursor = v.state.selection.main.head;
      window.dispatchEvent(new CustomEvent("wren:slash-search", { detail: { type: "tag", replaceFrom: cursor, replaceTo: cursor } }));
    };
    const handleLinkCollection = () => {
      if (!v) return;
      const cursor = v.state.selection.main.head;
      window.dispatchEvent(new CustomEvent("wren:slash-search", { detail: { type: "collection", replaceFrom: cursor, replaceTo: cursor } }));
    };

    const events: [string, () => void][] = [
      ["wren:insert-new-table", handleInsertNewTable],
      ["wren:browse-tables", handleBrowseTables],
      ["wren:editor-bold", handleBold],
      ["wren:editor-italic", handleItalic],
      ["wren:editor-strikethrough", handleStrikethrough],
      ["wren:editor-code", handleCode],
      ["wren:editor-link", handleLink],
      ["wren:editor-h1", handleH1],
      ["wren:editor-h2", handleH2],
      ["wren:editor-h3", handleH3],
      ["wren:editor-bullet-list", handleBulletList],
      ["wren:editor-task-list", handleTaskList],
      ["wren:editor-blockquote", handleBlockquote],
      ["wren:editor-code-block", handleCodeBlock],
      ["wren:editor-math", handleMath],
      ["wren:editor-callout", handleCallout],
      ["wren:editor-hr", handleHr],
      ["wren:editor-highlight", handleHighlight],
      ["wren:editor-link-entry", handleLinkEntry],
      ["wren:editor-link-tag", handleLinkTag],
      ["wren:editor-link-collection", handleLinkCollection],
    ];
    for (const [name, handler] of events) window.addEventListener(name, handler);
    return () => { for (const [name, handler] of events) window.removeEventListener(name, handler); };
  }, [v, openTablePicker]);

  const filteredTables = tableSearch
    ? existingTables.filter((t) =>
        t.title.toLowerCase().includes(tableSearch.toLowerCase()),
      )
    : existingTables;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 overflow-hidden">
        <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none">
          {/* Text formatting */}
          <ToolbarButton
            icon={Bold}
            label="Bold"
            shortcut="⌘B"
            onClick={() => v && wrapSelection(v, "**", "**")}
          />
          <ToolbarButton
            icon={Italic}
            label="Italic"
            shortcut="⌘I"
            onClick={() => v && wrapSelection(v, "*", "*")}
          />
          <ToolbarButton
            icon={Strikethrough}
            label="Strikethrough"
            shortcut="⌘⇧S"
            onClick={() => v && wrapSelection(v, "~~", "~~")}
          />
          <ToolbarButton
            icon={Code}
            label="Inline Code"
            shortcut="⌘E"
            onClick={() => v && wrapSelection(v, "`", "`")}
          />
          <ToolbarButton
            icon={Highlighter}
            label="Highlight"
            shortcut="⌘⇧H"
            onClick={() => v && wrapSelection(v, "==", "==")}
          />
          <ToolbarButton
            icon={MessageCircle}
            label="Comment"
            shortcut="⌘⇧M"
            onClick={() => {
              if (v) window.dispatchEvent(new CustomEvent("wren:editor-add-comment", { detail: { view: v } }));
            }}
          />

          <Divider />

          {/* Headings */}
          <ToolbarButton
            icon={Heading1}
            label="Heading 1"
            onClick={() => v && toggleLinePrefix(v, "# ")}
          />
          <ToolbarButton
            icon={Heading2}
            label="Heading 2"
            onClick={() => v && toggleLinePrefix(v, "## ")}
          />
          <ToolbarButton
            icon={Heading3}
            label="Heading 3"
            onClick={() => v && toggleLinePrefix(v, "### ")}
          />

          <Divider />

          {/* Block elements */}
          <ToolbarButton
            icon={Link}
            label="Link"
            shortcut="⌘K"
            onClick={() => v && insertLink(v)}
          />
          <ToolbarButton
            icon={List}
            label="Bullet List"
            onClick={() => v && insertAtLineStart(v, "- ")}
          />
          <ToolbarButton
            icon={ListChecks}
            label="Task List"
            onClick={() => v && insertAtLineStart(v, "- [ ] ")}
          />
          <ToolbarButton
            icon={Quote}
            label="Blockquote"
            onClick={() => v && insertAtLineStart(v, "> ")}
          />
          <ToolbarButton
            icon={Minus}
            label="Horizontal Rule"
            onClick={() => v && insertHorizontalRule(v)}
          />

          <Divider />

          {/* Table dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Table2 className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Insert Table
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              <DropdownMenuItem
                onClick={() => v && insertDatabaseTable(v)}
                className="text-sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Table
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={openTablePicker}
                className="text-sm"
              >
                <Search className="h-4 w-4 mr-2" />
                Browse Existing Tables...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ToolbarButton
            icon={Braces}
            label="Code Block"
            onClick={() => v && insertCodeBlock(v)}
          />
          <ToolbarButton
            icon={Sigma}
            label="Math"
            onClick={() => v && insertInlineMath(v)}
          />

          {/* Callout dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Insert Callout
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              {CALLOUT_TYPES.map(({ type, icon }) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => v && insertCallout(v, type)}
                  className="text-sm"
                >
                  <span className="mr-2">{icon}</span>
                  {type}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {/* Search popover */}
          <Popover open={searchOpen} onOpenChange={(open) => {
            if (open) {
              setSearchOpen(true);
            } else {
              handleCloseSearch();
            }
          }}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7", searchOpen && "bg-accent")}
              >
                <Search className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Find in Document"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (e.shiftKey) {
                          onSearchPrev?.();
                        } else {
                          onSearchNext?.();
                        }
                      }
                    }}
                    className="flex-1 h-8"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onSearchPrev} disabled={searchMatchCount === 0}>
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onSearchNext} disabled={searchMatchCount === 0}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCloseSearch}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {searchQuery && (
                  <div className="text-xs text-muted-foreground">
                    {searchMatchCount > 0
                      ? `${searchCurrentMatch} of ${searchMatchCount} matches`
                      : "No matches found"}
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="md-highlight-all" checked={highlightAll} onCheckedChange={(checked) => handleHighlightAllChange(checked === true)} />
                    <Label htmlFor="md-highlight-all" className="text-xs cursor-pointer">Highlight all</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="md-match-case" checked={matchCase} onCheckedChange={(checked) => handleMatchCaseChange(checked === true)} />
                    <Label htmlFor="md-match-case" className="text-xs cursor-pointer">Match case</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Checkbox id="md-whole-words" checked={wholeWords} onCheckedChange={(checked) => handleWholeWordsChange(checked === true)} />
                    <Label htmlFor="md-whole-words" className="text-xs cursor-pointer">Whole words</Label>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Save status */}
          {saveStatus !== "idle" && (
            <span
              className={cn(
                "text-xs text-muted-foreground transition-opacity duration-300",
                saveStatus === "saved" && "opacity-60",
              )}
            >
              {saveStatus === "saving" ? "Saving..." : "Saved"}
            </span>
          )}

          {/* Reindex button */}
          {showReindex && onReindex && (
            <ToolbarButton
              icon={RefreshCw}
              label="Rebuild Index"
              shortcut="⌘⇧R"
              onClick={onReindex}
            />
          )}

          {/* Info Pane toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleInfoPane}>
                {infoPaneOpen ? (
                  <PanelRightClose className={cn("h-4 w-4", isStackedLayout && "rotate-90")} />
                ) : (
                  <PanelRight className={cn("h-4 w-4", isStackedLayout && "rotate-90")} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {infoPaneOpen ? "Hide info panel" : "Show info panel"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Table picker dialog */}
      <Dialog open={tablePickerOpen} onOpenChange={setTablePickerOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TableProperties className="h-5 w-5 text-primary" />
              Insert Existing Table
            </DialogTitle>
            <DialogDescription>
              Choose a table to embed or link in the current document.
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex-shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="Search tables..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6">
            {tablePickerLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading tables...
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {existingTables.length === 0
                  ? "No tables yet. Create one with \"New Table\"."
                  : "No tables match your search."}
              </div>
            ) : (
              <div className="space-y-1 py-1">
                {filteredTables.map((table) => (
                  <div
                    key={table.key}
                    className="group flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg hover:bg-accent transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {table.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {table.column_count} columns &middot; {table.row_count} rows
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              if (v) {
                                insertExistingTable(v, table, "embed");
                                setTablePickerOpen(false);
                              }
                            }}
                          >
                            <Table2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Embed full table
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              if (v) {
                                insertExistingTable(v, table, "link");
                                setTablePickerOpen(false);
                              }
                            }}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Insert as link
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
