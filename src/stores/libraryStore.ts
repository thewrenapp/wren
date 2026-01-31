import { create } from "zustand";

// =====================================================
// Types: Entry-Attachment Model
// =====================================================

export interface Creator {
  creatorType: string; // "author", "editor", "translator", etc.
  firstName?: string;
  lastName?: string;
  name?: string; // For single-field names (institutions)
}

export interface Entry {
  id: string;
  key: string;
  entryType: string;
  entryTypeDisplay: string;
  title: string;
  creators: Creator[];
  publicationDate?: string;
  doi?: string;
  isbn?: string;
  issn?: string;
  url?: string;
  publisher?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstract?: string;
  repository?: string;
  archiveId?: string;
  language?: string;
  rights?: string;
  extra?: string;
  dateAdded: string;
  dateModified: string;
  tags: Tag[];
  collections: string[];
  attachments: Attachment[];
  attachmentCount: number;
}

export interface EntrySummary {
  id: string;
  key: string;
  entryType: string;
  title: string;
  creatorsDisplay: string;
  year?: string;
  dateAdded: string;
  tags: Tag[];
  attachmentCount: number;
  hasPdf: boolean;
  hasNote: boolean;
  thumbnailPath?: string;
}

export interface Attachment {
  id: string;
  key: string;
  entryId: string;
  attachmentType: string;
  attachmentTypeDisplay: string;
  title?: string;
  filePath?: string;
  fileHash?: string;
  fileSize?: number;
  url?: string;
  pageCount?: number;
  frontmatter?: string;
  thumbnailPath?: string;
  dateAdded: string;
  dateModified: string;
}

export interface EntryType {
  id: string;
  name: string;
  displayName: string;
  icon?: string;
}

export interface AttachmentTypeInfo {
  id: string;
  name: string;
  displayName: string;
  icon?: string;
}

export interface Collection {
  id: string;
  key: string;
  name: string;
  color?: string;
  icon?: string;
  itemCount: number;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  itemCount: number;
}

// Filter types for the sidebar
export type LibraryFilter =
  | { type: "all" }
  | { type: "pdf" }
  | { type: "note" }
  | { type: "collection"; id: string }
  | { type: "tag"; id: string };

interface LibraryState {
  // Data
  entries: EntrySummary[];
  currentEntry: Entry | null;
  entryTypes: EntryType[];
  attachmentTypes: AttachmentTypeInfo[];
  collections: Collection[];
  tags: Tag[];

  // Selection
  selectedEntryIds: string[];

  // Filters
  activeFilter: LibraryFilter;
  activeCollectionId: string | null;
  activeTagId: string | null;
  searchQuery: string;

  // Expanded entries (for tree view)
  expandedEntryIds: string[];

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Attachment cache invalidation
  attachmentVersion: number;

  // Entry Actions
  setEntries: (entries: EntrySummary[]) => void;
  addEntry: (entry: EntrySummary) => void;
  updateEntry: (id: string, updates: Partial<EntrySummary>) => void;
  removeEntry: (id: string) => void;
  setCurrentEntry: (entry: Entry | null) => void;

  // Entry Types
  setEntryTypes: (types: EntryType[]) => void;
  setAttachmentTypes: (types: AttachmentTypeInfo[]) => void;

  // Collection Actions
  setCollections: (collections: Collection[]) => void;
  addCollection: (collection: Collection) => void;
  updateCollection: (id: string, updates: Partial<Collection>) => void;
  removeCollection: (id: string) => void;

  // Tag Actions
  setTags: (tags: Tag[]) => void;
  addTag: (tag: Tag) => void;
  updateTag: (id: string, updates: Partial<Tag>) => void;
  removeTag: (id: string) => void;

  // Selection Actions
  selectEntry: (id: string, multi?: boolean) => void;
  selectEntries: (ids: string[]) => void;
  clearSelection: () => void;
  toggleEntryExpanded: (id: string) => void;

  // Filter Actions
  setFilter: (filter: LibraryFilter) => void;
  setActiveCollection: (id: string | null) => void;
  setActiveTag: (id: string | null) => void;
  setSearchQuery: (query: string) => void;

  // Loading Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Attachment Actions
  invalidateAttachments: () => void;
}

export const useLibraryStore = create<LibraryState>()((set) => ({
  // Initial state
  entries: [],
  currentEntry: null,
  entryTypes: [],
  attachmentTypes: [],
  collections: [],
  tags: [],
  selectedEntryIds: [],
  activeFilter: { type: "all" },
  activeCollectionId: null,
  activeTagId: null,
  searchQuery: "",
  expandedEntryIds: [],
  isLoading: false,
  error: null,
  attachmentVersion: 0,

  // Entry actions
  setEntries: (entries) => set({ entries }),

  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries],
    })),

  updateEntry: (id, updates) =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === id ? { ...entry, ...updates } : entry
      ),
    })),

  removeEntry: (id) =>
    set((state) => ({
      entries: state.entries.filter((entry) => entry.id !== id),
      selectedEntryIds: state.selectedEntryIds.filter((i) => i !== id),
      expandedEntryIds: state.expandedEntryIds.filter((i) => i !== id),
    })),

  setCurrentEntry: (entry) => set({ currentEntry: entry }),

  // Entry/Attachment Types
  setEntryTypes: (types) => set({ entryTypes: types }),
  setAttachmentTypes: (types) => set({ attachmentTypes: types }),

  // Collection actions
  setCollections: (collections) => set({ collections }),

  addCollection: (collection) =>
    set((state) => ({
      collections: [...state.collections, collection],
    })),

  updateCollection: (id, updates) =>
    set((state) => ({
      collections: state.collections.map((col) =>
        col.id === id ? { ...col, ...updates } : col
      ),
    })),

  removeCollection: (id) =>
    set((state) => ({
      collections: state.collections.filter((col) => col.id !== id),
      activeCollectionId:
        state.activeCollectionId === id ? null : state.activeCollectionId,
      activeFilter:
        state.activeFilter.type === "collection" &&
        state.activeFilter.id === id
          ? { type: "all" }
          : state.activeFilter,
    })),

  // Tag actions
  setTags: (tags) => set({ tags }),

  addTag: (tag) =>
    set((state) => ({
      tags: [...state.tags, tag],
    })),

  updateTag: (id, updates) =>
    set((state) => ({
      tags: state.tags.map((tag) =>
        tag.id === id ? { ...tag, ...updates } : tag
      ),
    })),

  removeTag: (id) =>
    set((state) => ({
      tags: state.tags.filter((tag) => tag.id !== id),
      activeTagId: state.activeTagId === id ? null : state.activeTagId,
      activeFilter:
        state.activeFilter.type === "tag" && state.activeFilter.id === id
          ? { type: "all" }
          : state.activeFilter,
    })),

  // Selection actions
  selectEntry: (id, multi = false) => {
    set((state) => {
      if (multi) {
        const isSelected = state.selectedEntryIds.includes(id);
        return {
          selectedEntryIds: isSelected
            ? state.selectedEntryIds.filter((i) => i !== id)
            : [...state.selectedEntryIds, id],
        };
      }
      return { selectedEntryIds: [id] };
    });
  },

  selectEntries: (ids) => set({ selectedEntryIds: ids }),

  clearSelection: () => set({ selectedEntryIds: [] }),

  toggleEntryExpanded: (id) =>
    set((state) => ({
      expandedEntryIds: state.expandedEntryIds.includes(id)
        ? state.expandedEntryIds.filter((i) => i !== id)
        : [...state.expandedEntryIds, id],
    })),

  // Filter actions
  setFilter: (filter) =>
    set({
      activeFilter: filter,
      activeCollectionId: filter.type === "collection" ? filter.id : null,
      activeTagId: filter.type === "tag" ? filter.id : null,
    }),

  setActiveCollection: (id) =>
    set({
      activeCollectionId: id,
      activeTagId: null,
      activeFilter: id ? { type: "collection", id } : { type: "all" },
    }),

  setActiveTag: (id) =>
    set({
      activeTagId: id,
      activeCollectionId: null,
      activeFilter: id ? { type: "tag", id } : { type: "all" },
    }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  // Loading actions
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  // Attachment cache invalidation
  invalidateAttachments: () =>
    set((state) => ({ attachmentVersion: state.attachmentVersion + 1 })),
}));
