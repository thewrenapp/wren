import {
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  FilePlus,
  Download,
  FolderPlus,
  FileJson,
  FileCode,
  Copy,
  Pencil,
  Settings2,
  X,
  Check,
  BookmarkX,
  Tag,
} from 'lucide-react';
import { sidebarIcons } from '@/lib/icons';
import { IconSearch } from '@tabler/icons-react';
import { useState, useEffect, useMemo, type MutableRefObject } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUIStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import {
  emptyTrash,
  createCollection,
  deleteCollection,
  updateCollection,
  getCollections,
  exportAllToBibtex,
  exportAllToCslJson,
  exportToBibtex,
  exportToCslJson,
  exportToBiblatexWithFiles,
  exportAllToBiblatexWithFiles,
  getEntries,
  updateTag,
  deleteTag,
  getTags,
  getDuplicateCount,
  getSavedSearches,
  deleteSavedSearch,
  type ExportOptions,
} from '@/services/tauri';
import { ExportOptionsDialog } from '@/components/dialogs/ExportOptionsDialog';
import { TagManagementDialog } from '@/components/dialogs/TagManagementDialog';
import { CollectionManagementDialog } from '@/components/dialogs/CollectionManagementDialog';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toastStore';
import { DroppableCollection } from '@/components/dnd/DroppableCollection';
import { DroppableTrash } from '@/components/dnd/DroppableTrash';
import { DroppableTag } from '@/components/dnd/DroppableTag';
import { useDragDropContext } from '@/components/dnd/DragDropProvider';

// Map filter to display title
function getFilterTitle(filter: string): string {
  switch (filter) {
    case 'pdfs':
      return 'PDFs';
    case 'notes':
      return 'Notes';
    case 'recent':
      return 'Recently Added';
    case 'untagged':
      return 'Untagged';
    case 'duplicates':
      return 'Duplicates';
    case 'trash':
      return 'Trash';
    default:
      return 'Library';
  }
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: (event?: React.MouseEvent) => void;
  allowContextMenu?: boolean;
}

function SidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  allowContextMenu = false,
}: SidebarItemProps) {
  return (
    <button
      onClick={(e) => onClick?.(e)}
      onContextMenu={allowContextMenu ? undefined : (e) => e.preventDefault()}
      className={cn(
        'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors select-none overflow-hidden',
        'hover:bg-sidebar-accent',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground/80',
      )}
    >
      <span className='flex-shrink-0 w-4 h-4'>{icon}</span>
      <span className='flex-1 min-w-0 text-left truncate'>{label}</span>
      {count !== undefined && <span className='flex-shrink-0 text-xs text-muted-foreground'>{count}</span>}
    </button>
  );
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state */
  isOpen?: boolean;
  /** Callback when open state changes (for controlled mode) */
  onOpenChange?: (open: boolean) => void;
  onAdd?: () => void;
  contextMenuContent?: React.ReactNode;
  actions?: React.ReactNode;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  isOpen: controlledIsOpen,
  onOpenChange,
  onAdd,
  contextMenuContent,
  actions,
}: CollapsibleSectionProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);

  // Support both controlled and uncontrolled modes
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    }
    setInternalIsOpen(open);
  };

  const headerContent = (
    <div
      className='flex items-center gap-1 px-2 py-1 group select-none overflow-hidden'
      onContextMenu={contextMenuContent ? undefined : (e) => e.preventDefault()}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className='flex items-center gap-1 flex-1 min-w-0 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground transition-colors select-none'
      >
        <span className='flex-shrink-0'>
          {isOpen ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
        </span>
        <span className='truncate'>{title}</span>
      </button>
      <div className='flex items-center flex-shrink-0'>
        {actions}
        {onAdd && (
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={`Add ${title}`}
            title={`Add ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            className='h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100'
          >
            <Plus className='h-3 w-3' />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className='mb-2 overflow-hidden'>
      {contextMenuContent ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{headerContent}</ContextMenuTrigger>
          <ContextMenuContent className='w-48'>{contextMenuContent}</ContextMenuContent>
        </ContextMenu>
      ) : (
        headerContent
      )}
      {isOpen && <div className='space-y-0.5 px-1 overflow-hidden'>{children}</div>}
    </div>
  );
}

interface LibrarySidebarProps {
  /** Ref to expose the expand collections function for drag-drop auto-expand */
  expandCollectionsRef?: MutableRefObject<(() => void) | null>;
}

export function LibrarySidebar({ expandCollectionsRef }: LibrarySidebarProps) {
  const {
    activeFilter,
    setActiveFilter,
    newCollectionDialogOpen,
    setNewCollectionDialogOpen,
    tagManagementDialogOpen,
    setTagManagementDialogOpen,
    collectionManagementDialogOpen,
    setCollectionManagementDialogOpen,
    hideImportedTags,
    toggleHideImportedTags,
  } = useUIStore();
  const {
    collections,
    tags,
    entryCounts,
    trashCount,
    setTrashCount,
    setTrashedEntries,
    setCollections,
    setTags,
    toggleActiveTag,
    clearActiveTags,
    setTagFilterMode,
    setActiveCollection,
    activeTagIds,
    tagFilterMode,
    activeCollectionId,
    entryVersion,
    clearSelection,
    refreshLibrary,
    invalidateEntry,
    activeFilter: libraryActiveFilter,
    savedSearches,
    setSavedSearches,
    removeSavedSearch,
    activeSavedSearchId,
    setActiveSavedSearch,
  } = useLibraryStore();
  const { tabs, updateTab, setActiveTab } = useTabStore();
  const { isDragging } = useDragDropContext();

  // Controlled state for collections and tags sections (for drag-drop auto-expand)
  const [collectionsOpen, setCollectionsOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);

  // Expose expand function for drag-drop
  useEffect(() => {
    if (expandCollectionsRef) {
      expandCollectionsRef.current = () => setCollectionsOpen(true);
    }
    return () => {
      if (expandCollectionsRef) {
        expandCollectionsRef.current = null;
      }
    };
  }, [expandCollectionsRef]);

  // Auto-expand collections and tags when dragging starts
  useEffect(() => {
    if (isDragging) {
      setCollectionsOpen(true);
      setTagsOpen(true);
    }
  }, [isDragging]);

  const [showEmptyTrashDialog, setShowEmptyTrashDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionColor, setNewCollectionColor] = useState('');
  const [renameCollection, setRenameCollection] = useState<{
    id: number;
    name: string;
    color?: string;
  } | null>(null);
  const [renameCollectionName, setRenameCollectionName] = useState('');
  const [renameCollectionColor, setRenameCollectionColor] = useState('');
  const [renameTag, setRenameTag] = useState<{ id: number; name: string; color?: string } | null>(
    null,
  );
  const [renameTagName, setRenameTagName] = useState('');
  const [renameTagColor, setRenameTagColor] = useState('');
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportContext, setExportContext] = useState<{
    type: 'all' | 'collection' | 'tag' | 'filter';
    id?: number;
    name?: string;
    filterType?: string;
  } | null>(null);
  const [deleteTagConfirm, setDeleteTagConfirm] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [deleteSavedSearchConfirm, setDeleteSavedSearchConfirm] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const visibleTags = useMemo(() => {
    return tags
      .filter((tag) => !hideImportedTags || !tag.isImported)
      .filter((tag) =>
        tagSearchQuery
          ? tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
          : true
      );
  }, [tags, hideImportedTags, tagSearchQuery]);

  // Fetch duplicate count
  useEffect(() => {
    getDuplicateCount().then(setDuplicateCount).catch(console.error);
  }, [entryCounts.total, entryVersion]); // Refresh when entries change or are modified

  // Fetch saved searches
  useEffect(() => {
    getSavedSearches().then(setSavedSearches).catch(console.error);
  }, [setSavedSearches]);

  // Update library tab title when filter changes
  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    // Clear tag/collection filters when switching to a basic filter
    clearActiveTags();
    setActiveCollection(null);
    // Clear saved search when switching to other filters
    setActiveSavedSearch(null);
    // Clear selection when switching views so info panel doesn't show stale data
    clearSelection();
    // Find and update the library tab title, and switch to it
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      updateTab(libraryTab.id, { title: getFilterTitle(filter) });
      setActiveTab(libraryTab.id);
    }
  };

  // Handle saved search selection
  const handleSavedSearchSelect = (searchId: number, searchName: string) => {
    setActiveSavedSearch(searchId);
    setActiveFilter('all');
    clearActiveTags();
    setActiveCollection(null);
    clearSelection();
    // Update tab title to saved search name
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      updateTab(libraryTab.id, { title: searchName });
      setActiveTab(libraryTab.id);
    }
  };

  // Handle saved search deletion
  const handleDeleteSavedSearch = async (id: number, name: string) => {
    try {
      await deleteSavedSearch(id);
      removeSavedSearch(id);
      if (activeSavedSearchId === id) {
        setActiveSavedSearch(null);
        const libraryTab = tabs.find((t) => t.type === 'library');
        if (libraryTab) {
          updateTab(libraryTab.id, { title: 'Library' });
        }
      }
      toast.success(`Deleted saved search "${name}"`);
    } catch (err) {
      console.error('Failed to delete saved search:', err);
      toast.error('Failed to delete saved search');
    }
  };

  // Handle tag selection (multi-select with Cmd/Ctrl, single select otherwise)
  const handleTagSelect = (tagId: number, _tagName: string, event?: React.MouseEvent) => {
    const isMultiSelect = event?.metaKey || event?.ctrlKey;
    const isSelected = activeTagIds.includes(tagId);
    const store = useLibraryStore.getState();

    let newActiveTagIds: number[];

    if (isMultiSelect) {
      // Multi-select: toggle this tag
      toggleActiveTag(tagId);
      newActiveTagIds = isSelected
        ? activeTagIds.filter((id) => id !== tagId)
        : [...activeTagIds, tagId];
    } else {
      // Single select behavior
      if (isSelected && activeTagIds.length === 1) {
        // Clicking the only selected tag - deselect it but stay in tag mode
        toggleActiveTag(tagId);
        newActiveTagIds = [];
      } else {
        // Select only this tag (deselect others)
        store.setActiveTags([tagId]);
        newActiveTagIds = [tagId];
      }
    }

    setActiveFilter('all'); // Clear basic filter when selecting a tag
    // Clear selection when switching views
    clearSelection();

    // Update tab title based on selection
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      if (newActiveTagIds.length === 0) {
        updateTab(libraryTab.id, { title: 'Tags' });
      } else if (newActiveTagIds.length === 1) {
        const selectedTag = tags.find((t) => t.id === newActiveTagIds[0]);
        updateTab(libraryTab.id, { title: selectedTag?.name ?? 'Tag' });
      } else {
        updateTab(libraryTab.id, { title: `${newActiveTagIds.length} Tags` });
      }
      setActiveTab(libraryTab.id);
    }
  };

  // Handle collection selection
  const handleCollectionSelect = (collectionId: number, collectionName: string) => {
    setActiveCollection(collectionId);
    setActiveFilter('all'); // Clear basic filter when selecting a collection
    // Clear selection when switching views
    clearSelection();
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      updateTab(libraryTab.id, { title: collectionName });
      setActiveTab(libraryTab.id);
    }
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

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    try {
      await createCollection({
        name: newCollectionName.trim(),
        color: newCollectionColor || undefined,
      });
      // Refresh collections list
      const allCollections = await getCollections();
      setCollections(allCollections);
      setNewCollectionName('');
      setNewCollectionColor('');
      setNewCollectionDialogOpen(false);
    } catch (err) {
      console.error('Failed to create collection:', err);
    }
  };

  const handleDeleteCollection = async (collectionId: number, collectionName: string) => {
    try {
      await deleteCollection(collectionId);
      // Refresh collections list
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Clear selection if the deleted collection was selected
      if (activeCollectionId === collectionId) {
        setActiveCollection(null);
        setActiveFilter('all');
        const libraryTab = tabs.find((t) => t.type === 'library');
        if (libraryTab) {
          updateTab(libraryTab.id, { title: 'Library' });
        }
      }
      toast.success(`Collection "${collectionName}" deleted`);
    } catch (err) {
      console.error('Failed to delete collection:', err);
      toast.error('Failed to delete collection');
    }
  };

  const handleDeleteTag = async () => {
    if (!deleteTagConfirm) return;
    try {
      await deleteTag(deleteTagConfirm.id);
      // Refresh tags list
      const allTags = await getTags();
      setTags(allTags);
      // Clear selection if the deleted tag was selected
      if (activeTagIds.includes(deleteTagConfirm.id)) {
        // Remove from active tags (store handles this via removeTag)
        const newActiveTagIds = activeTagIds.filter((id) => id !== deleteTagConfirm.id);
        if (newActiveTagIds.length === 0) {
          clearActiveTags();
          setActiveFilter('all');
          const libraryTab = tabs.find((t) => t.type === 'library');
          if (libraryTab) {
            updateTab(libraryTab.id, { title: 'Library' });
          }
        }
      }
      // Refresh entry info panel and library entries to reflect tag removal
      invalidateEntry();
      await refreshLibrary();
      toast.success(`Tag "${deleteTagConfirm.name}" deleted`);
      setDeleteTagConfirm(null);
    } catch (err) {
      console.error('Failed to delete tag:', err);
      toast.error('Failed to delete tag');
    }
  };

  const handleStartRenameCollection = (collection: {
    id: number;
    name: string;
    color?: string;
  }) => {
    setRenameCollection(collection);
    setRenameCollectionName(collection.name);
    setRenameCollectionColor(collection.color || '');
  };

  const handleRenameCollection = async () => {
    if (!renameCollection || !renameCollectionName.trim()) return;
    try {
      await updateCollection(renameCollection.id, {
        name: renameCollectionName.trim(),
        color: renameCollectionColor || undefined,
      });
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Update tab title if this collection is selected
      if (activeCollectionId === renameCollection.id) {
        const libraryTab = tabs.find((t) => t.type === 'library');
        if (libraryTab) {
          updateTab(libraryTab.id, { title: renameCollectionName.trim() });
        }
      }
      setRenameCollection(null);
      setRenameCollectionName('');
      setRenameCollectionColor('');
    } catch (err) {
      console.error('Failed to rename collection:', err);
    }
  };

  const handleStartRenameTag = (tag: { id: number; name: string; color?: string }) => {
    setRenameTag(tag);
    setRenameTagName(tag.name);
    setRenameTagColor(tag.color || '');
  };

  const handleRenameTag = async () => {
    if (!renameTag || !renameTagName.trim()) return;
    try {
      await updateTag(
        renameTag.id,
        renameTagName.trim() !== renameTag.name ? renameTagName.trim() : undefined,
        renameTagColor !== renameTag.color ? renameTagColor || undefined : undefined,
      );
      const allTags = await getTags();
      useLibraryStore.getState().setTags(allTags);
      // Refresh entries to update tag colors/names in the list
      invalidateEntry();
      await refreshLibrary();
      // Update tab title if this tag is the only selected tag
      if (activeTagIds.length === 1 && activeTagIds.includes(renameTag.id)) {
        const libraryTab = tabs.find((t) => t.type === 'library');
        if (libraryTab) {
          updateTab(libraryTab.id, { title: renameTagName.trim() });
        }
      }
      setRenameTag(null);
      setRenameTagName('');
      setRenameTagColor('');
    } catch (err) {
      console.error('Failed to rename tag:', err);
    }
  };

  // Export handlers for sidebar
  const handleExportAllCslJson = async () => {
    try {
      const content = await exportAllToCslJson();
      const filePath = await save({
        defaultPath: 'library.json',
        filters: [{ name: 'CSL JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export to CSL JSON:', err);
    }
  };

  const handleExportAllBibtex = async () => {
    try {
      const content = await exportAllToBibtex();
      const filePath = await save({
        defaultPath: 'library.bib',
        filters: [{ name: 'BibTeX', extensions: ['bib'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export to BibTeX:', err);
    }
  };

  const handleCopyAllCslJson = async () => {
    try {
      const content = await exportAllToCslJson();
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy CSL JSON:', err);
    }
  };

  const handleCopyAllBibtex = async () => {
    try {
      const content = await exportAllToBibtex();
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy BibTeX:', err);
    }
  };

  // Export handlers for collections
  const handleExportCollectionCslJson = async (collectionId: number, collectionName: string) => {
    try {
      const collectionEntries = await getEntries({ collectionId });
      const entryIds = collectionEntries.map((e) => e.id);
      if (entryIds.length === 0) {
        alert('No entries in this collection to export');
        return;
      }
      const content = await exportToCslJson(entryIds);
      const filePath = await save({
        defaultPath: `${collectionName}.json`,
        filters: [{ name: 'CSL JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export collection to CSL JSON:', err);
    }
  };

  const handleExportCollectionBibtex = async (collectionId: number, collectionName: string) => {
    try {
      const collectionEntries = await getEntries({ collectionId });
      const entryIds = collectionEntries.map((e) => e.id);
      if (entryIds.length === 0) {
        alert('No entries in this collection to export');
        return;
      }
      const content = await exportToBibtex(entryIds);
      const filePath = await save({
        defaultPath: `${collectionName}.bib`,
        filters: [{ name: 'BibTeX', extensions: ['bib'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export collection to BibTeX:', err);
    }
  };

  // Export handlers for tags
  const handleExportTagCslJson = async (tagId: number, tagName: string) => {
    try {
      const tagEntries = await getEntries({ tagIds: [tagId] });
      const entryIds = tagEntries.map((e) => e.id);
      if (entryIds.length === 0) {
        alert('No entries with this tag to export');
        return;
      }
      const content = await exportToCslJson(entryIds);
      const filePath = await save({
        defaultPath: `${tagName}.json`,
        filters: [{ name: 'CSL JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export tag to CSL JSON:', err);
    }
  };

  const handleExportTagBibtex = async (tagId: number, tagName: string) => {
    try {
      const tagEntries = await getEntries({ tagIds: [tagId] });
      const entryIds = tagEntries.map((e) => e.id);
      if (entryIds.length === 0) {
        alert('No entries with this tag to export');
        return;
      }
      const content = await exportToBibtex(entryIds);
      const filePath = await save({
        defaultPath: `${tagName}.bib`,
        filters: [{ name: 'BibTeX', extensions: ['bib'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export tag to BibTeX:', err);
    }
  };

  const fetchFilteredEntryIds = async (filterType: string): Promise<number[]> => {
    const entries = await getEntries({
      filterType,
    });
    return entries.map((e) => e.id);
  };

  // Export handlers for filtered views (All Items, PDFs, Notes, Recent, Untagged)
  const handleExportFilteredCslJson = async (filterType: string, fileName: string) => {
    try {
      const entryIds = await fetchFilteredEntryIds(filterType);
      if (entryIds.length === 0) {
        alert('No entries to export');
        return;
      }
      const content = await exportToCslJson(entryIds);
      const filePath = await save({
        defaultPath: `${fileName}.json`,
        filters: [{ name: 'CSL JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export to CSL JSON:', err);
    }
  };

  const handleExportFilteredBibtex = async (filterType: string, fileName: string) => {
    try {
      const entryIds = await fetchFilteredEntryIds(filterType);
      if (entryIds.length === 0) {
        alert('No entries to export');
        return;
      }
      const content = await exportToBibtex(entryIds);
      const filePath = await save({
        defaultPath: `${fileName}.bib`,
        filters: [{ name: 'BibTeX', extensions: ['bib'] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error('Failed to export to BibTeX:', err);
    }
  };

  const handleCopyFilteredCslJson = async (filterType: string) => {
    try {
      const entryIds = await fetchFilteredEntryIds(filterType);
      if (entryIds.length === 0) {
        alert('No entries to copy');
        return;
      }
      const content = await exportToCslJson(entryIds);
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy CSL JSON:', err);
    }
  };

  const handleCopyFilteredBibtex = async (filterType: string) => {
    try {
      const entryIds = await fetchFilteredEntryIds(filterType);
      if (entryIds.length === 0) {
        alert('No entries to copy');
        return;
      }
      const content = await exportToBibtex(entryIds);
      await writeText(content);
    } catch (err) {
      console.error('Failed to copy BibTeX:', err);
    }
  };

  // BibLaTeX with files export handlers
  const openBiblatexExportDialog = (context: typeof exportContext) => {
    setExportContext(context);
    setShowExportDialog(true);
  };

  const handleExportBiblatexWithFiles = async (options: ExportOptions) => {
    if (!exportContext) return;
    try {
      setIsExporting(true);
      const outputDir = await save({
        defaultPath: exportContext.name || 'library',
        // Note: For directory selection, we use the folder picker
      });

      if (outputDir) {
        // Get the directory path (remove file name if present)
        const dirPath = outputDir.replace(/\/[^/]+$/, '');

        let entryIds: number[] = [];

        if (exportContext.type === 'all') {
          const all = await getEntries();
          entryIds = all.map((e) => e.id);
        } else if (exportContext.type === 'collection' && exportContext.id) {
          const collectionEntries = await getEntries({ collectionId: exportContext.id });
          entryIds = collectionEntries.map((e) => e.id);
        } else if (exportContext.type === 'tag' && exportContext.id) {
          const tagEntries = await getEntries({ tagIds: [exportContext.id] });
          entryIds = tagEntries.map((e) => e.id);
        } else if (exportContext.type === 'filter' && exportContext.filterType) {
          entryIds = await fetchFilteredEntryIds(exportContext.filterType);
        }

        if (entryIds.length === 0) {
          toast.error('No entries to export');
          return;
        }

        const result = await exportToBiblatexWithFiles(entryIds, dirPath, options);
        toast.success(
          `Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`
        );
        setShowExportDialog(false);
        setExportContext(null);
      }
    } catch (err) {
      console.error('Failed to export to BibLaTeX:', err);
      toast.error('Failed to export to BibLaTeX');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAllBiblatexWithFiles = async (options: ExportOptions) => {
    try {
      setIsExporting(true);
      const outputDir = await save({
        defaultPath: 'library',
      });

      if (outputDir) {
        const dirPath = outputDir.replace(/\/[^/]+$/, '');
        const result = await exportAllToBiblatexWithFiles(dirPath, options);
        toast.success(
          `Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`
        );
        setShowExportDialog(false);
        setExportContext(null);
      }
    } catch (err) {
      console.error('Failed to export to BibLaTeX:', err);
      toast.error('Failed to export to BibLaTeX');
    } finally {
      setIsExporting(false);
    }
  };

  const pdfCount = entryCounts.pdf;
  const noteCount = entryCounts.note;
  const recentCount = entryCounts.recent;

  return (
    <div className='flex flex-col h-full w-full overflow-hidden'>
      <ScrollArea className='flex-1 px-2 pt-2 w-full min-w-0'>
        {/* Library section */}
        <CollapsibleSection
          title='Library'
          contextMenuContent={
            <>
              <ContextMenuItem disabled>
                <FilePlus className='h-4 w-4 mr-2' />
                Create New Reference
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Download className='h-4 w-4 mr-2' />
                  Export Library
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-48'>
                  <ContextMenuItem onClick={handleExportAllCslJson}>
                    <FileJson className='h-4 w-4 mr-2' />
                    CSL JSON...
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleExportAllBibtex}>
                    <FileCode className='h-4 w-4 mr-2' />
                    BibTeX...
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => openBiblatexExportDialog({ type: 'all', name: 'library' })}>
                    <FolderOpen className='h-4 w-4 mr-2' />
                    BibLaTeX with Files...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={handleCopyAllCslJson}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as CSL JSON
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleCopyAllBibtex}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as BibTeX
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          }
        >
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className='w-full overflow-hidden'>
                <SidebarItem
                  icon={<sidebarIcons.allItems className='h-4 w-4' />}
                  label='All Items'
                  count={entryCounts.total}
                  active={activeFilter === 'all'}
                  onClick={() => handleFilterChange('all')}
                  allowContextMenu
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className='w-48'>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Download className='h-4 w-4 mr-2' />
                  Export All Items
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-40'>
                  <ContextMenuItem onClick={() => handleExportFilteredCslJson('all', 'all-items')}>
                    <FileJson className='h-4 w-4 mr-2' />
                    CSL JSON...
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleExportFilteredBibtex('all', 'all-items')}>
                    <FileCode className='h-4 w-4 mr-2' />
                    BibTeX...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleCopyFilteredCslJson('all')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as CSL JSON
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleCopyFilteredBibtex('all')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as BibTeX
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className='w-full overflow-hidden'>
                <SidebarItem
                  icon={<sidebarIcons.pdfs className='h-4 w-4 text-red-500' />}
                  label='PDFs'
                  count={pdfCount}
                  active={activeFilter === 'pdfs'}
                  onClick={() => handleFilterChange('pdfs')}
                  allowContextMenu
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className='w-48'>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Download className='h-4 w-4 mr-2' />
                  Export PDFs
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-40'>
                  <ContextMenuItem onClick={() => handleExportFilteredCslJson('pdfs', 'pdfs')}>
                    <FileJson className='h-4 w-4 mr-2' />
                    CSL JSON...
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleExportFilteredBibtex('pdfs', 'pdfs')}>
                    <FileCode className='h-4 w-4 mr-2' />
                    BibTeX...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleCopyFilteredCslJson('pdfs')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as CSL JSON
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleCopyFilteredBibtex('pdfs')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as BibTeX
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className='w-full overflow-hidden'>
                <SidebarItem
                  icon={<sidebarIcons.notes className='h-4 w-4 text-amber-500' />}
                  label='Notes'
                  count={noteCount}
                  active={activeFilter === 'notes'}
                  onClick={() => handleFilterChange('notes')}
                  allowContextMenu
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className='w-48'>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Download className='h-4 w-4 mr-2' />
                  Export Notes
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-40'>
                  <ContextMenuItem onClick={() => handleExportFilteredCslJson('notes', 'notes')}>
                    <FileJson className='h-4 w-4 mr-2' />
                    CSL JSON...
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleExportFilteredBibtex('notes', 'notes')}>
                    <FileCode className='h-4 w-4 mr-2' />
                    BibTeX...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleCopyFilteredCslJson('notes')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as CSL JSON
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleCopyFilteredBibtex('notes')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as BibTeX
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
          <DroppableTrash>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className='w-full overflow-hidden'>
                  <SidebarItem
                    icon={<sidebarIcons.trash className='h-4 w-4 text-pink-600' />}
                    label='Trash'
                    count={trashCount}
                    active={activeFilter === 'trash'}
                    onClick={() => handleFilterChange('trash')}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className='w-48'>
                <ContextMenuItem
                  onClick={() => setShowEmptyTrashDialog(true)}
                  disabled={trashCount === 0}
                  className='text-destructive focus:text-destructive'
                >
                  <Trash2 className='h-4 w-4 mr-2' />
                  Empty Trash
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </DroppableTrash>
        </CollapsibleSection>

        {/* Smart Filters */}
        <CollapsibleSection title='Smart Filters'>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className='w-full overflow-hidden'>
                <SidebarItem
                  icon={<sidebarIcons.recent className='h-4 w-4' />}
                  label='Recently Added'
                  count={recentCount}
                  active={activeFilter === 'recent' && !activeSavedSearchId}
                  onClick={() => handleFilterChange('recent')}
                  allowContextMenu
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className='w-48'>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Download className='h-4 w-4 mr-2' />
                  Export Recent
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-40'>
                  <ContextMenuItem
                    onClick={() => handleExportFilteredCslJson('recent', 'recently-added')}
                  >
                    <FileJson className='h-4 w-4 mr-2' />
                    CSL JSON...
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => handleExportFilteredBibtex('recent', 'recently-added')}
                  >
                    <FileCode className='h-4 w-4 mr-2' />
                    BibTeX...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleCopyFilteredCslJson('recent')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as CSL JSON
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleCopyFilteredBibtex('recent')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as BibTeX
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className='w-full overflow-hidden'>
                <SidebarItem
                  icon={<sidebarIcons.untagged className='h-4 w-4' />}
                  label='Untagged'
                  count={entryCounts.untagged}
                  active={activeFilter === 'untagged' && !activeSavedSearchId}
                  onClick={() => handleFilterChange('untagged')}
                  allowContextMenu
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className='w-48'>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Download className='h-4 w-4 mr-2' />
                  Export Untagged
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-40'>
                  <ContextMenuItem
                    onClick={() => handleExportFilteredCslJson('untagged', 'untagged')}
                  >
                    <FileJson className='h-4 w-4 mr-2' />
                    CSL JSON...
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => handleExportFilteredBibtex('untagged', 'untagged')}
                  >
                    <FileCode className='h-4 w-4 mr-2' />
                    BibTeX...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleCopyFilteredCslJson('untagged')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as CSL JSON
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleCopyFilteredBibtex('untagged')}>
                    <Copy className='h-4 w-4 mr-2' />
                    Copy as BibTeX
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
          <SidebarItem
            icon={<sidebarIcons.duplicates className='h-4 w-4' />}
            label='Duplicates'
            count={duplicateCount}
            active={activeFilter === 'duplicates' && !activeSavedSearchId}
            onClick={() => handleFilterChange('duplicates')}
          />
          {/* User-created saved searches */}
          {savedSearches.map((search) => (
            <ContextMenu key={search.id}>
              <ContextMenuTrigger asChild>
                <div className='w-full overflow-hidden'>
                  <SidebarItem
                    icon={<IconSearch className='h-4 w-4 text-blue-500' />}
                    label={search.name}
                    active={activeSavedSearchId === search.id}
                    onClick={() => handleSavedSearchSelect(search.id, search.name)}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className='w-48'>
                <ContextMenuItem
                  onClick={() => setDeleteSavedSearchConfirm({ id: search.id, name: search.name })}
                  className='text-destructive focus:text-destructive'
                >
                  <BookmarkX className='h-4 w-4 mr-2' />
                  Delete Saved Search
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </CollapsibleSection>

        {/* Collections */}
        <CollapsibleSection
          title={collections.length > 0 ? `Collections (${collections.length})` : 'Collections'}
          isOpen={collectionsOpen}
          onOpenChange={setCollectionsOpen}
          onAdd={() => setNewCollectionDialogOpen(true)}
          actions={
            <Button
              variant='ghost'
              size='icon-xs'
              aria-label='Manage collections'
              onClick={(e) => {
                e.stopPropagation();
                setCollectionManagementDialogOpen(true);
              }}
              className='h-5 w-5 opacity-50 hover:opacity-100'
              title='Manage collections'
            >
              <Settings2 className='h-3 w-3' />
            </Button>
          }
          contextMenuContent={
            <>
              <ContextMenuItem onClick={() => setNewCollectionDialogOpen(true)}>
                <FolderPlus className='h-4 w-4 mr-2' />
                Create Collection
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setCollectionManagementDialogOpen(true)}>
                <Settings2 className='h-4 w-4 mr-2' />
                Manage Collections
              </ContextMenuItem>
            </>
          }
        >
          {collections.length === 0 ? (
            <p className='text-xs text-muted-foreground px-2 py-2'>
              Right-click to create a collection
            </p>
          ) : (
            collections.map((collection) => (
              <DroppableCollection
                key={collection.id}
                collectionId={collection.id}
                collectionName={collection.name}
                collectionColor={collection.color}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className='w-full overflow-hidden'>
                      <SidebarItem
                        icon={
                          <FolderOpen
                            className='h-4 w-4'
                            fill={collection.color || 'transparent'}
                            stroke={collection.color || 'currentColor'}
                          />
                        }
                        label={collection.name}
                        count={collection.itemCount}
                        active={activeCollectionId === collection.id}
                        onClick={() => handleCollectionSelect(collection.id, collection.name)}
                        allowContextMenu
                      />
                    </div>
                  </ContextMenuTrigger>
                <ContextMenuContent className='w-48'>
                  <ContextMenuItem
                    onClick={() =>
                      handleStartRenameCollection({
                        id: collection.id,
                        name: collection.name,
                        color: collection.color,
                      })
                    }
                  >
                    <Pencil className='h-4 w-4 mr-2' />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Download className='h-4 w-4 mr-2' />
                      Export Collection
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className='w-48'>
                      <ContextMenuItem
                        onClick={() =>
                          handleExportCollectionCslJson(collection.id, collection.name)
                        }
                      >
                        <FileJson className='h-4 w-4 mr-2' />
                        CSL JSON...
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          handleExportCollectionBibtex(collection.id, collection.name)
                        }
                      >
                        <FileCode className='h-4 w-4 mr-2' />
                        BibTeX...
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          openBiblatexExportDialog({
                            type: 'collection',
                            id: collection.id,
                            name: collection.name,
                          })
                        }
                      >
                        <FolderOpen className='h-4 w-4 mr-2' />
                        BibLaTeX with Files...
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => handleDeleteCollection(collection.id, collection.name)}
                    className='text-destructive focus:text-destructive'
                  >
                    <Trash2 className='h-4 w-4 mr-2' />
                    Delete Collection
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              </DroppableCollection>
            ))
          )}
        </CollapsibleSection>

        {/* Tags */}
        <CollapsibleSection
          title={visibleTags.length > 0 ? `Tags (${activeTagIds.length}/${visibleTags.length})` : 'Tags'}
          isOpen={tagsOpen}
          onOpenChange={setTagsOpen}
          onAdd={() => setTagManagementDialogOpen(true)}
          actions={
            <>
              {libraryActiveFilter.type === 'tag' && (
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label='Exit tag filter'
                  onClick={(e) => {
                    e.stopPropagation();
                    clearActiveTags();
                    const libraryTab = tabs.find((t) => t.type === 'library');
                    if (libraryTab) {
                      updateTab(libraryTab.id, { title: 'All Items' });
                    }
                  }}
                  className='h-5 w-5 opacity-50 hover:opacity-100'
                  title='Exit tag filter'
                >
                  <X className='h-3 w-3' />
                </Button>
              )}
              <Button
                variant='ghost'
                size='icon-xs'
                aria-label='Manage tags'
                onClick={(e) => {
                  e.stopPropagation();
                  setTagManagementDialogOpen(true);
                }}
                className='h-5 w-5 opacity-50 hover:opacity-100'
                title='Manage tags'
              >
                <Settings2 className='h-3 w-3' />
              </Button>
            </>
          }
          contextMenuContent={
            <>
              <ContextMenuItem onClick={() => setTagManagementDialogOpen(true)}>
                <Plus className='h-4 w-4 mr-2' />
                Create Tag
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setTagManagementDialogOpen(true)}>
                <Settings2 className='h-4 w-4 mr-2' />
                Manage Tags
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={toggleHideImportedTags}>
                <Tag className='h-4 w-4 mr-2' />
                {hideImportedTags ? 'Show Imported Tags' : 'Hide Imported Tags'}
              </ContextMenuItem>
            </>
          }
        >
          {/* Tag search and controls */}
          {tags.length > 0 && (
            <div className='px-2 py-1.5 space-y-2'>
              {/* Search input */}
              <div className='relative'>
                <IconSearch className='absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground' />
                <Input
                  placeholder='Search tags...'
                  value={tagSearchQuery}
                  onChange={(e) => setTagSearchQuery(e.target.value)}
                  className='h-7 pl-7 pr-7 text-xs'
                />
                {tagSearchQuery && (
                  <button
                    onClick={() => setTagSearchQuery('')}
                    className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
                  >
                    <X className='h-3 w-3' />
                  </button>
                )}
              </div>

              {/* AND/OR toggle - only show when 2+ tags selected */}
              {activeTagIds.length >= 2 && (
                <div className='flex items-center justify-between'>
                  <span className='text-xs text-muted-foreground'>Match:</span>
                  <div className='flex rounded-md border border-border overflow-hidden'>
                    <button
                      onClick={() => setTagFilterMode('or')}
                      className={cn(
                        'px-2 py-0.5 text-xs transition-colors',
                        tagFilterMode === 'or'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background hover:bg-muted'
                      )}
                    >
                      Any
                    </button>
                    <button
                      onClick={() => setTagFilterMode('and')}
                      className={cn(
                        'px-2 py-0.5 text-xs transition-colors border-l border-border',
                        tagFilterMode === 'and'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background hover:bg-muted'
                      )}
                    >
                      All
                    </button>
                  </div>
                </div>
              )}

              {/* Hide imported toggle */}
              <button
                onClick={toggleHideImportedTags}
                className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors'
              >
                <div
                  className={cn(
                    'w-6 h-3.5 rounded-full transition-colors relative',
                    hideImportedTags ? 'bg-primary' : 'bg-muted-foreground/30'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all',
                      hideImportedTags ? 'left-3' : 'left-0.5'
                    )}
                  />
                </div>
                <span>Hide imported</span>
              </button>
            </div>
          )}
          {tags.length === 0 ? (
            <p className='text-xs text-muted-foreground px-2 py-2'>
              Add tags to entries from the info panel
            </p>
          ) : (
            <div className='max-h-[200px] overflow-y-auto overflow-x-hidden'>
              {visibleTags.map((tag) => {
                  const isSelected = activeTagIds.includes(tag.id);
                  return (
                    <DroppableTag
                      key={tag.id}
                      tagId={tag.id}
                      tagName={tag.name}
                      tagColor={tag.color}
                      selectedTagIds={activeTagIds}
                      allTags={tags}
                    >
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                        <div className='w-full overflow-hidden'>
                          <SidebarItem
                            icon={
                              <span className='flex items-center justify-center w-4 h-4'>
                                {isSelected ? (
                                  <span className='flex items-center justify-center w-3.5 h-3.5 rounded border-2 border-primary bg-primary'>
                                    <Check className='h-2.5 w-2.5 text-primary-foreground' />
                                  </span>
                                ) : (tag.color || !tag.isImported) ? (
                                  <span
                                    className={cn(
                                      'w-2.5 h-2.5 rounded-full',
                                      tag.isImported && tag.color && 'ring-1 ring-offset-1 ring-muted-foreground/40'
                                    )}
                                    style={{
                                      backgroundColor: tag.color || '#6b7280'
                                    }}
                                  />
                                ) : null}
                              </span>
                            }
                            label={tag.name}
                            count={tag.itemCount}
                            active={isSelected}
                            onClick={(e) => handleTagSelect(tag.id, tag.name, e)}
                            allowContextMenu
                          />
                        </div>
                      </ContextMenuTrigger>
                <ContextMenuContent className='w-48'>
                  <ContextMenuItem
                    onClick={() =>
                      handleStartRenameTag({ id: tag.id, name: tag.name, color: tag.color })
                    }
                  >
                    <Pencil className='h-4 w-4 mr-2' />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Download className='h-4 w-4 mr-2' />
                      Export Tag
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className='w-48'>
                      <ContextMenuItem onClick={() => handleExportTagCslJson(tag.id, tag.name)}>
                        <FileJson className='h-4 w-4 mr-2' />
                        CSL JSON...
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleExportTagBibtex(tag.id, tag.name)}>
                        <FileCode className='h-4 w-4 mr-2' />
                        BibTeX...
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          openBiblatexExportDialog({
                            type: 'tag',
                            id: tag.id,
                            name: tag.name,
                          })
                        }
                      >
                        <FolderOpen className='h-4 w-4 mr-2' />
                        BibLaTeX with Files...
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => setDeleteTagConfirm({ id: tag.id, name: tag.name })}
                    className='text-destructive focus:text-destructive'
                  >
                    <Trash2 className='h-4 w-4 mr-2' />
                    Delete Tag
                  </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </DroppableTag>
                  );
                })}
            </div>
          )}
        </CollapsibleSection>
      </ScrollArea>

      {/* Empty Trash Confirmation Dialog */}
      <Dialog open={showEmptyTrashDialog} onOpenChange={setShowEmptyTrashDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empty Trash?</DialogTitle>
            <DialogDescription>
              This will permanently delete {trashCount} {trashCount === 1 ? 'item' : 'items'} and
              their files. This action cannot be undone.
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

      {/* New Collection Dialog */}
      <Dialog open={newCollectionDialogOpen} onOpenChange={setNewCollectionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Collection</DialogTitle>
            <DialogDescription>
              Create a new collection to organize your references.
            </DialogDescription>
          </DialogHeader>
          <div className='py-4 space-y-4'>
            <div>
              <Label htmlFor='collection-name'>Name</Label>
              <Input
                id='collection-name'
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder='Collection name...'
                className='mt-2'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateCollection();
                }}
                autoFocus
              />
            </div>
            <div>
              <Label>Color (optional)</Label>
              <div className='flex items-center gap-2 mt-2'>
                <div className='flex gap-1'>
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'].map(
                    (color) => (
                      <button
                        key={color}
                        type='button'
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          newCollectionColor === color
                            ? 'border-foreground scale-110'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setNewCollectionColor(color)}
                      />
                    ),
                  )}
                </div>
                {newCollectionColor && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setNewCollectionColor('')}
                    className='text-muted-foreground h-6 px-2'
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setNewCollectionDialogOpen(false);
                setNewCollectionName('');
                setNewCollectionColor('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateCollection} disabled={!newCollectionName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Collection Dialog */}
      <Dialog
        open={renameCollection !== null}
        onOpenChange={(open) => !open && setRenameCollection(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
            <DialogDescription>Update the collection name and color.</DialogDescription>
          </DialogHeader>
          <div className='py-4 space-y-4'>
            <div>
              <Label htmlFor='rename-collection-name'>Name</Label>
              <Input
                id='rename-collection-name'
                value={renameCollectionName}
                onChange={(e) => setRenameCollectionName(e.target.value)}
                placeholder='Collection name...'
                className='mt-2'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameCollection();
                }}
                autoFocus
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className='flex items-center gap-2 mt-2'>
                <div className='flex gap-1'>
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'].map(
                    (color) => (
                      <button
                        key={color}
                        type='button'
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          renameCollectionColor === color
                            ? 'border-foreground scale-110'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setRenameCollectionColor(color)}
                      />
                    ),
                  )}
                </div>
                {renameCollectionColor && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setRenameCollectionColor('')}
                    className='text-muted-foreground h-6 px-2'
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setRenameCollection(null);
                setRenameCollectionName('');
                setRenameCollectionColor('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRenameCollection} disabled={!renameCollectionName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Tag Dialog */}
      <Dialog open={renameTag !== null} onOpenChange={(open) => !open && setRenameTag(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Tag</DialogTitle>
            <DialogDescription>Enter a new name for this tag.</DialogDescription>
          </DialogHeader>
          <div className='py-4 space-y-4'>
            <div>
              <Label htmlFor='rename-tag-name'>Name</Label>
              <Input
                id='rename-tag-name'
                value={renameTagName}
                onChange={(e) => setRenameTagName(e.target.value)}
                placeholder='Tag name...'
                className='mt-2'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameTag();
                }}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor='rename-tag-color'>Color</Label>
              <div className='flex items-center gap-2 mt-2'>
                <div className='flex gap-1'>
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'].map((color) => (
                    <button
                      key={color}
                      type='button'
                      className={cn(
                        'w-6 h-6 rounded-full border-2 transition-all',
                        renameTagColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => setRenameTagColor(color)}
                    />
                  ))}
                </div>
                <Input
                  id='rename-tag-color'
                  type='color'
                  value={renameTagColor || '#808080'}
                  onChange={(e) => setRenameTagColor(e.target.value)}
                  className='w-10 h-6 p-0 border-0'
                />
                {renameTagColor && (
                  <Button variant='ghost' size='sm' className='h-6 px-2' onClick={() => setRenameTagColor('')}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setRenameTag(null);
                setRenameTagName('');
                setRenameTagColor('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRenameTag} disabled={!renameTagName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Options Dialog */}
      <ExportOptionsDialog
        open={showExportDialog}
        onClose={() => {
          setShowExportDialog(false);
          setExportContext(null);
        }}
        onExport={exportContext?.type === 'all' ? handleExportAllBiblatexWithFiles : handleExportBiblatexWithFiles}
        entryCount={
          exportContext?.type === 'all'
            ? entryCounts.total
            : exportContext?.type === 'collection'
              ? collections.find((c) => c.id === exportContext.id)?.itemCount ?? 0
              : exportContext?.type === 'tag'
                ? tags.find((t) => t.id === exportContext.id)?.itemCount ?? 0
                : 0
        }
        isExporting={isExporting}
      />

      {/* Delete Tag Confirmation Dialog */}
      <Dialog open={deleteTagConfirm !== null} onOpenChange={(open) => !open && setDeleteTagConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Tag?</DialogTitle>
            <DialogDescription>
              This will remove the tag "{deleteTagConfirm?.name}" from all entries. The entries themselves will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTagConfirm(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteTag}>
              Delete Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Saved Search Confirmation Dialog */}
      <Dialog
        open={deleteSavedSearchConfirm !== null}
        onOpenChange={(open) => !open && setDeleteSavedSearchConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Saved Search?</DialogTitle>
            <DialogDescription>
              This will permanently delete the saved search "{deleteSavedSearchConfirm?.name}".
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteSavedSearchConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (deleteSavedSearchConfirm) {
                  handleDeleteSavedSearch(deleteSavedSearchConfirm.id, deleteSavedSearchConfirm.name);
                  setDeleteSavedSearchConfirm(null);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag Management Dialog */}
      <TagManagementDialog
        open={tagManagementDialogOpen}
        onOpenChange={setTagManagementDialogOpen}
        tags={tags}
      />

      {/* Collection Management Dialog */}
      <CollectionManagementDialog
        open={collectionManagementDialogOpen}
        onOpenChange={setCollectionManagementDialogOpen}
        collections={collections}
      />
    </div>
  );
}
