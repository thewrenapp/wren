import { useMemo, useState, useCallback } from 'react';
import { Trash2, ExternalLink, ScrollText, RefreshCw, Sparkles, CircleCheck, FolderOpen } from 'lucide-react';
import { type EntrySummary, type Attachment, useLibraryStore } from '@/stores/libraryStore';
import { AttachmentIcon, getAttachmentIcon, getEntryTypeIcon } from '@/lib/icons';
import { useUIStore, type SortField, type SortDirection } from '@/stores/uiStore';
import { formatRelativeDate } from '@/lib/utils';
import { EntryContextMenuContent } from './EntryContextMenu';
import { TrashContextMenuContent } from './TrashContextMenu';
import { DataTable, type Column } from './DataTable';
import { deleteAttachment, reindexAttachment, exportToBiblatexWithFiles, type ExportOptions } from '@/services/tauri';
import { parseDocument, showAttachmentInFinder } from '@/services/tauri/commands';
import { useTabStore } from '@/stores/tabStore';
import { toast } from '@/stores/toastStore';
import type { EntryDragData } from '@/components/dnd/DragDropProvider';
import { ExportOptionsDialog } from '@/components/dialogs/ExportOptionsDialog';
import { open } from '@tauri-apps/plugin-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface EntryTableProps {
  entries: EntrySummary[];
  selectedIds: number[];
  expandedIds: number[];
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  onEntryClick: (id: number, event: React.MouseEvent) => void;
  onEntryDoubleClick: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onAttachmentClick?: (entryId: number, attachmentId: number) => void;
  onAttachmentDoubleClick?: (entryId: number, attachmentId: number) => void;
  attachmentsMap?: Record<number, Attachment[]>;
  /** Callback for keyboard navigation selection */
  onKeyboardSelect?: (id: number) => void;
  onEndReached?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  autoLoadKey?: string;
}

export function EntryTable({
  entries,
  selectedIds,
  expandedIds,
  sortField,
  sortDirection,
  onSort,
  onEntryClick,
  onEntryDoubleClick,
  onToggleExpand,
  onAttachmentClick,
  onAttachmentDoubleClick,
  attachmentsMap = {},
  onKeyboardSelect,
  onEndReached,
  hasMore = false,
  isLoadingMore = false,
  autoLoadKey,
}: EntryTableProps) {
  const { columns: columnConfig, activeFilter } = useUIStore();
  const visibleColumns = columnConfig.filter((col) => col.visible);
  const { invalidateAttachments, refreshLibrary } = useLibraryStore();

  // Entry context menu state
  const [contextMenuEntry, setContextMenuEntry] = useState<EntrySummary | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

  // Attachment context menu state
  const [contextMenuAttachment, setContextMenuAttachment] = useState<{
    attachment: Attachment;
    entryId: number;
  } | null>(null);

  // Export dialog state (lifted up so it persists after context menu closes)
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportTargetIds, setExportTargetIds] = useState<number[]>([]);

  const handleContextMenu = (entry: EntrySummary, event: React.MouseEvent) => {
    // Select the entry if not already in selection
    const { selectedEntryIds, selectEntry } = useLibraryStore.getState();
    if (!selectedEntryIds.includes(entry.id)) {
      selectEntry(entry.id);
    }
    setContextMenuEntry(entry);
    setContextMenuAttachment(null);
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const handleAttachmentContextMenu = (
    entryId: number,
    attachment: Attachment,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenuAttachment({ attachment, entryId });
    setContextMenuEntry(null);
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const closeContextMenu = useCallback(() => {
    setContextMenuEntry(null);
    setContextMenuAttachment(null);
  }, []);

  const handleShowExportDialog = useCallback((entryIds: number[]) => {
    setExportTargetIds(entryIds);
    setShowExportDialog(true);
  }, []);

  const handleExportBiblatexWithFiles = useCallback(async (options: ExportOptions) => {
    // Close the options dialog first - we're starting the export flow
    setShowExportDialog(false);

    try {
      setIsExporting(true);
      const outputDir = await open({
        directory: true,
        title: 'Select Export Folder',
      });
      if (outputDir) {
        const result = await exportToBiblatexWithFiles(exportTargetIds, outputDir, options);
        toast.success(
          `Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`,
        );
      }
    } catch (err) {
      console.error('Failed to export to BibLaTeX:', err);
      toast.error('Failed to export to BibLaTeX');
    } finally {
      setIsExporting(false);
    }
  }, [exportTargetIds]);

  const handleDeleteAttachment = async () => {
    if (!contextMenuAttachment) return;
    const { attachment } = contextMenuAttachment;

    try {
      await deleteAttachment(Number(attachment.id));
      invalidateAttachments();
      await refreshLibrary();
      toast.success('Attachment deleted');
    } catch (err) {
      console.error('Failed to delete attachment:', err);
      toast.error('Failed to delete attachment');
    }
    closeContextMenu();
  };

  const handleViewExtractedText = () => {
    if (!contextMenuAttachment) return;
    const { attachment, entryId } = contextMenuAttachment;
    const entry = entries.find((e) => e.id === entryId);
    const { openTab } = useTabStore.getState();
    openTab({
      type: 'markdown',
      title: `${entry?.title || 'Attachment'} - ${attachment.title || attachment.attachmentType}`,
      entryId: String(entryId),
      attachmentId: String(attachment.id),
      data: { attachmentId: attachment.id },
    });
    closeContextMenu();
  };

  const handleParseAttachment = async () => {
    if (!contextMenuAttachment) return;
    const { attachment, entryId } = contextMenuAttachment;
    closeContextMenu();
    try {
      await parseDocument(attachment.id, entryId);
      toast.info('Parsing started');
    } catch (err) {
      toast.error(`Failed to start parsing: ${err}`);
    }
  };

  const handleReindexAttachment = (forceOcr = false) => {
    if (!contextMenuAttachment) return;
    const { attachment } = contextMenuAttachment;
    const attachmentId = Number(attachment.id);
    const title = attachment.title || 'attachment';
    closeContextMenu();

    const label = forceOcr ? 'Re-extracting with OCR' : 'Re-extracting';
    const loadingId = toast.loading(`${label}: ${title}...`);

    (async () => {
      try {
        await reindexAttachment(attachmentId, { forceOcr });
        invalidateAttachments();
        await refreshLibrary();
        toast.dismiss(loadingId);
        toast.success('Attachment re-indexed successfully');
      } catch (err) {
        console.error('Failed to reindex attachment:', err);
        toast.dismiss(loadingId);
        toast.error(`Failed to reindex: ${err}`);
      }
    })();
  };

  // Define columns based on visible column config
  const columns: Column<EntrySummary>[] = useMemo(() => {
    return visibleColumns.map((col) => {
      const baseColumn = {
        id: col.id,
        header: col.label,
        width: col.width,
      };

      switch (col.id) {
        case 'title':
          return {
            ...baseColumn,
            cell: (entry: EntrySummary) => {
              const TypeIcon = getEntryTypeIcon(entry.itemType);
              return (
                <div className='flex items-center gap-2 min-w-0'>
                  <TypeIcon className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                  {entry.tags.filter(t => t.color || !t.isImported).length > 0 && (
                    <div className='flex items-center gap-0.5 flex-shrink-0'>
                      {entry.tags.filter(t => t.color || !t.isImported).slice(0, 3).map((tag) => (
                        <span
                          key={tag.id}
                          className='w-2 h-2 rounded-full'
                          style={{ backgroundColor: tag.color || '#6b7280' }}
                          title={tag.name}
                        />
                      ))}
                      {entry.tags.filter(t => t.color || !t.isImported).length > 3 && (
                        <span className='text-xs text-muted-foreground ml-0.5'>
                          +{entry.tags.filter(t => t.color || !t.isImported).length - 3}
                        </span>
                      )}
                    </div>
                  )}
                  <span className='font-medium truncate'>{entry.title}</span>
                </div>
              );
            },
          };

        case 'creator':
          return {
            ...baseColumn,
            cell: (entry: EntrySummary) => (
              <span className='text-muted-foreground truncate'>
                {entry.creatorsDisplay || '—'}
              </span>
            ),
          };

        case 'year':
          return {
            ...baseColumn,
            cell: (entry: EntrySummary) => (
              <span className='text-muted-foreground'>{entry.year || '—'}</span>
            ),
          };

        case 'itemType':
          return {
            ...baseColumn,
            cell: (entry: EntrySummary) => (
              <span className='text-muted-foreground capitalize'>
                {entry.itemTypeDisplay || entry.itemType?.replace(/_/g, ' ') || '—'}
              </span>
            ),
          };

        case 'dateAdded':
          return {
            ...baseColumn,
            cell: (entry: EntrySummary) => (
              <span className='text-muted-foreground'>{formatRelativeDate(entry.dateAdded)}</span>
            ),
          };

        case 'dateModified':
          return {
            ...baseColumn,
            cell: (entry: EntrySummary) => (
              <span className='text-muted-foreground'>
                {entry.dateModified ? formatRelativeDate(entry.dateModified) : '—'}
              </span>
            ),
          };

        case 'attachments':
          return {
            ...baseColumn,
            sortable: false,
            cell: (entry: EntrySummary) => {
              const PdfIcon = getAttachmentIcon('pdf');
              const NoteIcon = getAttachmentIcon('note');
              return (
                <div className='flex items-center gap-1'>
                  {entry.hasPdf && <PdfIcon.icon className={`h-3.5 w-3.5 ${PdfIcon.className}`} />}
                  {entry.hasNote && <NoteIcon.icon className={`h-3.5 w-3.5 ${NoteIcon.className}`} />}
                  {entry.attachmentCount > 0 && (
                    <span className='text-xs text-muted-foreground'>{entry.attachmentCount}</span>
                  )}
                </div>
              );
            },
          };

        case 'tags':
          return {
            ...baseColumn,
            sortable: false,
            cell: (entry: EntrySummary) => (
              <div className='flex items-center gap-1.5 overflow-hidden'>
                {entry.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag.id}
                    className='flex items-center gap-1 px-1.5 py-0.5 text-xs bg-muted rounded truncate max-w-[80px]'
                    title={tag.name}
                  >
                    {/* Only show color dot if tag has a color or is not imported */}
                    {(tag.color || !tag.isImported) && (
                      <span
                        className='w-2 h-2 rounded-full flex-shrink-0'
                        style={{ backgroundColor: tag.color || '#6b7280' }}
                      />
                    )}
                    <span className='truncate'>{tag.name}</span>
                  </span>
                ))}
                {entry.tags.length > 2 && (
                  <span className='text-xs text-muted-foreground'>+{entry.tags.length - 2}</span>
                )}
              </div>
            ),
          };

        default:
          return {
            ...baseColumn,
            cell: () => <span className='text-muted-foreground'>—</span>,
          };
      }
    });
  }, [visibleColumns]);

  // Render attachment sub-rows
  const renderSubRow = (entry: EntrySummary) => {
    const attachments = attachmentsMap[entry.id] || [];
    if (attachments.length === 0) return null;

    return (
      <>
        {attachments.map((attachment) => (
          <tr
            key={attachment.id}
            className='bg-muted/20 cursor-pointer hover:bg-accent/30 border-b h-7 select-none'
            onClick={() => onAttachmentClick?.(entry.id, attachment.id)}
            onDoubleClick={() => onAttachmentDoubleClick?.(entry.id, attachment.id)}
            onContextMenu={(e) => handleAttachmentContextMenu(entry.id, attachment, e)}
          >
            {/* Empty expand column for alignment */}
            <td className='w-8' />
            {/* Attachment icon in first content column */}
            <td className='px-2 py-1 text-sm text-muted-foreground'>
              <div className='flex items-center gap-2'>
                <AttachmentIcon type={attachment.attachmentType} />
                {attachment.attachmentType !== 'note' && attachment.hasParsedContent && (
                  <span title='AI structured'><Sparkles className='h-3 w-3 text-muted-foreground/50 flex-shrink-0' /></span>
                )}
                {attachment.attachmentType !== 'note' && !attachment.hasParsedContent && attachment.markdownPath && (
                  <span title='Text extracted'><ScrollText className='h-3 w-3 text-muted-foreground/50 flex-shrink-0' /></span>
                )}
                <span className='truncate'>
                  {attachment.title || getAttachmentDefaultTitle(attachment)}
                </span>
              </div>
            </td>
            {/* Empty cells for remaining columns */}
            {visibleColumns.slice(1).map((col) => (
              <td key={col.id} />
            ))}
          </tr>
        ))}
      </>
    );
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={entries}
        selectedIds={selectedIds}
        expandedIds={expandedIds}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={onSort}
        onRowClick={(entry, event) => onEntryClick(entry.id, event)}
        onRowDoubleClick={(entry) => onEntryDoubleClick(entry.id)}
        onRowContextMenu={handleContextMenu}
        onToggleExpand={onToggleExpand}
        getRowId={(entry) => entry.id}
        hasExpandableRows={(entry) => entry.attachmentCount > 0}
        renderSubRow={renderSubRow}
        onKeyboardSelect={onKeyboardSelect ? (entry) => onKeyboardSelect(entry.id) : undefined}
        isDragEnabled={activeFilter !== 'trash'}
        getDragData={(_entry, selectedEntries) => ({
          type: 'entries',
          entryIds: selectedEntries.map((e) => e.id),
          entries: selectedEntries,
        } satisfies EntryDragData)}
        onEndReached={onEndReached}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        autoLoadKey={autoLoadKey}
      />

      {/* Trash Context Menu - separate DropdownMenu to avoid conditional rendering issues */}
      {activeFilter === 'trash' && (
        <DropdownMenu
          open={!!contextMenuEntry}
          onOpenChange={(open) => !open && closeContextMenu()}
          modal={false}
        >
          <DropdownMenuTrigger asChild>
            <div
              className='fixed'
              style={{
                left: contextMenuPosition.x,
                top: contextMenuPosition.y,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-56'
            side='bottom'
            align='start'
            sideOffset={0}
            alignOffset={0}
          >
            {contextMenuEntry && (
              <TrashContextMenuContent entry={contextMenuEntry} onClose={closeContextMenu} />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Entry Context Menu - for non-trash views */}
      {activeFilter !== 'trash' && (
        <DropdownMenu
          open={!!contextMenuEntry}
          onOpenChange={(open) => !open && closeContextMenu()}
        >
          <DropdownMenuTrigger asChild>
            <div
              className='fixed'
              style={{
                left: contextMenuPosition.x,
                top: contextMenuPosition.y,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-56'
            side='bottom'
            align='start'
            sideOffset={0}
            alignOffset={0}
          >
            {contextMenuEntry && (
              <EntryContextMenuContent entry={contextMenuEntry} onClose={closeContextMenu} onShowExportDialog={handleShowExportDialog} />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Attachment Context Menu - controlled DropdownMenu */}
      <DropdownMenu
        open={!!contextMenuAttachment}
        onOpenChange={(open) => !open && closeContextMenu()}
      >
        <DropdownMenuTrigger asChild>
          <div
            className='fixed'
            style={{
              left: contextMenuPosition.x,
              top: contextMenuPosition.y,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className='w-48'
          side='bottom'
          align='start'
          sideOffset={0}
          alignOffset={0}
        >
          <DropdownMenuItem
            onClick={() => {
              if (contextMenuAttachment) {
                onAttachmentDoubleClick?.(
                  contextMenuAttachment.entryId,
                  contextMenuAttachment.attachment.id,
                );
              }
              closeContextMenu();
            }}
          >
            <ExternalLink className='h-4 w-4 mr-2' />
            Open
          </DropdownMenuItem>

          {contextMenuAttachment?.attachment.markdownPath && contextMenuAttachment.attachment.attachmentType !== 'note' && (
            <>
              <DropdownMenuItem onClick={handleViewExtractedText}>
                <ScrollText className='h-4 w-4 mr-2' />
                View Extracted Text
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleParseAttachment}>
                <Sparkles className='h-4 w-4 mr-2' />
                Parse with AI
                {contextMenuAttachment?.attachment.hasParsedContent && (
                  <CircleCheck className='h-4 w-4 ml-1 text-green-600' />
                )}
              </DropdownMenuItem>
            </>
          )}

          {contextMenuAttachment?.attachment.attachmentType !== 'note' && (
            <>
              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={() => handleReindexAttachment(false)}>
                <RefreshCw className='h-4 w-4 mr-2' />
                Re-extract Text
                {contextMenuAttachment?.attachment.markdownPath && (
                  <CircleCheck className='h-4 w-4 ml-1 text-green-600' />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleReindexAttachment(true)}>
                <RefreshCw className='h-4 w-4 mr-2' />
                Re-extract with OCR
                {contextMenuAttachment?.attachment.markdownPath && (
                  <CircleCheck className='h-4 w-4 ml-1 text-green-600' />
                )}
              </DropdownMenuItem>
            </>
          )}

          {(contextMenuAttachment?.attachment.filePath || contextMenuAttachment?.attachment.markdownPath) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (contextMenuAttachment) {
                    showAttachmentInFinder(contextMenuAttachment.attachment.id);
                  }
                  closeContextMenu();
                }}
              >
                <FolderOpen className='h-4 w-4 mr-2' />
                Show in Finder
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleDeleteAttachment}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='h-4 w-4 mr-2' />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Export Options Dialog - rendered outside menus so it persists after menu closes */}
      <ExportOptionsDialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        onExport={handleExportBiblatexWithFiles}
        entryCount={exportTargetIds.length}
        isExporting={isExporting}
      />
    </>
  );
}


// Default title for attachment if none provided
function getAttachmentDefaultTitle(attachment: Attachment): string {
  if (attachment.filePath) {
    const parts = attachment.filePath.split('/');
    return parts[parts.length - 1];
  }
  if (attachment.url) {
    return attachment.url;
  }
  return `${attachment.attachmentTypeDisplay}`;
}
