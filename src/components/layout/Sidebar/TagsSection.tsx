import {
  Plus,
  Settings2,
  X,
  Tag,
} from 'lucide-react';
import { IconSearch } from '@tabler/icons-react';
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import { TagManagementDialog } from '@/components/dialogs/TagManagementDialog';
import { CollapsibleSection } from './SidebarShared';
import { TagItem, useTagActions } from './TagContextMenu';
import { TagDialogs } from './TagDialogs';

interface TagsSectionProps {
  tagsOpen: boolean;
  onTagsOpenChange: (open: boolean) => void;
}

export function TagsSection({ tagsOpen, onTagsOpenChange }: TagsSectionProps) {
  const {
    setTagManagementDialogOpen,
    tagManagementDialogOpen,
    hideImportedTags,
    toggleHideImportedTags,
    setActiveFilter,
  } = useUIStore();
  const {
    tags,
    toggleActiveTag,
    clearActiveTags,
    setTagFilterMode,
    activeTagIds,
    tagFilterMode,
    activeFilter: libraryActiveFilter,
    clearSelection,
  } = useLibraryStore();
  const { tabs, updateTab, setActiveTab } = useTabStore();

  const [tagSearchQuery, setTagSearchQuery] = useState('');

  const actions = useTagActions();

  const visibleTags = useMemo(() => {
    return tags
      .filter((tag) => !hideImportedTags || !tag.isImported)
      .filter((tag) =>
        tagSearchQuery
          ? tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
          : true
      );
  }, [tags, hideImportedTags, tagSearchQuery]);

  const handleTagSelect = (tagId: number, _tagName: string, event?: React.MouseEvent) => {
    const isMultiSelect = event?.metaKey || event?.ctrlKey;
    const isSelected = activeTagIds.includes(tagId);
    const store = useLibraryStore.getState();

    let newActiveTagIds: number[];

    if (isMultiSelect) {
      toggleActiveTag(tagId);
      newActiveTagIds = isSelected
        ? activeTagIds.filter((id) => id !== tagId)
        : [...activeTagIds, tagId];
    } else {
      if (isSelected && activeTagIds.length === 1) {
        toggleActiveTag(tagId);
        newActiveTagIds = [];
      } else {
        store.setActiveTags([tagId]);
        newActiveTagIds = [tagId];
      }
    }

    setActiveFilter('all');
    clearSelection();

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

  return (
    <>
      <CollapsibleSection
        title={visibleTags.length > 0 ? `Tags (${activeTagIds.length}/${visibleTags.length})` : 'Tags'}
        isOpen={tagsOpen}
        onOpenChange={onTagsOpenChange}
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
        {tags.length > 0 && (
          <div className='px-2 py-1.5 space-y-2'>
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
            {visibleTags.map((tag) => (
              <TagItem
                key={tag.id}
                tag={tag}
                isSelected={activeTagIds.includes(tag.id)}
                activeTagIds={activeTagIds}
                allTags={tags}
                onSelect={handleTagSelect}
                onStartRename={actions.handleStartRenameTag}
                onConfirmDelete={actions.setDeleteTagConfirm}
                onExportCslJson={actions.handleExportTagCslJson}
                onExportBibtex={actions.handleExportTagBibtex}
                onExportBiblatex={actions.openBiblatexExportDialog}
              />
            ))}
          </div>
        )}
      </CollapsibleSection>

      <TagDialogs
        renameTag={actions.renameTag}
        setRenameTag={actions.setRenameTag}
        renameTagName={actions.renameTagName}
        setRenameTagName={actions.setRenameTagName}
        renameTagColor={actions.renameTagColor}
        setRenameTagColor={actions.setRenameTagColor}
        handleRenameTag={actions.handleRenameTag}
        deleteTagConfirm={actions.deleteTagConfirm}
        setDeleteTagConfirm={actions.setDeleteTagConfirm}
        handleDeleteTag={actions.handleDeleteTag}
        showExportDialog={actions.showExportDialog}
        setShowExportDialog={actions.setShowExportDialog}
        exportContext={actions.exportContext}
        setExportContext={actions.setExportContext}
        handleExportBiblatexWithFiles={actions.handleExportBiblatexWithFiles}
        isExporting={actions.isExporting}
        tags={actions.tags}
      />

      <TagManagementDialog
        open={tagManagementDialogOpen}
        onOpenChange={setTagManagementDialogOpen}
        tags={tags}
      />
    </>
  );
}
