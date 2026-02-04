import { useState, useEffect, useCallback, useRef } from "react";
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
  Download,
  Upload,
  Trash2,
  ChevronDown,
  FolderPlus,
  FolderMinus,
  RefreshCw,
  PanelRight,
  Copy,
  CopyPlus,
  Library,
  Settings2,
  ExternalLink,
  RotateCcw,
  Pencil,
  Minus,
  LayoutGrid,
  LayoutList,
  FilePlus2,
  FileUp,
  Clock,
  Files,
  StickyNote,
  CircleSlash,
  GitMerge,
  Loader2,
  BookOpen,
  FileSearch,
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
  getEntriesPaged,
  deleteEntry,
  duplicateEntry,
  addEntryToCollection,
  removeEntryFromCollection,
  addEntryTag,
  removeEntryTag,
  importBibtex,
  importCslJson,
  showEntryInFinder,
  showEntriesInFinder,
  emptyTrash,
  restoreEntry,
  permanentDeleteEntry,
  getTrashCount,
  addPdfAttachment,
  deleteCollection,
  updateCollection,
  getCollections,
  deleteTag,
  updateTag,
  getTags,
  getEntries,
  createEntry,
  createAttachment,
  deleteAttachment,
  importAnnotationsFromPdf,
  getEntryAttachments,
  fullTextSearch,
  type ExportOptions,
  type BiblatexPreviewResult,
  type Attachment,
  type EntrySummary,
  type FullSearchResult,
} from "@/services/tauri";
import { useSchemaStore } from "@/stores/schemaStore";
import { ExportOptionsDialog } from "@/components/dialogs/ExportOptionsDialog";
import { ImportPreviewDialog } from "@/components/dialogs/ImportPreviewDialog";
import { toast } from "@/stores/toastStore";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SearchMode = "quick" | "full" | "semantic";
type QuickSearchScope = "title_creator_year" | "fields_tags";

const searchModeConfig = {
  quick: { icon: Zap, label: "Quick", description: "Title search", hasScope: true },
  full: { icon: FileSearch, label: "Full", description: "Content search" },
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

export function CommandPalette({ openMode }: { openMode?: "full" | "advanced" | "ai" } = {}) {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setSettingsOpen,
    toggleInfoPane,
    setNewCollectionDialogOpen,
    setTagManagementDialogOpen,
    setCollectionManagementDialogOpen,
    showDeleteConfirmation,
    setCommandPaletteMode,
    setAdvancedSearchOpen,
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
    trashCount,
    setTrashCount,
    activeCollectionId,
    activeTagIds,
    setTrashedEntries,
    setCollections,
    setTags,
    invalidateEntry,
    invalidateAttachments,
  } = useLibraryStore();
  const { viewModeByFilter, setViewMode, activeFilter, setActiveFilter } = useUIStore();
  const { theme, setTheme } = useSettingsStore();
  const { importFiles, importFolder } = useImport();
  const { itemTypes } = useSchemaStore();

  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("quick");
  const [quickScope, setQuickScope] = useState<QuickSearchScope>("title_creator_year");
  const [subMenu, setSubMenu] = useState<
    | "collection"
    | "tag"
    | "removeFromCollection"
    | "removeTag"
    | "exportCollection"
    | "exportTag"
    | "renameCollection"
    | "deleteCollection"
    | "renameTag"
    | "deleteTag"
    | "addAttachment"
    | "deleteAttachment"
    | "createEntryType"
    | null
  >(null);
  const [entryAttachments, setEntryAttachments] = useState<Attachment[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("all");
  const [exportContext, setExportContext] = useState<{
    type: "collection" | "tag";
    id: number;
    name: string;
  } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  // Import preview state
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<BiblatexPreviewResult | null>(null);
  const [importFolderPath, setImportFolderPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [searchResults, setSearchResults] = useState<EntrySummary[]>([]);
  const [fullSearchResults, setFullSearchResults] = useState<FullSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [isLoadingMoreResults, setIsLoadingMoreResults] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }
    if (!search.trim()) {
      setSearchResults([]);
      setFullSearchResults([]);
      setIsSearching(false);
      setSearchTotal(0);
      setSearchOffset(0);
      setHasMoreResults(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = window.setTimeout(async () => {
      try {
        if (searchMode === "full") {
          // Full text search (searches inside PDF content, notes, etc.)
          const results = await fullTextSearch(search.trim(), 50, 0);
          setFullSearchResults(results);
          setSearchResults([]);
          setSearchTotal(results.length);
          setHasMoreResults(false);
        } else {
          // Quick search (metadata only)
          const result = await getEntriesPaged({
            searchQuery: search.trim(),
            searchScope: quickScope,
            limit: 20,
            offset: 0,
          });
          setSearchResults(result.entries);
          setFullSearchResults([]);
          setSearchTotal(result.total);
          setSearchOffset(result.entries.length);
          setHasMoreResults(result.entries.length < result.total);
        }
      } catch (err) {
        console.error("Search error:", err);
        setSearchResults([]);
        setFullSearchResults([]);
        setSearchTotal(0);
        setSearchOffset(0);
        setHasMoreResults(false);
      } finally {
        setIsSearching(false);
      }
    }, 150);
  }, [search, searchMode, quickScope]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    if (openMode === "advanced") {
      // Open advanced search dialog instead
      setAdvancedSearchOpen(true);
      setCommandPaletteOpen(false);
      return;
    }
    // Only set mode if explicitly requested via openMode prop
    // Otherwise preserve the previous mode and search state
    if (openMode === "full") {
      setSearchMode("full");
    } else if (openMode === "ai") {
      setSearchMode("semantic");
    }
    // No else clause - preserve existing mode when reopening
  }, [commandPaletteOpen, openMode, setAdvancedSearchOpen, setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) return;
    setCommandPaletteMode("default");
  }, [commandPaletteOpen, setCommandPaletteMode]);

  const handleLoadMoreResults = useCallback(async () => {
    if (isLoadingMoreResults || !hasMoreResults) return;
    setIsLoadingMoreResults(true);
    try {
      const result = await getEntriesPaged({
        searchQuery: search.trim(),
        searchScope: quickScope,
        limit: 20,
        offset: searchOffset,
      });
      setSearchResults((prev) => [...prev, ...result.entries]);
      const nextOffset = searchOffset + result.entries.length;
      setSearchOffset(nextOffset);
      setSearchTotal(result.total);
      setHasMoreResults(nextOffset < result.total);
    } catch (err) {
      console.error("Load more search results failed:", err);
    } finally {
      setIsLoadingMoreResults(false);
    }
  }, [search, quickScope, searchOffset, hasMoreResults, isLoadingMoreResults]);

  const handleResultsScroll = useCallback(() => {
    const el = resultsContainerRef.current;
    if (!el || isLoadingMoreResults || !hasMoreResults) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      handleLoadMoreResults();
    }
  }, [isLoadingMoreResults, hasMoreResults, handleLoadMoreResults]);

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
          invalidateAttachments();
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
          invalidateAttachments();
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
    // Close palette and clear search first
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

  const handleConfirmBiblatexImport = async (options: import('@/components/dialogs/ImportPreviewDialog').ImportOptions) => {
    if (!importFolderPath) return;

    const { selectedKeys, importTags, excludedFiles, collectionId } = options;

    setIsImporting(true);
    try {
      const result = await importBiblatexWithFiles(
        importFolderPath,
        importFolderPath,
        selectedKeys,
        importTags,
        excludedFiles,
        collectionId
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

      // Invalidate attachment cache so expanded rows refetch attachment names
      invalidateAttachments();
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

  // ==================== NEW HANDLERS ====================

  // Show in Finder handler
  const handleShowInFinder = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      if (selectedEntryIds.length === 1) {
        await showEntryInFinder(selectedEntryIds[0]);
      } else {
        await showEntriesInFinder(selectedEntryIds);
      }
    } catch (err) {
      console.error("Show in Finder error:", err);
      toast.error("Failed to show in Finder");
    }
    setCommandPaletteOpen(false);
  };

  // Copy title(s) handler
  const handleCopyTitle = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    const selectedEntries = entries.filter((e) => selectedEntryIds.includes(e.id));
    const titles = selectedEntries.map((e) => e.title).join("\n");
    try {
      await writeText(titles);
      toast.success(selectedEntryIds.length > 1 ? `${selectedEntryIds.length} titles copied` : "Title copied");
    } catch (err) {
      console.error("Copy title error:", err);
      toast.error("Failed to copy title");
    }
    setCommandPaletteOpen(false);
  };

  // Empty trash handler
  const handleEmptyTrash = async () => {
    if (trashCount === 0) {
      toast.info("Trash is already empty");
      return;
    }
    try {
      await emptyTrash();
      setTrashCount(0);
      setTrashedEntries([]);
      toast.success("Trash emptied");
      await refreshLibrary();
    } catch (err) {
      console.error("Empty trash error:", err);
      toast.error("Failed to empty trash");
    }
    setCommandPaletteOpen(false);
  };

  // Restore from trash handler (for trash view)
  const handleRestoreFromTrash = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      for (const id of selectedEntryIds) {
        await restoreEntry(id);
      }
      toast.success(`Restored ${selectedEntryIds.length} entries from trash`);
      const count = await getTrashCount();
      setTrashCount(count);
      clearSelection();
      await refreshLibrary();
    } catch (err) {
      console.error("Restore error:", err);
      toast.error("Failed to restore entries");
    }
    setCommandPaletteOpen(false);
  };

  // Permanent delete handler (for trash view)
  const handlePermanentDelete = async () => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      for (const id of selectedEntryIds) {
        await permanentDeleteEntry(id);
      }
      toast.success(`Permanently deleted ${selectedEntryIds.length} entries`);
      const count = await getTrashCount();
      setTrashCount(count);
      clearSelection();
      await refreshLibrary();
    } catch (err) {
      console.error("Permanent delete error:", err);
      toast.error("Failed to permanently delete entries");
    }
    setCommandPaletteOpen(false);
  };

  // Add PDF attachment handler
  const handleAddPdfAttachment = async () => {
    if (selectedEntryIds.length !== 1) {
      toast.warning("Select exactly one entry to add attachment");
      return;
    }
    setCommandPaletteOpen(false);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") {
        await addPdfAttachment(selectedEntryIds[0], selected);
        invalidateAttachments();
        await refreshLibrary();
        toast.success("PDF attached");
      }
    } catch (err) {
      console.error("Add PDF attachment error:", err);
      toast.error("Failed to attach PDF");
    }
  };

  // Remove from collection handler
  const handleRemoveFromCollection = async (collectionId: number) => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      for (const entryId of selectedEntryIds) {
        await removeEntryFromCollection(entryId, collectionId);
      }
      toast.success(`Removed ${selectedEntryIds.length} entries from collection`);
      const allCollections = await getCollections();
      setCollections(allCollections);
      await refreshLibrary();
    } catch (err) {
      console.error("Remove from collection error:", err);
      toast.error("Failed to remove from collection");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Remove tag handler
  const handleRemoveTag = async (tagId: number) => {
    if (selectedEntryIds.length === 0) {
      toast.warning("No entries selected");
      return;
    }
    try {
      for (const entryId of selectedEntryIds) {
        await removeEntryTag(entryId, tagId);
      }
      const allTags = await getTags();
      setTags(allTags);
      toast.success(`Removed tag from ${selectedEntryIds.length} entries`);
      await refreshLibrary();
    } catch (err) {
      console.error("Remove tag error:", err);
      toast.error("Failed to remove tag");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Export collection handler
  const handleExportCollection = async (collectionId: number, collectionName: string, format: "bibtex" | "csl") => {
    try {
      const collectionEntries = await getEntries({ collectionId });
      const entryIds = collectionEntries.map((e) => e.id);
      if (entryIds.length === 0) {
        toast.warning("No entries in this collection");
        return;
      }
      const content = format === "bibtex" ? await exportToBibtex(entryIds) : await exportToCslJson(entryIds);
      const ext = format === "bibtex" ? "bib" : "json";
      const filterName = format === "bibtex" ? "BibTeX" : "CSL JSON";
      const filePath = await save({
        defaultPath: `${collectionName}.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
        toast.success(`Exported collection "${collectionName}"`);
      }
    } catch (err) {
      console.error("Export collection error:", err);
      toast.error("Failed to export collection");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Export tag handler
  const handleExportTag = async (tagId: number, tagName: string, format: "bibtex" | "csl") => {
    try {
      const tagEntries = await getEntries({ tagIds: [tagId] });
      const entryIds = tagEntries.map((e) => e.id);
      if (entryIds.length === 0) {
        toast.warning("No entries with this tag");
        return;
      }
      const content = format === "bibtex" ? await exportToBibtex(entryIds) : await exportToCslJson(entryIds);
      const ext = format === "bibtex" ? "bib" : "json";
      const filterName = format === "bibtex" ? "BibTeX" : "CSL JSON";
      const filePath = await save({
        defaultPath: `${tagName}.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
        toast.success(`Exported tag "${tagName}"`);
      }
    } catch (err) {
      console.error("Export tag error:", err);
      toast.error("Failed to export tag");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Export collection with files handler
  const handleExportCollectionWithFiles = (collectionId: number, collectionName: string) => {
    setExportContext({ type: "collection", id: collectionId, name: collectionName });
    setShowExportDialog(true);
    setSubMenu(null);
  };

  // Export tag with files handler
  const handleExportTagWithFiles = (tagId: number, tagName: string) => {
    setExportContext({ type: "tag", id: tagId, name: tagName });
    setShowExportDialog(true);
    setSubMenu(null);
  };

  // Rename collection handler
  const handleRenameCollection = async (collectionId: number) => {
    if (!renameInput.trim()) return;
    try {
      await updateCollection(collectionId, { name: renameInput.trim() });
      const allCollections = await getCollections();
      setCollections(allCollections);
      toast.success("Collection renamed");
    } catch (err) {
      console.error("Rename collection error:", err);
      toast.error("Failed to rename collection");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
    setRenameInput("");
    setSelectedItemId(null);
  };

  // Delete collection handler
  const handleDeleteCollection = async (collectionId: number, collectionName: string) => {
    try {
      await deleteCollection(collectionId);
      const allCollections = await getCollections();
      setCollections(allCollections);
      toast.success(`Collection "${collectionName}" deleted`);
      await refreshLibrary();
    } catch (err) {
      console.error("Delete collection error:", err);
      toast.error("Failed to delete collection");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Rename tag handler
  const handleRenameTag = async (tagId: number) => {
    if (!renameInput.trim()) return;
    try {
      await updateTag(tagId, renameInput.trim());
      const allTags = await getTags();
      setTags(allTags);
      invalidateEntry();
      await refreshLibrary();
      toast.success("Tag renamed");
    } catch (err) {
      console.error("Rename tag error:", err);
      toast.error("Failed to rename tag");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
    setRenameInput("");
    setSelectedItemId(null);
  };

  // Delete tag handler
  const handleDeleteTag = async (tagId: number, tagName: string) => {
    try {
      await deleteTag(tagId);
      const allTags = await getTags();
      setTags(allTags);
      invalidateEntry();
      await refreshLibrary();
      toast.success(`Tag "${tagName}" deleted`);
    } catch (err) {
      console.error("Delete tag error:", err);
      toast.error("Failed to delete tag");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  // Toggle view mode handler
  const handleToggleViewMode = () => {
    const currentMode = viewModeByFilter[activeFilter];
    setViewMode(currentMode === "list" ? "card" : "list");
    setCommandPaletteOpen(false);
  };


  // Import PDF annotations handler
  const handleImportPdfAnnotations = async () => {
    if (selectedEntryIds.length !== 1) {
      toast.warning("Select exactly one entry to import annotations");
      return;
    }
    try {
      // Get the entry's attachments to find PDF
      const attachments = await getEntryAttachments(selectedEntryIds[0]);
      const pdfAttachment = attachments.find((a) => a.attachmentType === "pdf");
      if (!pdfAttachment) {
        toast.warning("Selected entry has no PDF attachment");
        return;
      }
      const imported = await importAnnotationsFromPdf(pdfAttachment.id);
      if (imported.length > 0) {
        toast.success(`Imported ${imported.length} annotations from PDF`);
      } else {
        toast.info("No annotations found in PDF");
      }
    } catch (err) {
      console.error("Import annotations error:", err);
      toast.error("Failed to import PDF annotations");
    }
    setCommandPaletteOpen(false);
  };

  // Create note for entry handler
  const handleCreateNote = async () => {
    if (selectedEntryIds.length !== 1) {
      toast.warning("Select exactly one entry to create a note");
      return;
    }
    const selectedEntry = entries.find((e) => e.id === selectedEntryIds[0]);
    if (!selectedEntry) return;

    try {
      const note = await createAttachment({
        entryId: selectedEntry.id,
        attachmentType: "note",
        title: `Notes - ${selectedEntry.title}`,
      });
      invalidateAttachments();
      await refreshLibrary();
      // Open the note in a new tab
      openTab({
        type: "entry",
        title: note.title || `Notes - ${selectedEntry.title}`,
        entryId: String(selectedEntry.id),
        attachmentId: String(note.id),
      });
      toast.success("Note created");
    } catch (err) {
      console.error("Create note error:", err);
      toast.error("Failed to create note");
    }
    setCommandPaletteOpen(false);
  };

  // Navigation handler
  const handleNavigateTo = (filter: 'all' | 'pdfs' | 'notes' | 'recent' | 'untagged' | 'duplicates' | 'trash') => {
    setActiveFilter(filter);
    setCommandPaletteOpen(false);
  };

  // Load attachments for delete attachment submenu
  const handleOpenDeleteAttachment = async () => {
    if (selectedEntryIds.length !== 1) {
      toast.warning("Select exactly one entry to delete an attachment");
      return;
    }
    try {
      const attachments = await getEntryAttachments(selectedEntryIds[0]);
      if (attachments.length === 0) {
        toast.info("Selected entry has no attachments");
        return;
      }
      setEntryAttachments(attachments);
      setSubMenu("deleteAttachment");
    } catch (err) {
      console.error("Failed to load attachments:", err);
      toast.error("Failed to load attachments");
    }
  };

  // Delete attachment handler
  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      await deleteAttachment(attachmentId);
      invalidateAttachments();
      await refreshLibrary();
      toast.success("Attachment deleted");
    } catch (err) {
      console.error("Delete attachment error:", err);
      toast.error("Failed to delete attachment");
    }
    setCommandPaletteOpen(false);
    setSubMenu(null);
    setEntryAttachments([]);
  };

  // Create entry with specific type handler
  const handleCreateEntryWithType = async (itemType: string) => {
    setCommandPaletteOpen(false);
    setSubMenu(null);
    try {
      const newEntry = await createEntry({
        itemType,
        title: "New Reference",
      });
      await refreshLibrary();
      toast.success(`${itemType} reference created`);
      // Open the new entry in a tab for editing
      openTab({
        type: "entry",
        title: newEntry.title,
        entryId: String(newEntry.id),
      });
    } catch (err) {
      console.error("Create reference error:", err);
      toast.error("Failed to create reference");
    }
  };

  // Export with context (collection or tag with files)
  const handleExportWithContext = async (options: ExportOptions) => {
    if (!exportContext) {
      // Fall back to regular export
      await handleExportBiblatexWithFiles(options);
      return;
    }
    try {
      setIsExporting(true);
      const outputDir = await open({
        directory: true,
        title: "Select Export Folder",
      });
      if (outputDir) {
        let entryIds: number[] = [];
        if (exportContext.type === "collection") {
          const collectionEntries = await getEntries({ collectionId: exportContext.id });
          entryIds = collectionEntries.map((e) => e.id);
        } else if (exportContext.type === "tag") {
          const tagEntries = await getEntries({ tagIds: [exportContext.id] });
          entryIds = tagEntries.map((e) => e.id);
        }
        if (entryIds.length === 0) {
          toast.warning("No entries to export");
          return;
        }
        const result = await exportToBiblatexWithFiles(entryIds, outputDir, options);
        toast.success(
          `Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`
        );
        setShowExportDialog(false);
        setExportContext(null);
      }
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Failed to export");
    } finally {
      setIsExporting(false);
    }
    setCommandPaletteOpen(false);
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

  // Render dialogs even when command palette is closed
  // This ensures ImportPreviewDialog shows after selecting a folder
  if (!commandPaletteOpen) {
    return (
      <>
        <ExportOptionsDialog
          open={showExportDialog}
          onClose={() => { setShowExportDialog(false); setExportContext(null); }}
          onExport={exportContext ? handleExportWithContext : handleExportBiblatexWithFiles}
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
      </>
    );
  }

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
                      style={{ backgroundColor: (tag.color || !tag.isImported) ? `${tag.color || '#3B82F6'}20` : 'transparent' }}
                    >
                      <Tag className="h-4 w-4" style={{ color: (tag.color || !tag.isImported) ? (tag.color || '#3B82F6') : 'var(--muted-foreground)' }} />
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

  // Sub-menu for removing from collection
  if (subMenu === "removeFromCollection") {
    // Get collections that the selected entries belong to
    const relevantCollections = activeCollectionId
      ? collections.filter(c => c.id === activeCollectionId)
      : collections;
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <FolderMinus className="h-5 w-5 text-primary shrink-0" />
              <span className="text-base">Remove from Collection</span>
              <button
                onClick={() => setSubMenu(null)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {relevantCollections.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No collections available.
                </div>
              ) : (
                relevantCollections.map((collection) => (
                  <Command.Item
                    key={collection.id}
                    onSelect={() => handleRemoveFromCollection(collection.id)}
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

  // Sub-menu for removing tags
  if (subMenu === "removeTag") {
    // Get tags from selected entries or active tag filter
    const relevantTags = activeTagIds.length > 0
      ? tags.filter(t => activeTagIds.includes(t.id))
      : tags;
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Minus className="h-5 w-5 text-primary shrink-0" />
              <span className="text-base">Remove Tag</span>
              <button
                onClick={() => setSubMenu(null)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {relevantTags.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No tags to remove.
                </div>
              ) : (
                relevantTags.map((tag) => (
                  <Command.Item
                    key={tag.id}
                    onSelect={() => handleRemoveTag(tag.id)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div
                      className="flex items-center justify-center h-8 w-8 rounded-lg"
                      style={{ backgroundColor: tag.color ? `${tag.color}20` : 'transparent' }}
                    >
                      <Tag className="h-4 w-4" style={{ color: tag.color || 'var(--muted-foreground)' }} />
                    </div>
                    <span className="text-sm font-medium">{tag.name}</span>
                  </Command.Item>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for exporting collection
  if (subMenu === "exportCollection") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Download className="h-5 w-5 text-primary shrink-0" />
              <span className="text-base">Export Collection</span>
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
                  No collections available.
                </div>
              ) : (
                collections.map((collection) => (
                  <div key={collection.id} className="mb-2">
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                      <Library className="h-3 w-3" style={{ color: collection.color || '#8B5CF6' }} />
                      {collection.name} ({collection.itemCount})
                    </div>
                    <Command.Item
                      onSelect={() => handleExportCollection(collection.id, collection.name, "bibtex")}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4"
                    >
                      <span className="text-sm">Export as BibTeX</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => handleExportCollection(collection.id, collection.name, "csl")}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4"
                    >
                      <span className="text-sm">Export as CSL JSON</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => handleExportCollectionWithFiles(collection.id, collection.name)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4"
                    >
                      <span className="text-sm">Export with Files...</span>
                    </Command.Item>
                  </div>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for exporting tag
  if (subMenu === "exportTag") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Download className="h-5 w-5 text-primary shrink-0" />
              <span className="text-base">Export Tag</span>
              <button
                onClick={() => setSubMenu(null)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {tags.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No tags available.
                </div>
              ) : (
                tags.map((tag) => (
                  <div key={tag.id} className="mb-2">
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                      <Tag className="h-3 w-3" style={{ color: tag.color || 'var(--muted-foreground)' }} />
                      {tag.name} ({tag.itemCount})
                    </div>
                    <Command.Item
                      onSelect={() => handleExportTag(tag.id, tag.name, "bibtex")}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4"
                    >
                      <span className="text-sm">Export as BibTeX</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => handleExportTag(tag.id, tag.name, "csl")}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4"
                    >
                      <span className="text-sm">Export as CSL JSON</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => handleExportTagWithFiles(tag.id, tag.name)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4"
                    >
                      <span className="text-sm">Export with Files...</span>
                    </Command.Item>
                  </div>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for renaming collection
  if (subMenu === "renameCollection") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); setRenameInput(""); setSelectedItemId(null); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Pencil className="h-5 w-5 text-primary shrink-0" />
              <span className="text-base">Rename Collection</span>
              <button
                onClick={() => { setSubMenu(null); setRenameInput(""); setSelectedItemId(null); }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {selectedItemId ? (
                <div className="p-3">
                  <input
                    value={renameInput}
                    onChange={(e) => setRenameInput(e.target.value)}
                    placeholder="New collection name..."
                    className="w-full px-3 py-2 text-sm bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameInput.trim()) {
                        handleRenameCollection(selectedItemId);
                      }
                    }}
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => { setSelectedItemId(null); setRenameInput(""); }}
                      className="flex-1 px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRenameCollection(selectedItemId)}
                      disabled={!renameInput.trim()}
                      className="flex-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                      Rename
                    </button>
                  </div>
                </div>
              ) : (
                collections.map((collection) => (
                  <Command.Item
                    key={collection.id}
                    onSelect={() => { setSelectedItemId(collection.id); setRenameInput(collection.name); }}
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

  // Sub-menu for deleting collection
  if (subMenu === "deleteCollection") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0" />
              <span className="text-base">Delete Collection</span>
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
                  No collections available.
                </div>
              ) : (
                collections.map((collection) => (
                  <Command.Item
                    key={collection.id}
                    onSelect={() => handleDeleteCollection(collection.id, collection.name)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-destructive/10 hover:bg-destructive/5"
                  >
                    <div
                      className="flex items-center justify-center h-8 w-8 rounded-lg"
                      style={{ backgroundColor: `${collection.color || '#8B5CF6'}20` }}
                    >
                      <Library className="h-4 w-4" style={{ color: collection.color || '#8B5CF6' }} />
                    </div>
                    <span className="text-sm font-medium">{collection.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{collection.itemCount} items</span>
                  </Command.Item>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for renaming tag
  if (subMenu === "renameTag") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); setRenameInput(""); setSelectedItemId(null); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Pencil className="h-5 w-5 text-primary shrink-0" />
              <span className="text-base">Rename Tag</span>
              <button
                onClick={() => { setSubMenu(null); setRenameInput(""); setSelectedItemId(null); }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {selectedItemId ? (
                <div className="p-3">
                  <input
                    value={renameInput}
                    onChange={(e) => setRenameInput(e.target.value)}
                    placeholder="New tag name..."
                    className="w-full px-3 py-2 text-sm bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameInput.trim()) {
                        handleRenameTag(selectedItemId);
                      }
                    }}
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => { setSelectedItemId(null); setRenameInput(""); }}
                      className="flex-1 px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRenameTag(selectedItemId)}
                      disabled={!renameInput.trim()}
                      className="flex-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                      Rename
                    </button>
                  </div>
                </div>
              ) : (
                tags.map((tag) => (
                  <Command.Item
                    key={tag.id}
                    onSelect={() => { setSelectedItemId(tag.id); setRenameInput(tag.name); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div
                      className="flex items-center justify-center h-8 w-8 rounded-lg"
                      style={{ backgroundColor: tag.color ? `${tag.color}20` : 'transparent' }}
                    >
                      <Tag className="h-4 w-4" style={{ color: tag.color || 'var(--muted-foreground)' }} />
                    </div>
                    <span className="text-sm font-medium">{tag.name}</span>
                  </Command.Item>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for deleting tag
  if (subMenu === "deleteTag") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0" />
              <span className="text-base">Delete Tag</span>
              <button
                onClick={() => setSubMenu(null)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {tags.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No tags available.
                </div>
              ) : (
                tags.map((tag) => (
                  <Command.Item
                    key={tag.id}
                    onSelect={() => handleDeleteTag(tag.id, tag.name)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-destructive/10 hover:bg-destructive/5"
                  >
                    <div
                      className="flex items-center justify-center h-8 w-8 rounded-lg"
                      style={{ backgroundColor: tag.color ? `${tag.color}20` : 'transparent' }}
                    >
                      <Tag className="h-4 w-4" style={{ color: tag.color || 'var(--muted-foreground)' }} />
                    </div>
                    <span className="text-sm font-medium">{tag.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{tag.itemCount} items</span>
                  </Command.Item>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for deleting attachment
  if (subMenu === "deleteAttachment") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); setEntryAttachments([]); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0" />
              <span className="text-base">Delete Attachment</span>
              <button
                onClick={() => { setSubMenu(null); setEntryAttachments([]); }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {entryAttachments.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No attachments available.
                </div>
              ) : (
                entryAttachments.map((attachment) => (
                  <Command.Item
                    key={attachment.id}
                    onSelect={() => handleDeleteAttachment(attachment.id)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-destructive/10 hover:bg-destructive/5"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                      {attachment.attachmentType === "pdf" ? (
                        <File className="h-4 w-4 text-red-500" />
                      ) : attachment.attachmentType === "note" ? (
                        <StickyNote className="h-4 w-4 text-yellow-500" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{attachment.title || attachment.filePath || "Untitled"}</span>
                      <span className="text-xs text-muted-foreground">{attachment.attachmentTypeDisplay}</span>
                    </div>
                  </Command.Item>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    );
  }

  // Sub-menu for selecting entry type when creating
  if (subMenu === "createEntryType") {
    return (
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
        />
        <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
          <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <FilePlus2 className="h-5 w-5 text-green-500 shrink-0" />
              <span className="text-base">Select Reference Type</span>
              <button
                onClick={() => setSubMenu(null)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto p-2">
              {itemTypes.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No entry types available.
                </div>
              ) : (
                itemTypes.map((type) => (
                  <Command.Item
                    key={type.id}
                    onSelect={() => handleCreateEntryWithType(type.name)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
                      <FileText className="h-4 w-4 text-green-500" />
                    </div>
                    <span className="text-sm font-medium">{type.displayName}</span>
                  </Command.Item>
                ))
              )}
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
          shouldFilter={false}
          className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden"
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
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
                {(["quick", "full", "semantic"] as const).map((mode) => {
                  const config = searchModeConfig[mode];
                  const Icon = config.icon;
                  const isActive = searchMode === mode;
                  const buttonClasses = cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  );

                  if (mode === "quick") {
                    // Split button: main part switches mode, chevron opens scope dropdown
                    return (
                      <div key={mode} className="flex">
                        <button
                          onClick={() => {
                            setSearchMode("quick");
                            setQuickScope("title_creator_year");
                          }}
                          title={config.description}
                          className={cn(
                            "flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-l-md transition-all",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{config.label}</span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              title="Change search scope"
                              className={cn(
                                "flex items-center px-1 py-1.5 text-xs font-medium rounded-r-md transition-all border-l",
                                isActive
                                  ? "bg-primary text-primary-foreground shadow-sm border-primary-foreground/20"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
                              )}
                            >
                              <ChevronDown className="h-3 w-3 opacity-70" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[220px]">
                            <DropdownMenuItem onClick={() => {
                              setSearchMode("quick");
                              setQuickScope("title_creator_year");
                            }}>
                              Title, Creator, Year
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              setSearchMode("quick");
                              setQuickScope("fields_tags");
                            }}>
                              All Fields &amp; Tags
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={mode}
                      onClick={() => setSearchMode(mode)}
                      title={config.description}
                      className={buttonClasses}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{config.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Results */}
          <Command.List
            ref={resultsContainerRef}
            onScroll={handleResultsScroll}
            className="max-h-[400px] overflow-y-auto p-2 scrollbar-hidden"
          >
            <Command.Empty className="py-12 text-center">
              <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              {isSearching ? (
                <p className="text-sm text-muted-foreground">Searching…</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No results found</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Try adjusting your search or import new PDFs
                  </p>
                </>
              )}
            </Command.Empty>

            {/* Search results */}
            {searchResults.length > 0 && (
              <Command.Group>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  Entries
                </div>
                {searchResults.map((entry) => (
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
                {searchTotal > 0 && (
                  <div className="px-3 py-2.5 text-xs text-muted-foreground">
                    {isLoadingMoreResults ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading more…
                      </span>
                    ) : (
                      `Showing ${searchResults.length} of ${searchTotal}`
                    )}
                  </div>
                )}
              </Command.Group>
            )}

            {/* Full search results (content search) */}
            {fullSearchResults.length > 0 && (
              <Command.Group>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  Content Matches ({fullSearchResults.length})
                </div>
                {fullSearchResults.map((result, idx) => (
                  <Command.Item
                    key={`${result.entryId}-${result.attachmentId ?? 'meta'}-${idx}`}
                    value={`${result.title} ${result.snippet}`}
                    onSelect={() =>
                      handleSelect(() =>
                        openTab({
                          type: "entry",
                          title: result.title || "Untitled",
                          entryId: String(result.entryId),
                          // Pass attachmentId to open the specific attachment where match was found
                          attachmentId: result.attachmentId ? String(result.attachmentId) : undefined,
                        })
                      )
                    }
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className={cn(
                      "flex items-center justify-center h-8 w-8 rounded-lg mt-0.5",
                      result.contentSource === "pdf" ? "bg-red-500/10" : "bg-primary/10"
                    )}>
                      {result.contentSource === "pdf" ? (
                        <File className="h-4 w-4 text-red-500" />
                      ) : result.contentSource === "note" ? (
                        <StickyNote className="h-4 w-4 text-primary" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{result.title || "Untitled"}</span>
                      {result.snippet && (
                        <p
                          className="text-xs text-muted-foreground line-clamp-2 mt-0.5"
                          dangerouslySetInnerHTML={{ __html: result.snippet }}
                        />
                      )}
                      <span className="text-xs text-muted-foreground/60 mt-0.5">
                        {result.contentSource} · score: {result.score.toFixed(2)}
                      </span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Commands */}
            <>
              {/* Actions on selected entries */}
              {selectedEntryIds.length > 0 && activeFilter !== "trash" && (
                  <Command.Group>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                      Selected ({selectedEntryIds.length})
                    </div>
                    <Command.Item
                      value="show in finder reveal files"
                      onSelect={handleShowInFinder}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                        <ExternalLink className="h-4 w-4 text-blue-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Show in Finder</span>
                      </div>
                      <ShortcutBadge keys={["⌘", "⇧", "R"]} />
                    </Command.Item>
                    <Command.Item
                      value="copy title clipboard"
                      onSelect={handleCopyTitle}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-cyan-500/10">
                        <Copy className="h-4 w-4 text-cyan-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Copy Title{selectedEntryIds.length > 1 ? "s" : ""}</span>
                      </div>
                      <ShortcutBadge keys={["⌘", "⇧", "T"]} />
                    </Command.Item>
                    <Command.Item
                      value="add to collection folder"
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
                    {(activeCollectionId || collections.length > 0) && (
                      <Command.Item
                        value="remove from collection folder"
                        onSelect={() => activeCollectionId ? handleRemoveFromCollection(activeCollectionId) : setSubMenu("removeFromCollection")}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-orange-500/10">
                          <FolderMinus className="h-4 w-4 text-orange-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Remove from Collection</span>
                        </div>
                      </Command.Item>
                    )}
                    <Command.Item
                      value="add tag label"
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
                    {(activeTagIds.length > 0 || tags.length > 0) && (
                      <Command.Item
                        value="remove tag label"
                        onSelect={() => activeTagIds.length === 1 ? handleRemoveTag(activeTagIds[0]) : setSubMenu("removeTag")}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-orange-500/10">
                          <Minus className="h-4 w-4 text-orange-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Remove Tag</span>
                        </div>
                      </Command.Item>
                    )}
                    {selectedEntryIds.length === 1 && (
                      <>
                        <Command.Item
                          value="add pdf attachment file"
                          onSelect={handleAddPdfAttachment}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                        >
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                            <FileUp className="h-4 w-4 text-red-500" />
                          </div>
                          <div className="flex-1">
                            <span className="block text-sm font-medium">Add PDF Attachment</span>
                          </div>
                          <ShortcutBadge keys={["⌘", "⇧", "A"]} />
                        </Command.Item>
                        <Command.Item
                          value="import pdf annotations highlights"
                          onSelect={handleImportPdfAnnotations}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                        >
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-yellow-500/10">
                            <FileText className="h-4 w-4 text-yellow-500" />
                          </div>
                          <div className="flex-1">
                            <span className="block text-sm font-medium">Import PDF Annotations</span>
                          </div>
                        </Command.Item>
                        <Command.Item
                          value="create note add notes"
                          onSelect={handleCreateNote}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                        >
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
                            <StickyNote className="h-4 w-4 text-green-500" />
                          </div>
                          <div className="flex-1">
                            <span className="block text-sm font-medium">Create Note</span>
                          </div>
                        </Command.Item>
                        <Command.Item
                          value="delete attachment remove file"
                          onSelect={handleOpenDeleteAttachment}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                        >
                          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </div>
                          <div className="flex-1">
                            <span className="block text-sm font-medium">Delete Attachment...</span>
                          </div>
                        </Command.Item>
                        <Command.Item
                          value="duplicate entry copy"
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
                      </>
                    )}
                    <Command.Item
                      value="delete move trash"
                      onSelect={handleDeleteSelected}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Move to Trash</span>
                      </div>
                      <ShortcutBadge keys={["⌫"]} />
                    </Command.Item>
                  </Command.Group>
                )}

              {/* Actions for trash view */}
              {activeFilter === "trash" && selectedEntryIds.length > 0 && (
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Trash ({selectedEntryIds.length} selected)
                  </div>
                  <Command.Item
                    value="restore from trash undo"
                    onSelect={handleRestoreFromTrash}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
                      <RotateCcw className="h-4 w-4 text-green-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Restore from Trash</span>
                    </div>
                    <ShortcutBadge keys={["⌘", "⇧", "Z"]} />
                  </Command.Item>
                  <Command.Item
                    value="permanent delete forever"
                    onSelect={handlePermanentDelete}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Permanently Delete</span>
                      <span className="text-xs text-muted-foreground">Cannot be undone</span>
                    </div>
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
                        value="export selected bibtex"
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
                        value="export selected csl json"
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
                        value="copy bibtex clipboard"
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
                        value="copy csl json clipboard"
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
                        value="export selected biblatex files attachments"
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
                    value="export all bibtex library"
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
                    value="export all csl json library"
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
                    value="export all biblatex files attachments library"
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
                  {collections.length > 0 && (
                    <Command.Item
                      value="export collection folder"
                      onSelect={() => setSubMenu("exportCollection")}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10">
                        <Library className="h-4 w-4 text-violet-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Export Collection...</span>
                        <span className="text-xs text-muted-foreground">Export a specific collection</span>
                      </div>
                    </Command.Item>
                  )}
                  {tags.length > 0 && (
                    <Command.Item
                      value="export tag label"
                      onSelect={() => setSubMenu("exportTag")}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                        <Tag className="h-4 w-4 text-blue-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Export Tag...</span>
                        <span className="text-xs text-muted-foreground">Export entries with a specific tag</span>
                      </div>
                    </Command.Item>
                  )}
                </Command.Group>

                {/* Create commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Create
                  </div>
                  <Command.Item
                    value="create new reference manual entry type"
                    onSelect={() => setSubMenu("createEntryType")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
                      <FilePlus2 className="h-4 w-4 text-green-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Create Manual Reference...</span>
                      <span className="text-xs text-muted-foreground">Select entry type and add manually</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    value="import pdf add document"
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
                    value="import folder pdfs multiple"
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
                    value="import bibtex bib references"
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
                    value="import csl json references"
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
                    value="import biblatex files zotero pdfs attachments"
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
                    value="new collection create organize"
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
                    value="manage tags edit merge delete colors"
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
                    value="create tag new add"
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
                  {tags.length > 0 && (
                    <>
                      <Command.Item
                        value="rename tag edit name"
                        onSelect={() => setSubMenu("renameTag")}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                          <Pencil className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Rename Tag...</span>
                        </div>
                      </Command.Item>
                      <Command.Item
                        value="delete tag remove"
                        onSelect={() => setSubMenu("deleteTag")}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Delete Tag...</span>
                        </div>
                      </Command.Item>
                    </>
                  )}
                </Command.Group>

                {/* Collections commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Collections
                  </div>
                  <Command.Item
                    value="manage collections edit merge delete colors"
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
                    value="create collection new add organize"
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
                  {collections.length > 0 && (
                    <>
                      <Command.Item
                        value="rename collection edit name"
                        onSelect={() => setSubMenu("renameCollection")}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10">
                          <Pencil className="h-4 w-4 text-violet-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Rename Collection...</span>
                        </div>
                      </Command.Item>
                      <Command.Item
                        value="delete collection remove"
                        onSelect={() => setSubMenu("deleteCollection")}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </div>
                        <div className="flex-1">
                          <span className="block text-sm font-medium">Delete Collection...</span>
                        </div>
                      </Command.Item>
                    </>
                  )}
                </Command.Group>

                {/* Utility commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    View
                  </div>
                  <Command.Item
                    value="toggle info panel sidebar details"
                    onSelect={() => handleSelect(() => toggleInfoPane())}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      <PanelRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Toggle Info Panel</span>
                    </div>
                    <ShortcutBadge keys={["⌘", "I"]} />
                  </Command.Item>
                  <Command.Item
                    value="toggle view mode list card grid table"
                    onSelect={handleToggleViewMode}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      {viewModeByFilter[activeFilter] === "list" ? (
                        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <LayoutList className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Toggle View Mode</span>
                      <span className="text-xs text-muted-foreground">
                        Current: {viewModeByFilter[activeFilter] === "list" ? "List" : "Card"}
                      </span>
                    </div>
                    <ShortcutBadge keys={["⌘", "⇧", "V"]} />
                  </Command.Item>
                  <Command.Item
                    value="refresh library reload sync"
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
                  {trashCount > 0 && (
                    <Command.Item
                      value="empty trash clear delete permanently"
                      onSelect={handleEmptyTrash}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </div>
                      <div className="flex-1">
                        <span className="block text-sm font-medium">Empty Trash</span>
                        <span className="text-xs text-muted-foreground">{trashCount} items in trash</span>
                      </div>
                    </Command.Item>
                  )}
                </Command.Group>

                {/* Navigation commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Navigate
                  </div>
                  <Command.Item
                    value="go to all items library"
                    onSelect={() => handleNavigateTo("all")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      <Library className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Go to All Items</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    value="go to pdfs documents files"
                    onSelect={() => handleNavigateTo("pdfs")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                      <Files className="h-4 w-4 text-red-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Go to PDFs</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    value="go to notes documents"
                    onSelect={() => handleNavigateTo("notes")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-yellow-500/10">
                      <StickyNote className="h-4 w-4 text-yellow-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Go to Notes</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    value="go to recently added recent"
                    onSelect={() => handleNavigateTo("recent")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                      <Clock className="h-4 w-4 text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Go to Recently Added</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    value="go to untagged no tags"
                    onSelect={() => handleNavigateTo("untagged")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                      <CircleSlash className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Go to Untagged</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    value="go to duplicates merge"
                    onSelect={() => handleNavigateTo("duplicates")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10">
                      <GitMerge className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Go to Duplicates</span>
                    </div>
                  </Command.Item>
                  <Command.Item
                    value="go to trash deleted"
                    onSelect={() => handleNavigateTo("trash")}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Go to Trash</span>
                      {trashCount > 0 && (
                        <span className="text-xs text-muted-foreground">{trashCount} items</span>
                      )}
                    </div>
                  </Command.Item>
                </Command.Group>

                {/* Search commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Search
                  </div>
                  <Command.Item
                    value="advanced search filter criteria smart"
                    onSelect={() =>
                      handleSelect(() => setAdvancedSearchOpen(true))
                    }
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
                      <BookOpen className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm font-medium">Advanced Search</span>
                      <span className="text-xs text-muted-foreground">Search with multiple criteria</span>
                    </div>
                    <ShortcutBadge keys={["⌘", "⇧", "F"]} />
                  </Command.Item>
                </Command.Group>

                {/* Settings commands */}
                <Command.Group>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    Settings
                  </div>
                  <Command.Item
                    value="toggle theme dark light mode appearance"
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
                    value="settings preferences configure options"
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
        onClose={() => { setShowExportDialog(false); setExportContext(null); }}
        onExport={exportContext ? handleExportWithContext : handleExportBiblatexWithFiles}
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
