import { useState, useEffect, useCallback } from "react";
import { Command } from "cmdk";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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
  Download,
  Upload,
  Trash2,
  FolderPlus,
  RefreshCw,
  PanelRight,
  Copy,
  CopyPlus,
  Library,
  Settings2,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useImport } from "@/hooks/useLibrarySync";
import {
  exportToBibtex,
  exportToCslJson,
  exportAllToBibtex,
  exportAllToCslJson,
  exportToBiblatexWithFiles,
  exportAllToBiblatexWithFiles,
  importBiblatexWithFiles,
  previewBiblatexImport,
  deleteEntry,
  duplicateEntry,
  addEntryToCollection,
  addEntryTag,
  importBibtex,
  importCslJson,
  type ExportOptions,
  type BiblatexPreviewResult,
} from "@/services/tauri";
import { ExportOptionsDialog } from "@/components/dialogs/ExportOptionsDialog";
import { ImportPreviewDialog } from "@/components/dialogs/ImportPreviewDialog";
import { toast } from "@/stores/toastStore";
import { cn } from "@/lib/utils";

type SearchMode = "quick" | "full" | "semantic";

const searchModeConfig = {
  quick: { icon: Zap, label: "Quick", description: "Title search" },
  full: { icon: BookOpen, label: "Full", description: "Full-text" },
  semantic: { icon: Sparkles, label: "AI", description: "Semantic" },
};

// Keyboard shortcut badge component
function ShortcutBadge({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5 ml-auto">
      {keys.map((key, i) => (
        <kbd key={i} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">
          {key}
        </kbd>
      ))}
    </div>
  );
}

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setSettingsOpen,
    toggleInfoPane,
    setNewCollectionDialogOpen,
    setTagManagementDialogOpen,
    setCollectionManagementDialogOpen,
    showDeleteConfirmation,
  } = useUIStore();

  // Threshold for showing confirmation dialog
  const BULK_DELETE_THRESHOLD = 3;
  const { openTab } = useTabStore();
  const {
    entries,
    selectedEntryIds,
    collections,
    tags,
    refreshLibrary,
    clearSelection,
  } = useLibraryStore();
  const { theme, setTheme } = useSettingsStore();
  const { importFiles, importFolder } = useImport();

  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("quick");
  const [subMenu, setSubMenu] = useState<"collection" | "tag" | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("all");

  // Import preview state
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<BiblatexPreviewResult | null>(null);
  const [importFolderPath, setImportFolderPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

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
      setSubMenu(null);
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

  const handleImportBibtex = async () => {
    setCommandPaletteOpen(false);
    setSearch("");

    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "BibTeX", extensions: ["bib", "bibtex"] }],
      });

      if (selected && typeof selected === "string") {
        const content = await readTextFile(selected);
        const result = await importBibtex(content);
        if (result.imported > 0) {
          toast.success(`Imported ${result.imported} entries from BibTeX`);
          await refreshLibrary();
        } else if (result.skipped > 0) {
          toast.info(`${result.skipped} entries skipped (duplicates)`);
        }
        if (result.errors.length > 0) {
          console.error("BibTeX import errors:", result.errors);
        }
      }
    } catch (err) {
      console.error("Import BibTeX error:", err);
      toast.error("Failed to import BibTeX file");
    }
  };

  const handleImportCslJson = async () => {
    setCommandPaletteOpen(false);
    setSearch("");

    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
      });

      if (selected && typeof selected === "string") {
        const content = await readTextFile(selected);
        const result = await importCslJson(content);
        if (result.imported > 0) {
          toast.success(`Imported ${result.imported} entries from CSL JSON`);
          await refreshLibrary();
        } else if (result.skipped > 0) {
          toast.info(`${result.skipped} entries skipped (duplicates)`);
        }
        if (result.errors.length > 0) {
          console.error("CSL JSON import errors:", result.errors);
        }
      }
    } catch (err) {
      console.error("Import CSL JSON error:", err);
      toast.error("Failed to import CSL JSON file");
    }
  };

  const handleImportBiblatexWithFiles = async () => {
    setCommandPaletteOpen(false);
    setSearch("");

    try {
      // Select the Zotero export folder (contains .bib file and files/ directory)
      const selected = await open({
        directory: true,
        title: "Select Zotero Export Folder",
      });

      if (selected && typeof selected === "string") {
        // Get preview data first
        const preview = await previewBiblatexImport(selected);
        setImportPreviewData(preview);
        setImportFolderPath(selected);
        setShowImportPreview(true);
      }
    } catch (err) {
      console.error("Import BibLaTeX error:", err);
      toast.error("Failed to preview BibLaTeX folder");
    }
  };

  const handleConfirmBiblatexImport = async (selectedKeys: string[], importTags: boolean) => {
    if (!importFolderPath) return;

    setIsImporting(true);
    try {
      const result = await importBiblatexWithFiles(
        importFolderPath,
        importFolderPath,
        selectedKeys,
        importTags
      );

      let message = `Imported ${result.imported} ${result.imported !== 1 ? "entries" : "entry"}`;
      if (result.filesImported > 0) {
        message += ` with ${result.filesImported} file${result.filesImported !== 1 ? "s" : ""}`;
      }
      if (result.tagsCreated > 0) {
        message += ` and ${result.tagsCreated} tag${result.tagsCreated !== 1 ? "s" : ""}`;
      }
      toast.success(message);

      if (result.skipped > 0) {
        toast.info(`${result.skipped} entries skipped`);
      }

      // Refresh library
      await refreshLibrary();

      // Close dialog
      setShowImportPreview(false);
      setImportPreviewData(null);
      setImportFolderPath(null);
    } catch (err) {
      console.error("Failed to import BibLaTeX:", err);
      toast.error("Failed to import BibLaTeX entries");
    } finally {
      setIsImporting(false);
    }
  };

  // Export handlers
  const handleExportSelectedBibtex = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      const bibtex = await exportToBibtex(selectedEntryIds);
      const filePath = await save({
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
        defaultPath: "export.bib",
      });
      if (filePath) {
        await writeTextFile(filePath, bibtex);
        toast.success(`Exported ${selectedEntryIds.length} entries to BibTeX`);
      }
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Failed to export");
    }
    setCommandPaletteOpen(false);
  };

  const handleExportSelectedCsl = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      const csl = await exportToCslJson(selectedEntryIds);
      const filePath = await save({
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
        defaultPath: "export.json",
      });
      if (filePath) {
        await writeTextFile(filePath, csl);
        toast.success(`Exported ${selectedEntryIds.length} entries to CSL JSON`);
      }
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Failed to export");
    }
    setCommandPaletteOpen(false);
  };

  const handleExportAllBibtex = async () => {
    try {
      const bibtex = await exportAllToBibtex();
      const filePath = await save({
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
        defaultPath: "library.bib",
      });
      if (filePath) {
        await writeTextFile(filePath, bibtex);
        toast.success("Exported entire library to BibTeX");
      }
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Failed to export");
    }
    setCommandPaletteOpen(false);
  };

  const handleExportAllCsl = async () => {
    try {
      const csl = await exportAllToCslJson();
      const filePath = await save({
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
        defaultPath: "library.json",
      });
      if (filePath) {
        await writeTextFile(filePath, csl);
        toast.success("Exported entire library to CSL JSON");
      }
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Failed to export");
    }
    setCommandPaletteOpen(false);
  };

  const handleCopyBibtex = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      const bibtex = await exportToBibtex(selectedEntryIds);
      await writeText(bibtex);
      toast.success("Copied BibTeX to clipboard");
    } catch (err) {
      console.error("Copy error:", err);
      toast.error("Failed to copy");
    }
    setCommandPaletteOpen(false);
  };

  const handleCopyCsl = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      const csl = await exportToCslJson(selectedEntryIds);
      await writeText(csl);
      toast.success("Copied CSL JSON to clipboard");
    } catch (err) {
      console.error("Copy error:", err);
      toast.error("Failed to copy");
    }
    setCommandPaletteOpen(false);
  };

  const handleExportBiblatexWithFiles = async (options: ExportOptions) => {
    try {
      setIsExporting(true);
      const outputDir = await open({
        directory: true,
        title: "Select Export Folder",
      });
      if (outputDir) {
        const result = exportMode === "selected"
          ? await exportToBiblatexWithFiles(selectedEntryIds, outputDir, options)
          : await exportAllToBiblatexWithFiles(outputDir, options);
        toast.success(
          `Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`
        );
        setShowExportDialog(false);
      }
    } catch (err) {
      console.error("Export BibLaTeX error:", err);
      toast.error("Failed to export to BibLaTeX");
    } finally {
      setIsExporting(false);
    }
    setCommandPaletteOpen(false);
  };

  const openExportDialog = (mode: "selected" | "all") => {
    setExportMode(mode);
    setShowExportDialog(true);
  };

  // Actual delete operation
  const performDelete = async () => {
    try {
      for (const id of selectedEntryIds) {
        await deleteEntry(id);
      }
      toast.success(`Moved ${selectedEntryIds.length} entries to trash`);
      clearSelection();
      await refreshLibrary();
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Failed to delete entries");
    }
  };

  // Delete handler (soft delete - moves to trash)
  const handleDeleteSelected = () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    setCommandPaletteOpen(false);

    // Show confirmation for bulk deletes
    if (selectedEntryIds.length >= BULK_DELETE_THRESHOLD) {
      showDeleteConfirmation(selectedEntryIds, performDelete);
    } else {
      performDelete();
    }
  };

  // Duplicate handler
  const handleDuplicate = async () => {
    if (selectedEntryIds.length !== 1) {
      toast.warning("Select exactly one entry to duplicate");
      return;
    }
    try {
      await duplicateEntry(selectedEntryIds[0]);
      toast.success("Entry duplicated");
      await refreshLibrary();
    } catch (err) {
      console.error("Duplicate error:", err);
      toast.error("Failed to duplicate entry");
    }
    setCommandPaletteOpen(false);
  };

  // Add to collection handler
  const handleAddToCollection = async (collectionId: number) => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      for (const entryId of selectedEntryIds) {
        await addEntryToCollection(entryId, collectionId);
      }
      toast.success(`Added ${selectedEntryIds.length} entries to collection`);
      await refreshLibrary();
    } catch (err) {
      console.error("Add to collection error:", err);
      toast.error("Failed to add to collection");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Add tag handler - uses tag name since addEntryTag takes name
  const handleAddTag = async (tagName: string) => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      for (const entryId of selectedEntryIds) {
        await addEntryTag(entryId, tagName);
      }
      toast.success(`Added tag "${tagName}" to ${selectedEntryIds.length} entries`);
      await refreshLibrary();
    } catch (err) {
      console.error("Add tag error:", err);
      toast.error("Failed to add tag");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Create and add new tag
  const handleCreateAndAddTag = async () => {
    if (!newTagName.trim()) return;
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      // addEntryTag will create the tag if it doesn't exist
      for (const entryId of selectedEntryIds) {
        await addEntryTag(entryId, newTagName.trim());
      }
      toast.success(`Added tag "${newTagName}" to ${selectedEntryIds.length} entries`);
      await refreshLibrary();
    } catch (err) {
      console.error("Add tag error:", err);
      toast.error("Failed to add tag");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
    setNewTagName("");
  };

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && commandPaletteOpen) {
        if (subMenu) {
          setSubMenu(null);
        } else {
          setCommandPaletteOpen(false);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen, subMenu]);

  if (!commandPaletteOpen) return null;

  // Sub-menu for collections
  if (subMenu === "collection") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <FolderPlus className="h-5 w-5 text-primary shrink-0" />
              <span className="text-base">Add to Collection</span>
              <button
                onClick={() => setSubMenu(null)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {collections.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No collections yet. Create one first.
                </div>
              ) : (
                collections.map((collection) => (
                  <Command.Item
                    key={collection.id}
                    onSelect={() => handleAddToCollection(collection.id)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div
                      className="flex items-center justify-center h-8 w-8 rounded-lg"
                      style={{ backgroundColor: `${collection.color || '#8B5CF6'}20` }}
                    >
                      <Library className="h-4 w-4" style={{ color: collection.color || '#8B5CF6' }} />
                    </div>
                    <span className="text-sm font-medium">{collection.name}</span>
                  </Command.Item>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for tags
  if (subMenu === "tag") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Tag className="h-5 w-5 text-primary shrink-0" />
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Search or create tag..."
                className="flex-1 text-base bg-transparent outline-none placeholder:text-muted-foreground/60"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTagName.trim()) {
                    handleCreateAndAddTag();
                  }
                }}
              />
              <button
                onClick={() => setSubMenu(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {newTagName.trim() && !tags.find(t => t.name.toLowerCase() === newTagName.toLowerCase()) && (
                <Command.Item
                  onSelect={handleCreateAndAddTag}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                >
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
                    <Plus className="h-4 w-4 text-green-500" />
                  </div>
                  <span className="text-sm font-medium">Create "{newTagName}"</span>
                </Command.Item>
              )}
              {tags
                .filter(tag => !newTagName || tag.name.toLowerCase().includes(newTagName.toLowerCase()))
                .map((tag) => (
                  <Command.Item
                    key={tag.id}
                    onSelect={() => handleAddTag(tag.name)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div
                      className="flex items-center justify-center h-8 w-8 rounded-lg"
                      style={{ backgroundColor: `${tag.color || '#3B82F6'}20` }}
                    >
                      <Tag className="h-4 w-4" style={{ color: tag.color || '#3B82F6' }} />
                    </div>
                    <span className="text-sm font-medium">{tag.name}</span>
                  </Command.Item>
                ))}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

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
          <Command.List className="max-h-[400px] overflow-y-auto p-2 scrollbar-hidden">
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
                          entryId: String(entry.id),
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
                        {entry.creatorsDisplay || entry.itemType}
                      </span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Commands (shown when no search) */}
            {!search && (
              <>
                {/* Actions on selected entries */}
                {selectedEntryIds.length > 0 && (
                  <Command.Group>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                      Selected ({selectedEntryIds.length})
                    </div>
                    <Command.Item
                      onSelect={() => setSubMenu("collection")}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10">
                        <FolderPlus className="h-4 w-4 text-violet-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Add to Collection</span>
                      </div>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => setSubMenu("tag")}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                        <Tag className="h-4 w-4 text-blue-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Add Tag</span>
                      </div>
                    </Command.Item>
                    {selectedEntryIds.length === 1 && (
                      <Command.Item
                        onSelect={handleDuplicate}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10">
                          <CopyPlus className="h-4 w-4 text-amber-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Duplicate Entry</span>
                        </div>
                        <ShortcutBadge keys={["⌘", "D"]} />
                      </Command.Item>
                    )}
                    <Command.Item
                      onSelect={handleDeleteSelected}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Delete Selected</span>
                      </div>
                      <ShortcutBadge keys={["⌫"]} />
                    </Command.Item>
                  </Command.Group>
                )}

                {/* Export commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Export
                  </div>
                  {selectedEntryIds.length > 0 && (
                    <>
                      <Command.Item
                        onSelect={handleExportSelectedBibtex}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
                          <Download className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Export Selected as BibTeX</span>
                          <span className="text-xs text-muted-foreground">{selectedEntryIds.length} entries</span>
                        </div>
                        <ShortcutBadge keys={["⌘", "E"]} />
                      </Command.Item>
                      <Command.Item
                        onSelect={handleExportSelectedCsl}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
                          <Download className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Export Selected as CSL JSON</span>
                          <span className="text-xs text-muted-foreground">{selectedEntryIds.length} entries</span>
                        </div>
                      </Command.Item>
                      <Command.Item
                        onSelect={handleCopyBibtex}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-cyan-500/10">
                          <Copy className="h-4 w-4 text-cyan-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Copy as BibTeX</span>
                        </div>
                        <ShortcutBadge keys={["⌘", "⇧", "C"]} />
                      </Command.Item>
                      <Command.Item
                        onSelect={handleCopyCsl}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-cyan-500/10">
                          <Copy className="h-4 w-4 text-cyan-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Copy as CSL JSON</span>
                        </div>
                      </Command.Item>
                      <Command.Item
                        onSelect={() => openExportDialog("selected")}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10">
                          <FolderOpen className="h-4 w-4 text-purple-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Export Selected as BibLaTeX with Files</span>
                          <span className="text-xs text-muted-foreground">{selectedEntryIds.length} entries with attachments</span>
                        </div>
                      </Command.Item>
                    </>
                  )}
                  <Command.Item
                    onSelect={handleExportAllBibtex}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
                      <Download className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Export All as BibTeX</span>
                      <span className="text-xs text-muted-foreground">Entire library</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    onSelect={handleExportAllCsl}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
                      <Download className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Export All as CSL JSON</span>
                      <span className="text-xs text-muted-foreground">Entire library</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    onSelect={() => openExportDialog("all")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10">
                      <FolderOpen className="h-4 w-4 text-purple-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Export All as BibLaTeX with Files</span>
                      <span className="text-xs text-muted-foreground">Entire library with attachments</span>
                    </div>
                  </Command.Item>
                </Command.Group>

                {/* Create commands */}
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
                        // TODO: Create note - deferred to next phase
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
                    onSelect={handleImportBibtex}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-teal-500/10">
                      <Upload className="h-4 w-4 text-teal-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Import BibTeX</span>
                      <span className="text-xs text-muted-foreground">Import references from a .bib file</span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={handleImportCslJson}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-teal-500/10">
                      <Upload className="h-4 w-4 text-teal-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Import CSL JSON</span>
                      <span className="text-xs text-muted-foreground">Import references from a CSL JSON file</span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={handleImportBiblatexWithFiles}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10">
                      <FolderOpen className="h-4 w-4 text-purple-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Import BibLaTeX with Files</span>
                      <span className="text-xs text-muted-foreground">Import from Zotero export folder with PDFs</span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => setNewCollectionDialogOpen(true))
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10">
                      <Library className="h-4 w-4 text-violet-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">New Collection</span>
                      <span className="text-xs text-muted-foreground">Organize entries into a collection</span>
                    </div>
                  </Command.Item>
                </Command.Group>

                {/* Tags commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Tags
                  </div>
                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => setTagManagementDialogOpen(true))
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                      <Settings2 className="h-4 w-4 text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Manage Tags</span>
                      <span className="text-xs text-muted-foreground">Create, merge, delete, and edit tag colors</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    onSelect={() => setSubMenu("tag")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                      <Plus className="h-4 w-4 text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Create Tag</span>
                      <span className="text-xs text-muted-foreground">Create a new tag{selectedEntryIds.length > 0 ? " and add to selection" : ""}</span>
                    </div>
                  </Command.Item>
                </Command.Group>

                {/* Collections commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Collections
                  </div>
                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => setCollectionManagementDialogOpen(true))
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10">
                      <Settings2 className="h-4 w-4 text-violet-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Manage Collections</span>
                      <span className="text-xs text-muted-foreground">Merge, delete, and edit collection colors</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    onSelect={() =>
                      handleSelect(() => setNewCollectionDialogOpen(true))
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10">
                      <Plus className="h-4 w-4 text-violet-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Create Collection</span>
                      <span className="text-xs text-muted-foreground">Create a new collection to organize entries</span>
                    </div>
                  </Command.Item>
                </Command.Group>

                {/* Utility commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    View
                  </div>
                  <Command.Item
                    onSelect={() => handleSelect(() => toggleInfoPane())}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      <PanelRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Toggle Info Panel</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    onSelect={() => handleSelect(() => refreshLibrary())}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Refresh Library</span>
                    </div>
                  </Command.Item>
                </Command.Group>

                {/* Settings commands */}
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
                        <Moon className="h-4 w-4 text-primary" />
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
                    <ShortcutBadge keys={["⌘", ","]} />
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

      <ExportOptionsDialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        onExport={handleExportBiblatexWithFiles}
        entryCount={exportMode === "selected" ? selectedEntryIds.length : entries.length}
        isExporting={isExporting}
      />

      <ImportPreviewDialog
        open={showImportPreview}
        onOpenChange={setShowImportPreview}
        previewData={importPreviewData}
        onImport={handleConfirmBiblatexImport}
        isImporting={isImporting}
      />
    </div>
  );
}
