import { useState } from 'react';
import {
  FolderOpen,
  FolderPlus,
  Download,
  FileJson,
  FileCode,
  Pencil,
  Settings2,
  Share2,
  Trash2,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { useUIStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import {
  createCollection,
  deleteCollection,
  updateCollection,
  getCollections,
  getEntries,
  exportToBibtex,
  exportToCslJson,
  exportToBiblatexWithFiles,
  type ExportOptions,
} from '@/services/tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { toast } from '@/stores/toastStore';
import { SidebarItem } from './SidebarShared';
import { DroppableCollection } from '@/components/dnd/DroppableCollection';

interface CollectionItemProps {
  collection: {
    id: number;
    name: string;
    color?: string;
    itemCount?: number;
  };
  active: boolean;
  onSelect: (id: number, name: string) => void;
  onStartRename: (collection: { id: number; name: string; color?: string }) => void;
  onDelete: (id: number, name: string) => void;
  onExportCslJson: (id: number, name: string) => void;
  onExportBibtex: (id: number, name: string) => void;
  onExportBiblatex: (id: number, name: string) => void;
}

export function CollectionItem({
  collection,
  active,
  onSelect,
  onStartRename,
  onDelete,
  onExportCslJson,
  onExportBibtex,
  onExportBiblatex,
}: CollectionItemProps) {
  return (
    <DroppableCollection
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
              active={active}
              onClick={() => onSelect(collection.id, collection.name)}
              allowContextMenu
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className='w-48'>
          <ContextMenuItem
            onClick={() =>
              onStartRename({
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
                onClick={() => onExportCslJson(collection.id, collection.name)}
              >
                <FileJson className='h-4 w-4 mr-2' />
                CSL JSON...
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onExportBibtex(collection.id, collection.name)}
              >
                <FileCode className='h-4 w-4 mr-2' />
                BibTeX...
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onExportBiblatex(collection.id, collection.name)}
              >
                <FolderOpen className='h-4 w-4 mr-2' />
                BibLaTeX with Files...
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem
            onClick={() => {
              useUIStore.getState().showShareDialog(
                'collection', [], [], collection.id, collection.name
              );
            }}
          >
            <Share2 className='h-4 w-4 mr-2' />
            Share Collection
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onDelete(collection.id, collection.name)}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='h-4 w-4 mr-2' />
            Delete Collection
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </DroppableCollection>
  );
}

export function useCollectionActions() {
  const {
    newCollectionDialogOpen,
    setNewCollectionDialogOpen,
  } = useUIStore();
  const {
    collections,
    setCollections,
    activeCollectionId,
    setActiveCollection,
  } = useLibraryStore();
  const { setActiveFilter } = useUIStore();
  const { tabs, updateTab } = useTabStore();

  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionColor, setNewCollectionColor] = useState('');
  const [renameCollection, setRenameCollection] = useState<{
    id: number;
    name: string;
    color?: string;
  } | null>(null);
  const [renameCollectionName, setRenameCollectionName] = useState('');
  const [renameCollectionColor, setRenameCollectionColor] = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportContext, setExportContext] = useState<{
    type: 'collection';
    id: number;
    name: string;
  } | null>(null);

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    try {
      await createCollection({
        name: newCollectionName.trim(),
        color: newCollectionColor || undefined,
      });
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
      const allCollections = await getCollections();
      setCollections(allCollections);
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

  const openBiblatexExportDialog = (id: number, name: string) => {
    setExportContext({ type: 'collection', id, name });
    setShowExportDialog(true);
  };

  const handleExportBiblatexWithFiles = async (options: ExportOptions) => {
    if (!exportContext) return;
    try {
      setIsExporting(true);
      const outputDir = await save({
        defaultPath: exportContext.name,
      });

      if (outputDir) {
        const dirPath = outputDir.replace(/\/[^/]+$/, '');
        const collectionEntries = await getEntries({ collectionId: exportContext.id });
        const entryIds = collectionEntries.map((e) => e.id);

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

  return {
    newCollectionDialogOpen,
    setNewCollectionDialogOpen,
    newCollectionName,
    setNewCollectionName,
    newCollectionColor,
    setNewCollectionColor,
    handleCreateCollection,
    renameCollection,
    setRenameCollection,
    renameCollectionName,
    setRenameCollectionName,
    renameCollectionColor,
    setRenameCollectionColor,
    handleRenameCollection,
    handleDeleteCollection,
    handleStartRenameCollection,
    handleExportCollectionCslJson,
    handleExportCollectionBibtex,
    openBiblatexExportDialog,
    showExportDialog,
    setShowExportDialog,
    exportContext,
    setExportContext,
    handleExportBiblatexWithFiles,
    isExporting,
    collections,
  };
}

export function CollectionSectionHeaderMenu() {
  const { setNewCollectionDialogOpen, setCollectionManagementDialogOpen } = useUIStore();

  return (
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
  );
}
