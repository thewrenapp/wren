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
import { cn } from '@/lib/utils';
import { ExportOptionsDialog } from '@/components/dialogs/ExportOptionsDialog';
import { type ExportOptions } from '@/services/tauri';

const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

interface TagDialogsProps {
  renameTag: { id: number; name: string; color?: string } | null;
  setRenameTag: (t: { id: number; name: string; color?: string } | null) => void;
  renameTagName: string;
  setRenameTagName: (name: string) => void;
  renameTagColor: string;
  setRenameTagColor: (color: string) => void;
  handleRenameTag: () => void;
  deleteTagConfirm: { id: number; name: string } | null;
  setDeleteTagConfirm: (t: { id: number; name: string } | null) => void;
  handleDeleteTag: () => void;
  showExportDialog: boolean;
  setShowExportDialog: (open: boolean) => void;
  exportContext: { type: 'tag'; id: number; name: string } | null;
  setExportContext: (c: { type: 'tag'; id: number; name: string } | null) => void;
  handleExportBiblatexWithFiles: (options: ExportOptions) => void;
  isExporting: boolean;
  tags: Array<{ id: number; itemCount?: number }>;
}

export function TagDialogs({
  renameTag,
  setRenameTag,
  renameTagName,
  setRenameTagName,
  renameTagColor,
  setRenameTagColor,
  handleRenameTag,
  deleteTagConfirm,
  setDeleteTagConfirm,
  handleDeleteTag,
  showExportDialog,
  setShowExportDialog,
  exportContext,
  setExportContext,
  handleExportBiblatexWithFiles,
  isExporting,
  tags,
}: TagDialogsProps) {
  return (
    <>
      <Dialog open={renameTag !== null} onOpenChange={(open) => !open && setRenameTag(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Tag</DialogTitle>
            <DialogDescription>Enter a new name for this tag.</DialogDescription>
          </DialogHeader>
          <div className='py-4 space-y-4'>
            <div>
              <Label htmlFor='rename-tag-name'>Name</Label>
              <Input
                id='rename-tag-name'
                value={renameTagName}
                onChange={(e) => setRenameTagName(e.target.value)}
                placeholder='Tag name...'
                className='mt-2'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameTag();
                }}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor='rename-tag-color'>Color</Label>
              <div className='flex items-center gap-2 mt-2'>
                <div className='flex gap-1'>
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type='button'
                      className={cn(
                        'w-6 h-6 rounded-full border-2 transition-all',
                        renameTagColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => setRenameTagColor(color)}
                    />
                  ))}
                </div>
                <Input
                  id='rename-tag-color'
                  type='color'
                  value={renameTagColor || '#808080'}
                  onChange={(e) => setRenameTagColor(e.target.value)}
                  className='w-10 h-6 p-0 border-0'
                />
                {renameTagColor && (
                  <Button variant='ghost' size='sm' className='h-6 px-2' onClick={() => setRenameTagColor('')}>
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
                setRenameTag(null);
                setRenameTagName('');
                setRenameTagColor('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRenameTag} disabled={!renameTagName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTagConfirm !== null} onOpenChange={(open) => !open && setDeleteTagConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Tag?</DialogTitle>
            <DialogDescription>
              This will remove the tag "{deleteTagConfirm?.name}" from all entries. The entries themselves will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTagConfirm(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteTag}>
              Delete Tag
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
        entryCount={exportContext ? (tags.find((t) => t.id === exportContext.id)?.itemCount ?? 0) : 0}
        isExporting={isExporting}
      />
    </>
  );
}
