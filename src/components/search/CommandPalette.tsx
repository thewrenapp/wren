import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Command } from "cmdk";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSchemaStore } from "@/stores/schemaStore";
import { ExportOptionsDialog } from "@/components/dialogs/ExportOptionsDialog";
import { ImportPreviewDialog } from "@/components/dialogs/ImportPreviewDialog";
import { toast } from "@/stores/toastStore";
import {
  importBiblatexWithFiles,
  exportToBiblatexWithFiles,
  exportAllToBiblatexWithFiles,
  getEntries,
  ragIndexAll, ragRebuild, reindexAttachment,
  showEntryInFinder, getEntry,
  type ExportOptions, type BiblatexPreviewResult, type Attachment,
} from "@/services/tauri";
import {
  useSearchState, useSearchEffects, SearchInput, SearchResults, hasSearchResults,
} from "./CommandPaletteSearch";
import {
  SubMenuRenderer, CommandGroups, type SubMenu, type CommandsProps,
} from "./CommandPaletteCommands";
import { useCommandPaletteActions } from "./useCommandPaletteActions";
import { useTabTypeLabels, useViewerContext } from "./useViewerContext";

export function CommandPalette({ openMode }: { openMode?: "full" | "advanced" | "ai" } = {}) {
  const {
    commandPaletteOpen, setCommandPaletteOpen, setSettingsOpen, toggleInfoPane,
    libraryInfoPaneEnabled, toggleLibraryInfoPane, setNewCollectionDialogOpen,
    setTagManagementDialogOpen, setCollectionManagementDialogOpen,
    setCommandPaletteMode, setAdvancedSearchOpen, toggleSidebar,
    viewModeByFilter, setViewMode, activeFilter, setActiveFilter,
    sortField, sortDirection, setSort, libraryLayout, setLibraryLayout,
    columns, toggleColumnVisibility, resetColumns,
    togglePdfLeftPanel, toggleHtmlLeftPanel, toggleEpubLeftPanel,
  } = useUIStore();

  const {
    openTab, tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs,
    closeAllTabs, pinTab, unpinTab, duplicateTab, closeTabsToRight,
    splitEnabled, moveTabToPane, disableSplit, focusedPane,
    activeRightTabId, setFocusedPane,
  } = useTabStore();

  const {
    entries, selectedEntryIds, collections, tags, refreshLibrary,
    trashCount, activeCollectionId, activeTagIds, savedSearches,
  } = useLibraryStore();

  const { theme, setTheme } = useSettingsStore();
  const { itemTypes } = useSchemaStore();
  const searchState = useSearchState();
  useSearchEffects(searchState);

  const [subMenu, setSubMenu] = useState<SubMenu>(null);
  const [entryAttachments, setEntryAttachments] = useState<Attachment[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "all">("all");
  const [exportContext, setExportContext] = useState<{ type: "collection" | "tag"; id: number; name: string } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<BiblatexPreviewResult | null>(null);
  const [importFolderPath, setImportFolderPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingMoreResults, setIsLoadingMoreResults] = useState(false);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId]);
  const tabTypeLabels = useTabTypeLabels(tabs);
  const { viewerContext, contextAttachmentId } = useViewerContext(activeTab);
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    if (openMode === "advanced") { setAdvancedSearchOpen(true); setCommandPaletteOpen(false); return; }
    if (openMode === "full") searchState.setSearchMode("full");
    else if (openMode === "ai") searchState.setSearchMode("semantic");
  }, [commandPaletteOpen, openMode, setAdvancedSearchOpen, setCommandPaletteOpen]);

  useEffect(() => { if (!commandPaletteOpen) setCommandPaletteMode("default"); }, [commandPaletteOpen, setCommandPaletteMode]);

  const handleLoadMoreResults = useCallback(async () => {
    if (isLoadingMoreResults || !searchState.hasMoreResults) return;
    setIsLoadingMoreResults(true);
    try {
      const { getEntriesPaged } = await import("@/services/tauri");
      const result = await getEntriesPaged({ searchQuery: searchState.search.trim(), searchScope: searchState.quickScope, limit: 20, offset: searchState.searchOffset });
      searchState.setSearchResults((prev) => [...prev, ...result.entries]);
      const nextOffset = searchState.searchOffset + result.entries.length;
      searchState.setSearchOffset(nextOffset); searchState.setSearchTotal(result.total);
      searchState.setHasMoreResults(nextOffset < result.total);
    } catch (err) { console.error("Load more search results failed:", err); }
    finally { setIsLoadingMoreResults(false); }
  }, [searchState.search, searchState.quickScope, searchState.searchOffset, searchState.hasMoreResults, isLoadingMoreResults]);

  const handleResultsScroll = useCallback(() => {
    const el = resultsContainerRef.current;
    if (!el || isLoadingMoreResults || !searchState.hasMoreResults) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) handleLoadMoreResults();
  }, [isLoadingMoreResults, searchState.hasMoreResults, handleLoadMoreResults]);

  const handlers = useCommandPaletteActions({
    searchState, setSubMenu: setSubMenu as (menu: null) => void,
    entryAttachments, setEntryAttachments, newTagName, setNewTagName,
    renameInput, setRenameInput, selectedItemId, setSelectedItemId,
    exportMode, setExportMode, setShowExportDialog, setIsExporting,
    setExportContext, setShowImportPreview, setImportPreviewData, setImportFolderPath,
  });

  const handleConfirmBiblatexImport = async (options: import('@/components/dialogs/ImportPreviewDialog').ImportOptions) => {
    if (!importFolderPath) return;
    const { selectedKeys, importTags, excludedFiles, collectionId } = options;
    setIsImporting(true);
    try {
      const result = await importBiblatexWithFiles(importFolderPath, importFolderPath, selectedKeys, importTags, excludedFiles, collectionId);
      let message = `Imported ${result.imported} ${result.imported !== 1 ? "entries" : "entry"}`;
      if (result.filesImported > 0) message += ` with ${result.filesImported} file${result.filesImported !== 1 ? "s" : ""}`;
      if (result.tagsCreated > 0) message += ` and ${result.tagsCreated} tag${result.tagsCreated !== 1 ? "s" : ""}`;
      toast.success(message);
      if (result.skipped > 0) toast.info(`${result.skipped} entries skipped`);
      const { invalidateAttachments, refreshLibrary } = useLibraryStore.getState();
      invalidateAttachments(); await refreshLibrary();
      setShowImportPreview(false); setImportPreviewData(null); setImportFolderPath(null);
    } catch (err) { console.error("Failed to import BibLaTeX:", err); toast.error("Failed to import BibLaTeX entries"); }
    finally { setIsImporting(false); }
  };

  const handleExportBiblatexWithFiles = async (options: ExportOptions) => {
    try {
      setIsExporting(true);
      const outputDir = await open({ directory: true, title: "Select Export Folder" });
      if (outputDir) {
        const result = exportMode === "selected"
          ? await exportToBiblatexWithFiles(selectedEntryIds, outputDir, options)
          : await exportAllToBiblatexWithFiles(outputDir, options);
        toast.success(`Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`);
        setShowExportDialog(false);
      }
    } catch (err) { console.error("Export BibLaTeX error:", err); toast.error("Failed to export to BibLaTeX"); }
    finally { setIsExporting(false); }
    setCommandPaletteOpen(false);
  };

  const handleExportWithContext = async (options: ExportOptions) => {
    if (!exportContext) { await handleExportBiblatexWithFiles(options); return; }
    try {
      setIsExporting(true);
      const outputDir = await open({ directory: true, title: "Select Export Folder" });
      if (outputDir) {
        let entryIds: number[] = [];
        if (exportContext.type === "collection") entryIds = (await getEntries({ collectionId: exportContext.id })).map(e => e.id);
        else if (exportContext.type === "tag") entryIds = (await getEntries({ tagIds: [exportContext.id] })).map(e => e.id);
        if (entryIds.length === 0) { toast.warning("No entries to export"); return; }
        const result = await exportToBiblatexWithFiles(entryIds, outputDir, options);
        toast.success(`Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`);
        setShowExportDialog(false); setExportContext(null);
      }
    } catch (err) { console.error("Export error:", err); toast.error("Failed to export"); }
    finally { setIsExporting(false); }
    setCommandPaletteOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && commandPaletteOpen) {
        if (subMenu) setSubMenu(null); else setCommandPaletteOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen, subMenu]);

  const commandsProps: CommandsProps = {
    handlers, viewerContext, contextAttachmentId,
    subMenu, setSubMenu, setCommandPaletteOpen,
    tabs, activeTabId, activeRightTabId, activeTab, tabTypeLabels,
    splitEnabled, focusedPane, collections, tags, selectedEntryIds,
    activeFilter, activeCollectionId, activeTagIds, trashCount,
    viewModeByFilter, sortField, sortDirection, libraryLayout, columns,
    theme, itemTypes, entryAttachments, newTagName, setNewTagName,
    renameInput, setRenameInput, selectedItemId, setSelectedItemId,
    setEntryAttachments, savedSearches, libraryInfoPaneEnabled,
    tabActions: { setActiveTab, closeTab, closeOtherTabs, closeAllTabs, closeTabsToRight, pinTab, unpinTab, duplicateTab, moveTabToPane, disableSplit, setFocusedPane, openTab },
    uiActions: { toggleSidebar, toggleInfoPane, toggleLibraryInfoPane, togglePdfLeftPanel, toggleHtmlLeftPanel, toggleEpubLeftPanel, setSettingsOpen, setNewCollectionDialogOpen, setTagManagementDialogOpen, setCollectionManagementDialogOpen, setAdvancedSearchOpen, setViewMode, setSort, setLibraryLayout, toggleColumnVisibility, resetColumns, setTheme, refreshLibrary, setActiveSavedSearch: useLibraryStore.getState().setActiveSavedSearch, setActiveFilter, reindexAttachment, ragIndexAll, ragRebuild, showEntryInFinder, getEntry },
  };

  const exportDialogProps = {
    open: showExportDialog,
    onClose: () => { setShowExportDialog(false); setExportContext(null); },
    onExport: exportContext ? handleExportWithContext : handleExportBiblatexWithFiles,
    entryCount: exportMode === "selected" ? selectedEntryIds.length : entries.length,
    isExporting,
  };

  const importDialogProps = {
    open: showImportPreview,
    onOpenChange: setShowImportPreview,
    previewData: importPreviewData,
    onImport: handleConfirmBiblatexImport,
    isImporting,
  };

  if (!commandPaletteOpen) {
    return (<><ExportOptionsDialog {...exportDialogProps} /><ImportPreviewDialog {...importDialogProps} /></>);
  }

  if (subMenu) {
    const subMenuContent = <SubMenuRenderer props={commandsProps} />;
    if (subMenuContent) return subMenuContent;
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => { if (!searchState.isSearching) setCommandPaletteOpen(false); }} />
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command
          shouldFilter={!hasSearchResults(searchState)}
          filter={(value, search) => {
            if (!search) return 1;
            const sl = search.toLowerCase(), vl = value.toLowerCase();
            const words = sl.split(/\s+/).filter(Boolean);
            if (words.every(w => vl.includes(w))) return 1;
            if (vl.includes(sl)) return 1;
            return 0;
          }}
          className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden"
        >
          <SearchInput state={searchState} />
          <Command.List ref={resultsContainerRef} onScroll={handleResultsScroll} className="max-h-[400px] overflow-y-auto p-2 scrollbar-hidden">
            <SearchResults state={searchState} isLoadingMoreResults={isLoadingMoreResults} onSelect={handlers.handleSelect} onOpenTab={openTab} />
            {!hasSearchResults(searchState) && <CommandGroups props={commandsProps} />}
          </Command.List>
          <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">↵</kbd> select</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">esc</kbd> close</span>
            </div>
          </div>
        </Command>
      </div>
      <ExportOptionsDialog {...exportDialogProps} />
      <ImportPreviewDialog {...importDialogProps} />
    </div>
  );
}
