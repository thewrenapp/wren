import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewMode = "list" | "card";
export type SortField = "title" | "dateAdded" | "dateModified" | "creator" | "year" | "entryType";
export type SortDirection = "asc" | "desc";
export type LibraryLayout = "normal" | "stacked";
export type InfoPanePosition = "side" | "bottom";

// Column configuration for the table view
export type ColumnId =
  | "title"
  | "creator"
  | "entryType"
  | "year"
  | "dateAdded"
  | "dateModified"
  | "publication"
  | "publisher"
  | "attachments"
  | "tags"
  | "doi";

export interface ColumnConfig {
  id: ColumnId;
  label: string;
  visible: boolean;
  width: number; // in pixels
  minWidth: number;
}

// Default column configuration
export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "title", label: "Title", visible: true, width: 300, minWidth: 150 },
  { id: "creator", label: "Creator", visible: true, width: 150, minWidth: 80 },
  { id: "year", label: "Year", visible: true, width: 60, minWidth: 50 },
  { id: "entryType", label: "Type", visible: false, width: 100, minWidth: 60 },
  { id: "dateAdded", label: "Date Added", visible: false, width: 100, minWidth: 80 },
  { id: "dateModified", label: "Modified", visible: false, width: 100, minWidth: 80 },
  { id: "publication", label: "Publication", visible: false, width: 150, minWidth: 80 },
  { id: "publisher", label: "Publisher", visible: false, width: 120, minWidth: 80 },
  { id: "attachments", label: "Attachments", visible: true, width: 80, minWidth: 60 },
  { id: "tags", label: "Tags", visible: false, width: 150, minWidth: 80 },
  { id: "doi", label: "DOI", visible: false, width: 150, minWidth: 80 },
];

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
  pdfInfoPanePosition: InfoPanePosition;

  // Column configuration for table view
  columns: ColumnConfig[];
  secondarySortField: SortField | null;
  secondarySortDirection: SortDirection;

  // Panel visibility
  infoPaneOpen: boolean;
  pdfLeftPanelOpen: boolean;

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
  setPdfInfoPanePosition: (position: InfoPanePosition) => void;
  setSort: (field: SortField, direction?: SortDirection) => void;
  setSecondarySort: (field: SortField | null, direction?: SortDirection) => void;
  toggleSortDirection: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setSettingsOpen: (open: boolean) => void;
  setInfoPaneOpen: (open: boolean) => void;
  toggleInfoPane: () => void;
  setPdfLeftPanelOpen: (open: boolean) => void;
  togglePdfLeftPanel: () => void;
  setActiveFilter: (filter: UIState["activeFilter"]) => void;

  // Column actions
  toggleColumnVisibility: (columnId: ColumnId) => void;
  setColumnWidth: (columnId: ColumnId, width: number) => void;
  moveColumn: (columnId: ColumnId, direction: "left" | "right") => void;
  resetColumns: () => void;
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
      secondarySortField: null,
      secondarySortDirection: "asc",
      libraryLayout: "normal",
      pdfInfoPanePosition: "side",
      columns: [...DEFAULT_COLUMNS],
      infoPaneOpen: true,
      pdfLeftPanelOpen: true,
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

      setPdfInfoPanePosition: (position) => set({ pdfInfoPanePosition: position }),

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

      setSecondarySort: (field, direction) => {
        const state = get();
        set({
          secondarySortField: field,
          secondarySortDirection: direction ?? state.secondarySortDirection,
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

      setInfoPaneOpen: (open) => set({ infoPaneOpen: open }),

      toggleInfoPane: () =>
        set((state) => ({ infoPaneOpen: !state.infoPaneOpen })),

      setPdfLeftPanelOpen: (open) => set({ pdfLeftPanelOpen: open }),

      togglePdfLeftPanel: () =>
        set((state) => ({ pdfLeftPanelOpen: !state.pdfLeftPanelOpen })),

      setActiveFilter: (filter) => set({ activeFilter: filter }),

      // Column actions
      toggleColumnVisibility: (columnId) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId ? { ...col, visible: !col.visible } : col
          ),
        })),

      setColumnWidth: (columnId, width) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId
              ? { ...col, width: Math.max(col.minWidth, width) }
              : col
          ),
        })),

      moveColumn: (columnId, direction) =>
        set((state) => {
          const columns = [...state.columns];
          const index = columns.findIndex((col) => col.id === columnId);
          if (index === -1) return state;

          const newIndex =
            direction === "left"
              ? Math.max(0, index - 1)
              : Math.min(columns.length - 1, index + 1);

          if (newIndex === index) return state;

          const [column] = columns.splice(index, 1);
          columns.splice(newIndex, 0, column);
          return { columns };
        }),

      resetColumns: () => set({ columns: [...DEFAULT_COLUMNS] }),
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
        secondarySortField: state.secondarySortField,
        secondarySortDirection: state.secondarySortDirection,
        libraryLayout: state.libraryLayout,
        pdfInfoPanePosition: state.pdfInfoPanePosition,
        infoPaneOpen: state.infoPaneOpen,
        pdfLeftPanelOpen: state.pdfLeftPanelOpen,
        columns: state.columns,
      }),
    }
  )
);
