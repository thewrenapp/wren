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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createTag, deleteTag, getTags, mergeTags, bulkUpdateTagColor } from '@/services/tauri';
import { useLibraryStore } from '@/stores/libraryStore';
import { toast } from '@/stores/toastStore';

interface Tag {
  id: number;
  name: string;
  color?: string;
  itemCount: number;
  isImported: boolean;
}

interface TagManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: Tag[];
}

type ActionMode = 'none' | 'create' | 'merge' | 'color';

const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

export function TagManagementDialog({ open, onOpenChange, tags }: TagManagementDialogProps) {
  const { setTags, refreshLibrary } = useLibraryStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>('none');

  // Merge state
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [mergeName, setMergeName] = useState('');

  // Color state
  const [bulkColor, setBulkColor] = useState<string>('');

  // Create tag state
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('');

  // Filter tags based on search
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tags;
    const query = searchQuery.toLowerCase();
    return tags.filter((tag) => tag.name.toLowerCase().includes(query));
  }, [tags, searchQuery]);

  // Stats
  const importedCount = tags.filter((t) => t.isImported).length;
  const userCount = tags.length - importedCount;

  // Selected tags info
  const selectedTags = useMemo(
    () => tags.filter((t) => selectedIds.has(t.id)),
    [tags, selectedIds]
  );

  const toggleTag = (id: number) => {
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
    setSelectedIds(new Set(filteredTags.map((t) => t.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const selectImported = () => {
    setSelectedIds(new Set(tags.filter((t) => t.isImported).map((t) => t.id)));
  };

  const refreshAndReset = async () => {
    const allTags = await getTags();
    setTags(allTags);
    await refreshLibrary();
    setSelectedIds(new Set());
    setActionMode('none');
    setMergeTargetId(null);
    setMergeName('');
    setBulkColor('');
    setNewTagName('');
    setNewTagColor('');
  };

  const handleStartCreate = () => {
    setNewTagName('');
    setNewTagColor('');
    setActionMode('create');
  };

  const handleConfirmCreate = async () => {
    const name = newTagName.trim();
    if (!name) {
      toast.error('Tag name is required');
      return;
    }
    // Check for duplicate
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error('A tag with this name already exists');
      return;
    }

    setIsProcessing(true);
    try {
      await createTag(name, newTagColor || undefined);
      await refreshAndReset();
      toast.success(`Created tag "${name}"`);
    } catch (err) {
      console.error('Failed to create tag:', err);
      toast.error('Failed to create tag');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;

    setIsProcessing(true);
    try {
      let deleted = 0;
      for (const id of selectedIds) {
        try {
          await deleteTag(id);
          deleted++;
        } catch (err) {
          console.error(`Failed to delete tag ${id}:`, err);
        }
      }
      await refreshAndReset();
      toast.success(`Deleted ${deleted} tag${deleted !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Failed to delete tags:', err);
      toast.error('Failed to delete tags');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartMerge = () => {
    if (selectedIds.size < 2) {
      toast.error('Select at least 2 tags to merge');
      return;
    }
    // Default target is the first selected tag
    const firstTag = selectedTags[0];
    setMergeTargetId(firstTag.id);
    setMergeName(firstTag.name);
    setActionMode('merge');
  };

  const handleConfirmMerge = async () => {
    if (!mergeTargetId || selectedIds.size < 2) return;

    setIsProcessing(true);
    try {
      const sourceIds = Array.from(selectedIds).filter((id) => id !== mergeTargetId);
      const targetTag = tags.find((t) => t.id === mergeTargetId);
      const newName = mergeName.trim() !== targetTag?.name ? mergeName.trim() : undefined;

      await mergeTags(mergeTargetId, sourceIds, newName, bulkColor || undefined);
      await refreshAndReset();
      toast.success(`Merged ${sourceIds.length + 1} tags into "${mergeName || targetTag?.name}"`);
    } catch (err) {
      console.error('Failed to merge tags:', err);
      toast.error('Failed to merge tags');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartColorEdit = () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least 1 tag to change color');
      return;
    }
    // Default to first selected tag's color
    const firstTag = selectedTags[0];
    setBulkColor(firstTag.color || '');
    setActionMode('color');
  };

  const handleConfirmColorEdit = async () => {
    if (selectedIds.size === 0) return;

    setIsProcessing(true);
    try {
      const tagIds = Array.from(selectedIds);
      await bulkUpdateTagColor(tagIds, bulkColor || undefined);
      await refreshAndReset();
      toast.success(`Updated color for ${tagIds.length} tag${tagIds.length !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Failed to update tag colors:', err);
      toast.error('Failed to update tag colors');
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
    setNewTagName('');
    setNewTagColor('');
    onOpenChange(false);
  };

  const cancelAction = () => {
    setActionMode('none');
    setMergeTargetId(null);
    setMergeName('');
    setBulkColor('');
    setNewTagName('');
    setNewTagColor('');
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Manage Tags</DialogTitle>
          <DialogDescription>
            {tags.length} tags total: {importedCount} imported, {userCount} user-created
          </DialogDescription>
        </DialogHeader>

        {/* Search - fixed at top */}
        <div className="relative flex-shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Selection actions - fixed */}
        <div className="flex items-center gap-2 text-sm flex-wrap flex-shrink-0">
          <span className="text-muted-foreground">Select:</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={selectAll}>
            All
          </Button>
          <span className="text-muted-foreground">|</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={selectNone}>
            None
          </Button>
          <span className="text-muted-foreground">|</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={selectImported}>
            Imported
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

          {/* Action Panel */}
          {actionMode === 'create' && (
            <div className="p-3 border rounded-md bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Create New Tag</span>
                <Button variant="ghost" size="icon-xs" onClick={cancelAction}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-tag-name" className="text-xs">Tag name:</Label>
                <Input
                  id="new-tag-name"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Enter tag name..."
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
                          newTagColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setNewTagColor(color)}
                      />
                    ))}
                  </div>
                  <Input
                    type="color"
                    value={newTagColor || '#808080'}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="w-10 h-6 p-0 border-0"
                  />
                  {newTagColor && (
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setNewTagColor('')}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={handleConfirmCreate}
                disabled={isProcessing || !newTagName.trim()}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Tag
              </Button>
            </div>
          )}

          {actionMode === 'merge' && (
            <div className="p-3 border rounded-md bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Merge {selectedIds.size} tags into one</span>
                <Button variant="ghost" size="icon-xs" onClick={cancelAction}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                All entries with the selected tags will be reassigned to a single tag.
                The other {selectedIds.size - 1} tag{selectedIds.size > 2 ? 's' : ''} will be deleted.
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
                    const tag = tags.find((t) => t.id === id);
                    if (tag) setMergeName(tag.name);
                  }}
                >
                  {selectedTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name} ({tag.itemCount} {tag.itemCount === 1 ? 'entry' : 'entries'})
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

          {actionMode === 'color' && (
            <div className="p-3 border rounded-md bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Set color for {selectedIds.size} tags</span>
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

          {/* Tag list */}
          <div className="border rounded-md">
            <div className="p-2 space-y-1">
              {filteredTags.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  {searchQuery ? 'No tags match your search' : 'No tags yet'}
                </p>
              ) : (
                filteredTags.map((tag) => (
                  <div
                    key={tag.id}
                    className={cn(
                      'flex items-center gap-3 px-2 py-1.5 rounded hover:bg-accent cursor-pointer',
                      selectedIds.has(tag.id) && 'bg-accent'
                    )}
                    onClick={() => toggleTag(tag.id)}
                  >
                    <Checkbox
                      checked={selectedIds.has(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="flex items-center justify-center w-4 h-4">
                      <span
                        className={cn(
                          'w-2.5 h-2.5 rounded-full',
                          tag.isImported && !tag.color && 'border border-dashed border-muted-foreground/60',
                        )}
                        style={{
                          backgroundColor: tag.color || (tag.isImported ? 'transparent' : '#6b7280'),
                        }}
                      />
                    </span>
                    <span className="flex-1 truncate">
                      {tag.name}
                      {tag.isImported && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground/70 uppercase">imported</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {tag.itemCount} {tag.itemCount === 1 ? 'entry' : 'entries'}
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
              onClick={handleDeleteSelected}
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
