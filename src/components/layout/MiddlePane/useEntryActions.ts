import { useLibraryStore, type EntrySummary } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import { toast } from '@/stores/toastStore';
import {
  showEntryInFinder,
  showEntriesInFinder,
  addPdfAttachment,
  addFileAttachment,
  createAttachment,
  exportToCslJson,
  exportToBibtex,
  getCollections,
  getTags,
  addTagToEntries,
  reindexEntry,
  bulkAddToCollection,
  bulkRemoveFromCollection,
  bulkRemoveTags,
  bulkMoveToTrash,
  exportEntriesArchive,
} from '@/services/tauri';
import { parseEntries } from '@/services/tauri/commands';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { buildEntryLink } from '@/lib/wrenLinks';

interface UseEntryActionsParams {
  entry: EntrySummary;
  onClose?: () => void;
}

export function useEntryActions({ entry, onClose }: UseEntryActionsParams) {
  const { openTab, tabs, closeTab } = useTabStore();
  const {
    collections,
    tags,
    entries,
    removeEntry,
    invalidateAttachments,
    setCollections,
    setTags,
    invalidateEntry,
    selectedEntryIds,
    activeCollectionId,
    activeTagIds,
    activeFilter,
    refreshLibrary,
  } = useLibraryStore();

  const targetIds =
    selectedEntryIds.length > 1 && selectedEntryIds.includes(entry.id)
      ? selectedEntryIds
      : [entry.id];
  const isMultiSelect = targetIds.length > 1;

  const targetEntries = isMultiSelect
    ? entries.filter((e) => targetIds.includes(e.id))
    : [entry];

  const handleOpen = () => {
    for (const targetEntry of targetEntries) {
      openTab({
        type: 'entry',
        title: targetEntry.title,
        entryId: String(targetEntry.id),
      });
    }
    onClose?.();
  };

  const handleShowInFinder = async () => {
    try {
      if (targetIds.length === 1) {
        await showEntryInFinder(targetIds[0]);
      } else {
        await showEntriesInFinder(targetIds);
      }
    } catch (err) {
      console.error('Failed to show in Finder:', err);
    }
    onClose?.();
  };

  const handleCopyTitle = async () => {
    try {
      const titles = targetEntries.map((e) => e.title).join('\n');
      await writeText(titles);
      toast.success(isMultiSelect ? `${targetEntries.length} titles copied` : 'Title copied');
    } catch (err) {
      console.error('Failed to copy title:', err);
      toast.error('Failed to copy title');
    }
    onClose?.();
  };

  const handleAddToCollection = async (collectionId: number) => {
    try {
      await bulkAddToCollection(targetIds, collectionId);
      const allCollections = await getCollections();
      setCollections(allCollections);
      invalidateEntry();
      toast.success(isMultiSelect ? `Added ${targetIds.length} items to collection` : 'Added to collection');
    } catch (err) {
      console.error('Failed to add to collection:', err);
      toast.error('Failed to add to collection');
    }
    onClose?.();
  };

  const handleRemoveFromCollection = async (collectionId: number) => {
    try {
      await bulkRemoveFromCollection(targetIds, collectionId);
      const allCollections = await getCollections();
      setCollections(allCollections);
      await refreshLibrary();
      invalidateEntry();
      toast.success(isMultiSelect ? `Removed ${targetIds.length} items from collection` : 'Removed from collection');
    } catch (err) {
      console.error('Failed to remove from collection:', err);
      toast.error('Failed to remove from collection');
    }
    onClose?.();
  };

  const handleAddTag = async (tagName: string) => {
    try {
      await addTagToEntries(tagName, targetIds);
      const allTags = await getTags();
      setTags(allTags);
      await refreshLibrary();
      invalidateEntry();
      toast.success(isMultiSelect ? `Tag added to ${targetIds.length} entries` : 'Tag added');
    } catch (err) {
      console.error('Failed to add tag:', err);
      toast.error('Failed to add tag');
    }
    onClose?.();
  };

  const handleRemoveActiveTag = async () => {
    try {
      await bulkRemoveTags(targetIds, activeTagIds);
      const allTags = await getTags();
      setTags(allTags);
      await refreshLibrary();
      invalidateEntry();
      const tagCount = activeTagIds.length;
      const entryCount = targetIds.length;
      if (entryCount > 1 && tagCount > 1) {
        toast.success(`Removed ${tagCount} tags from ${entryCount} entries`);
      } else if (entryCount > 1) {
        toast.success(`Tag removed from ${entryCount} entries`);
      } else if (tagCount > 1) {
        toast.success(`${tagCount} tags removed`);
      } else {
        toast.success('Tag removed');
      }
    } catch (err) {
      console.error('Failed to remove tag:', err);
      toast.error('Failed to remove tag');
    }
    onClose?.();
  };

  const handleAddPdfAttachment = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (selected) {
        await addPdfAttachment(entry.id, selected);
        invalidateAttachments();
        await refreshLibrary();
        toast.success('PDF attached');
      }
    } catch (err) {
      console.error('Failed to add PDF attachment:', err);
      toast.error('Failed to attach PDF');
    }
    onClose?.();
  };

  const handleAddFileAttachment = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Supported Files',
            extensions: [
              'epub', 'pdf', 'html', 'htm',
              'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff',
              'mp4', 'mov', 'avi', 'mkv', 'webm',
              'mp3', 'wav', 'flac', 'aac', 'ogg',
              'md', 'txt',
            ],
          },
        ],
      });
      if (selected) {
        const filePath = typeof selected === 'string' ? selected : (selected as any).path ?? String(selected);
        await addFileAttachment(entry.id, filePath);
        invalidateAttachments();
        await refreshLibrary();
        toast.success('File attached');
      }
    } catch (err) {
      console.error('Failed to add file attachment:', err);
      toast.error('Failed to attach file');
    }
    onClose?.();
  };

  const handleAddMarkdownAttachment = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }],
      });
      if (selected) {
        const filePath = typeof selected === 'string' ? selected : (selected as any).path ?? String(selected);
        await addFileAttachment(entry.id, filePath);
        invalidateAttachments();
        await refreshLibrary();
        toast.success('Markdown file attached');
      }
    } catch (err) {
      console.error('Failed to add markdown attachment:', err);
      toast.error('Failed to attach markdown file');
    }
    onClose?.();
  };

  const handleCreateNote = async () => {
    try {
      const note = await createAttachment({
        entryId: entry.id,
        attachmentType: 'note',
        title: `Notes - ${entry.title}`,
      });
      invalidateAttachments();
      await refreshLibrary();
      openTab({
        type: 'entry',
        title: note.title || `Notes - ${entry.title}`,
        entryId: String(entry.id),
        attachmentId: String(note.id),
        data: { attachmentType: 'note' },
      });
      toast.success('Note created');
    } catch (err) {
      console.error('Failed to create note:', err);
      toast.error('Failed to create note');
    }
    onClose?.();
  };

  const handleDelete = async () => {
    try {
      for (const id of targetIds) {
        removeEntry(id);
        const entryTabs = tabs.filter((t) => t.type === 'entry' && t.entryId === String(id));
        entryTabs.forEach((t) => closeTab(t.id));
      }
      await bulkMoveToTrash(targetIds);
      await refreshLibrary();
      toast.success(isMultiSelect ? `${targetIds.length} entries moved to Trash` : 'Moved to Trash');
    } catch (err) {
      console.error('Failed to delete entry:', err);
      toast.error('Failed to move to Trash');
    }
    onClose?.();
  };

  const handleParseWithAI = async () => {
    try {
      const jobIds = await parseEntries(targetIds);
      if (jobIds.length === 0) {
        toast.warning('No attachments with extracted text found. Run text extraction first.');
      } else {
        toast.info(isMultiSelect ? `Parsing attachments for ${targetIds.length} entries...` : 'Document parsing started');
      }
    } catch (err) {
      toast.error(`Failed to start parsing: ${err}`);
    }
    onClose?.();
  };

  const handleExtractMetadataWithAI = async () => {
    try {
      const { extractMetadataWithAi } = await import('@/services/tauri/commands');
      for (const id of targetIds) {
        await extractMetadataWithAi(id);
      }
      toast.info(`Metadata extraction started for ${targetIds.length} ${targetIds.length === 1 ? 'entry' : 'entries'}`);
    } catch (err) {
      toast.error(`Failed to start metadata extraction: ${err}`);
    }
    onClose?.();
  };

  const handleReextractAttachments = (forceOcr = false) => {
    onClose?.();
    const ocrLabel = forceOcr ? ' with OCR' : '';
    const label = isMultiSelect
      ? `Re-extracting${ocrLabel} attachments for ${targetIds.length} entries`
      : `Re-extracting${ocrLabel} attachments`;
    const loadingId = toast.loading(`${label}...`);
    const ids = [...targetIds];
    const multi = isMultiSelect;
    (async () => {
      try {
        for (const id of ids) {
          await reindexEntry(id, { forceOcr });
        }
        invalidateAttachments();
        await refreshLibrary();
        toast.dismiss(loadingId);
        toast.success(multi ? `${ids.length} entries re-extracted` : 'Attachments re-extracted');
      } catch (err) {
        console.error('Failed to re-extract:', err);
        toast.dismiss(loadingId);
        toast.error(`Failed to re-extract: ${err}`);
      }
    })();
  };

  const handleExportCslJson = async () => {
    try {
      const content = await exportToCslJson(targetIds);
      const defaultName = isMultiSelect ? 'export' : entry.key || 'export';
      const filePath = await save({
        defaultPath: `${defaultName}.json`,
        filters: [{ name: 'CSL JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export to CSL JSON:', err);
    }
    onClose?.();
  };

  const handleExportBibtex = async () => {
    try {
      const content = await exportToBibtex(targetIds);
      const defaultName = isMultiSelect ? 'export' : entry.key || 'export';
      const filePath = await save({
        defaultPath: `${defaultName}.bib`,
        filters: [{ name: 'BibTeX', extensions: ['bib'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export to BibTeX:', err);
    }
    onClose?.();
  };

  const handleCopyCslJson = async () => {
    try {
      const content = await exportToCslJson(targetIds);
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy CSL JSON:', err);
    }
    onClose?.();
  };

  const handleCopyBibtex = async () => {
    try {
      const content = await exportToBibtex(targetIds);
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy BibTeX:', err);
    }
    onClose?.();
  };

  const handleExportAsArchive = async () => {
    try {
      const defaultName = isMultiSelect ? 'export' : entry.key || 'export';
      const filePath = await save({
        defaultPath: `${defaultName}.wrenitem`,
        filters: [{ name: 'Wren Archive', extensions: ['wrenitem'] }],
      });
      if (filePath) {
        const result = await exportEntriesArchive(targetIds, filePath);
        toast.success(`Exported ${result.entriesExported} entries (${result.filesExported} files)`);
      }
    } catch (err) {
      console.error('Failed to export as archive:', err);
      toast.error('Failed to export archive');
    }
    onClose?.();
  };

  const handleCopyWrenLink = async () => {
    try {
      const link = buildEntryLink(entry.key);
      await writeText(link);
      toast.success('Wren link copied');
    } catch (err) {
      console.error('Failed to copy Wren link:', err);
      toast.error('Failed to copy link');
    }
    onClose?.();
  };

  return {
    targetIds,
    isMultiSelect,
    targetEntries,
    collections,
    tags,
    activeCollectionId,
    activeTagIds,
    activeFilter,
    handleOpen,
    handleShowInFinder,
    handleCopyTitle,
    handleAddToCollection,
    handleRemoveFromCollection,
    handleAddTag,
    handleRemoveActiveTag,
    handleAddPdfAttachment,
    handleAddFileAttachment,
    handleAddMarkdownAttachment,
    handleCreateNote,
    handleDelete,
    handleParseWithAI,
    handleExtractMetadataWithAI,
    handleReextractAttachments,
    handleExportCslJson,
    handleExportBibtex,
    handleCopyCslJson,
    handleCopyBibtex,
    handleExportAsArchive,
    handleCopyWrenLink,
  };
}
