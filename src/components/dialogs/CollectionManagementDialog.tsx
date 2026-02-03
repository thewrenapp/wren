import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Trash2,
  Search,
  Merge,
  Palette,
  X,
  Plus,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createCollection,
  deleteCollection,
  deleteCollectionWithEntries,
  getCollections,
  mergeCollections,
  bulkUpdateCollectionColor,
} from '@/services/tauri';
import { useLibraryStore } from '@/stores/libraryStore';
import { toast } from '@/stores/toastStore';

interface Collection {
  id: number;
  name: string;
  color?: string;
  itemCount: number;
}

interface CollectionManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Collection[];
}

type ActionMode = 'none' | 'create' | 'merge' | 'color' | 'delete';

const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

export function CollectionManagementDialog({ open, onOpenChange, collections }: CollectionManagementDialogProps) {
  const { setCollections, refreshLibrary } = useLibraryStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>('none');

  // Merge state
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [mergeName, setMergeName] = useState('');

  // Color state
  const [bulkColor, setBulkColor] = useState<string>('');

  // Create collection state
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionColor, setNewCollectionColor] = useState('');

  // Delete state
  const [deleteWithEntries, setDeleteWithEntries] = useState(false);

  // Filter collections based on search
  const filteredCollections = useMemo(() => {
    if (!searchQuery.trim()) return collections;
    const query = searchQuery.toLowerCase();
    return collections.filter((c) => c.name.toLowerCase().includes(query));
  }, [collections, searchQuery]);

  // Selected collections info
  const selectedCollections = useMemo(
    () => collections.filter((c) => selectedIds.has(c.id)),
    [collections, selectedIds]
  );

  const totalSelectedEntries = useMemo(
    () => selectedCollections.reduce((sum, c) => sum + c.itemCount, 0),
    [selectedCollections]
  );

  const toggleCollection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredCollections.map((c) => c.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const refreshAndReset = async () => {
    const allCollections = await getCollections();
    setCollections(allCollections);
    await refreshLibrary();
    setSelectedIds(new Set());
    setActionMode('none');
    setMergeTargetId(null);
    setMergeName('');
    setBulkColor('');
    setNewCollectionName('');
    setNewCollectionColor('');
    setDeleteWithEntries(false);
  };

  const handleStartCreate = () => {
    setNewCollectionName('');
    setNewCollectionColor('');
    setActionMode('create');
  };

  const handleConfirmCreate = async () => {
    const name = newCollectionName.trim();
    if (!name) {
      toast.error('Collection name is required');
      return;
    }
    if (collections.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error('A collection with this name already exists');
      return;
    }

    setIsProcessing(true);
    try {
      await createCollection({ name, color: newCollectionColor || undefined });
      await refreshAndReset();
      toast.success(`Created collection "${name}"`);
    } catch (err) {
      console.error('Failed to create collection:', err);
      toast.error('Failed to create collection');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartDelete = () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least 1 collection to delete');
      return;
    }
    setDeleteWithEntries(false);
    setActionMode('delete');
  };

  const handleConfirmDelete = async () => {
    if (selectedIds.size === 0) return;

    setIsProcessing(true);
    try {
      let deleted = 0;
      let entriesDeleted = 0;
      for (const id of selectedIds) {
        try {
          if (deleteWithEntries) {
            const count = await deleteCollectionWithEntries(id, true);
            entriesDeleted += count;
          } else {
            await deleteCollection(id);
          }
          deleted++;
        } catch (err) {
          console.error(`Failed to delete collection ${id}:`, err);
        }
      }
      await refreshAndReset();
      let message = `Deleted ${deleted} collection${deleted !== 1 ? 's' : ''}`;
      if (deleteWithEntries && entriesDeleted > 0) {
        message += ` and moved ${entriesDeleted} entries to trash`;
      }
      toast.success(message);
    } catch (err) {
      console.error('Failed to delete collections:', err);
      toast.error('Failed to delete collections');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartMerge = () => {
    if (selectedIds.size < 2) {
      toast.error('Select at least 2 collections to merge');
      return;
    }
    const firstCollection = selectedCollections[0];
    setMergeTargetId(firstCollection.id);
    setMergeName(firstCollection.name);
    setBulkColor(firstCollection.color || '');
    setActionMode('merge');
  };

  const handleConfirmMerge = async () => {
    if (!mergeTargetId || selectedIds.size < 2) return;

    setIsProcessing(true);
    try {
      const sourceIds = Array.from(selectedIds).filter((id) => id !== mergeTargetId);
      const targetCollection = collections.find((c) => c.id === mergeTargetId);
      const newName = mergeName.trim() !== targetCollection?.name ? mergeName.trim() : undefined;

      await mergeCollections(mergeTargetId, sourceIds, newName, bulkColor || undefined);
      await refreshAndReset();
      toast.success(`Merged ${sourceIds.length + 1} collections into "${mergeName || targetCollection?.name}"`);
    } catch (err) {
      console.error('Failed to merge collections:', err);
      toast.error('Failed to merge collections');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartColorEdit = () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least 1 collection to change color');
      return;
    }
    const firstCollection = selectedCollections[0];
    setBulkColor(firstCollection.color || '');
    setActionMode('color');
  };

  const handleConfirmColorEdit = async () => {
    if (selectedIds.size === 0) return;

    setIsProcessing(true);
    try {
      const collectionIds = Array.from(selectedIds);
      await bulkUpdateCollectionColor(collectionIds, bulkColor || undefined);
      await refreshAndReset();
      toast.success(`Updated color for ${collectionIds.length} collection${collectionIds.length !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Failed to update collection colors:', err);
      toast.error('Failed to update collection colors');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setSearchQuery('');
    setSelectedIds(new Set());
    setActionMode('none');
    setMergeTargetId(null);
    setMergeName('');
    setBulkColor('');
    setNewCollectionName('');
    setNewCollectionColor('');
    setDeleteWithEntries(false);
    onOpenChange(false);
  };

  const cancelAction = () => {
    setActionMode('none');
    setMergeTargetId(null);
    setMergeName('');
    setBulkColor('');
    setNewCollectionName('');
    setNewCollectionColor('');
    setDeleteWithEntries(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Manage Collections</DialogTitle>
          <DialogDescription>
            {collections.length} collection{collections.length !== 1 ? 's' : ''} total
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative flex-shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search collections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Selection actions */}
        <div className="flex items-center gap-2 text-sm flex-wrap flex-shrink-0">
          <span className="text-muted-foreground">Select:</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={selectAll}>
            All
          </Button>
          <span className="text-muted-foreground">|</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={selectNone}>
            None
          </Button>
          {selectedIds.size > 0 && (
            <Badge variant="secondary" className="ml-2">
              {selectedIds.size} selected
            </Badge>
          )}
        </div>

        {/* Scrollable content area */}
        <div className="min-h-[200px] max-h-[50vh] overflow-y-auto">
          <div className="flex flex-col gap-3 pr-1">

          {/* Action Panel - Create */}
          {actionMode === 'create' && (
            <div className="p-3 border rounded-md bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Create New Collection</span>
                <Button variant="ghost" size="icon-xs" onClick={cancelAction}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-collection-name" className="text-xs">Collection name:</Label>
                <Input
                  id="new-collection-name"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="Enter collection name..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isProcessing) {
                      handleConfirmCreate();
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Color (optional):</Label>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-all',
                          newCollectionColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setNewCollectionColor(color)}
                      />
                    ))}
                  </div>
                  <Input
                    type="color"
                    value={newCollectionColor || '#808080'}
                    onChange={(e) => setNewCollectionColor(e.target.value)}
                    className="w-10 h-6 p-0 border-0"
                  />
                  {newCollectionColor && (
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setNewCollectionColor('')}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={handleConfirmCreate}
                disabled={isProcessing || !newCollectionName.trim()}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Collection
              </Button>
            </div>
          )}

          {/* Action Panel - Delete */}
          {actionMode === 'delete' && (
            <div className="p-3 border rounded-md bg-destructive/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-destructive">Delete {selectedIds.size} collection{selectedIds.size !== 1 ? 's' : ''}</span>
                <Button variant="ghost" size="icon-xs" onClick={cancelAction}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Selected collections contain {totalSelectedEntries} {totalSelectedEntries === 1 ? 'entry' : 'entries'} total.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={deleteWithEntries}
                  onCheckedChange={(checked) => setDeleteWithEntries(checked === true)}
                />
                <span className="text-sm">Also delete entries (move to trash)</span>
              </label>
              {deleteWithEntries && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span>This will move {totalSelectedEntries} entries to trash</span>
                </div>
              )}
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={handleConfirmDelete}
                disabled={isProcessing}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Collection{selectedIds.size !== 1 ? 's' : ''}
              </Button>
            </div>
          )}

          {/* Action Panel - Merge */}
          {actionMode === 'merge' && (
            <div className="p-3 border rounded-md bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Merge {selectedIds.size} collections into one</span>
                <Button variant="ghost" size="icon-xs" onClick={cancelAction}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                All entries from the selected collections will be moved to a single collection.
                The other {selectedIds.size - 1} collection{selectedIds.size > 2 ? 's' : ''} will be deleted.
              </p>
              <div className="space-y-2">
                <Label htmlFor="merge-target" className="text-xs">Merge all into:</Label>
                <select
                  id="merge-target"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={mergeTargetId || ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setMergeTargetId(id);
                    const collection = collections.find((c) => c.id === id);
                    if (collection) setMergeName(collection.name);
                  }}
                >
                  {selectedCollections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name} ({collection.itemCount} {collection.itemCount === 1 ? 'entry' : 'entries'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="merge-name" className="text-xs">Rename to (optional):</Label>
                <Input
                  id="merge-name"
                  value={mergeName}
                  onChange={(e) => setMergeName(e.target.value)}
                  placeholder="Keep current name..."
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Set color (optional):</Label>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-all',
                          bulkColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setBulkColor(color)}
                      />
                    ))}
                  </div>
                  <Input
                    type="color"
                    value={bulkColor || '#808080'}
                    onChange={(e) => setBulkColor(e.target.value)}
                    className="w-10 h-6 p-0 border-0"
                  />
                  {bulkColor && (
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setBulkColor('')}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={handleConfirmMerge}
                disabled={isProcessing || !mergeTargetId}
              >
                <Merge className="h-4 w-4 mr-2" />
                Merge into "{mergeName}"
              </Button>
            </div>
          )}

          {/* Action Panel - Color */}
          {actionMode === 'color' && (
            <div className="p-3 border rounded-md bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Set color for {selectedIds.size} collections</span>
                <Button variant="ghost" size="icon-xs" onClick={cancelAction}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Choose color:</Label>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-all',
                          bulkColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setBulkColor(color)}
                      />
                    ))}
                  </div>
                  <Input
                    type="color"
                    value={bulkColor || '#808080'}
                    onChange={(e) => setBulkColor(e.target.value)}
                    className="w-10 h-6 p-0 border-0"
                  />
                  {bulkColor && (
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setBulkColor('')}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={handleConfirmColorEdit}
                disabled={isProcessing}
              >
                <Palette className="h-4 w-4 mr-2" />
                Apply Color
              </Button>
            </div>
          )}

          {/* Collection list */}
          <div className="border rounded-md">
            <div className="p-2 space-y-1">
              {filteredCollections.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  {searchQuery ? 'No collections match your search' : 'No collections yet'}
                </p>
              ) : (
                filteredCollections.map((collection) => (
                  <div
                    key={collection.id}
                    className={cn(
                      'flex items-center gap-3 px-2 py-1.5 rounded hover:bg-accent cursor-pointer',
                      selectedIds.has(collection.id) && 'bg-accent'
                    )}
                    onClick={() => toggleCollection(collection.id)}
                  >
                    <Checkbox
                      checked={selectedIds.has(collection.id)}
                      onCheckedChange={() => toggleCollection(collection.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <FolderOpen
                      className="h-4 w-4 flex-shrink-0"
                      fill={collection.color || 'transparent'}
                      stroke={collection.color || 'currentColor'}
                    />
                    <span className="flex-1 truncate">
                      {collection.name}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {collection.itemCount} {collection.itemCount === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t flex-shrink-0">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartCreate}
              disabled={actionMode !== 'none' || isProcessing}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartMerge}
              disabled={selectedIds.size < 2 || actionMode !== 'none' || isProcessing}
            >
              <Merge className="h-4 w-4 mr-1" />
              Merge
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartColorEdit}
              disabled={selectedIds.size === 0 || actionMode !== 'none' || isProcessing}
            >
              <Palette className="h-4 w-4 mr-1" />
              Color
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStartDelete}
              disabled={selectedIds.size === 0 || actionMode !== 'none' || isProcessing}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
