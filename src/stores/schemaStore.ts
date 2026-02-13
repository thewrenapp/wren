import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ItemType,
  ItemTypeInfo,
  CreatorType,
  FieldDefinition,
  AttachmentType,
} from "@/types/schema";

interface SchemaState {
  // Schema data
  itemTypes: ItemType[];
  creatorTypes: CreatorType[];
  fields: FieldDefinition[];
  attachmentTypes: AttachmentType[];

  // Cache for item type info (includes fields and creator types per type)
  itemTypeInfoCache: Record<string, ItemTypeInfo>;

  // Loading state
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadSchema: () => Promise<void>;
  getItemTypeInfo: (itemType: string) => Promise<ItemTypeInfo | null>;
  getFieldsForItemType: (itemType: string) => Promise<FieldDefinition[]>;
  getCreatorTypesForItemType: (itemType: string) => Promise<CreatorType[]>;
}

export const useSchemaStore = create<SchemaState>()((set, get) => ({
  // Initial state
  itemTypes: [],
  creatorTypes: [],
  fields: [],
  attachmentTypes: [],
  itemTypeInfoCache: {},
  isLoaded: false,
  isLoading: false,
  error: null,

  // Load all schema data
  loadSchema: async () => {
    if (get().isLoaded || get().isLoading) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const [itemTypes, creatorTypes, fields, attachmentTypes] =
        await Promise.all([
          invoke<ItemType[]>("get_all_item_types"),
          invoke<CreatorType[]>("get_all_creator_types"),
          invoke<FieldDefinition[]>("get_all_fields"),
          invoke<AttachmentType[]>("get_attachment_types"),
        ]);

      set({
        itemTypes,
        creatorTypes,
        fields,
        attachmentTypes,
        isLoaded: true,
        isLoading: false,
      });
    } catch (error) {
      console.error("Failed to load schema:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to load schema",
        isLoading: false,
      });
    }
  },

  // Get complete item type info (with fields and creator types)
  getItemTypeInfo: async (itemType: string) => {
    const { itemTypeInfoCache } = get();

    // Check cache first
    if (itemType in itemTypeInfoCache) {
      return itemTypeInfoCache[itemType];
    }

    try {
      const info = await invoke<ItemTypeInfo>("get_item_type_info", {
        itemType,
      });

      // Update cache
      set((state) => ({
        itemTypeInfoCache: { ...state.itemTypeInfoCache, [itemType]: info },
      }));

      return info;
    } catch (error) {
      console.error(`Failed to get item type info for ${itemType}:`, error);
      return null;
    }
  },

  // Get fields valid for a specific item type
  getFieldsForItemType: async (itemType: string) => {
    const info = await get().getItemTypeInfo(itemType);
    return info?.fields || [];
  },

  // Get creator types valid for a specific item type
  getCreatorTypesForItemType: async (itemType: string) => {
    const info = await get().getItemTypeInfo(itemType);
    return (
      info?.creatorTypes.map((ct) => ({
        id: ct.id,
        name: ct.name,
        displayName: ct.displayName,
        cslType: undefined,
      })) || []
    );
  },
}));

// Helper hooks

/**
 * Get item type by name
 */
export function useItemType(name: string): ItemType | undefined {
  const itemTypes = useSchemaStore((state) => state.itemTypes);
  return itemTypes.find((t) => t.name === name);
}

/**
 * Get attachment type by name
 */
export function useAttachmentType(name: string): AttachmentType | undefined {
  const attachmentTypes = useSchemaStore((state) => state.attachmentTypes);
  return attachmentTypes.find((t) => t.name === name);
}
