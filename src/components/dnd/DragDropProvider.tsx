import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { useLibraryStore, type EntrySummary } from '@/stores/libraryStore';
import { addEntryToCollection, getCollections, deleteEntry, getTrashCount, mergeCollections, addTagToEntries, getTags, mergeTags } from '@/services/tauri';
import { toast } from '@/stores/toastStore';
import { FolderOpen, Tag, Tags } from 'lucide-react';
import { IconFileText, IconFiles } from '@tabler/icons-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Types for drag data
export interface EntryDragData {
  type: 'entries';
  entryIds: number[];
  entries: EntrySummary[];
}

export interface CollectionDropData {
  type: 'collection';
  collectionId: number;
  collectionName: string;
}

export interface TrashDropData {
  type: 'trash';
}

export interface TagDropData {
  type: 'tag';
  tagId: number;
  tagName: string;
}

export interface CollectionDragData {
  type: 'collectionDrag';
  collectionId: number;
  collectionName: string;
  collectionColor?: string;
}

export interface TagDragData {
  type: 'tagDrag';
  tags: Array<{ id: number; name: string; color?: string }>;
}

type DragData = EntryDragData | CollectionDragData | TagDragData;
type DropData = CollectionDropData | TrashDropData | TagDropData;

interface DragDropContextValue {
  isDragging: boolean;
  draggedEntryIds: number[];
  draggedCollection: { id: number; name: string; color?: string } | null;
  draggedTags: Array<{ id: number; name: string; color?: string }>;
  activeDropTargetId: string | null;
}

const DragDropReactContext = createContext<DragDropContextValue>({
  isDragging: false,
  draggedEntryIds: [],
  draggedCollection: null,
  draggedTags: [],
  activeDropTargetId: null,
});

export function useDragDropContext() {
  return useContext(DragDropReactContext);
}

interface DragDropProviderProps {
  children: ReactNode;
  onExpandCollections?: () => void;
}

// Pending operation types for confirmations
interface PendingTrashDrop {
  entryIds: number[];
}

interface PendingMerge {
  sourceId: number;
  sourceName: string;
  targetId: number;
  targetName: string;
}

interface PendingTagMerge {
  sourceTags: Array<{ id: number; name: string }>;
  targetId: number;
  targetName: string;
}

export function DragDropProvider({ children, onExpandCollections }: DragDropProviderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedEntryIds, setDraggedEntryIds] = useState<number[]>([]);
  const [draggedEntries, setDraggedEntries] = useState<EntrySummary[]>([]);
  const [draggedCollection, setDraggedCollection] = useState<{ id: number; name: string; color?: string } | null>(null);
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null);

  // Dragged tags state
  const [draggedTags, setDraggedTags] = useState<Array<{ id: number; name: string; color?: string }>>([]);

  // Pending confirmations
  const [pendingTrashDrop, setPendingTrashDrop] = useState<PendingTrashDrop | null>(null);
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const [pendingTagMerge, setPendingTagMerge] = useState<PendingTagMerge | null>(null);

  const { setCollections, setTags, setTrashCount, setActiveCollection, activeCollectionId, invalidateEntry, refreshLibrary, clearSelection } = useLibraryStore();

  // Configure pointer sensor with activation constraint
  // This prevents accidental drags when clicking
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as DragData;

    if (data?.type === 'entries') {
      setIsDragging(true);
      setDraggedEntryIds(data.entryIds);
      setDraggedEntries(data.entries);

      // Expand collections section when dragging starts
      onExpandCollections?.();
    } else if (data?.type === 'collectionDrag') {
      setIsDragging(true);
      setDraggedCollection({
        id: data.collectionId,
        name: data.collectionName,
        color: data.collectionColor,
      });
    } else if (data?.type === 'tagDrag') {
      setIsDragging(true);
      setDraggedTags(data.tags);
    }
  }, [onExpandCollections]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (over) {
      setActiveDropTargetId(over.id as string);
    } else {
      setActiveDropTargetId(null);
    }
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    setIsDragging(false);
    setDraggedEntryIds([]);
    setDraggedEntries([]);
    setDraggedCollection(null);
    setDraggedTags([]);
    setActiveDropTargetId(null);

    if (!over) return;

    const dragData = active.data.current as DragData;
    const dropData = over.data.current as DropData;

    // Handle entry drops
    if (dragData?.type === 'entries') {
      const { entryIds } = dragData;

      // Handle drop on collection
      if (dropData?.type === 'collection') {
        const { collectionId, collectionName } = dropData;

        try {
          // Add all entries to the collection
          for (const entryId of entryIds) {
            await addEntryToCollection(entryId, collectionId);
          }

          // Refresh collections to update counts
          const allCollections = await getCollections();
          setCollections(allCollections);

          // Invalidate entry to refresh info panel
          invalidateEntry();

          // Refresh library entries
          await refreshLibrary();

          // Show success message
          if (entryIds.length === 1) {
            toast.success(`Added to "${collectionName}"`);
          } else {
            toast.success(`Added ${entryIds.length} items to "${collectionName}"`);
          }
        } catch (err) {
          console.error('Failed to add entries to collection:', err);
          toast.error('Failed to add to collection');
        }
      }

      // Handle drop on trash - show confirmation
      if (dropData?.type === 'trash') {
        setPendingTrashDrop({ entryIds });
      }

      // Handle drop on tag
      if (dropData?.type === 'tag') {
        const { tagName } = dropData;

        try {
          // Add tag to all entries
          await addTagToEntries(tagName, entryIds);

          // Refresh tags to update counts
          const allTags = await getTags();
          setTags(allTags);

          // Invalidate entry to refresh info panel
          invalidateEntry();

          // Refresh library entries
          await refreshLibrary();

          // Show success message
          if (entryIds.length === 1) {
            toast.success(`Tagged with "${tagName}"`);
          } else {
            toast.success(`Tagged ${entryIds.length} items with "${tagName}"`);
          }
        } catch (err) {
          console.error('Failed to add tag to entries:', err);
          toast.error('Failed to add tag');
        }
      }
    }

    // Handle collection-to-collection drops (merge) - show confirmation
    if (dragData?.type === 'collectionDrag' && dropData?.type === 'collection') {
      const sourceId = dragData.collectionId;
      const sourceName = dragData.collectionName;
      const { collectionId: targetId, collectionName: targetName } = dropData;

      // Don't merge collection into itself
      if (sourceId === targetId) return;

      setPendingMerge({ sourceId, sourceName, targetId, targetName });
    }

    // Handle tag-to-tag drops (merge) - show confirmation
    if (dragData?.type === 'tagDrag' && dropData?.type === 'tag') {
      const { tags: sourceTags } = dragData;
      const { tagId: targetId, tagName: targetName } = dropData;

      // Filter out the target tag from sources (can't merge tag into itself)
      const filteredSourceTags = sourceTags.filter(t => t.id !== targetId);

      // Only proceed if there are tags to merge
      if (filteredSourceTags.length > 0) {
        setPendingTagMerge({
          sourceTags: filteredSourceTags.map(t => ({ id: t.id, name: t.name })),
          targetId,
          targetName,
        });
      }
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setIsDragging(false);
    setDraggedEntryIds([]);
    setDraggedEntries([]);
    setDraggedCollection(null);
    setDraggedTags([]);
    setActiveDropTargetId(null);
  }, []);

  // Handle confirmed trash drop
  const handleConfirmTrashDrop = useCallback(async () => {
    if (!pendingTrashDrop) return;

    const { entryIds } = pendingTrashDrop;
    setPendingTrashDrop(null);

    try {
      // Move all entries to trash
      for (const entryId of entryIds) {
        await deleteEntry(entryId);
      }

      // Clear selection since items are now in trash
      clearSelection();

      // Update trash count
      const trashCount = await getTrashCount();
      setTrashCount(trashCount);

      // Refresh library entries
      await refreshLibrary();

      // Show success message
      if (entryIds.length === 1) {
        toast.success('Moved to Trash');
      } else {
        toast.success(`Moved ${entryIds.length} items to Trash`);
      }
    } catch (err) {
      console.error('Failed to move entries to trash:', err);
      toast.error('Failed to move to Trash');
    }
  }, [pendingTrashDrop, clearSelection, setTrashCount, refreshLibrary]);

  // Handle confirmed merge
  const handleConfirmMerge = useCallback(async () => {
    if (!pendingMerge) return;

    const { sourceId, sourceName, targetId, targetName } = pendingMerge;
    setPendingMerge(null);

    try {
      // Merge source collection into target
      await mergeCollections(targetId, [sourceId]);

      // Refresh collections
      const allCollections = await getCollections();
      setCollections(allCollections);

      // If we were viewing the source collection, switch to target
      if (activeCollectionId === sourceId) {
        setActiveCollection(targetId);
      }

      // Refresh library entries
      await refreshLibrary();

      toast.success(`Merged "${sourceName}" into "${targetName}"`);
    } catch (err) {
      console.error('Failed to merge collections:', err);
      toast.error('Failed to merge collections');
    }
  }, [pendingMerge, setCollections, setActiveCollection, activeCollectionId, refreshLibrary]);

  // Handle confirmed tag merge
  const handleConfirmTagMerge = useCallback(async () => {
    if (!pendingTagMerge) return;

    const { sourceTags, targetId, targetName } = pendingTagMerge;
    setPendingTagMerge(null);

    try {
      // Merge source tags into target
      await mergeTags(targetId, sourceTags.map(t => t.id));

      // Refresh tags
      const allTags = await getTags();
      setTags(allTags);

      // Invalidate entry to refresh info panel (tags may have changed)
      invalidateEntry();

      // Refresh library entries
      await refreshLibrary();

      if (sourceTags.length === 1) {
        toast.success(`Merged "${sourceTags[0].name}" into "${targetName}"`);
      } else {
        toast.success(`Merged ${sourceTags.length} tags into "${targetName}"`);
      }
    } catch (err) {
      console.error('Failed to merge tags:', err);
      toast.error('Failed to merge tags');
    }
  }, [pendingTagMerge, setTags, invalidateEntry, refreshLibrary]);

  return (
    <DragDropReactContext.Provider value={{ isDragging, draggedEntryIds, draggedCollection, draggedTags, activeDropTargetId }}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}

        {/* Drag overlay shows what's being dragged */}
        <DragOverlay dropAnimation={null}>
          {isDragging && draggedEntries.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg shadow-lg">
              {draggedEntries.length === 1 ? (
                <>
                  <IconFileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium truncate max-w-[200px]">
                    {draggedEntries[0].title}
                  </span>
                </>
              ) : (
                <>
                  <IconFiles className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {draggedEntries.length} items
                  </span>
                </>
              )}
            </div>
          )}
          {isDragging && draggedCollection && (
            <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg shadow-lg">
              <FolderOpen
                className="h-4 w-4"
                fill={draggedCollection.color || 'transparent'}
                stroke={draggedCollection.color || 'currentColor'}
              />
              <span className="text-sm font-medium truncate max-w-[200px]">
                {draggedCollection.name}
              </span>
            </div>
          )}
          {isDragging && draggedTags.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg shadow-lg">
              {draggedTags.length === 1 ? (
                <>
                  <Tag
                    className="h-4 w-4"
                    style={{ color: draggedTags[0].color || 'currentColor' }}
                  />
                  <span className="text-sm font-medium truncate max-w-[200px]">
                    {draggedTags[0].name}
                  </span>
                </>
              ) : (
                <>
                  <Tags className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {draggedTags.length} tags
                  </span>
                </>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Trash Drop Confirmation Dialog */}
      <AlertDialog open={!!pendingTrashDrop} onOpenChange={(open) => !open && setPendingTrashDrop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTrashDrop?.entryIds.length === 1
                ? 'This item will be moved to trash. You can restore it later from the Trash.'
                : `${pendingTrashDrop?.entryIds.length} items will be moved to trash. You can restore them later from the Trash.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmTrashDrop}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Collections Confirmation Dialog */}
      <AlertDialog open={!!pendingMerge} onOpenChange={(open) => !open && setPendingMerge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Collections?</AlertDialogTitle>
            <AlertDialogDescription>
              All items from "{pendingMerge?.sourceName}" will be moved to "{pendingMerge?.targetName}".
              The "{pendingMerge?.sourceName}" collection will be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmMerge}>
              Merge Collections
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Tags Confirmation Dialog */}
      <AlertDialog open={!!pendingTagMerge} onOpenChange={(open) => !open && setPendingTagMerge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Tags?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTagMerge?.sourceTags.length === 1
                ? `All items tagged with "${pendingTagMerge?.sourceTags[0].name}" will be tagged with "${pendingTagMerge?.targetName}" instead. The "${pendingTagMerge?.sourceTags[0].name}" tag will be deleted.`
                : `All items from ${pendingTagMerge?.sourceTags.length} tags will be tagged with "${pendingTagMerge?.targetName}" instead. The source tags will be deleted.`}
              {' '}This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmTagMerge}>
              Merge Tags
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DragDropReactContext.Provider>
  );
}
