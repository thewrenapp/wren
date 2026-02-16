import { ReactNode, useState } from 'react';
import { toast } from '@/stores/toastStore';
import {
  ExternalLink,
  FolderOpen,
  Plus,
  FileText,
  File,
  Copy,
  Trash2,
  FolderPlus,
  FolderMinus,
  Tags,
  Download,
  FileJson,
  FileCode,
  FolderOutput,
  Paperclip,
  RefreshCw,
  StickyNote,
  Sparkles,
} from 'lucide-react';
import { IconTagOff } from '@tabler/icons-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { useLibraryStore, type EntrySummary } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import {
  showEntryInFinder,
  showEntriesInFinder,
  addEntryToCollection,
  removeEntryFromCollection,
  deleteEntry,
  addPdfAttachment,
  addFileAttachment,
  createAttachment,
  getTrashCount,
  exportToCslJson,
  exportToBibtex,
  exportToBiblatexWithFiles,
  getCollections,
  getTags,
  addTagToEntries,
  removeEntryTag,
  reindexEntry,
  type ExportOptions,
} from '@/services/tauri';
import { parseEntries } from '@/services/tauri/commands';
import { ExportOptionsDialog } from '@/components/dialogs/ExportOptionsDialog';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

interface EntryContextMenuProps {
  entry: EntrySummary;
  children: ReactNode;
}

interface EntryContextMenuContentProps {
  entry: EntrySummary;
  onClose?: () => void;
  onShowExportDialog?: (entryIds: number[]) => void;
}

// Standalone content component for controlled dropdown menus (used in EntryTable)
export function EntryContextMenuContent({ entry, onClose, onShowExportDialog }: EntryContextMenuContentProps) {
  const { openTab, tabs, closeTab } = useTabStore();
  const {
    collections,
    tags,
    entries,
    removeEntry,
    invalidateAttachments,
    setTrashCount,
    setCollections,
    setTags,
    invalidateEntry,
    selectedEntryIds,
    activeCollectionId,
    activeTagIds,
    activeFilter,
    refreshLibrary,
  } = useLibraryStore();

  // Use all selected entries for bulk operations when multiple are selected
  const targetIds =
    selectedEntryIds.length > 1 && selectedEntryIds.includes(entry.id)
      ? selectedEntryIds
      : [entry.id];
  const isMultiSelect = targetIds.length > 1;

  // Get entry objects for selected entries (for titles, etc.)
  const targetEntries = isMultiSelect
    ? entries.filter((e) => targetIds.includes(e.id))
    : [entry];

  const handleOpen = () => {
    // Open all selected entries in tabs
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
      // Show all selected entries in Finder (batch operation for multiple files)
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
      // Copy all titles (newline separated for multiple)
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
      // Add all selected entries to collection
      for (const id of targetIds) {
        await addEntryToCollection(id, collectionId);
      }
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Invalidate entry to refresh info panel
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
      // Remove all selected entries from the collection
      for (const id of targetIds) {
        await removeEntryFromCollection(id, collectionId);
      }
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Refresh entries using current filters (collection/tag) so view updates correctly
      await refreshLibrary();
      // Invalidate entry to refresh info panel
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
      // Refresh tags to update item count
      const allTags = await getTags();
      setTags(allTags);
      // Refresh entries list to update tag dots
      await refreshLibrary();
      // Invalidate entry to refresh info panel
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
      // Remove all active tags from all selected entries
      for (const id of targetIds) {
        for (const tagId of activeTagIds) {
          await removeEntryTag(id, tagId);
        }
      }
      // Refresh tags to update item count
      const allTags = await getTags();
      setTags(allTags);
      // Refresh entries list
      await refreshLibrary();
      // Invalidate entry to refresh info panel
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
      // Open the note in a new tab
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
      // Delete all selected entries
      for (const id of targetIds) {
        await deleteEntry(id);
        removeEntry(id);
        // Close any open tabs for this entry
        const entryTabs = tabs.filter((t) => t.type === 'entry' && t.entryId === String(id));
        entryTabs.forEach((t) => closeTab(t.id));
      }
      const count = await getTrashCount();
      setTrashCount(count);
      // Refresh collections and tags to update item counts
      const allCollections = await getCollections();
      setCollections(allCollections);
      const allTags = await getTags();
      setTags(allTags);
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

  const handleReextractAttachments = (forceOcr = false) => {
    onClose?.();
    const ocrLabel = forceOcr ? ' with OCR' : '';
    const label = isMultiSelect
      ? `Re-extracting${ocrLabel} attachments for ${targetIds.length} entries`
      : `Re-extracting${ocrLabel} attachments`;
    const loadingId = toast.loading(`${label}...`);
    // Capture ids so the async work doesn't depend on component state
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

  return (
    <>
      <DropdownMenuItem onClick={handleOpen}>
        <ExternalLink className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Open ${targetIds.length} Items` : 'Open'}
        <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
      </DropdownMenuItem>

      <DropdownMenuItem onClick={handleShowInFinder}>
        <FolderOpen className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Show ${targetIds.length} in Finder` : 'Show in Finder'}
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      {!isMultiSelect && (
        <>
          <DropdownMenuItem onClick={handleCreateNote}>
            <StickyNote className='h-4 w-4 mr-2' />
            Add Note
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Plus className='h-4 w-4 mr-2' />
              Add Attachment
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='w-48'>
              <DropdownMenuItem onClick={handleAddPdfAttachment}>
                <File className='h-4 w-4 mr-2' />
                PDF...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAddMarkdownAttachment}>
                <FileText className='h-4 w-4 mr-2' />
                Markdown...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAddFileAttachment}>
                <Paperclip className='h-4 w-4 mr-2' />
                File...
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
        </>
      )}

      {collections.length > 0 && (
        <>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderPlus className='h-4 w-4 mr-2' />
              {isMultiSelect ? `Add ${targetIds.length} to Collection` : 'Add to Collection'}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='w-48'>
              {collections.map((collection) => (
                <DropdownMenuItem
                  key={collection.id}
                  onClick={() => handleAddToCollection(collection.id)}
                >
                  <FolderOpen
                    className='h-4 w-4 mr-2'
                    fill={collection.color || 'transparent'}
                    stroke={collection.color || 'currentColor'}
                  />
                  {collection.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {activeCollectionId && (
            <DropdownMenuItem onClick={() => handleRemoveFromCollection(activeCollectionId)}>
              <FolderMinus className='h-4 w-4 mr-2' />
              {isMultiSelect
                ? `Remove ${targetIds.length} from Collection`
                : 'Remove from Collection'}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
        </>
      )}

      {tags.length > 0 ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Tags className='h-4 w-4 mr-2' />
            {isMultiSelect ? `Add Tag to ${targetIds.length} Items` : 'Add Tag'}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='w-48'>
            {tags.map((tag) => (
              <DropdownMenuItem key={tag.id} onClick={() => handleAddTag(tag.name)}>
                {/* Only show color dot if tag has a color or is not imported */}
                {(tag.color || !tag.isImported) && (
                  <span
                    className='w-2 h-2 rounded-full mr-2'
                    style={{ backgroundColor: tag.color || '#6b7280' }}
                  />
                )}
                {tag.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <DropdownMenuItem disabled>
          <Tags className='h-4 w-4 mr-2' />
          Add Tag (no tags exist)
        </DropdownMenuItem>
      )}
      {activeFilter.type === 'tag' && activeTagIds.length > 0 && (
        <DropdownMenuItem onClick={handleRemoveActiveTag}>
          <IconTagOff className='h-4 w-4 mr-2' />
          {isMultiSelect
            ? `Remove Tag from ${targetIds.length} Items`
            : activeTagIds.length > 1
              ? `Remove ${activeTagIds.length} Tags`
              : 'Remove Tag'}
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Download className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Export ${targetIds.length} Items` : 'Export As'}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className='w-48'>
          <DropdownMenuItem onClick={handleExportCslJson}>
            <FileJson className='h-4 w-4 mr-2' />
            CSL JSON...
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportBibtex}>
            <FileCode className='h-4 w-4 mr-2' />
            BibTeX...
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onShowExportDialog?.(targetIds)}>
            <FolderOutput className='h-4 w-4 mr-2' />
            BibLaTeX with Files...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyCslJson}>
            <Copy className='h-4 w-4 mr-2' />
            Copy as CSL JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyBibtex}>
            <Copy className='h-4 w-4 mr-2' />
            Copy as BibTeX
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={handleCopyTitle}>
        <Copy className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Copy ${targetIds.length} Titles` : 'Copy Title'}
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={handleParseWithAI}>
        <Sparkles className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Parse Attachments (${targetIds.length} Entries)` : 'Parse Attachments with AI'}
      </DropdownMenuItem>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <RefreshCw className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Re-extract ${targetIds.length} Entries` : 'Re-extract Attachments'}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className='w-56'>
          <DropdownMenuItem onClick={() => handleReextractAttachments(false)}>
            <RefreshCw className='h-4 w-4 mr-2' />
            Re-extract Text
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleReextractAttachments(true)}>
            <RefreshCw className='h-4 w-4 mr-2' />
            Re-extract with OCR
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={handleDelete} className='text-destructive focus:text-destructive'>
        <Trash2 className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Delete ${targetIds.length} Entries` : 'Delete Entry'}
        <DropdownMenuShortcut>Del</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

// Original wrapper component for backwards compatibility
export function EntryContextMenu({ entry, children }: EntryContextMenuProps) {
  const { openTab, tabs, closeTab } = useTabStore();
  const {
    collections,
    tags,
    entries,
    removeEntry,
    invalidateAttachments,
    setTrashCount,
    setCollections,
    setTags,
    invalidateEntry,
    selectedEntryIds,
    activeCollectionId,
    activeTagIds,
    activeFilter,
    refreshLibrary,
  } = useLibraryStore();

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Use all selected entries for bulk operations when multiple are selected
  const targetIds =
    selectedEntryIds.length > 1 && selectedEntryIds.includes(entry.id)
      ? selectedEntryIds
      : [entry.id];
  const isMultiSelect = targetIds.length > 1;

  // Get entry objects for selected entries (for titles, etc.)
  const targetEntries = isMultiSelect
    ? entries.filter((e) => targetIds.includes(e.id))
    : [entry];

  const handleOpen = () => {
    // Open all selected entries in tabs
    for (const targetEntry of targetEntries) {
      openTab({
        type: 'entry',
        title: targetEntry.title,
        entryId: String(targetEntry.id),
      });
    }
  };

  const handleShowInFinder = async () => {
    try {
      // Show all selected entries in Finder (batch operation for multiple files)
      if (targetIds.length === 1) {
        await showEntryInFinder(targetIds[0]);
      } else {
        await showEntriesInFinder(targetIds);
      }
    } catch (err) {
      console.error('Failed to show in Finder:', err);
    }
  };

  const handleCopyTitle = async () => {
    try {
      // Copy all titles (newline separated for multiple)
      const titles = targetEntries.map((e) => e.title).join('\n');
      await writeText(titles);
      toast.success(isMultiSelect ? `${targetEntries.length} titles copied` : 'Title copied');
    } catch (err) {
      console.error('Failed to copy title:', err);
      toast.error('Failed to copy title');
    }
  };

  const handleAddToCollection = async (collectionId: number) => {
    try {
      // Add all selected entries to collection
      for (const id of targetIds) {
        await addEntryToCollection(id, collectionId);
      }
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Invalidate entry to refresh info panel
      invalidateEntry();
      toast.success(isMultiSelect ? `Added ${targetIds.length} items to collection` : 'Added to collection');
    } catch (err) {
      console.error('Failed to add to collection:', err);
      toast.error('Failed to add to collection');
    }
  };

  const handleRemoveFromCollection = async (collectionId: number) => {
    try {
      // Remove all selected entries from the collection
      for (const id of targetIds) {
        await removeEntryFromCollection(id, collectionId);
      }
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Refresh entries using current filters (collection/tag) so view updates correctly
      await refreshLibrary();
      // Invalidate entry to refresh info panel
      invalidateEntry();
      toast.success(isMultiSelect ? `Removed ${targetIds.length} items from collection` : 'Removed from collection');
    } catch (err) {
      console.error('Failed to remove from collection:', err);
      toast.error('Failed to remove from collection');
    }
  };

  const handleAddTag = async (tagName: string) => {
    try {
      await addTagToEntries(tagName, targetIds);
      // Refresh tags to update item count
      const allTags = await getTags();
      setTags(allTags);
      // Refresh entries list to update tag dots
      await refreshLibrary();
      // Invalidate entry to refresh info panel
      invalidateEntry();
      toast.success(isMultiSelect ? `Tag added to ${targetIds.length} entries` : 'Tag added');
    } catch (err) {
      console.error('Failed to add tag:', err);
      toast.error('Failed to add tag');
    }
  };

  const handleRemoveActiveTag = async () => {
    try {
      // Remove all active tags from all selected entries
      for (const id of targetIds) {
        for (const tagId of activeTagIds) {
          await removeEntryTag(id, tagId);
        }
      }
      // Refresh tags to update item count
      const allTags = await getTags();
      setTags(allTags);
      // Refresh entries list
      await refreshLibrary();
      // Invalidate entry to refresh info panel
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
        await addFileAttachment(entry.id, selected);
        invalidateAttachments();
        await refreshLibrary();
        toast.success('File attached');
      }
    } catch (err) {
      console.error('Failed to add file attachment:', err);
      toast.error('Failed to attach file');
    }
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
      // Open the note in a new tab
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
  };

  const handleDelete = async () => {
    try {
      // Delete all selected entries
      for (const id of targetIds) {
        await deleteEntry(id);
        removeEntry(id);
        // Close any open tabs for this entry
        const entryTabs = tabs.filter((t) => t.type === 'entry' && t.entryId === String(id));
        entryTabs.forEach((t) => closeTab(t.id));
      }
      const count = await getTrashCount();
      setTrashCount(count);
      // Refresh collections and tags to update item counts
      const allCollections = await getCollections();
      setCollections(allCollections);
      const allTags = await getTags();
      setTags(allTags);
      toast.success(isMultiSelect ? `${targetIds.length} entries moved to Trash` : 'Moved to Trash');
    } catch (err) {
      console.error('Failed to delete entry:', err);
      toast.error('Failed to move to Trash');
    }
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
  };

  const handleReextractAttachments = (forceOcr = false) => {
    const ocrLabel = forceOcr ? ' with OCR' : '';
    const label = isMultiSelect
      ? `Re-extracting${ocrLabel} attachments for ${targetIds.length} entries`
      : `Re-extracting${ocrLabel} attachments`;
    const loadingId = toast.loading(`${label}...`);
    // Capture ids so the async work doesn't depend on component state
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
  };

  const handleCopyCslJson = async () => {
    try {
      const content = await exportToCslJson(targetIds);
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy CSL JSON:', err);
    }
  };

  const handleCopyBibtex = async () => {
    try {
      const content = await exportToBibtex(targetIds);
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy BibTeX:', err);
    }
  };

  const handleExportBiblatexWithFiles = async (options: ExportOptions) => {
    try {
      setIsExporting(true);
      const outputDir = await open({
        directory: true,
        title: 'Select Export Folder',
      });
      if (outputDir) {
        const result = await exportToBiblatexWithFiles(targetIds, outputDir, options);
        toast.success(
          `Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`,
        );
        setShowExportDialog(false);
      }
    } catch (err) {
      console.error('Failed to export to BibLaTeX:', err);
      toast.error('Failed to export to BibLaTeX');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-56'>
        <ContextMenuItem onClick={handleOpen}>
          <ExternalLink className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Open ${targetIds.length} Items` : 'Open'}
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleShowInFinder}>
          <FolderOpen className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Show ${targetIds.length} in Finder` : 'Show in Finder'}
        </ContextMenuItem>

        <ContextMenuSeparator />

        {!isMultiSelect && (
          <>
            <ContextMenuItem onClick={handleCreateNote}>
              <StickyNote className='h-4 w-4 mr-2' />
              Add Note
            </ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Plus className='h-4 w-4 mr-2' />
                Add Attachment
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className='w-48'>
                <ContextMenuItem onClick={handleAddPdfAttachment}>
                  <File className='h-4 w-4 mr-2' />
                  PDF...
                </ContextMenuItem>
                <ContextMenuItem onClick={handleAddMarkdownAttachment}>
                  <FileText className='h-4 w-4 mr-2' />
                  Markdown...
                </ContextMenuItem>
                <ContextMenuItem onClick={handleAddFileAttachment}>
                  <Paperclip className='h-4 w-4 mr-2' />
                  File...
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />
          </>
        )}

        {collections.length > 0 && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderPlus className='h-4 w-4 mr-2' />
                {isMultiSelect ? `Add ${targetIds.length} to Collection` : 'Add to Collection'}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className='w-48'>
                {collections.map((collection) => (
                  <ContextMenuItem
                    key={collection.id}
                    onClick={() => handleAddToCollection(collection.id)}
                  >
                    <FolderOpen
                      className='h-4 w-4 mr-2'
                      fill={collection.color || 'transparent'}
                      stroke={collection.color || 'currentColor'}
                    />
                    {collection.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            {activeCollectionId && (
              <ContextMenuItem onClick={() => handleRemoveFromCollection(activeCollectionId)}>
                <FolderMinus className='h-4 w-4 mr-2' />
                {isMultiSelect
                  ? `Remove ${targetIds.length} from Collection`
                  : 'Remove from Collection'}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}

        {tags.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Tags className='h-4 w-4 mr-2' />
              {isMultiSelect ? `Add Tag to ${targetIds.length} Items` : 'Add Tag'}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className='w-48'>
              {tags.map((tag) => (
                <ContextMenuItem key={tag.id} onClick={() => handleAddTag(tag.name)}>
                  {/* Only show color dot if tag has a color or is not imported */}
                  {(tag.color || !tag.isImported) && (
                    <span
                      className='w-2 h-2 rounded-full mr-2'
                      style={{ backgroundColor: tag.color || '#6b7280' }}
                    />
                  )}
                  {tag.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem disabled>
            <Tags className='h-4 w-4 mr-2' />
            Add Tag (no tags exist)
          </ContextMenuItem>
        )}
        {activeFilter.type === 'tag' && activeTagIds.length > 0 && (
          <ContextMenuItem onClick={handleRemoveActiveTag}>
            <IconTagOff className='h-4 w-4 mr-2' />
            {isMultiSelect
              ? `Remove Tag from ${targetIds.length} Items`
              : activeTagIds.length > 1
                ? `Remove ${activeTagIds.length} Tags`
                : 'Remove Tag'}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Download className='h-4 w-4 mr-2' />
            {isMultiSelect ? `Export ${targetIds.length} Items` : 'Export As'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className='w-48'>
            <ContextMenuItem onClick={handleExportCslJson}>
              <FileJson className='h-4 w-4 mr-2' />
              CSL JSON...
            </ContextMenuItem>
            <ContextMenuItem onClick={handleExportBibtex}>
              <FileCode className='h-4 w-4 mr-2' />
              BibTeX...
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setShowExportDialog(true)}>
              <FolderOutput className='h-4 w-4 mr-2' />
              BibLaTeX with Files...
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleCopyCslJson}>
              <Copy className='h-4 w-4 mr-2' />
              Copy as CSL JSON
            </ContextMenuItem>
            <ContextMenuItem onClick={handleCopyBibtex}>
              <Copy className='h-4 w-4 mr-2' />
              Copy as BibTeX
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleCopyTitle}>
          <Copy className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Copy ${targetIds.length} Titles` : 'Copy Title'}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleParseWithAI}>
          <Sparkles className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Parse Attachments (${targetIds.length} Entries)` : 'Parse Attachments with AI'}
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <RefreshCw className='h-4 w-4 mr-2' />
            {isMultiSelect ? `Re-extract ${targetIds.length} Entries` : 'Re-extract Attachments'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className='w-56'>
            <ContextMenuItem onClick={() => handleReextractAttachments(false)}>
              <RefreshCw className='h-4 w-4 mr-2' />
              Re-extract Text
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleReextractAttachments(true)}>
              <RefreshCw className='h-4 w-4 mr-2' />
              Re-extract with OCR
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={handleDelete}
          className='text-destructive focus:text-destructive'
        >
          <Trash2 className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Delete ${targetIds.length} Entries` : 'Delete Entry'}
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <ExportOptionsDialog
      open={showExportDialog}
      onClose={() => setShowExportDialog(false)}
      onExport={handleExportBiblatexWithFiles}
      entryCount={targetIds.length}
      isExporting={isExporting}
    />
    </>
  );
}
