import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

export function getFilterTitle(filter: string): string {
  switch (filter) {
    case 'pdfs':
      return 'PDFs';
    case 'notes':
      return 'Notes';
    case 'recent':
      return 'Recently Added';
    case 'untagged':
      return 'Untagged';
    case 'duplicates':
      return 'Duplicates';
    case 'trash':
      return 'Trash';
    default:
      return 'Library';
  }
}

export interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: (event?: React.MouseEvent) => void;
  allowContextMenu?: boolean;
}

export function SidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  allowContextMenu = false,
}: SidebarItemProps) {
  return (
    <button
      onClick={(e) => onClick?.(e)}
      onContextMenu={allowContextMenu ? undefined : (e) => e.preventDefault()}
      className={cn(
        'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors select-none overflow-hidden',
        'hover:bg-sidebar-accent',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground/80',
      )}
    >
      <span className='flex-shrink-0 w-4 h-4'>{icon}</span>
      <span className='flex-1 min-w-0 text-left truncate'>{label}</span>
      {count !== undefined && <span className='flex-shrink-0 text-xs text-muted-foreground'>{count}</span>}
    </button>
  );
}

export interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAdd?: () => void;
  contextMenuContent?: React.ReactNode;
  actions?: React.ReactNode;
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  isOpen: controlledIsOpen,
  onOpenChange,
  onAdd,
  contextMenuContent,
  actions,
}: CollapsibleSectionProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);

  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    }
    setInternalIsOpen(open);
  };

  const headerContent = (
    <div
      className='flex items-center gap-1 px-2 py-1 group select-none overflow-hidden'
      onContextMenu={contextMenuContent ? undefined : (e) => e.preventDefault()}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className='flex items-center gap-1 flex-1 min-w-0 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground transition-colors select-none'
      >
        <span className='flex-shrink-0'>
          {isOpen ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
        </span>
        <span className='truncate'>{title}</span>
      </button>
      <div className='flex items-center flex-shrink-0'>
        {actions}
        {onAdd && (
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={`Add ${title}`}
            title={`Add ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            className='h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100'
          >
            <Plus className='h-3 w-3' />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className='mb-2 overflow-hidden'>
      {contextMenuContent ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{headerContent}</ContextMenuTrigger>
          <ContextMenuContent className='w-48'>{contextMenuContent}</ContextMenuContent>
        </ContextMenu>
      ) : (
        headerContent
      )}
      {isOpen && <div className='space-y-0.5 px-1 overflow-hidden'>{children}</div>}
    </div>
  );
}
