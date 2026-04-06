import { useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useImport } from "@/hooks/useLibrarySync";
import type { Attachment, BiblatexPreviewResult } from "@/services/tauri";
import type { CommandHandlers } from "./commands/types";
import type { SearchState } from "./CommandPaletteSearch";
import { createImportExportActions } from "./actions/importExportActions";
import { createEntryActions } from "./actions/entryActions";

interface ActionDeps {
  searchState: SearchState;
  setSubMenu: (menu: null) => void;
  entryAttachments: Attachment[];
  setEntryAttachments: (attachments: Attachment[]) => void;
  newTagName: string;
  setNewTagName: (val: string) => void;
  renameInput: string;
  setRenameInput: (val: string) => void;
  selectedItemId: number | null;
  setSelectedItemId: (id: number | null) => void;
  exportMode: "selected" | "all";
  setExportMode: (mode: "selected" | "all") => void;
  setShowExportDialog: (open: boolean) => void;
  setIsExporting: (val: boolean) => void;
  setExportContext: (ctx: { type: "collection" | "tag"; id: number; name: string } | null) => void;
  setShowImportPreview: (open: boolean) => void;
  setImportPreviewData: (data: BiblatexPreviewResult | null) => void;
  setImportFolderPath: (path: string | null) => void;
  setPendingArchiveImportPath: (path: string | null) => void;
}

export function useCommandPaletteActions(deps: ActionDeps): CommandHandlers {
  const {
    setCommandPaletteOpen, showDeleteConfirmation,
    setActiveFilter, viewModeByFilter, activeFilter, setViewMode,
  } = useUIStore();

  const { openTab } = useTabStore();
  const {
    entries, selectedEntryIds, refreshLibrary, clearSelection,
    trashCount, setTrashCount, setTrashedEntries,
    setCollections, setTags, invalidateEntry, invalidateAttachments,
  } = useLibraryStore();
  const { importFiles, importFolder } = useImport();

  const {
    searchState, setSubMenu,
    newTagName, setNewTagName,
    renameInput, setRenameInput,
    setSelectedItemId, setExportMode,
    setShowExportDialog, setExportContext,
    setShowImportPreview, setImportPreviewData, setImportFolderPath,
    setPendingArchiveImportPath, setEntryAttachments,
  } = deps;

  const handleSelect = useCallback(
    (callback: () => void) => {
      callback();
      setCommandPaletteOpen(false);
      searchState.setSearch("");
      setSubMenu(null);
    },
    [setCommandPaletteOpen, searchState, setSubMenu]
  );

  const importExport = createImportExportActions({
    searchState, setCommandPaletteOpen, selectedEntryIds,
    invalidateAttachments, refreshLibrary, importFiles, importFolder,
    setSubMenu, setExportMode, setShowExportDialog, setExportContext,
    setShowImportPreview, setImportPreviewData, setImportFolderPath,
    setPendingArchiveImportPath,
  });

  const entryActions = createEntryActions({
    setCommandPaletteOpen, showDeleteConfirmation,
    selectedEntryIds, entries, clearSelection, refreshLibrary,
    invalidateEntry, invalidateAttachments,
    trashCount, setTrashCount, setTrashedEntries,
    setCollections, setTags, setSubMenu,
    newTagName, setNewTagName, renameInput, setRenameInput,
    setSelectedItemId, setEntryAttachments, openTab,
    setActiveFilter, setViewMode, viewModeByFilter, activeFilter,
  });

  return {
    handleSelect,
    ...importExport,
    ...entryActions,
  };
}
