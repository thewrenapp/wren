import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExportOptionsDialog } from '@/components/dialogs/ExportOptionsDialog';
import { type ExportOptions } from '@/services/tauri';

const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

interface CollectionDialogsProps {
  newCollectionDialogOpen: boolean;
  setNewCollectionDialogOpen: (open: boolean) => void;
  newCollectionName: string;
  setNewCollectionName: (name: string) => void;
  newCollectionColor: string;
  setNewCollectionColor: (color: string) => void;
  handleCreateCollection: () => void;
  renameCollection: { id: number; name: string; color?: string } | null;
  setRenameCollection: (c: { id: number; name: string; color?: string } | null) => void;
  renameCollectionName: string;
  setRenameCollectionName: (name: string) => void;
  renameCollectionColor: string;
  setRenameCollectionColor: (color: string) => void;
  handleRenameCollection: () => void;
  showExportDialog: boolean;
  setShowExportDialog: (open: boolean) => void;
  exportContext: { type: 'collection'; id: number; name: string } | null;
  setExportContext: (c: { type: 'collection'; id: number; name: string } | null) => void;
  handleExportBiblatexWithFiles: (options: ExportOptions) => void;
  isExporting: boolean;
  collections: Array<{ id: number; itemCount?: number }>;
}

export function CollectionDialogs({
  newCollectionDialogOpen,
  setNewCollectionDialogOpen,
  newCollectionName,
  setNewCollectionName,
  newCollectionColor,
  setNewCollectionColor,
  handleCreateCollection,
  renameCollection,
  setRenameCollection,
  renameCollectionName,
  setRenameCollectionName,
  renameCollectionColor,
  setRenameCollectionColor,
  handleRenameCollection,
  showExportDialog,
  setShowExportDialog,
  exportContext,
  setExportContext,
  handleExportBiblatexWithFiles,
  isExporting,
  collections,
}: CollectionDialogsProps) {
  return (
    <>
      <Dialog open={newCollectionDialogOpen} onOpenChange={setNewCollectionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Collection</DialogTitle>
            <DialogDescription>
              Create a new collection to organize your references.
            </DialogDescription>
          </DialogHeader>
          <div className='py-4 space-y-4'>
            <div>
              <Label htmlFor='collection-name'>Name</Label>
              <Input
                id='collection-name'
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder='Collection name...'
                className='mt-2'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateCollection();
                }}
                autoFocus
              />
            </div>
            <div>
              <Label>Color (optional)</Label>
              <div className='flex items-center gap-2 mt-2'>
                <div className='flex gap-1'>
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type='button'
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        newCollectionColor === color
                          ? 'border-foreground scale-110'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewCollectionColor(color)}
                    />
                  ))}
                </div>
                {newCollectionColor && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setNewCollectionColor('')}
                    className='text-muted-foreground h-6 px-2'
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setNewCollectionDialogOpen(false);
                setNewCollectionName('');
                setNewCollectionColor('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateCollection} disabled={!newCollectionName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameCollection !== null}
        onOpenChange={(open) => !open && setRenameCollection(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
            <DialogDescription>Update the collection name and color.</DialogDescription>
          </DialogHeader>
          <div className='py-4 space-y-4'>
            <div>
              <Label htmlFor='rename-collection-name'>Name</Label>
              <Input
                id='rename-collection-name'
                value={renameCollectionName}
                onChange={(e) => setRenameCollectionName(e.target.value)}
                placeholder='Collection name...'
                className='mt-2'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameCollection();
                }}
                autoFocus
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className='flex items-center gap-2 mt-2'>
                <div className='flex gap-1'>
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type='button'
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        renameCollectionColor === color
                          ? 'border-foreground scale-110'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setRenameCollectionColor(color)}
                    />
                  ))}
                </div>
                {renameCollectionColor && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setRenameCollectionColor('')}
                    className='text-muted-foreground h-6 px-2'
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setRenameCollection(null);
                setRenameCollectionName('');
                setRenameCollectionColor('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRenameCollection} disabled={!renameCollectionName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExportOptionsDialog
        open={showExportDialog}
        onClose={() => {
          setShowExportDialog(false);
          setExportContext(null);
        }}
        onExport={handleExportBiblatexWithFiles}
        entryCount={exportContext ? (collections.find((c) => c.id === exportContext.id)?.itemCount ?? 0) : 0}
        isExporting={isExporting}
      />
    </>
  );
}
