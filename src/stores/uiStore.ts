import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewMode = "list" | "card";
export type SortField = "title" | "dateAdded" | "dateModified";
export type SortDirection = "asc" | "desc";
export type LibraryLayout = "normal" | "stacked";

interface UIState {
  // Layout dimensions
  sidebarWidth: number;
  rightPaneWidth: number;
  infoPanelHeight: number;

  // View settings
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  libraryLayout: LibraryLayout;

  // Command palette
  commandPaletteOpen: boolean;

  // Settings dialog
  settingsOpen: boolean;

  // Active filters
  activeFilter: "all" | "pdfs" | "notes" | "recent" | "untagged";

  // Actions
  setSidebarWidth: (width: number) => void;
  setRightPaneWidth: (width: number) => void;
  setInfoPanelHeight: (height: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setLibraryLayout: (layout: LibraryLayout) => void;
  setSort: (field: SortField, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setSettingsOpen: (open: boolean) => void;
  setActiveFilter: (filter: UIState["activeFilter"]) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Defaults
      sidebarWidth: 240,
      rightPaneWidth: 320,
      infoPanelHeight: 250,
      viewMode: "list",
      sortField: "dateAdded",
      sortDirection: "desc",
      libraryLayout: "normal",
      commandPaletteOpen: false,
      settingsOpen: false,
      activeFilter: "all",

      // Actions
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(180, Math.min(400, width)) }),

      setRightPaneWidth: (width) =>
        set({ rightPaneWidth: Math.max(250, Math.min(500, width)) }),

      setInfoPanelHeight: (height) =>
        set({ infoPanelHeight: Math.max(150, Math.min(400, height)) }),

      setViewMode: (mode) => set({ viewMode: mode }),

      setLibraryLayout: (layout) => set({ libraryLayout: layout }),

      setSort: (field, direction) => {
        const state = get();
        set({
          sortField: field,
          sortDirection:
            direction ??
            (state.sortField === field && state.sortDirection === "asc"
              ? "desc"
              : "asc"),
        });
      },

      toggleSortDirection: () =>
        set((state) => ({
          sortDirection: state.sortDirection === "asc" ? "desc" : "asc",
        })),

      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setActiveFilter: (filter) => set({ activeFilter: filter }),
    }),
    {
      name: "etal-ui",
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        rightPaneWidth: state.rightPaneWidth,
        infoPanelHeight: state.infoPanelHeight,
        viewMode: state.viewMode,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
        libraryLayout: state.libraryLayout,
      }),
    }
  )
);
