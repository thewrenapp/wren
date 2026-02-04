// =====================================================
// SCHEMA TYPES (Zotero-compatible)
// =====================================================

/**
 * Item type definition (journalArticle, book, thesis, etc.)
 */
export interface ItemType {
  id: number;
  name: string;
  displayName: string;
  cslType?: string;
  icon?: string;
}

/**
 * Field definition with metadata
 */
export interface FieldDefinition {
  id: number;
  name: string;
  displayName: string;
  cslField?: string;
  fieldType: string; // "text", "date", "number", "url", "identifier"
  sortOrder: number;
  isRequired: boolean;
}

/**
 * Creator type definition
 */
export interface CreatorType {
  id: number;
  name: string;
  displayName: string;
  cslType?: string;
}

/**
 * Creator type with primary flag (for specific item type context)
 */
export interface CreatorTypeInfo {
  id: number;
  name: string;
  displayName: string;
  isPrimary: boolean;
}

/**
 * Complete item type info with valid fields and creator types
 */
export interface ItemTypeInfo {
  id: number;
  name: string;
  displayName: string;
  cslType?: string;
  icon?: string;
  fields: FieldDefinition[];
  creatorTypes: CreatorTypeInfo[];
}

// =====================================================
// ENTRY & CREATOR TYPES
// =====================================================

/**
 * A creator (author, editor, inventor, etc.)
 */
export interface Creator {
  id?: number;
  creatorType: string;
  creatorTypeDisplay?: string;
  firstName?: string;
  lastName?: string;
  name?: string; // For single-field names (institutions)
  sortOrder: number;
}

/**
 * Input for creating/updating a creator
 */
export interface CreatorInput {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

/**
 * A library entry with dynamic fields
 */
export interface Entry {
  id: number;
  key: string;
  itemType: string;
  itemTypeDisplay: string;
  title: string;
  date?: string;
  url?: string;
  accessDate?: string;
  creators: Creator[];
  fields: Record<string, string>; // Dynamic fields
  dateAdded: string;
  dateModified: string;
  tags: Tag[];
  collections: string[];
  attachments: Attachment[];
}

/**
 * Summary info for list views
 */
export interface EntrySummary {
  id: number;
  key: string;
  itemType: string;
  itemTypeDisplay: string;
  title: string;
  creatorsDisplay: string;
  year?: string;
  dateAdded: string;
  dateModified?: string;
  tags: Tag[];
  attachmentCount: number;
  hasPdf: boolean;
  hasNote: boolean;
  hasWeblink: boolean;
  thumbnailPath?: string;
}

/**
 * Input for creating an entry
 */
export interface CreateEntryInput {
  itemType: string;
  title: string;
  date?: string;
  url?: string;
  creators?: CreatorInput[];
  fields?: Record<string, string>;
}

/**
 * Input for updating an entry
 */
export interface UpdateEntryInput {
  itemType?: string;
  title?: string;
  date?: string;
  url?: string;
  creators?: CreatorInput[];
  fields?: Record<string, string>;
}

// =====================================================
// ATTACHMENT TYPES
// =====================================================

/**
 * Attachment type info
 */
export interface AttachmentType {
  id: number;
  name: string;
  displayName: string;
  icon?: string;
}

/**
 * An attachment (PDF, note, weblink, etc.)
 */
export interface Attachment {
  id: number;
  key: string;
  entryId: number;
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

/**
 * Input for creating an attachment
 */
export interface CreateAttachmentInput {
  entryId: number;
  attachmentType: string;
  title?: string;
  filePath?: string;
  url?: string;
}

// =====================================================
// TAG & COLLECTION TYPES
// =====================================================

export interface Tag {
  id: number;
  name: string;
  color?: string;
  itemCount: number;
  isImported: boolean;
}

export interface Collection {
  id: number;
  key: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: number;
  itemCount: number;
}

export interface CreateCollectionInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: number;
}

// =====================================================
// LINK TYPES
// =====================================================

export interface EntryLink {
  id: number;
  sourceEntryId: number;
  targetEntryId: number;
  linkType: string;
  linkTypeDisplay: string;
  context?: string;
}

// =====================================================
// SAVED SEARCH TYPES (Smart Filters)
// =====================================================

export interface SavedSearchCriterion {
  field: string;
  operator: string;
  value: string | null;
}

export interface SavedSearch {
  id: number;
  name: string;
  matchMode: 'all' | 'any';
  criteria: SavedSearchCriterion[];
  scope: 'all' | 'collection';
  collectionId?: number;
  sortOrder: number;
  dateAdded: string;
  dateModified: string;
}

export interface CreateSavedSearchInput {
  name: string;
  matchMode: 'all' | 'any';
  criteria: SavedSearchCriterion[];
  scope: 'all' | 'collection';
  collectionId?: number;
}

export interface UpdateSavedSearchInput {
  name?: string;
  matchMode?: 'all' | 'any';
  criteria?: SavedSearchCriterion[];
  scope?: 'all' | 'collection';
  collectionId?: number;
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Get display name for a creator
 */
export function getCreatorDisplayName(creator: Creator): string {
  if (creator.name) {
    return creator.name;
  }
  if (creator.firstName && creator.lastName) {
    return `${creator.firstName} ${creator.lastName}`;
  }
  return creator.lastName || creator.firstName || "";
}

/**
 * Get short name for a creator (last name only, or name)
 */
export function getCreatorShortName(creator: Creator): string {
  if (creator.name) {
    return creator.name;
  }
  return creator.lastName || creator.firstName || "";
}

/**
 * Format creators for display (e.g., "Smith & Jones" or "Smith et al.")
 */
export function formatCreatorsDisplay(creators: Creator[]): string {
  const authors = creators.filter(
    (c) => c.creatorType === "author" || c.sortOrder === 0
  );
  const displayCreators = authors.length > 0 ? authors : creators;

  switch (displayCreators.length) {
    case 0:
      return "";
    case 1:
      return getCreatorShortName(displayCreators[0]);
    case 2:
      return `${getCreatorShortName(displayCreators[0])} & ${getCreatorShortName(displayCreators[1])}`;
    default:
      return `${getCreatorShortName(displayCreators[0])} et al.`;
  }
}

/**
 * Extract year from date string
 */
export function extractYear(date?: string): string | undefined {
  if (!date) return undefined;
  return date.split("-")[0];
}
