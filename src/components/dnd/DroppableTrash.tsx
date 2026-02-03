import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { TrashDropData } from './DragDropProvider';

interface DroppableTrashProps {
  children: React.ReactNode;
  className?: string;
}

export function DroppableTrash({
  children,
  className,
}: DroppableTrashProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'trash',
    data: {
      type: 'trash',
    } satisfies TrashDropData,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'transition-all duration-150',
        isOver && 'ring-2 ring-destructive ring-offset-1 rounded-md bg-destructive/10',
        className
      )}
    >
      {children}
    </div>
  );
}
