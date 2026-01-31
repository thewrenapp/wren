import { invoke } from "@tauri-apps/api/core";

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
  id: number;
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

export interface CreateEntryInput {
  entryType: string;
  title: string;
  creators?: Creator[];
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
}

export interface UpdateEntryInput {
  entryType?: string;
  title?: string;
  creators?: Creator[];
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
  tagId?: number;
  attachmentType?: string;
  searchQuery?: string;
}): Promise<EntrySummary[]> {
  return invoke("get_entries", {
    collectionId: params?.collectionId ?? null,
    tagId: params?.tagId ?? null,
    attachmentType: params?.attachmentType ?? null,
    searchQuery: params?.searchQuery ?? null,
  });
}

export async function getEntry(id: number): Promise<Entry> {
  return invoke("get_entry", { id });
}

export async function createEntry(input: CreateEntryInput): Promise<Entry> {
  return invoke("create_entry", { input });
}

export async function updateEntry(
  id: number,
  input: UpdateEntryInput
): Promise<Entry> {
  return invoke("update_entry", { id, input });
}

export async function deleteEntry(id: number): Promise<void> {
  return invoke("delete_entry", { id });
}

// =====================================================
// Attachment Commands
// =====================================================

export async function getEntryAttachments(
  entryId: number
): Promise<Attachment[]> {
  return invoke("get_entry_attachments", { entryId });
}

export async function getAttachment(id: number): Promise<Attachment> {
  return invoke("get_attachment", { id });
}

export async function createAttachment(
  input: CreateAttachmentInput
): Promise<Attachment> {
  return invoke("create_attachment", { input });
}

export async function deleteAttachment(id: number): Promise<void> {
  return invoke("delete_attachment", { id });
}

export async function addPdfAttachment(
  entryId: number,
  filePath: string
): Promise<Attachment> {
  return invoke("add_pdf_attachment", { entryId, filePath });
}

// =====================================================
// Collection Commands
// =====================================================

export async function getCollections(): Promise<Collection[]> {
  return invoke("get_collections");
}

export async function createCollection(input: {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}): Promise<Collection> {
  return invoke("create_collection", { input });
}

export async function updateCollection(
  id: number,
  input: { name?: string; description?: string; color?: string; icon?: string }
): Promise<void> {
  return invoke("update_collection", { id, input });
}

export async function deleteCollection(id: number): Promise<void> {
  return invoke("delete_collection", { id });
}

export async function addEntryToCollection(
  entryId: number,
  collectionId: number
): Promise<void> {
  return invoke("add_entry_to_collection", { entryId, collectionId });
}

export async function removeEntryFromCollection(
  entryId: number,
  collectionId: number
): Promise<void> {
  return invoke("remove_entry_from_collection", { entryId, collectionId });
}

// =====================================================
// Tag Commands
// =====================================================

export async function getTags(): Promise<Tag[]> {
  return invoke("get_tags");
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  return invoke("create_tag", { name, color });
}

export async function deleteTag(id: number): Promise<void> {
  return invoke("delete_tag", { id });
}

export async function addEntryTag(
  entryId: number,
  tagId: number
): Promise<void> {
  return invoke("add_entry_tag", { entryId, tagId });
}

export async function removeEntryTag(
  entryId: number,
  tagId: number
): Promise<void> {
  return invoke("remove_entry_tag", { entryId, tagId });
}

// =====================================================
// Import Commands
// =====================================================

export async function importPdf(filePath: string): Promise<ImportResult> {
  return invoke("import_pdf", { filePath });
}

export async function importPdfs(filePaths: string[]): Promise<ImportResult[]> {
  return invoke("import_pdfs", { filePaths });
}

export async function importFolder(folderPath: string): Promise<ImportResult[]> {
  return invoke("import_folder", { folderPath });
}

// =====================================================
// Settings Commands
// =====================================================

export async function getSettings(): Promise<Setting[]> {
  return invoke("get_settings");
}

export async function updateSetting(key: string, value: string): Promise<void> {
  return invoke("update_setting", { key, value });
}

export async function getLibraryPath(): Promise<string> {
  return invoke("get_library_path");
}

// =====================================================
// Entry/Attachment Types
// =====================================================

export async function getEntryTypes(): Promise<EntryType[]> {
  return invoke("get_entry_types");
}

export async function getAttachmentTypes(): Promise<AttachmentType[]> {
  return invoke("get_attachment_types");
}

// =====================================================
// File Operations
// =====================================================

export async function showEntryInFinder(entryId: number): Promise<void> {
  return invoke("show_entry_in_finder", { entryId });
}

// =====================================================
// Annotation Types
// =====================================================

export interface Annotation {
  id: number;
  key: string;
  itemId: number;
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
  itemId: number;
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

export async function getAnnotations(itemId: number): Promise<Annotation[]> {
  return invoke("get_annotations", { itemId });
}

export async function createAnnotation(
  input: CreateAnnotationInput
): Promise<Annotation> {
  return invoke("create_annotation", { input });
}

export async function updateAnnotation(
  id: number,
  input: UpdateAnnotationInput
): Promise<void> {
  return invoke("update_annotation", { id, input });
}

export async function deleteAnnotation(id: number): Promise<void> {
  return invoke("delete_annotation", { id });
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
  itemId: number,
  annotationKey: string,
  annotationData: PdfAnnotationData
): Promise<void> {
  return invoke("save_annotation_to_pdf", {
    itemId,
    annotationKey,
    annotationData,
  });
}

export async function removeAnnotationFromPdf(
  itemId: number,
  annotationKey: string
): Promise<boolean> {
  return invoke("remove_annotation_from_pdf", { itemId, annotationKey });
}

export async function importAnnotationsFromPdf(
  itemId: number
): Promise<Annotation[]> {
  return invoke("import_annotations_from_pdf", { itemId });
}
