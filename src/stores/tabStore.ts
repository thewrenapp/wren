import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  type: "item" | "entry" | "markdown" | "parsed" | "search" | "collection" | "welcome" | "library";
  title: string;
  itemId?: string;
  entryId?: string;
  attachmentId?: string; // Specific attachment to open within an entry
  data?: Record<string, unknown>;
  pinned?: boolean;
  pane?: "left" | "right"; // undefined = "left" (backwards compat)
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null; // Left pane active tab

  // Split pane state
  splitEnabled: boolean;
  activeRightTabId: string | null;
  focusedPane: "left" | "right";

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

  // Split pane actions
  enableSplit: () => void;
  disableSplit: () => void;
  moveTabToPane: (tabId: string, targetPane: "left" | "right") => void;
  setFocusedPane: (pane: "left" | "right") => void;
  setActiveTabInPane: (tabId: string, pane: "left" | "right") => void;
}

const generateId = () => crypto.randomUUID();

/** Get the pane a tab belongs to */
function getTabPane(tab: Tab): "left" | "right" {
  return tab.pane ?? "left";
}

/** Filter tabs for a specific pane */
export function getTabsForPane(tabs: Tab[], pane: "left" | "right"): Tab[] {
  return tabs.filter((t) => getTabPane(t) === pane);
}

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

      // Split pane defaults
      splitEnabled: false,
      activeRightTabId: null,
      focusedPane: "left",

      openTab: (tab) => {
        const state = get();

        // Determine which pane to open in
        const targetPane =
          tab.type === "library" || tab.type === "welcome"
            ? "left"
            : tab.pane ?? (state.splitEnabled ? state.focusedPane : "left");

        // Check if item already has a tab open
        if (tab.itemId) {
          const existing = state.tabs.find((t) => t.itemId === tab.itemId);
          if (existing) {
            const existingPane = getTabPane(existing);
            if (existingPane === "left") {
              set({ activeTabId: existing.id, focusedPane: "left" });
            } else {
              set({ activeRightTabId: existing.id, focusedPane: "right" });
            }
            return existing.id;
          }
        }

        // Check if entry already has a tab open (with same type and attachment if specified)
        if (tab.entryId) {
          const existing = state.tabs.find(
            (t) =>
              t.type === tab.type &&
              t.entryId === tab.entryId &&
              t.attachmentId === tab.attachmentId
          );
          if (existing) {
            const existingPane = getTabPane(existing);
            if (existingPane === "left") {
              set({ activeTabId: existing.id, focusedPane: "left" });
            } else {
              set({ activeRightTabId: existing.id, focusedPane: "right" });
            }
            return existing.id;
          }
        }

        // Check for unique tabs like welcome and library
        if (tab.type === "welcome" || tab.type === "library") {
          const existing = state.tabs.find((t) => t.type === tab.type);
          if (existing) {
            set({ activeTabId: existing.id, focusedPane: "left" });
            return existing.id;
          }
        }

        const id = generateId();
        const newTab: Tab = { ...tab, id, pane: targetPane === "right" ? "right" : undefined };

        const updates: Partial<TabState> = {
          tabs: [...state.tabs, newTab],
        };

        if (targetPane === "right") {
          updates.activeRightTabId = id;
          updates.focusedPane = "right";
        } else {
          updates.activeTabId = id;
          updates.focusedPane = "left";
        }

        set(updates);
        return id;
      },

      closeTab: (id) => {
        set((state) => {
          const tab = state.tabs.find((t) => t.id === id);
          if (!tab) return state;

          const tabPane = getTabPane(tab);
          const paneTabsBefore = getTabsForPane(state.tabs, tabPane);
          const paneIndex = paneTabsBefore.findIndex((t) => t.id === id);
          const newTabs = state.tabs.filter((t) => t.id !== id);

          let newActiveId = state.activeTabId;
          let newActiveRightId = state.activeRightTabId;
          let newSplitEnabled = state.splitEnabled;

          if (tabPane === "left") {
            if (state.activeTabId === id) {
              const leftTabs = getTabsForPane(newTabs, "left");
              if (leftTabs.length > 0) {
                const clampedIndex = Math.min(paneIndex, leftTabs.length - 1);
                newActiveId = leftTabs[clampedIndex]?.id ?? null;
              } else {
                newActiveId = null;
              }
            }
          } else {
            if (state.activeRightTabId === id) {
              const rightTabs = getTabsForPane(newTabs, "right");
              if (rightTabs.length > 0) {
                const clampedIndex = Math.min(paneIndex, rightTabs.length - 1);
                newActiveRightId = rightTabs[clampedIndex]?.id ?? null;
              } else {
                newActiveRightId = null;
              }
            }

            // Auto-close split if right pane is empty
            const rightTabs = getTabsForPane(newTabs, "right");
            if (rightTabs.length === 0) {
              newSplitEnabled = false;
              newActiveRightId = null;
            }
          }

          return {
            tabs: newTabs,
            activeTabId: newActiveId,
            activeRightTabId: newActiveRightId,
            splitEnabled: newSplitEnabled,
            focusedPane: newSplitEnabled ? state.focusedPane : "left",
          };
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

          // Check if right pane still has tabs
          const rightTabs = getTabsForPane(kept, "right");
          const targetTab = kept.find((t) => t.id === id);
          const targetPane = targetTab ? getTabPane(targetTab) : "left";

          return {
            tabs: kept,
            activeTabId: targetPane === "left" ? id : state.activeTabId,
            activeRightTabId: targetPane === "right" ? id : (rightTabs.length > 0 ? rightTabs[0].id : null),
            splitEnabled: rightTabs.length > 0 ? state.splitEnabled : false,
            focusedPane: targetPane,
          };
        });
      },

      closeAllTabs: () => {
        set((state) => {
          // Keep library tab and pinned tabs
          const kept = state.tabs.filter((t) => t.type === "library" || t.pinned);
          const leftTabs = getTabsForPane(kept, "left");
          const rightTabs = getTabsForPane(kept, "right");
          const newActiveId = leftTabs.length > 0 ? leftTabs[leftTabs.length - 1].id : null;
          return {
            tabs: kept,
            activeTabId: newActiveId,
            activeRightTabId: rightTabs.length > 0 ? rightTabs[rightTabs.length - 1].id : null,
            splitEnabled: rightTabs.length > 0 ? state.splitEnabled : false,
            focusedPane: "left",
          };
        });
      },

      setActiveTab: (id) => {
        // Determine which pane this tab is in and set the correct active ID
        const state = get();
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) return;

        const pane = getTabPane(tab);
        if (pane === "right") {
          set({ activeRightTabId: id, focusedPane: "right" });
        } else {
          set({ activeTabId: id, focusedPane: "left" });
        }
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
            tabs.splice(index, 1);
            const newBoundary = getPinnedBoundary(tabs);
            tabs.splice(newBoundary, 0, tab);
          }

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

        const pane = getTabPane(original);
        if (pane === "right") {
          set({ tabs: newTabs, activeRightTabId: newId, focusedPane: "right" });
        } else {
          set({ tabs: newTabs, activeTabId: newId, focusedPane: "left" });
        }
        return newId;
      },

      closeTabsToRight: (id) => {
        set((state) => {
          const index = state.tabs.findIndex((t) => t.id === id);
          if (index === -1) return state;

          // Keep tabs up to and including the target, plus any pinned/library tabs to the right
          const newTabs = state.tabs.filter(
            (t, i) => i <= index || t.type === "library" || t.pinned
          );

          let newActiveId = state.activeTabId;
          if (!newTabs.find((t) => t.id === state.activeTabId)) {
            newActiveId = id;
          }

          let newActiveRightId = state.activeRightTabId;
          if (
            state.activeRightTabId &&
            !newTabs.find((t) => t.id === state.activeRightTabId)
          ) {
            const rightTabs = getTabsForPane(newTabs, "right");
            newActiveRightId = rightTabs.length > 0 ? rightTabs[rightTabs.length - 1].id : null;
          }

          // Auto-close split if right pane is empty
          const rightTabs = getTabsForPane(newTabs, "right");
          const newSplitEnabled = rightTabs.length > 0 ? state.splitEnabled : false;

          return {
            tabs: newTabs,
            activeTabId: newActiveId,
            activeRightTabId: newActiveRightId,
            splitEnabled: newSplitEnabled,
            focusedPane: newSplitEnabled ? state.focusedPane : "left",
          };
        });
      },

      // Split pane actions

      enableSplit: () => {
        set({ splitEnabled: true, focusedPane: "right" });
      },

      disableSplit: () => {
        set((state) => {
          // Move all right-pane tabs back to left pane
          const newTabs = state.tabs.map((t) =>
            t.pane === "right" ? { ...t, pane: undefined } : t
          ) as Tab[];

          return {
            tabs: newTabs,
            splitEnabled: false,
            activeRightTabId: null,
            focusedPane: "left",
          };
        });
      },

      moveTabToPane: (tabId, targetPane) => {
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          if (!tab) return state;

          // Library tab always stays in left pane
          if (tab.type === "library") return state;

          const currentPane = getTabPane(tab);
          if (currentPane === targetPane) return state;

          // Update the tab's pane
          const newTabs = state.tabs.map((t) =>
            t.id === tabId
              ? { ...t, pane: targetPane === "right" ? ("right" as const) : undefined }
              : t
          );

          let newActiveId = state.activeTabId;
          let newActiveRightId = state.activeRightTabId;
          let newSplitEnabled = state.splitEnabled;
          let newFocusedPane: "left" | "right" = targetPane;

          // Enable split if moving to right and not already enabled
          if (targetPane === "right" && !state.splitEnabled) {
            newSplitEnabled = true;
          }

          // Update active tabs
          if (targetPane === "right") {
            // Moving from left to right
            newActiveRightId = tabId;
            if (state.activeTabId === tabId) {
              // Pick next active in left pane
              const leftTabs = getTabsForPane(newTabs, "left");
              newActiveId = leftTabs.length > 0 ? leftTabs[0].id : null;
            }
          } else {
            // Moving from right to left
            newActiveId = tabId;
            if (state.activeRightTabId === tabId) {
              // Pick next active in right pane
              const rightTabs = getTabsForPane(newTabs, "right");
              newActiveRightId = rightTabs.length > 0 ? rightTabs[0].id : null;
            }

            // Auto-close split if right pane is now empty
            const rightTabs = getTabsForPane(newTabs, "right");
            if (rightTabs.length === 0) {
              newSplitEnabled = false;
              newActiveRightId = null;
              newFocusedPane = "left";
            }
          }

          return {
            tabs: newTabs,
            activeTabId: newActiveId,
            activeRightTabId: newActiveRightId,
            splitEnabled: newSplitEnabled,
            focusedPane: newFocusedPane,
          };
        });
      },

      setFocusedPane: (pane) => {
        set({ focusedPane: pane });
      },

      setActiveTabInPane: (tabId, pane) => {
        if (pane === "right") {
          set({ activeRightTabId: tabId, focusedPane: "right" });
        } else {
          set({ activeTabId: tabId, focusedPane: "left" });
        }
      },
    }),
    {
      name: "wren-tabs",
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        splitEnabled: state.splitEnabled,
        activeRightTabId: state.activeRightTabId,
        focusedPane: state.focusedPane,
      }),
    }
  )
);
