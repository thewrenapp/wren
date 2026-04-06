import { useState } from 'react';
import {
  FolderOpen,
  Download,
  FileJson,
  FileCode,
  Pencil,
  Trash2,
  Check,
  Archive,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { useLibraryStore } from '@/stores/libraryStore';
import { useUIStore } from '@/stores/uiStore';
import { useTabStore } from '@/stores/tabStore';
import {
  updateTag,
  deleteTag,
  getTags,
  getEntries,
  exportToBibtex,
  exportToCslJson,
  exportToBiblatexWithFiles,
  exportEntriesArchive,
  type ExportOptions,
} from '@/services/tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { toast } from '@/stores/toastStore';
import { DroppableTag } from '@/components/dnd/DroppableTag';
import { SidebarItem } from './SidebarShared';

interface TagItemProps {
  tag: { id: number; name: string; color?: string; isImported?: boolean; itemCount?: number };
  isSelected: boolean;
  activeTagIds: number[];
  allTags: Array<{ id: number; name: string; color?: string; isImported?: boolean; itemCount?: number }>;
  onSelect: (tagId: number, tagName: string, event?: React.MouseEvent) => void;
  onStartRename: (tag: { id: number; name: string; color?: string }) => void;
  onConfirmDelete: (tag: { id: number; name: string }) => void;
  onExportCslJson: (id: number, name: string) => void;
  onExportBibtex: (id: number, name: string) => void;
  onExportBiblatex: (id: number, name: string) => void;
  onExportArchive: (id: number, name: string) => void;
}

export function TagItem({
  tag,
  isSelected,
  activeTagIds,
  allTags,
  onSelect,
  onStartRename,
  onConfirmDelete,
  onExportCslJson,
  onExportBibtex,
  onExportBiblatex,
  onExportArchive,
}: TagItemProps) {
  return (
    <DroppableTag
      tagId={tag.id}
      tagName={tag.name}
      tagColor={tag.color}
      selectedTagIds={activeTagIds}
      allTags={allTags}
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
              onClick={(e) => onSelect(tag.id, tag.name, e)}
              allowContextMenu
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className='w-48'>
          <ContextMenuItem
            onClick={() => onStartRename({ id: tag.id, name: tag.name, color: tag.color })}
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
              <ContextMenuItem onClick={() => onExportCslJson(tag.id, tag.name)}>
                <FileJson className='h-4 w-4 mr-2' />
                CSL JSON...
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onExportBibtex(tag.id, tag.name)}>
                <FileCode className='h-4 w-4 mr-2' />
                BibTeX...
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onExportBiblatex(tag.id, tag.name)}>
                <FolderOpen className='h-4 w-4 mr-2' />
                BibLaTeX with Files...
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onExportArchive(tag.id, tag.name)}>
                <Archive className='h-4 w-4 mr-2' />
                Wren Archive...
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => onConfirmDelete({ id: tag.id, name: tag.name })}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='h-4 w-4 mr-2' />
            Delete Tag
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </DroppableTag>
  );
}

export function useTagActions() {
  const {
    tags,
    setTags,
    activeTagIds,
    clearActiveTags,
    refreshLibrary,
    invalidateEntry,
  } = useLibraryStore();
  const { setActiveFilter } = useUIStore();
  const { tabs, updateTab } = useTabStore();

  const [renameTag, setRenameTag] = useState<{ id: number; name: string; color?: string } | null>(null);
  const [renameTagName, setRenameTagName] = useState('');
  const [renameTagColor, setRenameTagColor] = useState('');
  const [deleteTagConfirm, setDeleteTagConfirm] = useState<{ id: number; name: string } | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportContext, setExportContext] = useState<{
    type: 'tag';
    id: number;
    name: string;
  } | null>(null);

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
      invalidateEntry();
      await refreshLibrary();
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

  const handleDeleteTag = async () => {
    if (!deleteTagConfirm) return;
    try {
      await deleteTag(deleteTagConfirm.id);
      const allTags = await getTags();
      setTags(allTags);
      if (activeTagIds.includes(deleteTagConfirm.id)) {
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
      invalidateEntry();
      await refreshLibrary();
      toast.success(`Tag "${deleteTagConfirm.name}" deleted`);
      setDeleteTagConfirm(null);
    } catch (err) {
      console.error('Failed to delete tag:', err);
      toast.error('Failed to delete tag');
    }
  };

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

  const openBiblatexExportDialog = (id: number, name: string) => {
    setExportContext({ type: 'tag', id, name });
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
        const tagEntries = await getEntries({ tagIds: [exportContext.id] });
        const entryIds = tagEntries.map((e) => e.id);

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

  const handleExportTagArchive = async (tagId: number, tagName: string) => {
    try {
      const tagEntries = await getEntries({ tagIds: [tagId] });
      const entryIds = tagEntries.map((e) => e.id);
      if (entryIds.length === 0) { toast.warning('No entries with this tag'); return; }
      const filePath = await save({
        defaultPath: `${tagName}.wrenitem`,
        filters: [{ name: 'Wren Archive', extensions: ['wrenitem'] }],
      });
      if (filePath) {
        const result = await exportEntriesArchive(entryIds, filePath);
        toast.success(`Exported tag "${tagName}" (${result.entriesExported} entries, ${result.filesExported} files)`);
      }
    } catch (err) {
      console.error('Failed to export tag archive:', err);
      toast.error('Failed to export tag archive');
    }
  };

  return {
    renameTag,
    setRenameTag,
    renameTagName,
    setRenameTagName,
    renameTagColor,
    setRenameTagColor,
    handleStartRenameTag,
    handleRenameTag,
    deleteTagConfirm,
    setDeleteTagConfirm,
    handleDeleteTag,
    handleExportTagCslJson,
    handleExportTagBibtex,
    openBiblatexExportDialog,
    handleExportTagArchive,
    showExportDialog,
    setShowExportDialog,
    exportContext,
    setExportContext,
    handleExportBiblatexWithFiles,
    isExporting,
    tags,
  };
}
