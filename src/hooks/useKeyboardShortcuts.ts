import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";

export function useKeyboardShortcuts() {
  const { toggleCommandPalette, setViewMode, viewMode } = useUIStore();
  const { closeTab, activeTabId, tabs, setActiveTab, openTab } = useTabStore();
  const { selectedEntryIds, entries, selectEntry, clearSelection } =
    useLibraryStore();

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
            entryId: entry.id,
          });
        }
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
  ]);
}
