import { type EntrySummary } from '@/stores/libraryStore';
import { cn } from '@/lib/utils';
import { EntryContextMenu } from './EntryContextMenu';
import { TrashContextMenu } from './TrashContextMenu';
import { getEntryTypeIcon, getAttachmentIcon, entryTypeDisplayNames } from '@/lib/icons';

interface EntryCardViewProps {
  entries: EntrySummary[];
  selectedIds: number[];
  onEntryClick: (id: number, event: React.MouseEvent) => void;
  onEntryDoubleClick: (id: number) => void;
  isTrashView?: boolean;
  footer?: React.ReactNode;
}

export function EntryCardView({
  entries,
  selectedIds,
  onEntryClick,
  onEntryDoubleClick,
  isTrashView = false,
  footer,
}: EntryCardViewProps) {
  const PdfIcon = getAttachmentIcon('pdf');
  const NoteIcon = getAttachmentIcon('note');

  return (
    <div className='grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3'>
      {entries.map((entry) => {
        const isSelected = selectedIds.includes(entry.id);
        const Icon = getEntryTypeIcon(entry.itemType);
        const typeName = entryTypeDisplayNames[entry.itemType] || entry.itemTypeDisplay || entry.itemType;
        const Wrapper = isTrashView ? TrashContextMenu : EntryContextMenu;

        return (
          <Wrapper key={entry.id} entry={entry}>
            <div
              onClick={(e) => onEntryClick(entry.id, e)}
              onDoubleClick={() => onEntryDoubleClick(entry.id)}
              className={cn(
                'flex flex-col p-3 rounded-lg border cursor-pointer transition-all',
                'hover:border-primary/50 hover:shadow-sm',
                isSelected && 'border-primary bg-accent',
              )}
            >
              {/* Thumbnail - only shown when there's an actual image */}
              {entry.thumbnailPath && (
                <div className='flex items-center justify-center h-24 mb-2 rounded relative overflow-hidden'>
                  <img
                    src={`file://${entry.thumbnailPath}`}
                    alt=''
                    className='h-full w-full object-cover rounded'
                  />
                </div>
              )}

              {/* Title with inline icon (when no thumbnail) */}
              <div className='flex items-start gap-1.5 mb-1'>
                {!entry.thumbnailPath && (
                  <Icon className='h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5' />
                )}
                <h3 className='text-sm font-medium line-clamp-2'>{entry.title}</h3>
              </div>

              {/* Creator + Year */}
              {(entry.creatorsDisplay || entry.year) && (
                <p className='text-xs text-muted-foreground truncate mb-1'>
                  {entry.creatorsDisplay}
                  {entry.creatorsDisplay && entry.year && ' · '}
                  {entry.year}
                </p>
              )}

              {/* Metadata row: type badge + attachments */}
              <div className='flex items-center gap-2 text-xs text-muted-foreground mt-auto'>
                <span className='px-1.5 py-0.5 rounded text-xs bg-muted'>{typeName}</span>
                <div className='flex items-center gap-1 ml-auto'>
                  {entry.hasPdf && <PdfIcon.icon className={`h-3 w-3 ${PdfIcon.className}`} />}
                  {entry.hasNote && <NoteIcon.icon className={`h-3 w-3 ${NoteIcon.className}`} />}
                  {entry.attachmentCount > 1 && (
                    <span className='text-xs'>{entry.attachmentCount}</span>
                  )}
                  {entry.hasExtractedText && (
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${entry.ragIndexed ? 'bg-green-500/60' : 'bg-yellow-500/80'}`}
                      title={entry.ragIndexed ? 'Indexed for AI search' : 'Not indexed for AI search'}
                    />
                  )}
                </div>
              </div>

              {/* Tags - only show non-imported tags (or imported with color) */}
              {(() => {
                const visibleTags = entry.tags.filter(t => t.color || !t.isImported);
                return visibleTags.length > 0 ? (
                  <div className='flex flex-wrap gap-1 mt-2'>
                    {visibleTags.slice(0, 3).map((tag) => (
                      <span
                        key={tag.id}
                        className='flex items-center gap-1 px-1.5 py-0.5 text-xs bg-muted rounded truncate max-w-full'
                        title={tag.name}
                      >
                        <span
                          className='w-2 h-2 rounded-full flex-shrink-0'
                          style={{ backgroundColor: tag.color || '#6b7280' }}
                        />
                        <span className='truncate'>{tag.name}</span>
                      </span>
                    ))}
                    {visibleTags.length > 3 && (
                      <span className='text-xs text-muted-foreground'>+{visibleTags.length - 3}</span>
                    )}
                  </div>
                ) : null;
              })()}
            </div>
          </Wrapper>
        );
      })}
      {footer && (
        <div className='col-span-full'>
          {footer}
        </div>
      )}
    </div>
  );
}
