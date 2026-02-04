import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { CollectionDropData, CollectionDragData } from './DragDropProvider';
import { useDragDropContext } from './DragDropProvider';

interface DroppableCollectionProps {
  collectionId: number;
  collectionName: string;
  collectionColor?: string;
  children: React.ReactNode;
  className?: string;
}

export function DroppableCollection({
  collectionId,
  collectionName,
  collectionColor,
  children,
  className,
}: DroppableCollectionProps) {
  const { draggedCollection } = useDragDropContext();

  // Make this collection a drop target
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `collection-${collectionId}`,
    data: {
      type: 'collection',
      collectionId,
      collectionName,
    } satisfies CollectionDropData,
  });

  // Make this collection draggable
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag-collection-${collectionId}`,
    data: {
      type: 'collectionDrag',
      collectionId,
      collectionName,
      collectionColor,
    } satisfies CollectionDragData,
  });

  // Combine refs
  const setNodeRef = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
  };

  // Don't highlight as drop target if dragging this collection onto itself
  const isDraggingSelf = draggedCollection?.id === collectionId;
  const showDropHighlight = isOver && !isDraggingSelf;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'transition-all duration-150 w-full overflow-hidden',
        showDropHighlight && 'ring-2 ring-primary ring-offset-1 rounded-md bg-accent/50',
        isDragging && 'opacity-50',
        className
      )}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}
