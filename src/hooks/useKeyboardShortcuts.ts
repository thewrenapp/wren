import { useEffect, useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { deleteEntry, duplicateEntry, exportToBibtex } from "@/services/tauri";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "@/stores/toastStore";

// Threshold for showing confirmation dialog
const BULK_DELETE_THRESHOLD = 3;

export function useKeyboardShortcuts() {
  const { toggleCommandPalette, setViewMode, viewMode, showDeleteConfirmation } = useUIStore();
  const { closeTab, activeTabId, tabs, setActiveTab, openTab } = useTabStore();
  const { selectedEntryIds, entries, selectEntry, clearSelection, refreshLibrary } =
    useLibraryStore();

  // Actual delete operation
  const performDelete = useCallback(async () => {
    if (selectedEntryIds.length === 0) return;

    // Delete all selected entries (soft delete - moves to trash)
    for (const id of selectedEntryIds) {
      try {
        await deleteEntry(id);
      } catch (err) {
        console.error(`Failed to delete entry ${id}:`, err);
      }
    }

    clearSelection();
    refreshLibrary();
  }, [selectedEntryIds, clearSelection, refreshLibrary]);

  // Handle delete for selected entries (with confirmation for bulk)
  const handleDeleteSelected = useCallback(() => {
    if (selectedEntryIds.length === 0) return;

    // Show confirmation for bulk deletes
    if (selectedEntryIds.length >= BULK_DELETE_THRESHOLD) {
      showDeleteConfirmation(selectedEntryIds, performDelete);
    } else {
      // Direct delete for small number of entries
      performDelete();
    }
  }, [selectedEntryIds, showDeleteConfirmation, performDelete]);

  // Handle duplicate for single selected entry
  const handleDuplicate = useCallback(async () => {
    if (selectedEntryIds.length !== 1) return;

    try {
      await duplicateEntry(selectedEntryIds[0]);
      toast.success("Entry duplicated");
      refreshLibrary();
    } catch (err) {
      console.error("Failed to duplicate entry:", err);
      toast.error("Failed to duplicate entry");
    }
  }, [selectedEntryIds, refreshLibrary]);

  // Handle export to BibTeX (copy to clipboard)
  const handleExport = useCallback(async () => {
    if (selectedEntryIds.length === 0) return;

    try {
      const bibtex = await exportToBibtex(selectedEntryIds);
      await writeText(bibtex);
      toast.success(`Copied ${selectedEntryIds.length} entries as BibTeX`);
    } catch (err) {
      console.error("Failed to export:", err);
      toast.error("Failed to export");
    }
  }, [selectedEntryIds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      // Ignore if typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow some shortcuts even in inputs
        if (!(isMeta && e.key === "k")) {
          return;
        }
      }

      // Command Palette: Cmd+K
      if (isMeta && e.key === "k") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Close tab: Cmd+W
      if (isMeta && e.key === "w") {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
        return;
      }

      // Toggle view mode: Cmd+Shift+V
      if (isMeta && isShift && e.key === "V") {
        e.preventDefault();
        setViewMode(viewMode === "list" ? "card" : "list");
        return;
      }

      // Navigate tabs: Cmd+Shift+[ or ]
      if (isMeta && isShift && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex !== -1) {
          const newIndex =
            e.key === "["
              ? Math.max(0, currentIndex - 1)
              : Math.min(tabs.length - 1, currentIndex + 1);
          setActiveTab(tabs[newIndex].id);
        }
        return;
      }

      // Navigate tabs by number: Cmd+1-9
      if (isMeta && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < tabs.length) {
          setActiveTab(tabs[index].id);
        }
        return;
      }

      // Select all: Cmd+A
      if (isMeta && e.key === "a") {
        e.preventDefault();
        // Select all entries in current view
        const allIds = entries.map((e) => e.id);
        allIds.forEach((id) => selectEntry(id, true));
        return;
      }

      // Escape: Clear selection
      if (e.key === "Escape") {
        clearSelection();
        return;
      }

      // Arrow navigation for entries
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (entries.length === 0) return;

        e.preventDefault();

        if (selectedEntryIds.length === 0) {
          // Select first entry
          selectEntry(entries[0].id);
        } else {
          // Navigate from current selection
          const lastSelected = selectedEntryIds[selectedEntryIds.length - 1];
          const currentIndex = entries.findIndex((e) => e.id === lastSelected);

          const newIndex =
            e.key === "ArrowDown"
              ? Math.min(entries.length - 1, currentIndex + 1)
              : Math.max(0, currentIndex - 1);

          if (isShift) {
            // Extend selection
            selectEntry(entries[newIndex].id, true);
          } else {
            // Single selection
            selectEntry(entries[newIndex].id);
          }
        }
        return;
      }

      // Enter: Open selected entry
      if (e.key === "Enter" && selectedEntryIds.length === 1) {
        const entry = entries.find((e) => e.id === selectedEntryIds[0]);
        if (entry) {
          openTab({
            type: "entry",
            title: entry.title,
            entryId: String(entry.id),
          });
        }
        return;
      }

      // Delete/Backspace: Move selected entries to trash
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEntryIds.length > 0) {
        e.preventDefault();
        handleDeleteSelected();
        return;
      }

      // Cmd+D: Duplicate entry
      if (isMeta && e.key === "d" && selectedEntryIds.length === 1) {
        e.preventDefault();
        handleDuplicate();
        return;
      }

      // Cmd+E: Export selected as BibTeX (copy to clipboard)
      if (isMeta && e.key === "e" && selectedEntryIds.length > 0) {
        e.preventDefault();
        handleExport();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    toggleCommandPalette,
    setViewMode,
    viewMode,
    closeTab,
    activeTabId,
    tabs,
    setActiveTab,
    entries,
    selectedEntryIds,
    selectEntry,
    clearSelection,
    openTab,
    handleDeleteSelected,
    handleDuplicate,
    handleExport,
  ]);
}
