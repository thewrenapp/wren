import { Command } from "cmdk";
import {
  RefreshCw, PanelRight, LayoutGrid, LayoutList,
  Columns, ArrowUpDown, Sparkles, RotateCcw, Trash2,
} from "lucide-react";
import type { ColumnConfig } from "@/stores/uiStore";
import type { CommandHandlers, CommandsProps } from "./types";
import { CommandItem, ShortcutBadge } from "./shared";

interface ViewCommandsProps {
  handlers: CommandHandlers;
  viewModeByFilter: Record<string, string>;
  activeFilter: string;
  sortField: string;
  sortDirection: string;
  libraryLayout: string;
  columns: ColumnConfig[];
  trashCount: number;
  libraryInfoPaneEnabled: boolean;
  uiActions: CommandsProps["uiActions"];
  setCommandPaletteOpen: (open: boolean) => void;
}

export function ViewCommands({
  handlers, viewModeByFilter, activeFilter, sortField, sortDirection,
  libraryLayout, columns, trashCount, libraryInfoPaneEnabled,
  uiActions, setCommandPaletteOpen,
}: ViewCommandsProps) {
  const { toast } = require("@/stores/toastStore");
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">View</div>
      <CommandItem value="toggle info panel sidebar details" onSelect={() => handlers.handleSelect(() => uiActions.toggleInfoPane())} icon={<PanelRight className="h-4 w-4 text-muted-foreground" />} iconBg="bg-muted" label="Toggle Info Panel" shortcut={["⌘", "I"]} />
      <Command.Item value="toggle library info panel preview details sidebar" onSelect={() => handlers.handleSelect(() => uiActions.toggleLibraryInfoPane())} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted"><PanelRight className="h-4 w-4 text-muted-foreground" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Toggle Library Info Panel</span>
          <span className="text-xs text-muted-foreground">Currently {libraryInfoPaneEnabled ? "shown" : "hidden"} for selected entries</span>
        </div>
      </Command.Item>
      <Command.Item value="toggle view mode list card grid table" onSelect={handlers.handleToggleViewMode} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
          {viewModeByFilter[activeFilter] === "list" ? <LayoutGrid className="h-4 w-4 text-muted-foreground" /> : <LayoutList className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Toggle View Mode</span>
          <span className="text-xs text-muted-foreground">Current: {viewModeByFilter[activeFilter] === "list" ? "List" : "Card"}</span>
        </div>
        <ShortcutBadge keys={["⌘", "⇧", "V"]} />
      </Command.Item>
      <CommandItem value="refresh library reload sync" onSelect={() => handlers.handleSelect(() => uiActions.refreshLibrary())} icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />} iconBg="bg-muted" label="Refresh Library" />
      {trashCount > 0 && (
        <Command.Item value="empty trash clear delete permanently" onSelect={handlers.handleEmptyTrash} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10"><Trash2 className="h-4 w-4 text-red-500" /></div>
          <div className="flex-1">
            <span className="block text-sm font-medium">Empty Trash</span>
            <span className="text-xs text-muted-foreground">{trashCount} items in trash</span>
          </div>
        </Command.Item>
      )}
      <Command.Item value="toggle layout normal stacked horizontal vertical" onSelect={() => handlers.handleSelect(() => uiActions.setLibraryLayout(libraryLayout === "normal" ? "stacked" : "normal"))} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted"><Columns className="h-4 w-4 text-muted-foreground" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Toggle Layout</span>
          <span className="text-xs text-muted-foreground">Current: {libraryLayout === "normal" ? "Side-by-side" : "Stacked"}</span>
        </div>
      </Command.Item>
      {(["title", "dateAdded", "dateModified", "creator", "year", "itemType"] as const).map(field => {
        const labels: Record<string, string> = {
          title: "Title", dateAdded: "Date Added", dateModified: "Date Modified",
          creator: "Creator", year: "Year", itemType: "Type",
        };
        return (
          <Command.Item key={field} value={`sort by ${labels[field]} order ${field}`} onSelect={() => handlers.handleSelect(() => uiActions.setSort(field))} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted"><ArrowUpDown className="h-4 w-4 text-muted-foreground" /></div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Sort by {labels[field]}</span>
              {sortField === field && <span className="text-xs text-muted-foreground">Current: {sortDirection === "asc" ? "Ascending" : "Descending"}</span>}
            </div>
          </Command.Item>
        );
      })}
      {columns.map(col => (
        <Command.Item key={col.id} value={`toggle column ${col.label} visibility show hide ${col.id}`} onSelect={() => handlers.handleSelect(() => uiActions.toggleColumnVisibility(col.id))} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted"><LayoutList className="h-4 w-4 text-muted-foreground" /></div>
          <div className="flex-1"><span className="block text-sm font-medium">{col.visible ? "Hide" : "Show"} {col.label} Column</span></div>
        </Command.Item>
      ))}
      <CommandItem value="reset columns default table" onSelect={() => handlers.handleSelect(() => uiActions.resetColumns())} icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />} iconBg="bg-muted" label="Reset Columns to Default" />
      <Command.Item
        value="reindex entire library re-extract all background"
        onSelect={async () => {
          setCommandPaletteOpen(false);
          try {
            const { useJobStore } = await import("@/stores/jobStore");
            await useJobStore.getState().enqueueJob(
              "reindex_library",
              { enableOcr: true, forceOcr: false },
              { title: "Reindex Library" }
            );
            toast.info("Library reindex started in background");
          } catch (err) {
            toast.error(`Failed to start reindex: ${err}`);
          }
        }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10"><RefreshCw className="h-4 w-4 text-amber-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Reindex Entire Library</span>
          <span className="text-xs text-muted-foreground">Re-extract text from all documents (background task)</span>
        </div>
      </Command.Item>
      <Command.Item
        value="build RAG index index entities claims"
        onSelect={async () => {
          setCommandPaletteOpen(false);
          try {
            await uiActions.ragIndexAll();
            toast.info("RAG index build started in background");
          } catch (err) {
            toast.error(`Failed to start graph build: ${err}`);
          }
        }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10"><Sparkles className="h-4 w-4 text-primary" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Build Knowledge Graph</span>
          <span className="text-xs text-muted-foreground">Extract entities and claims from all parsed documents</span>
        </div>
      </Command.Item>
      <Command.Item
        value="find related papers auto relate connections"
        onSelect={async () => {
          setCommandPaletteOpen(false);
          try {
            await uiActions.ragIndexAll();
            toast.info("Finding related papers in background");
          } catch (err) {
            toast.error(`Failed to start auto-relate: ${err}`);
          }
        }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10"><Sparkles className="h-4 w-4 text-primary" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Find Related Papers</span>
          <span className="text-xs text-muted-foreground">Discover connections between papers via shared concepts</span>
        </div>
      </Command.Item>
      <Command.Item
        value="rebuild RAG index reset reindex embeddings"
        onSelect={async () => {
          setCommandPaletteOpen(false);
          const confirmed = window.confirm("This will delete all RAG vectors and rebuild the index from scratch.\n\nContinue?");
          if (!confirmed) return;
          try {
            await uiActions.ragRebuild();
            toast.info("RAG index cleared — rebuilding in background");
          } catch (err) {
            toast.error(`Failed to rebuild graph: ${err}`);
          }
        }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-destructive/10"><RotateCcw className="h-4 w-4 text-destructive" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Rebuild Knowledge Graph</span>
          <span className="text-xs text-muted-foreground">Clear all graph data and re-extract from scratch</span>
        </div>
      </Command.Item>
    </Command.Group>
  );
}
