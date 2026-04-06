import type { Attachment, Collection, Tag as TagType } from "@/services/tauri";
import type { Tab } from "@/stores/tabStore";
import type { ViewMode, SortField, LibraryLayout, ColumnId, ColumnConfig } from "@/stores/uiStore";

export type ViewerContext = "library" | "pdf" | "epub" | "html" | "image" | "note" | "markdown" | "welcome" | "weblink" | "none";

export type SubMenu =
  | "collection"
  | "tag"
  | "removeFromCollection"
  | "removeTag"
  | "exportCollection"
  | "exportTag"
  | "renameCollection"
  | "deleteCollection"
  | "renameTag"
  | "deleteTag"
  | "addAttachment"
  | "deleteAttachment"
  | "reindexAttachment"
  | "createEntryType"
  | null;

export interface ItemTypeInfo {
  id: number;
  name: string;
  displayName: string;
}

export interface CommandHandlers {
  handleSelect: (callback: () => void) => void;
  handleImportPdf: () => void;
  handleImportFolder: () => void;
  handleImportBibtex: () => void;
  handleImportCslJson: () => void;
  handleImportBiblatexWithFiles: () => void;
  handleExportSelectedBibtex: () => void;
  handleExportSelectedCsl: () => void;
  handleExportAllBibtex: () => void;
  handleExportAllCsl: () => void;
  handleCopyBibtex: () => void;
  handleCopyCsl: () => void;
  handleDeleteSelected: () => void;
  handleParseWithAI: () => void;
  handleDuplicate: () => void;
  handleShowInFinder: () => void;
  handleCopyTitle: () => void;
  handleCopyWrenLink: () => void;
  handleEmptyTrash: () => void;
  handleRestoreFromTrash: () => void;
  handlePermanentDelete: () => void;
  handleAddPdfAttachment: () => void;
  handleImportPdfAnnotations: () => void;
  handleCreateNote: () => void;
  handleAddMarkdownAttachment: () => void;
  handleToggleViewMode: () => void;
  handleNavigateTo: (filter: 'all' | 'pdfs' | 'notes' | 'recent' | 'untagged' | 'duplicates' | 'trash') => void;
  handleOpenDeleteAttachment: () => void;
  handleOpenReindexAttachment: (forceOcr: boolean) => void;
  handleAddToCollection: (collectionId: number) => void;
  handleAddTag: (tagName: string) => void;
  handleCreateAndAddTag: () => void;
  handleRemoveFromCollection: (collectionId: number) => void;
  handleRemoveTag: (tagId: number) => void;
  handleExportCollection: (collectionId: number, name: string, format: "bibtex" | "csl") => void;
  handleExportTag: (tagId: number, name: string, format: "bibtex" | "csl") => void;
  handleExportCollectionWithFiles: (collectionId: number, name: string) => void;
  handleExportTagWithFiles: (tagId: number, name: string) => void;
  handleExportSelectedAsArchive: () => void;
  handleExportCollectionAsArchive: (collectionId: number, name: string) => void;
  handleExportTagAsArchive: (tagId: number, name: string) => void;
  handleExportLibraryAsArchive: () => void;
  handleImportArchive: () => void;
  handleRenameCollection: (collectionId: number) => void;
  handleDeleteCollection: (collectionId: number, name: string) => void;
  handleRenameTag: (tagId: number) => void;
  handleDeleteTag: (tagId: number, name: string) => void;
  handleDeleteAttachment: (attachmentId: number) => void;
  handleReindexAttachmentCmd: (attachmentId: number, forceOcr: boolean) => void;
  handleCreateEntryWithType: (itemType: string) => void;
  openExportDialog: (mode: "selected" | "all") => void;
}

export interface CommandsProps {
  handlers: CommandHandlers;
  viewerContext: ViewerContext;
  contextAttachmentId: number | null;
  subMenu: SubMenu;
  setSubMenu: (menu: SubMenu) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  tabs: Tab[];
  activeTabId: string | null;
  activeRightTabId: string | null;
  activeTab: Tab | undefined;
  tabTypeLabels: Record<string, string>;
  splitEnabled: boolean;
  focusedPane: "left" | "right";
  collections: Collection[];
  tags: TagType[];
  selectedEntryIds: number[];
  activeFilter: 'all' | 'pdfs' | 'notes' | 'recent' | 'untagged' | 'duplicates' | 'trash';
  activeCollectionId: number | null;
  activeTagIds: number[];
  trashCount: number;
  viewModeByFilter: Record<string, ViewMode>;
  sortField: SortField;
  sortDirection: string;
  libraryLayout: LibraryLayout;
  columns: ColumnConfig[];
  theme: string;
  itemTypes: ItemTypeInfo[];
  entryAttachments: Attachment[];
  newTagName: string;
  setNewTagName: (val: string) => void;
  renameInput: string;
  setRenameInput: (val: string) => void;
  selectedItemId: number | null;
  setSelectedItemId: (id: number | null) => void;
  setEntryAttachments: (attachments: Attachment[]) => void;
  savedSearches: { id: number; name: string }[];
  libraryInfoPaneEnabled: boolean;
  tabActions: {
    setActiveTab: (id: string) => void;
    closeTab: (id: string) => void;
    closeOtherTabs: (id: string) => void;
    closeAllTabs: () => void;
    closeTabsToRight: (id: string) => void;
    pinTab: (id: string) => void;
    unpinTab: (id: string) => void;
    duplicateTab: (id: string) => string;
    moveTabToPane: (id: string, pane: "left" | "right") => void;
    disableSplit: () => void;
    setFocusedPane: (pane: "left" | "right") => void;
    openTab: (tab: Omit<Tab, "id">) => string;
  };
  uiActions: {
    toggleSidebar: () => void;
    toggleInfoPane: () => void;
    toggleLibraryInfoPane: () => void;
    togglePdfLeftPanel: () => void;
    toggleHtmlLeftPanel: () => void;
    toggleEpubLeftPanel: () => void;
    setSettingsOpen: (open: boolean) => void;
    setNewCollectionDialogOpen: (open: boolean) => void;
    setTagManagementDialogOpen: (open: boolean) => void;
    setCollectionManagementDialogOpen: (open: boolean) => void;
    setAdvancedSearchOpen: (open: boolean) => void;
    setViewMode: (mode: ViewMode) => void;
    setSort: (field: SortField, direction?: "asc" | "desc") => void;
    setLibraryLayout: (layout: LibraryLayout) => void;
    toggleColumnVisibility: (id: ColumnId) => void;
    resetColumns: () => void;
    setTheme: (theme: "system" | "light" | "dark") => void;
    refreshLibrary: () => Promise<void>;
    setActiveSavedSearch: (id: number) => void;
    setActiveFilter: (filter: 'all' | 'pdfs' | 'notes' | 'recent' | 'untagged' | 'duplicates' | 'trash') => void;
    reindexAttachment: (id: number, opts?: { forceOcr: boolean }) => Promise<void>;
    ragIndexAll: () => Promise<string>;
    ragRebuild: () => Promise<void>;
    showEntryInFinder: (id: number) => Promise<void>;
    getEntry: (id: number) => Promise<unknown>;
  };
}
