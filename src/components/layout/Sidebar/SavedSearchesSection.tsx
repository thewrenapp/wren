import { useState, useEffect } from 'react';
import { BookmarkX } from 'lucide-react';
import { IconSearch } from '@tabler/icons-react';
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
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import { sidebarIcons } from '@/lib/icons';
import {
  getDuplicateCount,
  getSavedSearches,
  deleteSavedSearch,
} from '@/services/tauri';
import { toast } from '@/stores/toastStore';
import { CollapsibleSection, SidebarItem } from './SidebarShared';
import { FilterItemWithExportMenu } from './FilterExportMenu';

export function SavedSearchesSection() {
  const { activeFilter, setActiveFilter } = useUIStore();
  const {
    entryCounts,
    clearActiveTags,
    setActiveCollection,
    entryVersion,
    clearSelection,
    savedSearches,
    setSavedSearches,
    removeSavedSearch,
    activeSavedSearchId,
    setActiveSavedSearch,
  } = useLibraryStore();
  const { tabs, updateTab, setActiveTab } = useTabStore();

  const [duplicateCount, setDuplicateCount] = useState(0);
  const [deleteSavedSearchConfirm, setDeleteSavedSearchConfirm] = useState<{
    id: number;
    name: string;
  } | null>(null);

  useEffect(() => {
    getDuplicateCount().then(setDuplicateCount).catch(console.error);
  }, [entryCounts.total, entryVersion]);

  useEffect(() => {
    getSavedSearches().then(setSavedSearches).catch(console.error);
  }, [setSavedSearches]);

  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    clearActiveTags();
    setActiveCollection(null);
    setActiveSavedSearch(null);
    clearSelection();
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      updateTab(libraryTab.id, { title: filter === 'recent' ? 'Recently Added' : filter === 'untagged' ? 'Untagged' : 'Duplicates' });
      setActiveTab(libraryTab.id);
    }
  };

  const handleSavedSearchSelect = (searchId: number, searchName: string) => {
    setActiveSavedSearch(searchId);
    setActiveFilter('all');
    clearActiveTags();
    setActiveCollection(null);
    clearSelection();
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      updateTab(libraryTab.id, { title: searchName });
      setActiveTab(libraryTab.id);
    }
  };

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

  const recentCount = entryCounts.recent;

  return (
    <>
      <CollapsibleSection title='Smart Filters'>
        <FilterItemWithExportMenu filterType='recent' fileName='recently-added' label='Export Recent'>
          <SidebarItem
            icon={<sidebarIcons.recent className='h-4 w-4' />}
            label='Recently Added'
            count={recentCount}
            active={activeFilter === 'recent' && !activeSavedSearchId}
            onClick={() => handleFilterChange('recent')}
            allowContextMenu
          />
        </FilterItemWithExportMenu>
        <FilterItemWithExportMenu filterType='untagged' fileName='untagged' label='Export Untagged'>
          <SidebarItem
            icon={<sidebarIcons.untagged className='h-4 w-4' />}
            label='Untagged'
            count={entryCounts.untagged}
            active={activeFilter === 'untagged' && !activeSavedSearchId}
            onClick={() => handleFilterChange('untagged')}
            allowContextMenu
          />
        </FilterItemWithExportMenu>
        <SidebarItem
          icon={<sidebarIcons.duplicates className='h-4 w-4' />}
          label='Duplicates'
          count={duplicateCount}
          active={activeFilter === 'duplicates' && !activeSavedSearchId}
          onClick={() => handleFilterChange('duplicates')}
        />
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
    </>
  );
}
