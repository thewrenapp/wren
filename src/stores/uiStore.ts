import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ViewMode = 'list' | 'card';
export type SortField = 'title' | 'dateAdded' | 'dateModified' | 'creator' | 'year' | 'itemType';
export type SortDirection = 'asc' | 'desc';
export type LibraryLayout = 'normal' | 'stacked';
export type InfoPanePosition = 'side' | 'bottom';

// Column configuration for the table view
export type ColumnId =
  | 'title'
  | 'creator'
  | 'itemType'
  | 'year'
  | 'dateAdded'
  | 'dateModified'
  | 'publication'
  | 'publisher'
  | 'attachments'
  | 'tags'
  | 'doi';

export interface ColumnConfig {
  id: ColumnId;
  label: string;
  visible: boolean;
  width: number; // in pixels
  minWidth: number;
}

// Default column configuration
export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'title', label: 'Title', visible: true, width: 280, minWidth: 120 },
  { id: 'creator', label: 'Creator', visible: true, width: 140, minWidth: 80 },
  { id: 'year', label: 'Year', visible: true, width: 50, minWidth: 40 },
  { id: 'itemType', label: 'Type', visible: false, width: 90, minWidth: 60 },
  { id: 'dateAdded', label: 'Added', visible: true, width: 80, minWidth: 60 },
  { id: 'dateModified', label: 'Modified', visible: false, width: 80, minWidth: 60 },
  { id: 'publication', label: 'Publication', visible: false, width: 100, minWidth: 80 },
  { id: 'publisher', label: 'Publisher', visible: false, width: 100, minWidth: 80 },
  { id: 'attachments', label: 'Files', visible: true, width: 55, minWidth: 40 },
  { id: 'tags', label: 'Tags', visible: false, width: 100, minWidth: 80 },
  { id: 'doi', label: 'DOI', visible: false, width: 100, minWidth: 80 },
];

interface UIState {
  // Layout dimensions
  sidebarWidth: number;
  rightPaneWidth: number;
  infoPanelHeight: number;

  // View settings
  viewModeByFilter: Record<UIState['activeFilter'], ViewMode>;
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
  htmlLeftPanelOpen: boolean;
  epubLeftPanelOpen: boolean;
  libraryInfoPaneEnabled: boolean;

  // Command palette
  commandPaletteOpen: boolean;
  commandPaletteMode: 'default' | 'full' | 'advanced' | 'ai';

  // Settings dialog
  settingsOpen: boolean;

  // New Collection dialog
  newCollectionDialogOpen: boolean;

  // Tag Management dialog
  tagManagementDialogOpen: boolean;

  // Collection Management dialog
  collectionManagementDialogOpen: boolean;

  // Advanced Search dialog
  advancedSearchOpen: boolean;

  // Active filters
  activeFilter: 'all' | 'pdfs' | 'notes' | 'recent' | 'untagged' | 'duplicates' | 'trash';

  // Tag display settings
  hideImportedTags: boolean;

  // Delete confirmation
  deleteConfirmation: {
    open: boolean;
    entryIds: number[];
    onConfirm: (() => void) | null;
  };

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
  setCommandPaletteMode: (mode: UIState['commandPaletteMode']) => void;
  toggleCommandPalette: () => void;
  setSettingsOpen: (open: boolean) => void;
  setNewCollectionDialogOpen: (open: boolean) => void;
  setTagManagementDialogOpen: (open: boolean) => void;
  setCollectionManagementDialogOpen: (open: boolean) => void;
  setAdvancedSearchOpen: (open: boolean) => void;
  setInfoPaneOpen: (open: boolean) => void;
  toggleInfoPane: () => void;
  setPdfLeftPanelOpen: (open: boolean) => void;
  togglePdfLeftPanel: () => void;
  setHtmlLeftPanelOpen: (open: boolean) => void;
  toggleHtmlLeftPanel: () => void;
  setEpubLeftPanelOpen: (open: boolean) => void;
  toggleEpubLeftPanel: () => void;
  setLibraryInfoPaneEnabled: (enabled: boolean) => void;
  toggleLibraryInfoPane: () => void;
  setActiveFilter: (filter: UIState['activeFilter']) => void;

  // Tag display actions
  setHideImportedTags: (hide: boolean) => void;
  toggleHideImportedTags: () => void;

  // Column actions
  toggleColumnVisibility: (columnId: ColumnId) => void;
  setColumnWidth: (columnId: ColumnId, width: number) => void;
  moveColumn: (columnId: ColumnId, direction: 'left' | 'right') => void;
  resetColumns: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Delete confirmation actions
  showDeleteConfirmation: (entryIds: number[], onConfirm: () => void) => void;
  hideDeleteConfirmation: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Defaults
      sidebarWidth: 240,
      rightPaneWidth: 320,
      infoPanelHeight: 250,
      viewModeByFilter: {
        all: 'list',
        pdfs: 'list',
        notes: 'list',
        recent: 'list',
        untagged: 'list',
        duplicates: 'list',
        trash: 'list',
      },
      sortField: 'dateAdded',
      sortDirection: 'desc',
      secondarySortField: null,
      secondarySortDirection: 'asc',
      libraryLayout: 'normal',
      pdfInfoPanePosition: 'side',
      columns: [...DEFAULT_COLUMNS],
      infoPaneOpen: true,
      pdfLeftPanelOpen: true,
      htmlLeftPanelOpen: true,
      epubLeftPanelOpen: true,
      libraryInfoPaneEnabled: true,
      commandPaletteOpen: false,
      commandPaletteMode: 'default',
      settingsOpen: false,
      newCollectionDialogOpen: false,
      tagManagementDialogOpen: false,
      collectionManagementDialogOpen: false,
      advancedSearchOpen: false,
      activeFilter: 'all',
      hideImportedTags: true,
      sidebarCollapsed: false,
      deleteConfirmation: {
        open: false,
        entryIds: [],
        onConfirm: null,
      },

      // Actions
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(400, width)) }),

      setRightPaneWidth: (width) => set({ rightPaneWidth: Math.max(250, Math.min(500, width)) }),

      setInfoPanelHeight: (height) =>
        set({ infoPanelHeight: Math.max(150, Math.min(400, height)) }),

      setViewMode: (mode) =>
        set((state) => ({
          viewModeByFilter: {
            ...state.viewModeByFilter,
            [state.activeFilter]: mode,
          },
        })),

      setLibraryLayout: (layout) => set({ libraryLayout: layout }),

      setPdfInfoPanePosition: (position) => set({ pdfInfoPanePosition: position }),

      setSort: (field, direction) => {
        const state = get();
        set({
          sortField: field,
          sortDirection:
            direction ??
            (state.sortField === field && state.sortDirection === 'asc' ? 'desc' : 'asc'),
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
          sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
        })),

      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setCommandPaletteMode: (mode) => set({ commandPaletteMode: mode }),

      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setNewCollectionDialogOpen: (open) => set({ newCollectionDialogOpen: open }),

      setTagManagementDialogOpen: (open) => set({ tagManagementDialogOpen: open }),

      setCollectionManagementDialogOpen: (open) => set({ collectionManagementDialogOpen: open }),

      setAdvancedSearchOpen: (open) => set({ advancedSearchOpen: open }),

      setInfoPaneOpen: (open) => set({ infoPaneOpen: open }),

      toggleInfoPane: () => set((state) => ({ infoPaneOpen: !state.infoPaneOpen })),

      setPdfLeftPanelOpen: (open) => set({ pdfLeftPanelOpen: open }),

      togglePdfLeftPanel: () => set((state) => ({ pdfLeftPanelOpen: !state.pdfLeftPanelOpen })),

      setHtmlLeftPanelOpen: (open) => set({ htmlLeftPanelOpen: open }),

      toggleHtmlLeftPanel: () => set((state) => ({ htmlLeftPanelOpen: !state.htmlLeftPanelOpen })),

      setEpubLeftPanelOpen: (open) => set({ epubLeftPanelOpen: open }),

      toggleEpubLeftPanel: () => set((state) => ({ epubLeftPanelOpen: !state.epubLeftPanelOpen })),

      setLibraryInfoPaneEnabled: (enabled) => set({ libraryInfoPaneEnabled: enabled }),
      toggleLibraryInfoPane: () => set((state) => ({ libraryInfoPaneEnabled: !state.libraryInfoPaneEnabled })),

      setActiveFilter: (filter) => set({ activeFilter: filter }),

      // Tag display actions
      setHideImportedTags: (hide) => set({ hideImportedTags: hide }),
      toggleHideImportedTags: () => set((state) => ({ hideImportedTags: !state.hideImportedTags })),

      // Column actions
      toggleColumnVisibility: (columnId) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId ? { ...col, visible: !col.visible } : col,
          ),
        })),

      setColumnWidth: (columnId, width) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId ? { ...col, width: Math.max(col.minWidth, width) } : col,
          ),
        })),

      moveColumn: (columnId, direction) =>
        set((state) => {
          const columns = [...state.columns];
          const index = columns.findIndex((col) => col.id === columnId);
          if (index === -1) return state;

          const newIndex =
            direction === 'left'
              ? Math.max(0, index - 1)
              : Math.min(columns.length - 1, index + 1);

          if (newIndex === index) return state;

          const [column] = columns.splice(index, 1);
          columns.splice(newIndex, 0, column);
          return { columns };
        }),

      resetColumns: () => set({ columns: [...DEFAULT_COLUMNS] }),

      // Sidebar
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      showDeleteConfirmation: (entryIds, onConfirm) =>
        set({
          deleteConfirmation: {
            open: true,
            entryIds,
            onConfirm,
          },
        }),

      hideDeleteConfirmation: () =>
        set({
          deleteConfirmation: {
            open: false,
            entryIds: [],
            onConfirm: null,
          },
        }),
    }),
    {
      name: 'wren-ui',
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        rightPaneWidth: state.rightPaneWidth,
        infoPanelHeight: state.infoPanelHeight,
        viewModeByFilter: state.viewModeByFilter,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
        secondarySortField: state.secondarySortField,
        secondarySortDirection: state.secondarySortDirection,
        libraryLayout: state.libraryLayout,
        pdfInfoPanePosition: state.pdfInfoPanePosition,
        infoPaneOpen: state.infoPaneOpen,
        pdfLeftPanelOpen: state.pdfLeftPanelOpen,
        htmlLeftPanelOpen: state.htmlLeftPanelOpen,
        epubLeftPanelOpen: state.epubLeftPanelOpen,
        columns: state.columns,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
