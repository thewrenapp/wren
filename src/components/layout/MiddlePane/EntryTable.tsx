import { useMemo, useState, useCallback } from 'react';
import { FileType, StickyNote, Globe, Paperclip, Trash2, ExternalLink } from 'lucide-react';
import { type EntrySummary, type Attachment, useLibraryStore } from '@/stores/libraryStore';
import { useUIStore, type SortField, type SortDirection } from '@/stores/uiStore';
import { formatRelativeDate } from '@/lib/utils';
import { EntryContextMenuContent } from './EntryContextMenu';
import { TrashContextMenuContent } from './TrashContextMenu';
import { DataTable, type Column } from './DataTable';
import { deleteAttachment } from '@/services/tauri';
import { toast } from '@/stores/toastStore';
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
}: EntryTableProps) {
  const { columns: columnConfig, activeFilter } = useUIStore();
  const visibleColumns = columnConfig.filter((col) => col.visible);
  const { invalidateAttachments } = useLibraryStore();

  // Entry context menu state
  const [contextMenuEntry, setContextMenuEntry] = useState<EntrySummary | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

  // Attachment context menu state
  const [contextMenuAttachment, setContextMenuAttachment] = useState<{
    attachment: Attachment;
    entryId: number;
  } | null>(null);

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

  const closeEntryContextMenu = useCallback(() => {
    setContextMenuEntry(null);
  }, []);

  const closeAttachmentContextMenu = useCallback(() => {
    setContextMenuAttachment(null);
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuEntry(null);
    setContextMenuAttachment(null);
  }, []);

  const handleDeleteAttachment = async () => {
    if (!contextMenuAttachment) return;
    const { attachment } = contextMenuAttachment;

    try {
      await deleteAttachment(Number(attachment.id));
      invalidateAttachments();
      toast.success('Attachment deleted');
    } catch (err) {
      console.error('Failed to delete attachment:', err);
      toast.error('Failed to delete attachment');
    }
    closeContextMenu();
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
            cell: (entry: EntrySummary) => (
              <span className='font-medium truncate'>{entry.title}</span>
            ),
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
                {entry.itemType.replace(/_/g, ' ')}
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
            cell: (entry: EntrySummary) => (
              <div className='flex items-center gap-1'>
                {entry.hasPdf && <FileType className='h-3.5 w-3.5 text-red-500' />}
                {entry.hasNote && <StickyNote className='h-3.5 w-3.5 text-amber-500' />}
                {entry.attachmentCount > 0 && (
                  <span className='text-xs text-muted-foreground'>{entry.attachmentCount}</span>
                )}
              </div>
            ),
          };

        case 'tags':
          return {
            ...baseColumn,
            sortable: false,
            cell: (entry: EntrySummary) => (
              <div className='flex items-center gap-1 overflow-hidden'>
                {entry.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag.id}
                    className='px-1 py-0.5 text-xs bg-muted rounded truncate max-w-[60px]'
                  >
                    {tag.name}
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
              <EntryContextMenuContent entry={contextMenuEntry} onClose={closeContextMenu} />
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

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleDeleteAttachment}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='h-4 w-4 mr-2' />
            Delete Attachment
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Attachment icon based on type
function AttachmentIcon({ type }: { type: string }) {
  switch (type) {
    case 'pdf':
      return <FileType className='h-4 w-4 text-red-500 flex-shrink-0' />;
    case 'note':
      return <StickyNote className='h-4 w-4 text-amber-500 flex-shrink-0' />;
    case 'weblink':
      return <Globe className='h-4 w-4 text-primary flex-shrink-0' />;
    default:
      return <Paperclip className='h-4 w-4 text-muted-foreground flex-shrink-0' />;
  }
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
