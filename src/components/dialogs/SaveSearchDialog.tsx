import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { createSavedSearch, updateSavedSearch } from '@/services/tauri';
import { useLibraryStore } from '@/stores/libraryStore';
import { toast } from '@/stores/toastStore';
import type { SavedSearchCriterion, SavedSearch } from '@/types/schema';

interface SaveSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // For creating new saved search
  matchMode: 'all' | 'any';
  criteria: SavedSearchCriterion[];
  scope: 'all' | 'collection';
  collectionId?: number;
  // For editing existing saved search
  existingSearch?: SavedSearch;
  onSuccess?: (savedSearch: SavedSearch) => void;
}

export function SaveSearchDialog({
  open,
  onOpenChange,
  matchMode,
  criteria,
  scope,
  collectionId,
  existingSearch,
  onSuccess,
}: SaveSearchDialogProps) {
  const { addSavedSearch, updateSavedSearch: updateSearchInStore } = useLibraryStore();
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = !!existingSearch;

  useEffect(() => {
    if (open && existingSearch) {
      setName(existingSearch.name);
    } else if (open) {
      setName('');
    }
  }, [open, existingSearch]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Please enter a name for the search');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing && existingSearch) {
        const updated = await updateSavedSearch(existingSearch.id, {
          name: trimmedName,
          matchMode,
          criteria,
          scope,
          collectionId: scope === 'collection' ? collectionId : undefined,
        });
        updateSearchInStore(existingSearch.id, updated);
        toast.success(`Updated saved search "${trimmedName}"`);
        onSuccess?.(updated);
      } else {
        const created = await createSavedSearch({
          name: trimmedName,
          matchMode,
          criteria,
          scope,
          collectionId: scope === 'collection' ? collectionId : undefined,
        });
        addSavedSearch(created);
        toast.success(`Saved search "${trimmedName}" created`);
        onSuccess?.(created);
      }
      onOpenChange(false);
      setName('');
    } catch (err) {
      console.error('Failed to save search:', err);
      toast.error(isEditing ? 'Failed to update saved search' : 'Failed to create saved search');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Update Saved Search' : 'Save Search'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the name for this saved search.'
              : 'Save these search criteria as a Smart Filter for quick access.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div>
            <Label htmlFor="search-name">Name</Label>
            <Input
              id="search-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Machine Learning Papers 2020+"
              className="mt-2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isSaving) {
                  handleSave();
                }
              }}
            />
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <strong>Match:</strong> {matchMode === 'all' ? 'All criteria (AND)' : 'Any criterion (OR)'}
            </p>
            <p>
              <strong>Criteria:</strong> {criteria.length} condition{criteria.length !== 1 ? 's' : ''}
            </p>
            <p>
              <strong>Scope:</strong> {scope === 'collection' ? 'Within collection' : 'Entire library'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? 'Update' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
