import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  LayoutGrid,
  List,
  Plus,
  SortAsc,
  SortDesc,
  File,
  FileText,
  FolderOpen,
  Library,
  RotateCcw,
  Trash2,
  Check,
  FileType,
  StickyNote,
  CheckSquare,
  Square,
  XSquare,
  Tag,
  Paperclip,
  Globe,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { open as openInBrowser } from '@tauri-apps/plugin-shell';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUIStore, type SortField } from '@/stores/uiStore';
import { useLibraryStore, type Attachment } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import { useImport, useLibrarySync } from '@/hooks/useLibrarySync';
import {
  getEntryAttachments,
  getEntriesAttachments,
  getTrashedEntries,
  restoreEntry,
  emptyTrash,
  getTrashCount,
  permanentDeleteEntry,
  previewBiblatexImport,
  importBiblatexWithFiles,
  type BiblatexPreviewResult,
} from '@/services/tauri';
import { ImportPreviewDialog } from '@/components/dialogs/ImportPreviewDialog';
import { toast } from '@/stores/toastStore';
import { EntryTable } from './EntryTable';
import { EntryCardView } from './EntryCardView';
import { ColumnConfigDropdown } from './ColumnConfigDropdown';
import { QuickSearchBar } from './QuickSearchBar';
import { DuplicatesView } from './DuplicatesView';
import { cn } from '@/lib/utils';
import { filterEntriesBySearch, sortEntries } from '@/lib/filters';

export function MiddlePane() {
  const {
    viewModeByFilter,
    setViewMode,
    sortField,
    sortDirection,
    setSort,
    secondarySortField,
    secondarySortDirection,
    setSecondarySort,
    activeFilter,
  } = useUIStore();
  const {
    entries,
    entryCounts,
    currentTotal,
    selectedEntryIds,
    selectEntry,
    clearSelection,
    expandedEntryIds,
    toggleEntryExpanded,
    isLoading,
    isLoadingMore,
    searchQuery,
    attachmentVersion,
    trashedEntries,
    setTrashedEntries,
    setTrashCount,
    invalidateAttachments,
    tags,
    collections,
    activeTagIds,
    activeCollectionId,
    activeFilter: libraryFilter,
    hasMore,
    loadNextPage,
  } = useLibraryStore();
  const { openTab } = useTabStore();
  const { importFiles, importFolder } = useImport();
  const { refresh } = useLibrarySync();

  const viewMode = viewModeByFilter[activeFilter];

  const activeTags = activeTagIds.length > 0
    ? tags.filter((tag) => activeTagIds.includes(tag.id))
    : [];
  const activeCollection = activeCollectionId
    ? collections.find((collection) => collection.id === activeCollectionId)
    : null;
  const isTagView = libraryFilter.type === 'tag';
  const isEmptyTagMode = isTagView && activeTagIds.length === 0;
  const isCollectionView = Boolean(activeCollectionId);

  // Trash state
  const [showEmptyTrashDialog, setShowEmptyTrashDialog] = useState(false);
  const [isTrashLoading, setIsTrashLoading] = useState(false);

  // BibLaTeX import preview state
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<BiblatexPreviewResult | null>(null);
  const [importFolderPath, setImportFolderPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // State for fetched attachments (keyed by entry ID)
  const [attachmentsMap, setAttachmentsMap] = useState<Record<number, Attachment[]>>({});
  const fetchedEntryIdsRef = useRef<Set<number>>(new Set());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const cardScrollRef = useRef<HTMLDivElement | null>(null);

  // Load trashed entries when filter changes to trash
  const loadTrashedEntries = useCallback(async () => {
    setIsTrashLoading(true);
    try {
      const trashed = await getTrashedEntries();
      setTrashedEntries(trashed);
    } catch (err) {
      console.error('Failed to load trashed entries:', err);
    } finally {
      setIsTrashLoading(false);
    }
  }, [setTrashedEntries]);

  useEffect(() => {
    if (activeFilter === 'trash') {
      loadTrashedEntries();
    }
  }, [activeFilter, loadTrashedEntries]);

  // Trash actions
  const handleRestoreSelected = async () => {
    for (const id of selectedEntryIds) {
      try {
        await restoreEntry(id);
      } catch (err) {
        console.error(`Failed to restore entry ${id}:`, err);
      }
    }
    clearSelection();
    await loadTrashedEntries();
    const count = await getTrashCount();
    setTrashCount(count);
    await refresh();
  };

  const handleEmptyTrash = async () => {
    setShowEmptyTrashDialog(false);
    try {
      await emptyTrash();
      setTrashedEntries([]);
      setTrashCount(0);
    } catch (err) {
      console.error('Failed to empty trash:', err);
    }
  };

  const handleDeleteSelectedPermanently = async () => {
    for (const id of selectedEntryIds) {
      try {
        await permanentDeleteEntry(id);
      } catch (err) {
        console.error(`Failed to permanently delete entry ${id}:`, err);
      }
    }
    clearSelection();
    await loadTrashedEntries();
    const count = await getTrashCount();
    setTrashCount(count);
  };

  // Clear attachment cache when version changes (e.g., after adding an attachment)
  useEffect(() => {
    if (attachmentVersion > 0) {
      fetchedEntryIdsRef.current.clear();
      setAttachmentsMap({});
    }
  }, [attachmentVersion]);

  // Fetch attachments when entries are expanded or cache is invalidated (BATCH)
  useEffect(() => {
    const fetchAttachments = async () => {
      // Find entry IDs that need fetching
      const idsToFetch = expandedEntryIds.filter((id) => !fetchedEntryIdsRef.current.has(id));

      if (idsToFetch.length === 0) return;

      // Mark as fetching to prevent duplicate requests
      idsToFetch.forEach((id) => fetchedEntryIdsRef.current.add(id));

      try {
        // Batch fetch ALL attachments in ONE call
        const attachmentsMap = await getEntriesAttachments(idsToFetch);
        setAttachmentsMap((prev) => ({
          ...prev,
          ...attachmentsMap,
        }));
      } catch (err) {
        console.error('Failed to fetch attachments:', err);
        // Remove from fetched set so we can retry
        idsToFetch.forEach((id) => fetchedEntryIdsRef.current.delete(id));
      }
    };

    fetchAttachments();
  }, [expandedEntryIds, attachmentVersion]);

  const handleImportFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        await importFiles(selected);
      }
    } catch (err) {
      console.error('Import error:', err);
    }
  };

  const handleImportFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (selected && typeof selected === 'string') {
      await importFolder(selected);
    }
  };

  const handleImportBiblatex = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Zotero BibLaTeX Export Folder',
    });

    if (selected && typeof selected === 'string') {
      try {
        // Get preview data first
        const preview = await previewBiblatexImport(selected);
        setImportPreviewData(preview);
        setImportFolderPath(selected);
        setShowImportPreview(true);
      } catch (err) {
        console.error('Failed to preview BibLaTeX:', err);
        toast.error('Failed to preview BibLaTeX folder');
      }
    }
  };

  const handleConfirmImport = async (options: import('@/components/dialogs/ImportPreviewDialog').ImportOptions) => {
    if (!importFolderPath) return;

    const { selectedKeys, importTags, excludedFiles, collectionId } = options;

    setIsImporting(true);
    try {
      const result = await importBiblatexWithFiles(
        importFolderPath,
        importFolderPath,
        selectedKeys,
        importTags,
        excludedFiles,
        collectionId
      );

      let message = `Imported ${result.imported} ${result.imported !== 1 ? 'entries' : 'entry'}`;
      if (result.filesImported > 0) {
        message += ` with ${result.filesImported} file${result.filesImported !== 1 ? 's' : ''}`;
      }
      if (result.tagsCreated > 0) {
        message += ` and ${result.tagsCreated} tag${result.tagsCreated !== 1 ? 's' : ''}`;
      }
      toast.success(message);

      if (result.skipped > 0) {
        toast.info(`${result.skipped} entries skipped`);
      }

      // Invalidate attachment cache so expanded rows refetch attachment names
      invalidateAttachments();
      // Refresh library
      await refresh();

      // Close dialog
      setShowImportPreview(false);
      setImportPreviewData(null);
      setImportFolderPath(null);
    } catch (err) {
      console.error('Failed to import BibLaTeX:', err);
      toast.error('Failed to import BibLaTeX entries');
    } finally {
      setIsImporting(false);
    }
  };

  // Determine which entries to display (regular or trashed)
  const isTrashView = activeFilter === 'trash';
  const isDuplicatesView = activeFilter === 'duplicates';
  const displayEntries = isTrashView ? trashedEntries : entries;

  // Memoized filter entries using shared utility
  const filteredEntries = useMemo(() => {
    if (isTrashView) {
      return filterEntriesBySearch(displayEntries, searchQuery);
    }
    return displayEntries;
  }, [displayEntries, isTrashView, searchQuery]);

  // Memoized sort entries using shared utility
  const sortedEntries = useMemo(() => {
    return sortEntries(
      filteredEntries,
      sortField,
      sortDirection,
      secondarySortField,
      secondarySortDirection,
    );
  }, [filteredEntries, sortField, sortDirection, secondarySortField, secondarySortDirection]);

  const loadedCount = sortedEntries.length;
  const totalCount = isTrashView ? sortedEntries.length : currentTotal;

  const maybeLoadMoreCards = useCallback(() => {
    if (isTrashView || isDuplicatesView || viewMode !== 'card') return;
    if (!hasMore || isLoadingMore || isLoading) return;
    const el = cardScrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 200) {
      loadNextPage();
    }
  }, [hasMore, isLoadingMore, isLoading, isTrashView, isDuplicatesView, loadNextPage, viewMode]);

  useEffect(() => {
    if (isTrashView || isDuplicatesView || viewMode !== 'card') return;
    if (!loadMoreRef.current) return;
    const observer = new IntersectionObserver(
      (entriesObs) => {
        const [entry] = entriesObs;
        if (entry.isIntersecting && hasMore && !isLoadingMore && !isLoading) {
          loadNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [activeFilter, hasMore, isLoadingMore, isLoading, isTrashView, isDuplicatesView, loadNextPage, viewMode]);

  useEffect(() => {
    maybeLoadMoreCards();
  }, [sortedEntries.length, maybeLoadMoreCards]);

  useEffect(() => {
    if (viewMode !== 'card') return;
    maybeLoadMoreCards();
  }, [activeFilter, activeCollectionId, activeTagIds, searchQuery, viewMode, maybeLoadMoreCards]);

  useEffect(() => {
    const el = cardScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      maybeLoadMoreCards();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [maybeLoadMoreCards]);

  // Entry handlers
  const handleEntryClick = (entryId: number, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      selectEntry(entryId, true);
    } else {
      selectEntry(entryId);
    }
  };

  // Keyboard navigation handler
  const handleKeyboardSelect = useCallback(
    (entryId: number) => {
      selectEntry(entryId);
    },
    [selectEntry],
  );

  // Bulk selection handlers
  const handleSelectAll = useCallback(() => {
    sortedEntries.forEach((e) => selectEntry(e.id, true));
  }, [sortedEntries, selectEntry]);

  const handleSelectPdfs = useCallback(() => {
    clearSelection();
    sortedEntries.filter((e) => e.hasPdf).forEach((e) => selectEntry(e.id, true));
  }, [sortedEntries, selectEntry, clearSelection]);

  const handleSelectUntagged = useCallback(() => {
    clearSelection();
    sortedEntries.filter((e) => e.tags.length === 0).forEach((e) => selectEntry(e.id, true));
  }, [sortedEntries, selectEntry, clearSelection]);

  const handleSelectNoAttachments = useCallback(() => {
    clearSelection();
    sortedEntries.filter((e) => e.attachmentCount === 0).forEach((e) => selectEntry(e.id, true));
  }, [sortedEntries, selectEntry, clearSelection]);

  const handleSelectNoPdfs = useCallback(() => {
    clearSelection();
    sortedEntries.filter((e) => !e.hasPdf).forEach((e) => selectEntry(e.id, true));
  }, [sortedEntries, selectEntry, clearSelection]);

  const handleSelectNoNotes = useCallback(() => {
    clearSelection();
    sortedEntries.filter((e) => !e.hasNote).forEach((e) => selectEntry(e.id, true));
  }, [sortedEntries, selectEntry, clearSelection]);

  const handleSelectNoWeblinks = useCallback(() => {
    clearSelection();
    sortedEntries.filter((e) => !e.hasWeblink).forEach((e) => selectEntry(e.id, true));
  }, [sortedEntries, selectEntry, clearSelection]);

  const handleEntryDoubleClick = async (entryId: number) => {
    // Don't open trashed entries - user should restore first
    if (isTrashView) return;

    // Find entry from the displayed entries
    const entry = sortedEntries.find((e) => e.id === entryId);
    if (!entry) return;

    // Get attachments - from cache or fetch
    let attachments = attachmentsMap[entryId];
    if (!attachments) {
      try {
        const fetched = await getEntryAttachments(entryId);
        attachments = fetched;
        setAttachmentsMap((prev) => ({ ...prev, [entryId]: attachments! }));
      } catch (err) {
        console.error('Failed to fetch attachments:', err);
        // Fallback: just open entry tab
        openTab({ type: 'entry', title: entry.title, entryId: String(entry.id) });
        return;
      }
    }

    // Determine which attachment to open based on filter
    let targetAttachment: Attachment | undefined;

    if (activeFilter === 'notes') {
      // Notes filter: only open notes
      targetAttachment = attachments.find((a) => a.attachmentType === 'note');
    } else if (activeFilter === 'pdfs') {
      // PDFs filter: only open PDFs
      targetAttachment = attachments.find((a) => a.attachmentType === 'pdf');
    } else {
      // For "all", "recent", "untagged", collections, etc.
      // Priority: PDF > Note > Weblink
      targetAttachment =
        attachments.find((a) => a.attachmentType === 'pdf') ||
        attachments.find((a) => a.attachmentType === 'note') ||
        attachments.find((a) => a.attachmentType === 'weblink');
    }

    if (targetAttachment) {
      if (targetAttachment.attachmentType === 'weblink' && targetAttachment.url) {
        // Open weblink in browser
        try {
          await openInBrowser(targetAttachment.url);
        } catch (err) {
          console.error('Failed to open URL:', err);
        }
      } else {
        // Open PDF or note in app tab
        openTab({
          type: 'entry',
          title: targetAttachment.title || entry.title,
          entryId: String(entry.id),
          attachmentId: String(targetAttachment.id),
        });
      }
    } else {
      // No matching attachment, just open entry details
      openTab({ type: 'entry', title: entry.title, entryId: String(entry.id) });
    }
  };

  // Attachment handlers
  const handleAttachmentClick = (entryId: number, _attachmentId: number) => {
    selectEntry(entryId);
  };

  const handleAttachmentDoubleClick = async (entryId: number, attachmentId: number) => {
    const entry = entries.find((e) => e.id === entryId);
    const attachment = attachmentsMap[entryId]?.find((a) => a.id === attachmentId);
    if (!entry || !attachment) return;

    if (attachment.attachmentType === 'weblink' && attachment.url) {
      // Open weblink in browser
      try {
        await openInBrowser(attachment.url);
      } catch (err) {
        console.error('Failed to open URL:', err);
      }
    } else {
      // Open PDF or note in app tab
      openTab({
        type: 'entry',
        title: attachment.title || entry.title,
        entryId: String(entry.id),
        attachmentId: String(attachmentId),
      });
    }
  };

  const getFilterTitle = () => {
    if (isTagView) {
      if (activeTags.length === 0) {
        return 'Tags';
      }
      if (activeTags.length === 1) {
        return activeTags[0]?.name ?? 'Tag';
      }
      return `${activeTags.length} Tags`;
    }
    if (isCollectionView) {
      return activeCollection?.name ?? 'Collection';
    }

    switch (activeFilter) {
      case 'pdfs':
        return 'PDFs';
      case 'notes':
        return 'Notes';
      case 'recent':
        return 'Recently Added';
      case 'untagged':
        return 'Untagged';
      case 'trash':
        return 'Trash';
      case 'duplicates':
        return 'Duplicates';
      default:
        return 'All Items';
    }
  };

  return (
    <div className='flex flex-col h-full'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-2 border-b bg-background'>
        <div className='flex items-center gap-2'>
          <h2 className='font-semibold text-sm'>{getFilterTitle()}</h2>
          <span className='text-xs text-muted-foreground'>
            {isTrashView || totalCount <= loadedCount
              ? `${loadedCount} ${loadedCount !== 1 ? 'entries' : 'entry'}`
              : `${loadedCount} of ${totalCount} entries`}
          </span>
        </div>

        <div className='flex items-center gap-2'>
          <QuickSearchBar />

          {/* Bulk selection dropdown */}
          {!isTrashView && !isDuplicatesView && sortedEntries.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='h-7 w-7'
                  title='Selection options'
                >
                  {selectedEntryIds.length > 0 ? (
                    <CheckSquare className='h-4 w-4' />
                  ) : (
                    <Square className='h-4 w-4' />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-40'>
                <DropdownMenuItem onClick={handleSelectAll}>
                  <CheckSquare className='h-4 w-4 mr-2' />
                  Select All
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSelectPdfs}>
                  <FileType className='h-4 w-4 mr-2' />
                  Select PDFs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSelectUntagged}>
                  <Square className='h-4 w-4 mr-2' />
                  Select Untagged
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSelectNoAttachments}>
                  <Paperclip className='h-4 w-4 mr-2' />
                  Select No Attachments
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSelectNoPdfs}>
                  <FileType className='h-4 w-4 mr-2' />
                  Select No PDFs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSelectNoNotes}>
                  <StickyNote className='h-4 w-4 mr-2' />
                  Select No Notes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSelectNoWeblinks}>
                  <Globe className='h-4 w-4 mr-2' />
                  Select No Weblinks
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={clearSelection}
                  disabled={selectedEntryIds.length === 0}
                >
                  <XSquare className='h-4 w-4 mr-2' />
                  Deselect All
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {viewMode === 'list' && <ColumnConfigDropdown />}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-sm' className='h-7 w-7' title='Sort options'>
                {sortDirection === 'asc' ? (
                  <SortAsc className='h-4 w-4' />
                ) : (
                  <SortDesc className='h-4 w-4' />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-48'>
              <DropdownMenuLabel className='text-xs text-muted-foreground'>
                Sort by
              </DropdownMenuLabel>
              {(
                [
                  'title',
                  'creator',
                  'year',
                  'dateAdded',
                  'dateModified',
                  'itemType',
                ] as SortField[]
              ).map((field) => (
                <DropdownMenuItem
                  key={field}
                  onClick={() => setSort(field)}
                  className='flex items-center justify-between'
                >
                  <span>
                    {field === 'title' && 'Title'}
                    {field === 'creator' && 'Creator'}
                    {field === 'year' && 'Year'}
                    {field === 'dateAdded' && 'Date Added'}
                    {field === 'dateModified' && 'Date Modified'}
                    {field === 'itemType' && 'Type'}
                  </span>
                  {sortField === field && <Check className='h-4 w-4' />}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className='text-muted-foreground'>Then by</span>
                  {secondarySortField && (
                    <span className='ml-1 text-xs text-muted-foreground'>
                      ({secondarySortField === 'title' && 'Title'}
                      {secondarySortField === 'creator' && 'Creator'}
                      {secondarySortField === 'year' && 'Year'}
                      {secondarySortField === 'dateAdded' && 'Added'}
                      {secondarySortField === 'dateModified' && 'Modified'}
                      {secondarySortField === 'itemType' && 'Type'})
                    </span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className='w-40'>
                  <DropdownMenuItem
                    onClick={() => setSecondarySort(null)}
                    className='flex items-center justify-between'
                  >
                    <span className='text-muted-foreground'>None</span>
                    {secondarySortField === null && <Check className='h-4 w-4' />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {(
                    [
                      'title',
                      'creator',
                      'year',
                      'dateAdded',
                      'dateModified',
                      'itemType',
                    ] as SortField[]
                  )
                    .filter((field) => field !== sortField)
                    .map((field) => (
                      <DropdownMenuItem
                        key={field}
                        onClick={() => setSecondarySort(field)}
                        className='flex items-center justify-between'
                      >
                        <span>
                          {field === 'title' && 'Title'}
                          {field === 'creator' && 'Creator'}
                          {field === 'year' && 'Year'}
                          {field === 'dateAdded' && 'Date Added'}
                          {field === 'dateModified' && 'Date Modified'}
                          {field === 'itemType' && 'Type'}
                        </span>
                        {secondarySortField === field && <Check className='h-4 w-4' />}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={() => setSort(sortField)}>
                {sortDirection === 'asc' ? 'Sort Descending' : 'Sort Ascending'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Hide view toggle for duplicates view (has its own layout) */}
          {!isDuplicatesView && (
            <div className='flex items-center border rounded-md'>
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={() => setViewMode('list')}
                className={cn('h-7 w-7 rounded-r-none', viewMode === 'list' && 'bg-accent')}
              >
                <List className='h-4 w-4' />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={() => setViewMode('card')}
                className={cn('h-7 w-7 rounded-l-none', viewMode === 'card' && 'bg-accent')}
              >
                <LayoutGrid className='h-4 w-4' />
              </Button>
            </div>
          )}

          {/* Hide import button in trash view */}
          {!isTrashView && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' size='icon-sm' className='h-7 w-7' disabled={isLoading}>
                  <Plus className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={handleImportFiles}>
                  <File className='h-4 w-4 mr-2' />
                  Import PDFs...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleImportFolder}>
                  <FolderOpen className='h-4 w-4 mr-2' />
                  Import Folder...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleImportBiblatex}>
                  <Library className='h-4 w-4 mr-2' />
                  Import from Zotero...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content */}
      {isDuplicatesView ? (
        <DuplicatesView />
      ) : isLoading || isTrashLoading ? (
        <div className='flex-1 flex items-center justify-center text-muted-foreground'>
          <p className='text-sm'>Loading...</p>
        </div>
      ) : sortedEntries.length === 0 ? (
        <div className='flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4'>
          <div className='text-center'>
            {isTrashView ? (
              <>
                <Trash2 className='h-8 w-8 mx-auto mb-2 opacity-50' />
                <p className='text-sm font-medium'>Trash is empty</p>
                <p className='text-xs'>Deleted items will appear here</p>
              </>
            ) : searchQuery ? (
              <>
                <p className='text-sm font-medium'>No results found</p>
                <p className='text-xs'>No entries match "{searchQuery}"</p>
              </>
            ) : activeFilter === 'pdfs' ? (
              <>
                <FileType className='h-8 w-8 mx-auto mb-2 opacity-50' />
                <p className='text-sm font-medium'>No PDFs</p>
                <p className='text-xs'>Import PDF files to see them here</p>
              </>
            ) : activeFilter === 'notes' ? (
              <>
                <StickyNote className='h-8 w-8 mx-auto mb-2 opacity-50' />
                <p className='text-sm font-medium'>No notes</p>
                <p className='text-xs'>Create notes on your entries</p>
              </>
            ) : activeFilter === 'recent' ? (
              <>
                <p className='text-sm font-medium'>No recent items</p>
                <p className='text-xs'>Items added in the last 7 days appear here</p>
              </>
            ) : activeFilter === 'untagged' ? (
              <>
                <p className='text-sm font-medium'>No untagged items</p>
                <p className='text-xs'>All your entries have tags</p>
              </>
            ) : isEmptyTagMode ? (
              <>
                <Tag className='h-8 w-8 mx-auto mb-2 opacity-50' />
                <p className='text-sm font-medium'>Select a tag</p>
                <p className='text-xs'>Choose one or more tags from the sidebar to filter entries</p>
              </>
            ) : isTagView ? (
              <>
                <p className='text-sm font-medium'>No entries with selected tags</p>
                <p className='text-xs'>Add these tags to entries to see them here</p>
              </>
            ) : isCollectionView ? (
              <>
                <p className='text-sm font-medium'>No entries in this collection</p>
                <p className='text-xs'>Add entries to this collection to see them here</p>
              </>
            ) : entryCounts.total === 0 ? (
              <>
                <p className='text-sm font-medium'>Your library is empty</p>
                <p className='text-xs'>Import PDFs or BibLaTeX to start building your collection</p>
              </>
            ) : (
              <>
                <p className='text-sm font-medium'>No entries in this view</p>
                <p className='text-xs'>Try selecting a different filter</p>
              </>
            )}
          </div>
          {!isTrashView && !searchQuery && entryCounts.total === 0 && (
            <div className='flex gap-2'>
              <Button variant='outline' size='sm' onClick={handleImportFiles}>
                <File className='h-4 w-4 mr-2' />
                Import PDFs
              </Button>
              <Button variant='outline' size='sm' onClick={handleImportFolder}>
                <FolderOpen className='h-4 w-4 mr-2' />
                Import Folder
              </Button>
              <Button variant='outline' size='sm' onClick={handleImportBiblatex}>
                <FileText className='h-4 w-4 mr-2' />
                Import BibLaTeX
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className='flex-1 flex flex-col overflow-hidden'>
          {/* Trash action bar - above table */}
          {isTrashView && sortedEntries.length > 0 && (
            <div className='flex items-center gap-2 px-4 py-2 border-b bg-muted/30'>
              <Button
                variant='outline'
                size='sm'
                onClick={handleRestoreSelected}
                disabled={selectedEntryIds.length === 0}
                className='h-7'
              >
                <RotateCcw className='h-3.5 w-3.5 mr-1.5' />
                Restore{selectedEntryIds.length > 0 ? ` (${selectedEntryIds.length})` : ''}
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={handleDeleteSelectedPermanently}
                disabled={selectedEntryIds.length === 0}
                className='h-7 text-destructive hover:text-destructive'
              >
                <Trash2 className='h-3.5 w-3.5 mr-1.5' />
                Delete{selectedEntryIds.length > 0 ? ` (${selectedEntryIds.length})` : ''}
              </Button>
              <div className='flex-1' />
              <Button
                variant='destructive'
                size='sm'
                onClick={() => setShowEmptyTrashDialog(true)}
                className='h-7'
              >
                <Trash2 className='h-3.5 w-3.5 mr-1.5' />
                Empty Trash
              </Button>
            </div>
          )}

          {/* Table or Card view */}
          {viewMode === 'list' ? (
            <div className='flex-1 overflow-hidden'>
              <EntryTable
                entries={sortedEntries}
                selectedIds={selectedEntryIds}
                expandedIds={expandedEntryIds}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={setSort}
                onEntryClick={handleEntryClick}
                onEntryDoubleClick={handleEntryDoubleClick}
                onToggleExpand={toggleEntryExpanded}
                attachmentsMap={attachmentsMap}
                onAttachmentClick={handleAttachmentClick}
                onAttachmentDoubleClick={handleAttachmentDoubleClick}
                onKeyboardSelect={handleKeyboardSelect}
                onEndReached={!isTrashView && !isDuplicatesView ? loadNextPage : undefined}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                autoLoadKey={`${activeFilter}|${activeCollectionId ?? ''}|${activeTagIds.join(',')}|${searchQuery}|${sortField}|${sortDirection}|${secondarySortField ?? ''}|${secondarySortDirection ?? ''}`}
              />
            </div>
          ) : (
            <ScrollArea className='flex-1' ref={cardScrollRef}>
              <EntryCardView
                entries={sortedEntries}
                selectedIds={selectedEntryIds}
                onEntryClick={handleEntryClick}
                onEntryDoubleClick={handleEntryDoubleClick}
                isTrashView={isTrashView}
                footer={
                  !isTrashView && !isDuplicatesView ? (
                    <div ref={loadMoreRef} className='py-4 text-center text-xs text-muted-foreground'>
                      {isLoadingMore ? 'Loading more…' : hasMore ? 'Scroll to load more' : 'All entries loaded'}
                    </div>
                  ) : null
                }
              />
            </ScrollArea>
          )}
        </div>
      )}

      {/* Empty Trash Confirmation Dialog */}
      <Dialog open={showEmptyTrashDialog} onOpenChange={setShowEmptyTrashDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empty Trash?</DialogTitle>
            <DialogDescription>
              This will permanently delete {trashedEntries.length}{' '}
              {trashedEntries.length === 1 ? 'item' : 'items'} and their files. This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setShowEmptyTrashDialog(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleEmptyTrash}>
              Empty Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BibLaTeX Import Preview Dialog */}
      <ImportPreviewDialog
        open={showImportPreview}
        onOpenChange={setShowImportPreview}
        previewData={importPreviewData}
        onImport={handleConfirmImport}
        isImporting={isImporting}
      />
    </div>
  );
}
