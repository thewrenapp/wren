import { create } from 'zustand';
import type {
  Entry,
  EntrySummary,
  Attachment,
  Tag,
  Collection,
  ItemType,
  AttachmentType,
} from '@/types/schema';

// Re-export types for convenience
export type { Entry, EntrySummary, Attachment, Tag, Collection, ItemType, AttachmentType };

// Filter types for the sidebar
export type LibraryFilter =
  | { type: 'all' }
  | { type: 'pdf' }
  | { type: 'note' }
  | { type: 'collection'; id: number }
  | { type: 'tag'; ids: number[] };

// Tag filter mode
export type TagFilterMode = 'and' | 'or';
export type LibrarySearchScope = 'title_creator_year' | 'fields_tags' | 'everything';

interface LibraryState {
  // Data
  entries: EntrySummary[];
  currentEntry: Entry | null;
  itemTypes: ItemType[];
  attachmentTypes: AttachmentType[];
  collections: Collection[];
  tags: Tag[];
  entryCounts: {
    total: number;
    pdf: number;
    note: number;
    recent: number;
    untagged: number;
  };
  currentTotal: number;

  // Selection
  selectedEntryIds: number[];

  // Filters
  activeFilter: LibraryFilter;
  activeCollectionId: number | null;
  activeTagIds: number[];
  tagFilterMode: TagFilterMode;
  searchQuery: string;
  searchScope: LibrarySearchScope;

  // Expanded entries (for tree view)
  expandedEntryIds: number[];

  // Loading states
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Attachment cache invalidation
  attachmentVersion: number;

  // Entry cache invalidation (for info panel refetch)
  entryVersion: number;

  // Trash
  trashCount: number;
  trashedEntries: EntrySummary[];

  // Entry Actions
  setEntries: (entries: EntrySummary[]) => void;
  appendEntries: (entries: EntrySummary[]) => void;
  addEntry: (entry: EntrySummary) => void;
  updateEntry: (id: number, updates: Partial<EntrySummary>) => void;
  removeEntry: (id: number) => void;
  setCurrentEntry: (entry: Entry | null) => void;
  setEntryCounts: (counts: LibraryState['entryCounts']) => void;
  setCurrentTotal: (total: number) => void;
  setHasMore: (hasMore: boolean) => void;
  setLoadingMore: (loading: boolean) => void;
  setPageOffset: (offset: number) => void;
  resetPaging: () => void;

  // Type Actions
  setItemTypes: (types: ItemType[]) => void;
  setAttachmentTypes: (types: AttachmentType[]) => void;

  // Collection Actions
  setCollections: (collections: Collection[]) => void;
  addCollection: (collection: Collection) => void;
  updateCollection: (id: number, updates: Partial<Collection>) => void;
  removeCollection: (id: number) => void;

  // Tag Actions
  setTags: (tags: Tag[]) => void;
  addTag: (tag: Tag) => void;
  updateTag: (id: number, updates: Partial<Tag>) => void;
  removeTag: (id: number) => void;

  // Selection Actions
  selectEntry: (id: number, multi?: boolean) => void;
  selectEntries: (ids: number[]) => void;
  clearSelection: () => void;
  toggleEntryExpanded: (id: number) => void;

  // Filter Actions
  setFilter: (filter: LibraryFilter) => void;
  setActiveCollection: (id: number | null) => void;
  toggleActiveTag: (id: number) => void;
  setActiveTags: (ids: number[]) => void;
  setTagFilterMode: (mode: TagFilterMode) => void;
  clearActiveTags: () => void;
  setSearchQuery: (query: string) => void;
  setSearchScope: (scope: LibrarySearchScope) => void;

  // Loading Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Attachment Actions
  invalidateAttachments: () => void;

  // Entry Actions (cache invalidation)
  invalidateEntry: () => void;

  // Trash Actions
  setTrashCount: (count: number) => void;
  setTrashedEntries: (entries: EntrySummary[]) => void;

  // Refresh function (stored in store to avoid global mutable state)
  _refreshFn: (() => Promise<void>) | null;
  _setRefreshFn: (fn: (() => Promise<void>) | null) => void;
  refreshLibrary: () => Promise<void>;

  // Load more function for lazy loading
  _loadMoreFn: (() => Promise<void>) | null;
  _setLoadMoreFn: (fn: (() => Promise<void>) | null) => void;
  loadNextPage: () => Promise<void>;

  // Pagination state
  hasMore: boolean;
  pageOffset: number;
}

export const useLibraryStore = create<LibraryState>()((set) => ({
  // Initial state
  entries: [],
  currentEntry: null,
  itemTypes: [],
  attachmentTypes: [],
  collections: [],
  tags: [],
  entryCounts: {
    total: 0,
    pdf: 0,
    note: 0,
    recent: 0,
    untagged: 0,
  },
  currentTotal: 0,
  selectedEntryIds: [],
  activeFilter: { type: 'all' },
  activeCollectionId: null,
  activeTagIds: [],
  tagFilterMode: 'or',
  searchQuery: '',
  searchScope: 'title_creator_year',
  expandedEntryIds: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  attachmentVersion: 0,
  entryVersion: 0,
  trashCount: 0,
  trashedEntries: [],
  hasMore: false,
  pageOffset: 0,

  // Entry actions
  setEntries: (entries) => set({ entries }),
  appendEntries: (entries) =>
    set((state) => {
      if (entries.length === 0) return { entries: state.entries };
      const existingIds = new Set(state.entries.map((entry) => entry.id));
      const nextEntries = entries.filter((entry) => !existingIds.has(entry.id));
      if (nextEntries.length === 0) {
        return { entries: state.entries };
      }
      return { entries: [...state.entries, ...nextEntries] };
    }),
  setEntryCounts: (counts) => set({ entryCounts: counts }),
  setCurrentTotal: (total) => set({ currentTotal: total }),
  setHasMore: (hasMore) => set({ hasMore }),
  setLoadingMore: (loading) => set({ isLoadingMore: loading }),
  setPageOffset: (offset) => set({ pageOffset: offset }),
  resetPaging: () =>
    set({
      entries: [],
      currentTotal: 0,
      hasMore: false,
      pageOffset: 0,
    }),

  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries],
      currentTotal: state.currentTotal + 1,
      entryCounts: {
        ...state.entryCounts,
        total: state.entryCounts.total + 1,
      },
    })),

  updateEntry: (id, updates) =>
    set((state) => ({
      entries: state.entries.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)),
    })),

  removeEntry: (id) =>
    set((state) => ({
      entries: state.entries.filter((entry) => entry.id !== id),
      selectedEntryIds: state.selectedEntryIds.filter((i) => i !== id),
      expandedEntryIds: state.expandedEntryIds.filter((i) => i !== id),
    })),

  setCurrentEntry: (entry) => set({ currentEntry: entry }),

  // Type actions
  setItemTypes: (types) => set({ itemTypes: types }),
  setAttachmentTypes: (types) => set({ attachmentTypes: types }),

  // Collection actions
  setCollections: (collections) => set({ collections }),

  addCollection: (collection) =>
    set((state) => ({
      collections: [...state.collections, collection],
    })),

  updateCollection: (id, updates) =>
    set((state) => ({
      collections: state.collections.map((col) => (col.id === id ? { ...col, ...updates } : col)),
    })),

  removeCollection: (id) =>
    set((state) => ({
      collections: state.collections.filter((col) => col.id !== id),
      activeCollectionId: state.activeCollectionId === id ? null : state.activeCollectionId,
      activeFilter:
        state.activeFilter.type === 'collection' && state.activeFilter.id === id
          ? { type: 'all' }
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
      tags: state.tags.map((tag) => (tag.id === id ? { ...tag, ...updates } : tag)),
    })),

  removeTag: (id) =>
    set((state) => {
      const newActiveTagIds = state.activeTagIds.filter((tagId) => tagId !== id);
      return {
        tags: state.tags.filter((tag) => tag.id !== id),
        activeTagIds: newActiveTagIds,
        activeFilter:
          state.activeFilter.type === 'tag' && state.activeFilter.ids.includes(id)
            ? newActiveTagIds.length > 0
              ? { type: 'tag', ids: newActiveTagIds }
              : { type: 'all' }
            : state.activeFilter,
      };
    }),

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
      activeCollectionId: filter.type === 'collection' ? filter.id : null,
      activeTagIds: filter.type === 'tag' ? filter.ids : [],
    }),

  setActiveCollection: (id) =>
    set({
      activeCollectionId: id,
      activeTagIds: [],
      activeFilter: id ? { type: 'collection', id } : { type: 'all' },
    }),

  toggleActiveTag: (id) =>
    set((state) => {
      const isSelected = state.activeTagIds.includes(id);
      const newIds = isSelected
        ? state.activeTagIds.filter((tagId) => tagId !== id)
        : [...state.activeTagIds, id];
      return {
        activeTagIds: newIds,
        activeCollectionId: null,
        // Stay in tag mode even when empty (user explicitly chose tag filtering)
        activeFilter: { type: 'tag', ids: newIds },
      };
    }),

  setActiveTags: (ids) =>
    set({
      activeTagIds: ids,
      activeCollectionId: null,
      // Stay in tag mode even with empty selection
      activeFilter: { type: 'tag', ids },
    }),

  setTagFilterMode: (mode) => set({ tagFilterMode: mode }),

  clearActiveTags: () =>
    set({
      activeTagIds: [],
      // Go back to showing all items (exit tag mode)
      activeFilter: { type: 'all' },
    }),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchScope: (scope) => set({ searchScope: scope }),

  // Loading actions
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  // Attachment cache invalidation
  invalidateAttachments: () =>
    set((state) => ({ attachmentVersion: state.attachmentVersion + 1 })),

  // Entry cache invalidation (for info panel refetch)
  invalidateEntry: () => set((state) => ({ entryVersion: state.entryVersion + 1 })),

  // Trash actions
  setTrashCount: (count) => set({ trashCount: count }),
  setTrashedEntries: (entries) => set({ trashedEntries: entries }),

  // Refresh function management (replaces global mutable state)
  _refreshFn: null,
  _setRefreshFn: (fn) => set({ _refreshFn: fn }),
  refreshLibrary: async () => {
    const state = useLibraryStore.getState();
    if (state._refreshFn) {
      await state._refreshFn();
    }
  },

  // Load more function management
  _loadMoreFn: null,
  _setLoadMoreFn: (fn) => set({ _loadMoreFn: fn }),
  loadNextPage: async () => {
    const state = useLibraryStore.getState();
    if (state._loadMoreFn) {
      await state._loadMoreFn();
    }
  },
}));
