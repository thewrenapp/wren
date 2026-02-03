import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

interface DraggableTableRowProps {
  dragId: string;
  dragData: Record<string, unknown>;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
  dataState?: string;
}

export function DraggableTableRow({
  dragId,
  dragData,
  disabled = false,
  children,
  className,
  onClick,
  onDoubleClick,
  onContextMenu,
  rowRef,
  dataState,
}: DraggableTableRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    disabled,
    data: dragData,
  });

  // Combine refs
  const handleRef = (el: HTMLTableRowElement | null) => {
    setNodeRef(el);
    rowRef?.(el);
  };

  return (
    <tr
      ref={handleRef}
      data-state={dataState}
      className={cn(
        className,
        isDragging && 'opacity-50'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      {...listeners}
      {...attributes}
    >
      {children}
    </tr>
  );
}
