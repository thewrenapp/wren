import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  bulkMoveToTrash,
  duplicateEntry,
  addEntryToCollection,
  removeEntryFromCollection,
  addEntryTag,
  removeEntryTag,
  showEntryInFinder,
  showEntriesInFinder,
  emptyTrash,
  restoreEntry,
  permanentDeleteEntry,
  getTrashCount,
  addPdfAttachment,
  addFileAttachment,
  deleteCollection,
  updateCollection,
  getCollections,
  deleteTag,
  updateTag,
  getTags,
  createEntry,
  createAttachment,
  deleteAttachment,
  reindexAttachment,
  reindexEntry,
  importAnnotationsFromPdf,
  getEntryAttachments,
  parseEntries,
  type Attachment,
} from "@/services/tauri";
import { toast } from "@/stores/toastStore";
import type { EntrySummary, Collection, Tag as TagType } from "@/services/tauri";
import type { Tab } from "@/stores/tabStore";
import type { ViewMode } from "@/stores/uiStore";

type ActiveFilter = 'all' | 'pdfs' | 'notes' | 'recent' | 'untagged' | 'duplicates' | 'trash';

interface EntryActionDeps {
  setCommandPaletteOpen: (open: boolean) => void;
  showDeleteConfirmation: (ids: number[], onConfirm: () => void) => void;
  selectedEntryIds: number[];
  entries: EntrySummary[];
  clearSelection: () => void;
  refreshLibrary: () => Promise<void>;
  invalidateEntry: () => void;
  invalidateAttachments: () => void;
  trashCount: number;
  setTrashCount: (count: number) => void;
  setTrashedEntries: (entries: EntrySummary[]) => void;
  setCollections: (collections: Collection[]) => void;
  setTags: (tags: TagType[]) => void;
  setSubMenu: (menu: null) => void;
  newTagName: string;
  setNewTagName: (val: string) => void;
  renameInput: string;
  setRenameInput: (val: string) => void;
  setSelectedItemId: (id: number | null) => void;
  setEntryAttachments: (attachments: Attachment[]) => void;
  openTab: (tab: Omit<Tab, "id">) => string;
  setActiveFilter: (filter: ActiveFilter) => void;
  setViewMode: (mode: ViewMode) => void;
  viewModeByFilter: Record<string, ViewMode>;
  activeFilter: ActiveFilter;
}

export function createEntryActions(deps: EntryActionDeps) {
  const {
    setCommandPaletteOpen, showDeleteConfirmation,
    selectedEntryIds, entries, clearSelection, refreshLibrary,
    invalidateEntry, invalidateAttachments,
    trashCount, setTrashCount, setTrashedEntries,
    setCollections, setTags,
    setSubMenu, newTagName, setNewTagName,
    renameInput, setRenameInput, setSelectedItemId,
    setEntryAttachments, openTab, setActiveFilter,
    setViewMode, viewModeByFilter, activeFilter,
  } = deps;

  const BULK_DELETE_THRESHOLD = 3;

  const performDelete = async () => {
    try {
      await bulkMoveToTrash(selectedEntryIds);
      toast.success(`Moved ${selectedEntryIds.length} entries to trash`);
      clearSelection();
      await refreshLibrary();
    } catch (err) { console.error("Delete error:", err); toast.error("Failed to delete entries"); }
  };

  const handleDeleteSelected = () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    setCommandPaletteOpen(false);
    if (selectedEntryIds.length >= BULK_DELETE_THRESHOLD) {
      showDeleteConfirmation(selectedEntryIds, performDelete);
    } else { performDelete(); }
  };

  const handleParseWithAI = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    setCommandPaletteOpen(false);
    try {
      const jobIds = await parseEntries(selectedEntryIds);
      if (jobIds.length > 0) toast.info(`Started parsing ${jobIds.length} document${jobIds.length !== 1 ? "s" : ""} with AI`);
      else toast.warning("No documents with extracted text found for selected entries");
    } catch (err) { toast.error(`Failed to start AI parsing: ${err}`); }
  };

  const handleDuplicate = async () => {
    if (selectedEntryIds.length !== 1) { toast.warning("Select exactly one entry to duplicate"); return; }
    try { await duplicateEntry(selectedEntryIds[0]); toast.success("Entry duplicated"); await refreshLibrary(); }
    catch (err) { console.error("Duplicate error:", err); toast.error("Failed to duplicate entry"); }
    setCommandPaletteOpen(false);
  };

  const handleAddToCollection = async (collectionId: number) => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      for (const entryId of selectedEntryIds) await addEntryToCollection(entryId, collectionId);
      toast.success(`Added ${selectedEntryIds.length} entries to collection`);
      await refreshLibrary();
    } catch (err) { console.error("Add to collection error:", err); toast.error("Failed to add to collection"); }
    setCommandPaletteOpen(false); setSubMenu(null);
  };

  const handleAddTag = async (tagName: string) => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      for (const entryId of selectedEntryIds) await addEntryTag(entryId, tagName);
      toast.success(`Added tag "${tagName}" to ${selectedEntryIds.length} entries`);
      await refreshLibrary();
    } catch (err) { console.error("Add tag error:", err); toast.error("Failed to add tag"); }
    setCommandPaletteOpen(false); setSubMenu(null);
  };

  const handleCreateAndAddTag = async () => {
    if (!newTagName.trim()) return;
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      for (const entryId of selectedEntryIds) await addEntryTag(entryId, newTagName.trim());
      toast.success(`Added tag "${newTagName}" to ${selectedEntryIds.length} entries`);
      await refreshLibrary();
    } catch (err) { console.error("Add tag error:", err); toast.error("Failed to add tag"); }
    setCommandPaletteOpen(false); setSubMenu(null); setNewTagName("");
  };

  const handleShowInFinder = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      if (selectedEntryIds.length === 1) await showEntryInFinder(selectedEntryIds[0]);
      else await showEntriesInFinder(selectedEntryIds);
    } catch (err) { console.error("Show in Finder error:", err); toast.error("Failed to show in Finder"); }
    setCommandPaletteOpen(false);
  };

  const handleCopyTitle = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    const selectedEntries = entries.filter((e) => selectedEntryIds.includes(e.id));
    const titles = selectedEntries.map((e) => e.title).join("\n");
    try { await writeText(titles); toast.success(selectedEntryIds.length > 1 ? `${selectedEntryIds.length} titles copied` : "Title copied"); }
    catch (err) { console.error("Copy title error:", err); toast.error("Failed to copy title"); }
    setCommandPaletteOpen(false);
  };

  const handleEmptyTrash = async () => {
    if (trashCount === 0) { toast.info("Trash is already empty"); return; }
    try { await emptyTrash(); setTrashCount(0); setTrashedEntries([]); toast.success("Trash emptied"); await refreshLibrary(); }
    catch (err) { console.error("Empty trash error:", err); toast.error("Failed to empty trash"); }
    setCommandPaletteOpen(false);
  };

  const handleRestoreFromTrash = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      for (const id of selectedEntryIds) await restoreEntry(id);
      toast.success(`Restored ${selectedEntryIds.length} entries from trash`);
      const count = await getTrashCount();
      setTrashCount(count); clearSelection(); await refreshLibrary();
    } catch (err) { console.error("Restore error:", err); toast.error("Failed to restore entries"); }
    setCommandPaletteOpen(false);
  };

  const handlePermanentDelete = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      for (const id of selectedEntryIds) await permanentDeleteEntry(id);
      toast.success(`Permanently deleted ${selectedEntryIds.length} entries`);
      const count = await getTrashCount();
      setTrashCount(count); clearSelection(); await refreshLibrary();
    } catch (err) { console.error("Permanent delete error:", err); toast.error("Failed to permanently delete entries"); }
    setCommandPaletteOpen(false);
  };

  const handleAddPdfAttachment = async () => {
    if (selectedEntryIds.length !== 1) { toast.warning("Select exactly one entry to add attachment"); return; }
    setCommandPaletteOpen(false);
    try {
      const selected = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (selected && typeof selected === "string") {
        await addPdfAttachment(selectedEntryIds[0], selected);
        invalidateAttachments(); await refreshLibrary(); toast.success("PDF attached");
      }
    } catch (err) { console.error("Add PDF attachment error:", err); toast.error("Failed to attach PDF"); }
  };

  const handleRemoveFromCollection = async (collectionId: number) => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      for (const entryId of selectedEntryIds) await removeEntryFromCollection(entryId, collectionId);
      toast.success(`Removed ${selectedEntryIds.length} entries from collection`);
      const allCollections = await getCollections();
      setCollections(allCollections); await refreshLibrary();
    } catch (err) { console.error("Remove from collection error:", err); toast.error("Failed to remove from collection"); }
    setCommandPaletteOpen(false); setSubMenu(null);
  };

  const handleRemoveTag = async (tagId: number) => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      for (const entryId of selectedEntryIds) await removeEntryTag(entryId, tagId);
      const allTags = await getTags();
      setTags(allTags); toast.success(`Removed tag from ${selectedEntryIds.length} entries`);
      await refreshLibrary();
    } catch (err) { console.error("Remove tag error:", err); toast.error("Failed to remove tag"); }
    setCommandPaletteOpen(false); setSubMenu(null);
  };

  const handleRenameCollection = async (collectionId: number) => {
    if (!renameInput.trim()) return;
    try { await updateCollection(collectionId, { name: renameInput.trim() }); const allCollections = await getCollections(); setCollections(allCollections); toast.success("Collection renamed"); }
    catch (err) { console.error("Rename collection error:", err); toast.error("Failed to rename collection"); }
    setCommandPaletteOpen(false); setSubMenu(null); setRenameInput(""); setSelectedItemId(null);
  };

  const handleDeleteCollection = async (collectionId: number, collectionName: string) => {
    try { await deleteCollection(collectionId); const allCollections = await getCollections(); setCollections(allCollections); toast.success(`Collection "${collectionName}" deleted`); await refreshLibrary(); }
    catch (err) { console.error("Delete collection error:", err); toast.error("Failed to delete collection"); }
    setCommandPaletteOpen(false); setSubMenu(null);
  };

  const handleRenameTag = async (tagId: number) => {
    if (!renameInput.trim()) return;
    try { await updateTag(tagId, renameInput.trim()); const allTags = await getTags(); setTags(allTags); invalidateEntry(); await refreshLibrary(); toast.success("Tag renamed"); }
    catch (err) { console.error("Rename tag error:", err); toast.error("Failed to rename tag"); }
    setCommandPaletteOpen(false); setSubMenu(null); setRenameInput(""); setSelectedItemId(null);
  };

  const handleDeleteTag = async (tagId: number, tagName: string) => {
    try { await deleteTag(tagId); const allTags = await getTags(); setTags(allTags); invalidateEntry(); await refreshLibrary(); toast.success(`Tag "${tagName}" deleted`); }
    catch (err) { console.error("Delete tag error:", err); toast.error("Failed to delete tag"); }
    setCommandPaletteOpen(false); setSubMenu(null);
  };

  const handleToggleViewMode = () => {
    const currentMode = viewModeByFilter[activeFilter];
    setViewMode(currentMode === "list" ? "card" : "list");
    setCommandPaletteOpen(false);
  };

  const handleImportPdfAnnotations = async () => {
    if (selectedEntryIds.length !== 1) { toast.warning("Select exactly one entry to import annotations"); return; }
    try {
      const attachments = await getEntryAttachments(selectedEntryIds[0]);
      const pdfAttachment = attachments.find((a) => a.attachmentType === "pdf");
      if (!pdfAttachment) { toast.warning("Selected entry has no PDF attachment"); return; }
      const imported = await importAnnotationsFromPdf(pdfAttachment.id);
      if (imported.length > 0) toast.success(`Imported ${imported.length} annotations from PDF`);
      else toast.info("No annotations found in PDF");
    } catch (err) { console.error("Import annotations error:", err); toast.error("Failed to import PDF annotations"); }
    setCommandPaletteOpen(false);
  };

  const handleCreateNote = async () => {
    if (selectedEntryIds.length !== 1) { toast.warning("Select exactly one entry to create a note"); return; }
    const selectedEntry = entries.find((e) => e.id === selectedEntryIds[0]);
    if (!selectedEntry) return;
    try {
      const note = await createAttachment({ entryId: selectedEntry.id, attachmentType: "note", title: `Notes - ${selectedEntry.title}` });
      invalidateAttachments(); await refreshLibrary();
      openTab({ type: "entry", title: note.title || `Notes - ${selectedEntry.title}`, entryId: String(selectedEntry.id), attachmentId: String(note.id) });
      toast.success("Note created");
    } catch (err) { console.error("Create note error:", err); toast.error("Failed to create note"); }
    setCommandPaletteOpen(false);
  };

  const handleAddMarkdownAttachment = async () => {
    if (selectedEntryIds.length !== 1) { toast.warning("Select exactly one entry to attach a file"); return; }
    setCommandPaletteOpen(false);
    try {
      const selected = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md", "txt"] }] });
      if (selected && typeof selected === "string") {
        await addFileAttachment(selectedEntryIds[0], selected);
        invalidateAttachments(); await refreshLibrary(); toast.success("Markdown file attached");
      }
    } catch (err) { console.error("Add markdown attachment error:", err); toast.error("Failed to attach markdown file"); }
  };

  const handleNavigateTo = (filter: 'all' | 'pdfs' | 'notes' | 'recent' | 'untagged' | 'duplicates' | 'trash') => {
    setActiveFilter(filter); setCommandPaletteOpen(false);
  };

  const handleOpenDeleteAttachment = async () => {
    if (selectedEntryIds.length !== 1) { toast.warning("Select exactly one entry to delete an attachment"); return; }
    try {
      const attachments = await getEntryAttachments(selectedEntryIds[0]);
      if (attachments.length === 0) { toast.info("Selected entry has no attachments"); return; }
      setEntryAttachments(attachments);
      setSubMenu("deleteAttachment" as unknown as null);
    } catch (err) { console.error("Failed to load attachments:", err); toast.error("Failed to load attachments"); }
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    try { await deleteAttachment(attachmentId); invalidateAttachments(); await refreshLibrary(); toast.success("Attachment deleted"); }
    catch (err) { console.error("Delete attachment error:", err); toast.error("Failed to delete attachment"); }
    setCommandPaletteOpen(false); setSubMenu(null); setEntryAttachments([]);
  };

  const handleOpenReindexAttachment = (forceOcr = false) => {
    if (selectedEntryIds.length === 0) { toast.warning("Select at least one entry to re-extract"); return; }
    if (selectedEntryIds.length > 1) {
      setCommandPaletteOpen(false);
      const ids = [...selectedEntryIds];
      const ocrLabel = forceOcr ? " with OCR" : "";
      const loadingId = toast.loading(`Re-extracting${ocrLabel} attachments for ${ids.length} entries...`);
      (async () => {
        try {
          for (const id of ids) await reindexEntry(id, { forceOcr });
          invalidateAttachments(); await refreshLibrary();
          toast.dismiss(loadingId); toast.success(`${ids.length} entries re-extracted`);
        } catch (err) { console.error("Failed to re-extract:", err); toast.dismiss(loadingId); toast.error(`Failed to re-extract: ${err}`); }
      })();
      return;
    }
    (async () => {
      try {
        const attachments = await getEntryAttachments(selectedEntryIds[0]);
        if (attachments.length === 0) { toast.info("Selected entry has no attachments"); return; }
        setEntryAttachments(attachments);
        setSubMenu("reindexAttachment" as unknown as null);
      } catch (err) { console.error("Failed to load attachments:", err); toast.error("Failed to load attachments"); }
    })();
  };

  const handleReindexAttachmentCmd = (attachmentId: number, forceOcr: boolean) => {
    setCommandPaletteOpen(false); setSubMenu(null); setEntryAttachments([]);
    const label = forceOcr ? "Re-extracting with OCR" : "Re-extracting";
    const loadingId = toast.loading(`${label}...`);
    (async () => {
      try {
        await reindexAttachment(attachmentId, { forceOcr });
        invalidateAttachments(); await refreshLibrary();
        toast.dismiss(loadingId); toast.success("Attachment re-indexed successfully");
      } catch (err) { console.error("Reindex attachment error:", err); toast.dismiss(loadingId); toast.error(`Failed to re-extract: ${err}`); }
    })();
  };

  const handleCreateEntryWithType = async (itemType: string) => {
    setCommandPaletteOpen(false); setSubMenu(null);
    try {
      const newEntry = await createEntry({ itemType, title: "New Reference" });
      await refreshLibrary(); toast.success(`${itemType} reference created`);
      openTab({ type: "entry", title: newEntry.title, entryId: String(newEntry.id) });
    } catch (err) { console.error("Create reference error:", err); toast.error("Failed to create reference"); }
  };

  return {
    handleDeleteSelected, handleParseWithAI, handleDuplicate,
    handleAddToCollection, handleAddTag, handleCreateAndAddTag,
    handleShowInFinder, handleCopyTitle,
    handleEmptyTrash, handleRestoreFromTrash, handlePermanentDelete,
    handleAddPdfAttachment, handleRemoveFromCollection, handleRemoveTag,
    handleRenameCollection, handleDeleteCollection,
    handleRenameTag, handleDeleteTag,
    handleToggleViewMode, handleImportPdfAnnotations,
    handleCreateNote, handleAddMarkdownAttachment,
    handleNavigateTo, handleOpenDeleteAttachment, handleDeleteAttachment,
    handleOpenReindexAttachment, handleReindexAttachmentCmd,
    handleCreateEntryWithType,
  };
}
