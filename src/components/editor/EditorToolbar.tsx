import { useState, useEffect, useCallback } from "react";
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
import { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";
import {
  createInlineTable,
  getInlineTables,
  type InlineTableSummary,
} from "@/services/tauri";

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
}: EditorToolbarProps) {
  const v = editorView;
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [existingTables, setExistingTables] = useState<InlineTableSummary[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const [tablePickerLoading, setTablePickerLoading] = useState(false);

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

  // Listen for Command Palette events
  useEffect(() => {
    const handleInsertNewTable = () => {
      if (v) insertDatabaseTable(v);
    };
    const handleBrowseTables = () => {
      openTablePicker();
    };
    window.addEventListener("wren:insert-new-table", handleInsertNewTable);
    window.addEventListener("wren:browse-tables", handleBrowseTables);
    return () => {
      window.removeEventListener("wren:insert-new-table", handleInsertNewTable);
      window.removeEventListener("wren:browse-tables", handleBrowseTables);
    };
  }, [v, openTablePicker]);

  const filteredTables = tableSearch
    ? existingTables.filter((t) =>
        t.title.toLowerCase().includes(tableSearch.toLowerCase()),
      )
    : existingTables;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-0.5">
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
