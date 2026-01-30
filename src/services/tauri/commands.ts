import { invoke } from "@tauri-apps/api/core";

// Types matching Rust backend

export interface Item {
  id: number;
  key: string;
  type: "pdf" | "markdown";
  title: string;
  dateAdded: string;
  dateModified: string;
  tags: Tag[];
  collections: string[];
}

export interface PdfItemDetails {
  filePath: string;
  pageCount?: number;
  author?: string;
  abstract?: string;
  doi?: string;
  publicationDate?: string;
  publisher?: string;
  journal?: string;
}

export interface MarkdownItemDetails {
  filePath: string;
  frontmatter?: string;
}

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
  success: boolean;
  error?: string;
}

export interface Setting {
  key: string;
  value: string;
  valueType: string;
}

// Items commands

export async function getItems(params?: {
  collectionId?: number;
  tagId?: number;
}): Promise<Item[]> {
  return invoke("get_items", {
    collectionId: params?.collectionId ?? null,
    tagId: params?.tagId ?? null,
  });
}

export async function getItem(id: number): Promise<Item> {
  return invoke("get_item", { id });
}

export async function createItem(input: {
  title: string;
  type: "pdf" | "markdown";
  filePath?: string;
}): Promise<Item> {
  return invoke("create_item", { input });
}

export async function updateItem(
  id: number,
  input: { title?: string }
): Promise<void> {
  return invoke("update_item", { id, input });
}

export async function deleteItem(id: number): Promise<void> {
  return invoke("delete_item", { id });
}

export async function getPdfDetails(itemId: number): Promise<PdfItemDetails> {
  return invoke("get_pdf_details", { itemId });
}

// Collections commands

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

export async function addItemToCollection(
  collectionId: number,
  itemId: number
): Promise<void> {
  return invoke("add_item_to_collection", { collectionId, itemId });
}

export async function removeItemFromCollection(
  collectionId: number,
  itemId: number
): Promise<void> {
  return invoke("remove_item_from_collection", { collectionId, itemId });
}

// Tags commands

export async function getTags(): Promise<Tag[]> {
  return invoke("get_tags");
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  return invoke("create_tag", { name, color });
}

export async function deleteTag(id: number): Promise<void> {
  return invoke("delete_tag", { id });
}

export async function addTagToItem(itemId: number, tagId: number): Promise<void> {
  return invoke("add_tag_to_item", { itemId, tagId });
}

export async function removeTagFromItem(
  itemId: number,
  tagId: number
): Promise<void> {
  return invoke("remove_tag_from_item", { itemId, tagId });
}

// Import commands

export async function importPdf(filePath: string): Promise<ImportResult> {
  return invoke("import_pdf", { filePath });
}

export async function importPdfs(filePaths: string[]): Promise<ImportResult[]> {
  return invoke("import_pdfs", { filePaths });
}

export async function importFolder(folderPath: string): Promise<ImportResult[]> {
  return invoke("import_folder", { folderPath });
}

// Settings commands

export async function getSettings(): Promise<Setting[]> {
  return invoke("get_settings");
}

export async function updateSetting(key: string, value: string): Promise<void> {
  return invoke("update_setting", { key, value });
}

export async function getLibraryPath(): Promise<string> {
  return invoke("get_library_path");
}

// Annotation types

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

// Annotation commands

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
