import { create } from "zustand";

// Types
export interface Item {
  id: string;
  key: string;
  type: "pdf" | "markdown";
  title: string;
  dateAdded: string;
  dateModified: string;
  tags: Tag[];
  collections: string[];
}

export interface PdfItem extends Item {
  type: "pdf";
  filePath: string;
  pageCount?: number;
  author?: string;
  abstract?: string;
  doi?: string;
  publicationDate?: string;
  publisher?: string;
  journal?: string;
}

export interface MarkdownItem extends Item {
  type: "markdown";
  filePath: string;
  frontmatter?: Record<string, unknown>;
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

export interface ItemLink {
  id: string;
  sourceItemId: string;
  targetItemId: string;
  linkType: string;
  linkTypeDisplay: string;
  context?: string;
}

interface LibraryState {
  // Data
  items: Item[];
  collections: Collection[];
  tags: Tag[];

  // Selection
  selectedItemIds: string[];
  activeCollectionId: string | null;
  activeTagId: string | null;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setItems: (items: Item[]) => void;
  addItem: (item: Item) => void;
  updateItem: (id: string, updates: Partial<Item>) => void;
  removeItem: (id: string) => void;

  setCollections: (collections: Collection[]) => void;
  addCollection: (collection: Collection) => void;
  updateCollection: (id: string, updates: Partial<Collection>) => void;
  removeCollection: (id: string) => void;

  setTags: (tags: Tag[]) => void;
  addTag: (tag: Tag) => void;
  updateTag: (id: string, updates: Partial<Tag>) => void;
  removeTag: (id: string) => void;

  // Selection actions
  selectItem: (id: string, multi?: boolean) => void;
  selectItems: (ids: string[]) => void;
  clearSelection: () => void;
  setActiveCollection: (id: string | null) => void;
  setActiveTag: (id: string | null) => void;

  // Loading actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useLibraryStore = create<LibraryState>()((set, _get) => ({
  // Initial state
  items: [],
  collections: [],
  tags: [],
  selectedItemIds: [],
  activeCollectionId: null,
  activeTagId: null,
  isLoading: false,
  error: null,

  // Item actions
  setItems: (items) => set({ items }),

  addItem: (item) =>
    set((state) => ({
      items: [item, ...state.items],
    })),

  updateItem: (id, updates) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    })),

  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      selectedItemIds: state.selectedItemIds.filter((i) => i !== id),
    })),

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
    })),

  // Selection actions
  selectItem: (id, multi = false) => {
    set((state) => {
      if (multi) {
        const isSelected = state.selectedItemIds.includes(id);
        return {
          selectedItemIds: isSelected
            ? state.selectedItemIds.filter((i) => i !== id)
            : [...state.selectedItemIds, id],
        };
      }
      return { selectedItemIds: [id] };
    });
  },

  selectItems: (ids) => set({ selectedItemIds: ids }),

  clearSelection: () => set({ selectedItemIds: [] }),

  setActiveCollection: (id) =>
    set({
      activeCollectionId: id,
      activeTagId: null, // Clear tag filter when selecting collection
    }),

  setActiveTag: (id) =>
    set({
      activeTagId: id,
      activeCollectionId: null, // Clear collection filter when selecting tag
    }),

  // Loading actions
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}));
