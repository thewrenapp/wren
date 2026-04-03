import {
  FilePlus,
  Download,
  FolderOpen,
  FileJson,
  FileCode,
  Copy,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { sidebarIcons } from '@/lib/icons';
import { useUIStore } from '@/stores/uiStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useTabStore } from '@/stores/tabStore';
import {
  emptyTrash,
  exportAllToBibtex,
  exportAllToCslJson,
  getEntries,
  type ExportOptions,
  exportAllToBiblatexWithFiles,
  exportToBiblatexWithFiles,
} from '@/services/tauri';
import { ExportOptionsDialog } from '@/components/dialogs/ExportOptionsDialog';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from '@/stores/toastStore';
import { DroppableTrash } from '@/components/dnd/DroppableTrash';
import { CollapsibleSection, SidebarItem, getFilterTitle } from './SidebarShared';
import { FilterItemWithExportMenu } from './FilterExportMenu';

export function FilterSection() {
  const { activeFilter, setActiveFilter } = useUIStore();
  const {
    entryCounts,
    trashCount,
    setTrashCount,
    setTrashedEntries,
    clearActiveTags,
    setActiveCollection,
    clearSelection,
    setActiveSavedSearch,
  } = useLibraryStore();
  const { tabs, updateTab, setActiveTab } = useTabStore();

  const [showEmptyTrashDialog, setShowEmptyTrashDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportContext, setExportContext] = useState<{
    type: 'all' | 'filter';
    filterType?: string;
    name?: string;
  } | null>(null);

  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    clearActiveTags();
    setActiveCollection(null);
    setActiveSavedSearch(null);
    clearSelection();
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (libraryTab) {
      updateTab(libraryTab.id, { title: getFilterTitle(filter) });
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

  const openBiblatexExportDialog = (context: typeof exportContext) => {
    setExportContext(context);
    setShowExportDialog(true);
  };

  const fetchFilteredEntryIds = async (filterType: string): Promise<number[]> => {
    const entries = await getEntries({ filterType });
    return entries.map((e) => e.id);
  };

  const handleExportBiblatexWithFiles = async (options: ExportOptions) => {
    if (!exportContext) return;
    try {
      setIsExporting(true);
      const outputDir = await save({
        defaultPath: exportContext.name || 'library',
      });

      if (outputDir) {
        const dirPath = outputDir.replace(/\/[^/]+$/, '');
        let entryIds: number[] = [];

        if (exportContext.type === 'all') {
          const all = await getEntries();
          entryIds = all.map((e) => e.id);
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

  return (
    <>
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
        <FilterItemWithExportMenu filterType='all' fileName='all-items' label='Export All Items'>
          <SidebarItem
            icon={<sidebarIcons.allItems className='h-4 w-4' />}
            label='All Items'
            count={entryCounts.total}
            active={activeFilter === 'all'}
            onClick={() => handleFilterChange('all')}
            allowContextMenu
          />
        </FilterItemWithExportMenu>
        <FilterItemWithExportMenu filterType='pdfs' fileName='pdfs' label='Export PDFs'>
          <SidebarItem
            icon={<sidebarIcons.pdfs className='h-4 w-4 text-red-500' />}
            label='PDFs'
            count={pdfCount}
            active={activeFilter === 'pdfs'}
            onClick={() => handleFilterChange('pdfs')}
            allowContextMenu
          />
        </FilterItemWithExportMenu>
        <FilterItemWithExportMenu filterType='notes' fileName='notes' label='Export Notes'>
          <SidebarItem
            icon={<sidebarIcons.notes className='h-4 w-4 text-amber-500' />}
            label='Notes'
            count={noteCount}
            active={activeFilter === 'notes'}
            onClick={() => handleFilterChange('notes')}
            allowContextMenu
          />
        </FilterItemWithExportMenu>
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

      <ExportOptionsDialog
        open={showExportDialog}
        onClose={() => {
          setShowExportDialog(false);
          setExportContext(null);
        }}
        onExport={exportContext?.type === 'all' ? handleExportAllBiblatexWithFiles : handleExportBiblatexWithFiles}
        entryCount={entryCounts.total}
        isExporting={isExporting}
      />
    </>
  );
}
