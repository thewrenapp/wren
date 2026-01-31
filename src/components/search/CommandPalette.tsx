import { useState, useEffect, useCallback } from "react";
import { Command } from "cmdk";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Search,
  File,
  FileText,
  FolderOpen,
  Settings,
  Moon,
  Sun,
  Monitor,
  Plus,
  Tag,
  Sparkles,
  Zap,
  BookOpen,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useImport } from "@/hooks/useLibrarySync";
import { cn } from "@/lib/utils";

type SearchMode = "quick" | "full" | "semantic";

const searchModeConfig = {
  quick: { icon: Zap, label: "Quick", description: "Title search" },
  full: { icon: BookOpen, label: "Full", description: "Full-text" },
  semantic: { icon: Sparkles, label: "AI", description: "Semantic" },
};

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, setSettingsOpen } = useUIStore();
  const { openTab } = useTabStore();
  const { entries } = useLibraryStore();
  const { theme, setTheme } = useSettingsStore();
  const { importFiles, importFolder } = useImport();

  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("quick");

  // Filter entries based on search
  const filteredEntries = search.trim()
    ? entries.filter((entry) =>
        entry.title.toLowerCase().includes(search.toLowerCase()) ||
        (entry.creatorsDisplay?.toLowerCase().includes(search.toLowerCase()) ?? false)
      )
    : [];

  const handleSelect = useCallback(
    (callback: () => void) => {
      callback();
      setCommandPaletteOpen(false);
      setSearch("");
    },
    [setCommandPaletteOpen]
  );

  const handleImportPdf = async () => {
    setCommandPaletteOpen(false);
    setSearch("");

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        await importFiles(selected);
      }
    } catch (err) {
      console.error("Import error:", err);
    }
  };

  const handleImportFolder = async () => {
    setCommandPaletteOpen(false);
    setSearch("");

    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        await importFolder(selected);
      }
    } catch (err) {
      console.error("Import folder error:", err);
    }
  };

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => setCommandPaletteOpen(false)}
      />

      {/* Dialog */}
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command
          className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden"
          shouldFilter={false}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <Search className="h-5 w-5 text-primary shrink-0" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search entries, run commands..."
              className="flex-1 text-base bg-transparent outline-none placeholder:text-muted-foreground/60"
              autoFocus
            />

            {/* Search mode toggle */}
            <div className="flex gap-1 shrink-0 bg-muted/50 rounded-lg p-1">
              {(["quick", "full", "semantic"] as const).map((mode) => {
                const config = searchModeConfig[mode];
                const Icon = config.icon;
                return (
                  <button
                    key={mode}
                    onClick={() => setSearchMode(mode)}
                    title={config.description}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-all",
                      searchMode === mode
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{config.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Results */}
          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            <Command.Empty className="py-12 text-center">
              <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Try adjusting your search or import new PDFs
              </p>
            </Command.Empty>

            {/* Search results */}
            {filteredEntries.length > 0 && (
              <Command.Group>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  Entries
                </div>
                {filteredEntries.slice(0, 10).map((entry) => (
                  <Command.Item
                    key={entry.id}
                    value={entry.title}
                    onSelect={() =>
                      handleSelect(() =>
                        openTab({
                          type: "entry",
                          title: entry.title,
                          entryId: entry.id,
                        })
                      )
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className={cn(
                      "flex items-center justify-center h-8 w-8 rounded-lg",
                      entry.hasPdf ? "bg-red-500/10" : "bg-primary/10"
                    )}>
                      {entry.hasPdf ? (
                        <File className="h-4 w-4 text-red-500" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{entry.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {entry.creatorsDisplay || entry.entryType}
                      </span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Commands (shown when no search) */}
            {!search && (
              <>
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Create
                  </div>
                  <Command.Item
                    onSelect={handleImportPdf}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                      <Plus className="h-4 w-4 text-red-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Import PDF</span>
                      <span className="text-xs text-muted-foreground">Add a PDF document to your library</span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => {
                        // TODO: Create note
                      })
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">New Note</span>
                      <span className="text-xs text-muted-foreground">Create a new markdown note</span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={handleImportFolder}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10">
                      <FolderOpen className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Import Folder</span>
                      <span className="text-xs text-muted-foreground">Import multiple PDFs from a folder</span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => {
                        // TODO: New collection
                      })
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10">
                      <Tag className="h-4 w-4 text-violet-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">New Collection</span>
                      <span className="text-xs text-muted-foreground">Organize entries into a collection</span>
                    </div>
                  </Command.Item>
                </Command.Group>

                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Settings
                  </div>
                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => {
                        const themes = ["system", "light", "dark"] as const;
                        const current = themes.indexOf(theme);
                        const next = themes[(current + 1) % themes.length];
                        setTheme(next);
                      })
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      {theme === "system" ? (
                        <Monitor className="h-4 w-4 text-muted-foreground" />
                      ) : theme === "light" ? (
                        <Sun className="h-4 w-4 text-amber-500" />
                      ) : (
                        <Moon className="h-4 w-4 text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Toggle Theme</span>
                      <span className="text-xs text-muted-foreground">
                        Current: {theme.charAt(0).toUpperCase() + theme.slice(1)}
                      </span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => setSettingsOpen(true))
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Settings</span>
                      <span className="text-xs text-muted-foreground">Configure app preferences</span>
                    </div>
                  </Command.Item>
                </Command.Group>
              </>
            )}
          </Command.List>

          {/* Footer with keyboard hints */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">↵</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">esc</kbd>
                close
              </span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
