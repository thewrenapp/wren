import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { TagDropData, TagDragData } from './DragDropProvider';
import { useDragDropContext } from './DragDropProvider';

interface DroppableTagProps {
  tagId: number;
  tagName: string;
  tagColor?: string;
  children: React.ReactNode;
  className?: string;
  /** All currently selected tag IDs for multi-drag support */
  selectedTagIds?: number[];
  /** All tags info for building drag data */
  allTags?: Array<{ id: number; name: string; color?: string }>;
}

export function DroppableTag({
  tagId,
  tagName,
  tagColor,
  children,
  className,
  selectedTagIds = [],
  allTags = [],
}: DroppableTagProps) {
  const { draggedTags } = useDragDropContext();

  // Determine which tags to drag
  // If this tag is selected, drag all selected tags; otherwise just this tag
  const isSelected = selectedTagIds.includes(tagId);
  const tagsToInclude = isSelected
    ? allTags.filter(t => selectedTagIds.includes(t.id))
    : [{ id: tagId, name: tagName, color: tagColor }];

  // Make this tag a drop target
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `tag-${tagId}`,
    data: {
      type: 'tag',
      tagId,
      tagName,
    } satisfies TagDropData,
  });

  // Make this tag draggable
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag-tag-${tagId}`,
    data: {
      type: 'tagDrag',
      tags: tagsToInclude,
    } satisfies TagDragData,
  });

  // Combine refs
  const setNodeRef = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
  };

  // Don't highlight as drop target if dragging any of the selected tags onto this tag
  const isDraggingThis = draggedTags.some(t => t.id === tagId);
  const showDropHighlight = isOver && !isDraggingThis;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'transition-all duration-150',
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
