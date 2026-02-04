import { invoke } from '@tauri-apps/api/core';

// =====================================================
// Core Types
// =====================================================

export interface Collection {
  id: number;
  key: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  itemCount: number;
}

export interface Tag {
  id: number;
  name: string;
  color?: string;
  itemCount: number;
  isImported: boolean;
}

export interface ImportResult {
  id: number;
  key: string;
  title: string;
  filePath: string;
  entryId: number;
  attachmentId: number;
  success: boolean;
  error?: string;
}

export interface Setting {
  key: string;
  value: string;
  valueType: string;
}

// =====================================================
// Entry-Attachment Model Types
// =====================================================

export interface Creator {
  creatorType: string; // "author", "editor", "translator", etc.
  firstName?: string;
  lastName?: string;
  name?: string; // For single-field names (institutions)
}

export interface EntryType {
  id: number;
  name: string;
  displayName: string;
  icon?: string;
}

export interface AttachmentType {
  id: number;
  name: string;
  displayName: string;
  icon?: string;
}

export interface Entry {
  id: number;
  key: string;
  itemType: string;
  itemTypeDisplay: string;
  title: string;
  creators: Creator[];
  // Dynamic fields from EAV table
  fields: Record<string, string>;
  // Core fields (also in fields map but commonly accessed)
  date?: string;
  url?: string;
  accessDate?: string;
  // Metadata
  dateAdded: string;
  dateModified: string;
  tags: Tag[];
  collections: number[];
  attachments: Attachment[];
  attachmentCount: number;
}

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

export interface CreatorInput {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string; // For single-field names (institutions)
}

export interface CreateEntryInput {
  itemType: string;
  title: string;
  date?: string;
  url?: string;
  creators?: CreatorInput[];
  fields?: Record<string, string>;
}

export interface UpdateEntryInput {
  itemType?: string;
  title?: string;
  date?: string;
  url?: string;
  creators?: CreatorInput[];
  fields?: Record<string, string>;
}

export interface CreateAttachmentInput {
  entryId: number;
  attachmentType: string;
  title?: string;
  filePath?: string;
  url?: string;
}

// =====================================================
// Entry Commands
// =====================================================

export async function getEntries(params?: {
  collectionId?: number;
  tagIds?: number[];
  tagMode?: 'and' | 'or';
  attachmentType?: string;
  searchQuery?: string;
  searchScope?: 'title_creator_year' | 'fields_tags' | 'everything';
  advancedSearch?: {
    matchMode: 'all' | 'any';
    criteria: {
      field: string;
      operator: string;
      value?: string | null;
    }[];
  };
  filterType?: string;
}): Promise<EntrySummary[]> {
  return invoke('get_entries', {
    collectionId: params?.collectionId ?? null,
    tagIds: params?.tagIds ?? null,
    tagMode: params?.tagMode ?? null,
    attachmentType: params?.attachmentType ?? null,
    searchQuery: params?.searchQuery ?? null,
    searchScope: params?.searchScope ?? null,
    advancedSearch: params?.advancedSearch ?? null,
    filterType: params?.filterType ?? null,
  });
}

export type EntriesPage = {
  entries: EntrySummary[];
  total: number;
};

export async function getEntriesPaged(params?: {
  collectionId?: number;
  tagIds?: number[];
  tagMode?: 'and' | 'or';
  attachmentType?: string;
  searchQuery?: string;
  searchScope?: 'title_creator_year' | 'fields_tags' | 'everything';
  advancedSearch?: {
    matchMode: 'all' | 'any';
    criteria: {
      field: string;
      operator: string;
      value?: string | null;
    }[];
  };
  filterType?: string;
  sortField?: 'title' | 'creator' | 'year' | 'dateAdded' | 'dateModified' | 'itemType';
  sortDirection?: 'asc' | 'desc';
  secondarySortField?: 'title' | 'creator' | 'year' | 'dateAdded' | 'dateModified' | 'itemType';
  secondarySortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<EntriesPage> {
  return invoke('get_entries_paged', {
    collectionId: params?.collectionId ?? null,
    tagIds: params?.tagIds ?? null,
    tagMode: params?.tagMode ?? null,
    attachmentType: params?.attachmentType ?? null,
    searchQuery: params?.searchQuery ?? null,
    searchScope: params?.searchScope ?? null,
    advancedSearch: params?.advancedSearch ?? null,
    filterType: params?.filterType ?? null,
    sortField: params?.sortField ?? null,
    sortDirection: params?.sortDirection ?? null,
    secondarySortField: params?.secondarySortField ?? null,
    secondarySortDirection: params?.secondarySortDirection ?? null,
    limitValue: params?.limit ?? null,
    offsetValue: params?.offset ?? null,
  });
}

export type EntryCounts = {
  total: number;
  pdf: number;
  note: number;
  recent: number;
  untagged: number;
};

export async function getEntryCounts(): Promise<EntryCounts> {
  return invoke('get_entry_counts');
}

export async function getEntry(id: number, includeDeleted?: boolean): Promise<Entry> {
  return invoke('get_entry', { id, includeDeleted: includeDeleted ?? false });
}

export async function createEntry(input: CreateEntryInput): Promise<Entry> {
  return invoke('create_entry', { input });
}

export async function updateEntry(id: number, input: UpdateEntryInput): Promise<Entry> {
  return invoke('update_entry', { id, input });
}

export async function deleteEntry(id: number): Promise<void> {
  return invoke('delete_entry', { id });
}

export async function duplicateEntry(id: number): Promise<Entry> {
  return invoke('duplicate_entry', { id });
}

export async function repairEntryAttachments(entryId: number): Promise<string[]> {
  return invoke('repair_entry_attachments', { entryId });
}

// =====================================================
// Trash Commands
// =====================================================

export async function getTrashedEntries(): Promise<EntrySummary[]> {
  return invoke('get_trashed_entries');
}

export async function getTrashCount(): Promise<number> {
  return invoke('get_trash_count');
}

export async function restoreEntry(id: number): Promise<void> {
  return invoke('restore_entry', { id });
}

export async function permanentDeleteEntry(id: number): Promise<void> {
  return invoke('permanent_delete_entry', { id });
}

export async function emptyTrash(): Promise<number> {
  return invoke('empty_trash');
}

// =====================================================
// Attachment Commands
// =====================================================

export async function getEntryAttachments(entryId: number): Promise<Attachment[]> {
  return invoke('get_entry_attachments', { entryId });
}

/**
 * Batch fetch attachments for multiple entries in ONE call
 * Returns a map of entryId -> attachments[]
 */
export async function getEntriesAttachments(
  entryIds: number[],
): Promise<Record<number, Attachment[]>> {
  return invoke('get_entries_attachments', { entryIds });
}

export async function getAttachment(id: number): Promise<Attachment> {
  return invoke('get_attachment', { id });
}

export async function createAttachment(input: CreateAttachmentInput): Promise<Attachment> {
  return invoke('create_attachment', { input });
}

export async function deleteAttachment(id: number): Promise<void> {
  return invoke('delete_attachment', { id });
}

export async function addPdfAttachment(entryId: number, filePath: string): Promise<Attachment> {
  return invoke('add_pdf_attachment', { entryId, filePath });
}

// =====================================================
// Collection Commands
// =====================================================

export async function getCollections(): Promise<Collection[]> {
  return invoke('get_collections');
}

export async function createCollection(input: {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}): Promise<Collection> {
  return invoke('create_collection', { input });
}

export async function updateCollection(
  id: number,
  input: { name?: string; description?: string; color?: string; icon?: string },
): Promise<void> {
  return invoke('update_collection', {
    id,
    name: input.name,
    description: input.description,
    color: input.color,
    icon: input.icon,
  });
}

export async function deleteCollection(id: number): Promise<void> {
  return invoke('delete_collection', { id });
}

export async function addEntryToCollection(entryId: number, collectionId: number): Promise<void> {
  return invoke('add_entry_to_collection', { entryId, collectionId });
}

export async function removeEntryFromCollection(
  entryId: number,
  collectionId: number,
): Promise<void> {
  return invoke('remove_entry_from_collection', { entryId, collectionId });
}

export async function mergeCollections(
  targetId: number,
  sourceIds: number[],
  newName?: string,
  newColor?: string,
): Promise<number> {
  return invoke('merge_collections', { targetId, sourceIds, newName, newColor });
}

export async function deleteCollectionWithEntries(
  id: number,
  deleteEntries: boolean,
): Promise<number> {
  return invoke('delete_collection_with_entries', { id, deleteEntries });
}

export async function bulkUpdateCollectionColor(
  collectionIds: number[],
  color?: string,
): Promise<number> {
  return invoke('bulk_update_collection_color', { collectionIds, color });
}

// =====================================================
// Tag Commands
// =====================================================

export async function getTags(): Promise<Tag[]> {
  return invoke('get_tags');
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  return invoke('create_tag', { name, color });
}

export async function deleteTag(id: number): Promise<void> {
  return invoke('delete_tag', { id });
}

export async function addEntryTag(entryId: number, tagName: string): Promise<Tag> {
  return invoke('add_tag_to_item', { entryId, tagName });
}

export async function removeEntryTag(entryId: number, tagId: number): Promise<void> {
  return invoke('remove_entry_tag', { entryId, tagId });
}

export async function addTagToEntries(tagName: string, entryIds: number[]): Promise<Tag> {
  return invoke('add_tag_to_entries', { tagName, entryIds });
}

export async function updateTag(id: number, name?: string, color?: string): Promise<Tag> {
  return invoke('update_tag', { id, name, color });
}

export async function mergeTags(
  targetId: number,
  sourceIds: number[],
  newName?: string,
  newColor?: string
): Promise<number> {
  return invoke('merge_tags', { targetId, sourceIds, newName, newColor });
}

export async function bulkUpdateTagColor(tagIds: number[], color?: string): Promise<number> {
  return invoke('bulk_update_tag_color', { tagIds, color });
}

// =====================================================
// Import Commands
// =====================================================

export async function importPdf(filePath: string): Promise<ImportResult> {
  return invoke('import_pdf', { filePath });
}

export async function importPdfs(filePaths: string[]): Promise<ImportResult[]> {
  return invoke('import_pdfs', { filePaths });
}

export async function importFolder(folderPath: string): Promise<ImportResult[]> {
  return invoke('import_folder', { folderPath });
}

export interface BibtexImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importBibtex(content: string): Promise<BibtexImportResult> {
  return invoke('import_bibtex', { content });
}

export interface CslJsonImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importCslJson(content: string): Promise<CslJsonImportResult> {
  return invoke('import_csl_json', { content });
}

export interface BiblatexImportResult {
  imported: number;
  skipped: number;
  filesImported: number;
  tagsCreated: number;
  errors: string[];
}

export async function importBiblatexWithFiles(
  biblatexPath: string,
  filesBasePath?: string,
  selectedKeys?: string[],
  importTags?: boolean,
  excludedFiles?: Record<string, number[]>,
  collectionId?: number,
): Promise<BiblatexImportResult> {
  return invoke('import_biblatex_with_files', {
    biblatexPath,
    filesBasePath: filesBasePath ?? null,
    selectedKeys: selectedKeys ?? null,
    importTags: importTags ?? null,
    excludedFiles: excludedFiles ?? null,
    collectionId: collectionId ?? null,
  });
}

// BibLaTeX Preview (parse without importing)
export interface BiblatexPreviewFile {
  title: string;
  path: string;
  mimetype: string;
  attachmentType: string;
  exists: boolean;
}

export interface BiblatexPreviewEntry {
  bibtexKey: string;
  title: string;
  entryType: string;
  itemType: string;
  creators: string[];
  year: string | null;
  tags: string[];
  files: BiblatexPreviewFile[];
  isDuplicate: boolean;
}

export interface BiblatexPreviewResult {
  entries: BiblatexPreviewEntry[];
  totalEntries: number;
  totalFiles: number;
  duplicateCount: number;
  uniqueTags: string[];
}

export async function previewBiblatexImport(
  biblatexPath: string,
): Promise<BiblatexPreviewResult> {
  return invoke('preview_biblatex_import', { biblatexPath });
}

// =====================================================
// Settings Commands
// =====================================================

export async function getSettings(): Promise<Setting[]> {
  return invoke('get_settings');
}

export async function updateSetting(key: string, value: string): Promise<void> {
  return invoke('update_setting', { key, value });
}

export async function getLibraryPath(): Promise<string> {
  return invoke('get_library_path');
}

// =====================================================
// Entry/Attachment Types
// =====================================================

export async function getEntryTypes(): Promise<EntryType[]> {
  return invoke('get_entry_types');
}

export async function getAttachmentTypes(): Promise<AttachmentType[]> {
  return invoke('get_attachment_types');
}

// =====================================================
// File Operations
// =====================================================

export async function showEntryInFinder(entryId: number): Promise<void> {
  return invoke('show_entry_in_finder', { entryId });
}

export async function showEntriesInFinder(entryIds: number[]): Promise<void> {
  return invoke('show_entries_in_finder', { entryIds });
}

// =====================================================
// Annotation Types
// =====================================================

export interface Annotation {
  id: number;
  key: string;
  attachmentId: number;
  annotationType: string;
  pageNumber: number;
  positionJson: string;
  selectedText?: string;
  comment?: string;
  color: string;
  dateAdded: string;
  dateModified: string;
}

export interface CreateAnnotationInput {
  attachmentId: number;
  annotationType: string;
  pageNumber: number;
  positionJson: string;
  selectedText?: string;
  comment?: string;
  color: string;
}

export interface UpdateAnnotationInput {
  positionJson?: string;
  comment?: string;
  color?: string;
}

// =====================================================
// Annotation Commands
// =====================================================

export async function getAnnotations(attachmentId: number): Promise<Annotation[]> {
  return invoke('get_annotations', { attachmentId });
}

export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  return invoke('create_annotation', { input });
}

export async function updateAnnotation(id: number, input: UpdateAnnotationInput): Promise<void> {
  return invoke('update_annotation', { id, input });
}

export async function deleteAnnotation(id: number): Promise<void> {
  return invoke('delete_annotation', { id });
}

// =====================================================
// PDF Annotation Sync Types
// =====================================================

export interface PdfAnnotationData {
  pageNumber: number;
  rect: [number, number, number, number];
  quadPoints: number[];
  color: string;
  contents?: string;
}

// =====================================================
// PDF Annotation Sync Commands
// =====================================================

export async function saveAnnotationToPdf(
  attachmentId: number,
  annotationKey: string,
  annotationData: PdfAnnotationData,
): Promise<void> {
  return invoke('save_annotation_to_pdf', {
    attachmentId,
    annotationKey,
    annotationData,
  });
}

export async function removeAnnotationFromPdf(
  attachmentId: number,
  annotationKey: string,
): Promise<boolean> {
  return invoke('remove_annotation_from_pdf', { attachmentId, annotationKey });
}

export async function importAnnotationsFromPdf(attachmentId: number): Promise<Annotation[]> {
  return invoke('import_annotations_from_pdf', { attachmentId });
}

// =====================================================
// Export Commands
// =====================================================

export async function exportToCslJson(entryIds: number[]): Promise<string> {
  return invoke('export_to_csl_json', { entryIds });
}

export async function exportToBibtex(entryIds: number[]): Promise<string> {
  return invoke('export_to_bibtex', { entryIds });
}

export async function exportAllToCslJson(): Promise<string> {
  return invoke('export_all_to_csl_json');
}

export async function exportAllToBibtex(): Promise<string> {
  return invoke('export_all_to_bibtex');
}

export interface ExportOptions {
  includePdfs: boolean;
  includeNotes: boolean;
  includeWeblinks: boolean;
  includeAnnotations: boolean;
}

export interface BiblatexExportResult {
  entriesExported: number;
  filesExported: number;
  notesExported: number;
  outputPath: string;
}

export async function exportToBiblatexWithFiles(
  entryIds: number[],
  outputDir: string,
  options: ExportOptions,
): Promise<BiblatexExportResult> {
  return invoke('export_to_biblatex_with_files', {
    entryIds,
    outputDir,
    options: {
      include_pdfs: options.includePdfs,
      include_notes: options.includeNotes,
      include_weblinks: options.includeWeblinks,
      include_annotations: options.includeAnnotations,
    },
  });
}

export async function exportAllToBiblatexWithFiles(
  outputDir: string,
  options: ExportOptions,
): Promise<BiblatexExportResult> {
  return invoke('export_all_to_biblatex_with_files', {
    outputDir,
    options: {
      include_pdfs: options.includePdfs,
      include_notes: options.includeNotes,
      include_weblinks: options.includeWeblinks,
      include_annotations: options.includeAnnotations,
    },
  });
}

// =====================================================
// Duplicate Detection Commands
// =====================================================

export interface DuplicateEntry {
  id: number;
  key: string;
  title: string;
  itemType: string;
  date?: string;
  dateAdded: string;
  doi?: string;
  creatorsDisplay?: string;
  attachmentCount: number;
}

export interface DuplicateGroup {
  entries: DuplicateEntry[];
  matchReason: string;
}

export async function findDuplicates(): Promise<DuplicateGroup[]> {
  return invoke('find_duplicates');
}

export async function getDuplicateCount(): Promise<number> {
  return invoke('get_duplicate_count');
}

export async function mergeEntries(targetId: number, sourceIds: number[]): Promise<void> {
  return invoke('merge_entries', { targetId, sourceIds });
}

export async function discardDuplicates(keepId: number, discardIds: number[]): Promise<void> {
  return invoke('discard_duplicates', { keepId, discardIds });
}

// =====================================================
// Saved Searches (Smart Filters)
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

export async function getSavedSearches(): Promise<SavedSearch[]> {
  return invoke('get_saved_searches');
}

export async function getSavedSearch(id: number): Promise<SavedSearch> {
  return invoke('get_saved_search', { id });
}

export async function createSavedSearch(input: CreateSavedSearchInput): Promise<SavedSearch> {
  return invoke('create_saved_search', { input });
}

export async function updateSavedSearch(id: number, input: UpdateSavedSearchInput): Promise<SavedSearch> {
  return invoke('update_saved_search', { id, input });
}

export async function deleteSavedSearch(id: number): Promise<void> {
  return invoke('delete_saved_search', { id });
}

export async function reorderSavedSearches(ids: number[]): Promise<void> {
  return invoke('reorder_saved_searches', { ids });
}

// =====================================================
// Full-Text Search Commands
// =====================================================

export interface FullSearchResult {
  entryId: number;
  entryKey: string;
  attachmentId: number | null;
  title: string | null;
  snippet: string | null;
  contentSource: string;
  score: number;
}

export async function fullTextSearch(
  query: string,
  limit?: number,
  offset?: number,
): Promise<FullSearchResult[]> {
  return invoke('full_text_search', {
    query,
    limit: limit ?? null,
    offset: offset ?? null,
  });
}

export interface ExtractionConfig {
  skipOcr?: boolean;
  ollamaEnabled?: boolean;
  ollamaEndpoint?: string;
  ollamaModel?: string;
}

export async function reindexEntry(entryId: number, config?: ExtractionConfig): Promise<void> {
  return invoke('reindex_entry', {
    entryId,
    skipOcr: config?.skipOcr ?? null,
    ollamaEnabled: config?.ollamaEnabled ?? null,
    ollamaEndpoint: config?.ollamaEndpoint ?? null,
    ollamaModel: config?.ollamaModel ?? null,
  });
}

export async function reindexLibrary(config?: ExtractionConfig): Promise<void> {
  return invoke('reindex_library', {
    skipOcr: config?.skipOcr ?? null,
    ollamaEnabled: config?.ollamaEnabled ?? null,
    ollamaEndpoint: config?.ollamaEndpoint ?? null,
    ollamaModel: config?.ollamaModel ?? null,
  });
}

export interface OllamaStatus {
  connected: boolean;
  models: string[];
}

export async function checkOllamaStatus(endpoint: string): Promise<OllamaStatus> {
  return invoke('check_ollama_status', { endpoint });
}
