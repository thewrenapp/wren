import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  type: "item" | "entry" | "markdown" | "search" | "collection" | "welcome" | "library";
  title: string;
  itemId?: string;
  entryId?: string;
  attachmentId?: string; // Specific attachment to open within an entry
  data?: Record<string, unknown>;
  pinned?: boolean;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  // Actions
  openTab: (tab: Omit<Tab, "id">) => string;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Omit<Tab, "id">>) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  pinTab: (id: string) => void;
  unpinTab: (id: string) => void;
  duplicateTab: (id: string) => string;
  closeTabsToRight: (id: string) => void;
}

const generateId = () => crypto.randomUUID();

/** Get the boundary index where pinned tabs end and unpinned tabs begin */
function getPinnedBoundary(tabs: Tab[]): number {
  // Library tab is always at index 0 if present (implicitly pinned)
  // Then pinned tabs, then unpinned tabs
  let boundary = 0;
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].type === "library" || tabs[i].pinned) {
      boundary = i + 1;
    } else {
      break;
    }
  }
  return boundary;
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      // Start with no tabs - library browse mode is the default
      tabs: [],
      activeTabId: null,

      openTab: (tab) => {
        const state = get();

        // Check if item already has a tab open
        if (tab.itemId) {
          const existing = state.tabs.find((t) => t.itemId === tab.itemId);
          if (existing) {
            set({ activeTabId: existing.id });
            return existing.id;
          }
        }

        // Check if entry already has a tab open (with same type and attachment if specified)
        if (tab.entryId) {
          const existing = state.tabs.find((t) =>
            t.type === tab.type && t.entryId === tab.entryId && t.attachmentId === tab.attachmentId
          );
          if (existing) {
            set({ activeTabId: existing.id });
            return existing.id;
          }
        }

        // Check for unique tabs like welcome and library
        if (tab.type === "welcome" || tab.type === "library") {
          const existing = state.tabs.find((t) => t.type === tab.type);
          if (existing) {
            set({ activeTabId: existing.id });
            return existing.id;
          }
        }

        const id = generateId();
        set({
          tabs: [...state.tabs, { ...tab, id }],
          activeTabId: id,
        });

        return id;
      },

      closeTab: (id) => {
        set((state) => {
          const index = state.tabs.findIndex((t) => t.id === id);
          const newTabs = state.tabs.filter((t) => t.id !== id);

          // If we're closing the active tab, activate an adjacent one
          let newActiveId = state.activeTabId;
          if (state.activeTabId === id && newTabs.length > 0) {
            const newIndex = Math.min(index, newTabs.length - 1);
            newActiveId = newTabs[newIndex]?.id ?? null;
          } else if (newTabs.length === 0) {
            newActiveId = null;
          }

          return { tabs: newTabs, activeTabId: newActiveId };
        });
      },

      closeOtherTabs: (id) => {
        set((state) => {
          // Keep the specified tab plus library tab (always kept) and pinned tabs
          const kept = state.tabs.filter(
            (t) => t.id === id || t.type === "library" || t.pinned
          );
          // Make sure the target tab is in the kept list
          if (!kept.find((t) => t.id === id)) {
            const target = state.tabs.find((t) => t.id === id);
            if (target) kept.push(target);
          }
          return { tabs: kept, activeTabId: id };
        });
      },

      closeAllTabs: () => {
        set((state) => {
          // Keep library tab and pinned tabs
          const kept = state.tabs.filter((t) => t.type === "library" || t.pinned);
          const newActiveId = kept.length > 0 ? kept[kept.length - 1].id : null;
          return { tabs: kept, activeTabId: newActiveId };
        });
      },

      setActiveTab: (id) => {
        set({ activeTabId: id });
      },

      updateTab: (id, updates) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === id ? { ...tab, ...updates } : tab
          ),
        }));
      },

      reorderTabs: (fromIndex, toIndex) => {
        set((state) => {
          const tabs = [...state.tabs];
          const tab = tabs[fromIndex];
          if (!tab) return { tabs };

          // Library tab is immovable
          if (tab.type === "library") return { tabs };

          const boundary = getPinnedBoundary(tabs);
          const libraryOffset = tabs[0]?.type === "library" ? 1 : 0;

          // Clamp toIndex within the tab's zone
          let clampedTo = toIndex;
          if (tab.pinned) {
            // Pinned tabs stay in [libraryOffset, boundary - 1]
            clampedTo = Math.max(libraryOffset, Math.min(toIndex, boundary - 1));
          } else {
            // Unpinned tabs stay in [boundary, tabs.length - 1]
            clampedTo = Math.max(boundary, Math.min(toIndex, tabs.length - 1));
          }

          if (fromIndex === clampedTo) return { tabs };

          const [removed] = tabs.splice(fromIndex, 1);
          tabs.splice(clampedTo, 0, removed);
          return { tabs };
        });
      },

      pinTab: (id) => {
        set((state) => {
          const tabs = [...state.tabs];
          const index = tabs.findIndex((t) => t.id === id);
          if (index === -1) return { tabs };

          const tab = tabs[index];
          // Library tab is already implicitly pinned
          if (tab.type === "library") return { tabs };

          // Mark as pinned
          tab.pinned = true;

          // Move to end of pinned section
          const boundary = getPinnedBoundary(tabs);
          if (index >= boundary) {
            // Tab is in unpinned zone, move it to the end of pinned zone
            tabs.splice(index, 1);
            // boundary was computed before removing, so insert at boundary - 0
            // Actually after removing, the boundary might shift. Recompute:
            const newBoundary = getPinnedBoundary(tabs);
            tabs.splice(newBoundary, 0, tab);
          }
          // If already in pinned zone, just keep it there with pinned=true

          return { tabs };
        });
      },

      unpinTab: (id) => {
        set((state) => {
          const tabs = [...state.tabs];
          const index = tabs.findIndex((t) => t.id === id);
          if (index === -1) return { tabs };

          const tab = tabs[index];
          tab.pinned = false;

          // Move to start of unpinned section
          const boundary = getPinnedBoundary(tabs);
          if (index < boundary) {
            // Tab was in pinned zone, move to start of unpinned zone
            tabs.splice(index, 1);
            const newBoundary = getPinnedBoundary(tabs);
            tabs.splice(newBoundary, 0, tab);
          }

          return { tabs };
        });
      },

      duplicateTab: (id) => {
        const state = get();
        const original = state.tabs.find((t) => t.id === id);
        if (!original) return "";

        const newId = generateId();
        const newTab: Tab = {
          ...original,
          id: newId,
          pinned: false, // Duplicated tabs are not pinned
        };

        const index = state.tabs.findIndex((t) => t.id === id);
        const newTabs = [...state.tabs];
        newTabs.splice(index + 1, 0, newTab);

        set({ tabs: newTabs, activeTabId: newId });
        return newId;
      },

      closeTabsToRight: (id) => {
        set((state) => {
          const index = state.tabs.findIndex((t) => t.id === id);
          if (index === -1) return state;

          // Keep tabs up to and including the target, plus any pinned/library tabs to the right
          const newTabs = state.tabs.filter((t, i) =>
            i <= index || t.type === "library" || t.pinned
          );

          let newActiveId = state.activeTabId;
          if (!newTabs.find((t) => t.id === state.activeTabId)) {
            newActiveId = id;
          }

          return { tabs: newTabs, activeTabId: newActiveId };
        });
      },
    }),
    {
      name: "wren-tabs",
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
