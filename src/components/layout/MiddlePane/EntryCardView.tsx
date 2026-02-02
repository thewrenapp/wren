import {
  FileText,
  File,
  BookOpen,
  GraduationCap,
  Globe,
  Presentation,
  Newspaper,
  FileCode,
  ScrollText,
} from 'lucide-react';
import { type EntrySummary } from '@/stores/libraryStore';
import { cn } from '@/lib/utils';
import { EntryContextMenu } from './EntryContextMenu';
import { TrashContextMenu } from './TrashContextMenu';

interface EntryCardViewProps {
  entries: EntrySummary[];
  selectedIds: number[];
  onEntryClick: (id: number, event: React.MouseEvent) => void;
  onEntryDoubleClick: (id: number) => void;
  isTrashView?: boolean;
}

// Map item types to icons (Zotero-compatible)
const itemTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  journalArticle: FileText,
  book: BookOpen,
  bookSection: BookOpen,
  conferencePaper: Presentation,
  thesis: GraduationCap,
  report: ScrollText,
  preprint: FileText,
  webpage: Globe,
  blogPost: Globe,
  magazineArticle: Newspaper,
  newspaperArticle: Newspaper,
  computerProgram: FileCode,
  document: File,
  dataset: File,
  patent: ScrollText,
  artwork: File,
  film: File,
  podcast: File,
  note: FileText,
};

// Map item types to display names (Zotero-compatible)
const itemTypeNames: Record<string, string> = {
  journalArticle: 'Journal Article',
  book: 'Book',
  bookSection: 'Book Section',
  conferencePaper: 'Conference Paper',
  thesis: 'Thesis',
  report: 'Report',
  preprint: 'Preprint',
  webpage: 'Web Page',
  blogPost: 'Blog Post',
  magazineArticle: 'Magazine Article',
  newspaperArticle: 'Newspaper Article',
  computerProgram: 'Software',
  document: 'Document',
  dataset: 'Dataset',
  patent: 'Patent',
  artwork: 'Artwork',
  film: 'Film',
  podcast: 'Podcast',
  note: 'Note',
};

export function EntryCardView({
  entries,
  selectedIds,
  onEntryClick,
  onEntryDoubleClick,
  isTrashView = false,
}: EntryCardViewProps) {
  return (
    <div className='grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3'>
      {entries.map((entry) => {
        const isSelected = selectedIds.includes(entry.id);
        const Icon = itemTypeIcons[entry.itemType] || File;
        const typeName = itemTypeNames[entry.itemType] || entry.itemType;
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
              {/* Thumbnail/Icon area */}
              <div
                className={cn(
                  'flex items-center justify-center h-24 mb-2 rounded relative',
                  entry.hasPdf ? 'bg-red-50 dark:bg-red-900/20' : 'bg-muted/50',
                )}
              >
                {entry.thumbnailPath ? (
                  <img
                    src={`file://${entry.thumbnailPath}`}
                    alt=''
                    className='h-full w-full object-cover rounded'
                  />
                ) : (
                  <Icon
                    className={cn(
                      'h-10 w-10',
                      entry.hasPdf ? 'text-red-400' : 'text-muted-foreground',
                    )}
                  />
                )}
              </div>

              {/* Title */}
              <h3 className='text-sm font-medium line-clamp-2 mb-1'>{entry.title}</h3>

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
                  {entry.hasPdf && <File className='h-3 w-3 text-red-400' />}
                  {entry.hasNote && <FileText className='h-3 w-3 text-primary/70' />}
                  {entry.attachmentCount > 1 && (
                    <span className='text-xs'>{entry.attachmentCount}</span>
                  )}
                </div>
              </div>

              {/* Tags */}
              {entry.tags.length > 0 && (
                <div className='flex flex-wrap gap-1 mt-2'>
                  {entry.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag.id}
                      className='px-1.5 py-0.5 text-xs bg-muted rounded truncate max-w-full'
                    >
                      {tag.name}
                    </span>
                  ))}
                  {entry.tags.length > 3 && (
                    <span className='text-xs text-muted-foreground'>+{entry.tags.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          </Wrapper>
        );
      })}
    </div>
  );
}
