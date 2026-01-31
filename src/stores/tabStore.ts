import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  type: "item" | "entry" | "search" | "collection" | "welcome" | "library";
  title: string;
  itemId?: string;
  entryId?: string;
  attachmentId?: string; // Specific attachment to open within an entry
  data?: Record<string, unknown>;
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
}

const generateId = () => crypto.randomUUID();

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

        // Check if entry already has a tab open (with same attachment if specified)
        if (tab.entryId) {
          const existing = state.tabs.find((t) =>
            t.entryId === tab.entryId && t.attachmentId === tab.attachmentId
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
        set((state) => ({
          tabs: state.tabs.filter((t) => t.id === id),
          activeTabId: id,
        }));
      },

      closeAllTabs: () => {
        set({ tabs: [], activeTabId: null });
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
          const [removed] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, removed);
          return { tabs };
        });
      },
    }),
    {
      name: "etal-tabs",
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
