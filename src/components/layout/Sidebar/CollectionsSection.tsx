import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import { CollectionManagementDialog } from '@/components/dialogs/CollectionManagementDialog';
import { CollapsibleSection } from './SidebarShared';
import {
  CollectionItem,
  CollectionSectionHeaderMenu,
  useCollectionActions,
} from './CollectionContextMenu';
import { CollectionDialogs } from './CollectionDialogs';

interface CollectionsSectionProps {
  collectionsOpen: boolean;
  onCollectionsOpenChange: (open: boolean) => void;
}

export function CollectionsSection({ collectionsOpen, onCollectionsOpenChange }: CollectionsSectionProps) {
  const {
    collectionManagementDialogOpen,
    setCollectionManagementDialogOpen,
  } = useUIStore();
  const {
    collections,
    activeCollectionId,
    setActiveCollection,
    clearSelection,
  } = useLibraryStore();
  const { setActiveFilter } = useUIStore();
  const { tabs, updateTab, setActiveTab } = useTabStore();

  const actions = useCollectionActions();

  const handleCollectionSelect = (collectionId: number, collectionName: string) => {
    setActiveCollection(collectionId);
    setActiveFilter('all');
    clearSelection();
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      updateTab(libraryTab.id, { title: collectionName });
      setActiveTab(libraryTab.id);
    }
  };

  return (
    <>
      <CollapsibleSection
        title={collections.length > 0 ? `Collections (${collections.length})` : 'Collections'}
        isOpen={collectionsOpen}
        onOpenChange={onCollectionsOpenChange}
        onAdd={() => actions.setNewCollectionDialogOpen(true)}
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
        contextMenuContent={<CollectionSectionHeaderMenu />}
      >
        {collections.length === 0 ? (
          <p className='text-xs text-muted-foreground px-2 py-2'>
            Right-click to create a collection
          </p>
        ) : (
          collections.map((collection) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              active={activeCollectionId === collection.id}
              onSelect={handleCollectionSelect}
              onStartRename={actions.handleStartRenameCollection}
              onDelete={actions.handleDeleteCollection}
              onExportCslJson={actions.handleExportCollectionCslJson}
              onExportBibtex={actions.handleExportCollectionBibtex}
              onExportBiblatex={actions.openBiblatexExportDialog}
              onExportArchive={actions.handleExportCollectionArchive}
            />
          ))
        )}
      </CollapsibleSection>

      <CollectionDialogs
        newCollectionDialogOpen={actions.newCollectionDialogOpen}
        setNewCollectionDialogOpen={actions.setNewCollectionDialogOpen}
        newCollectionName={actions.newCollectionName}
        setNewCollectionName={actions.setNewCollectionName}
        newCollectionColor={actions.newCollectionColor}
        setNewCollectionColor={actions.setNewCollectionColor}
        handleCreateCollection={actions.handleCreateCollection}
        renameCollection={actions.renameCollection}
        setRenameCollection={actions.setRenameCollection}
        renameCollectionName={actions.renameCollectionName}
        setRenameCollectionName={actions.setRenameCollectionName}
        renameCollectionColor={actions.renameCollectionColor}
        setRenameCollectionColor={actions.setRenameCollectionColor}
        handleRenameCollection={actions.handleRenameCollection}
        showExportDialog={actions.showExportDialog}
        setShowExportDialog={actions.setShowExportDialog}
        exportContext={actions.exportContext}
        setExportContext={actions.setExportContext}
        handleExportBiblatexWithFiles={actions.handleExportBiblatexWithFiles}
        isExporting={actions.isExporting}
        collections={actions.collections}
      />

      <CollectionManagementDialog
        open={collectionManagementDialogOpen}
        onOpenChange={setCollectionManagementDialogOpen}
        collections={collections}
      />
    </>
  );
}
