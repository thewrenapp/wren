import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";

export function useKeyboardShortcuts() {
  const { toggleCommandPalette, setViewMode, viewMode } = useUIStore();
  const { closeTab, activeTabId, tabs, setActiveTab } = useTabStore();
  const { selectedItemIds, items, selectItem, clearSelection } =
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
        // Select all items in current view
        const allIds = items.map((i) => i.id);
        allIds.forEach((id) => selectItem(id, true));
        return;
      }

      // Escape: Clear selection
      if (e.key === "Escape") {
        clearSelection();
        return;
      }

      // Arrow navigation for items
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (items.length === 0) return;

        e.preventDefault();

        if (selectedItemIds.length === 0) {
          // Select first item
          selectItem(items[0].id);
        } else {
          // Navigate from current selection
          const lastSelected = selectedItemIds[selectedItemIds.length - 1];
          const currentIndex = items.findIndex((i) => i.id === lastSelected);

          const newIndex =
            e.key === "ArrowDown"
              ? Math.min(items.length - 1, currentIndex + 1)
              : Math.max(0, currentIndex - 1);

          if (isShift) {
            // Extend selection
            selectItem(items[newIndex].id, true);
          } else {
            // Single selection
            selectItem(items[newIndex].id);
          }
        }
        return;
      }

      // Enter: Open selected item
      if (e.key === "Enter" && selectedItemIds.length === 1) {
        const item = items.find((i) => i.id === selectedItemIds[0]);
        if (item) {
          // TODO: Open in tab
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
    items,
    selectedItemIds,
    selectItem,
    clearSelection,
  ]);
}
