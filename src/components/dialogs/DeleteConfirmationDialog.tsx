import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { Trash2 } from "lucide-react";

export function DeleteConfirmationDialog() {
  const { deleteConfirmation, hideDeleteConfirmation } = useUIStore();
  const { open, entryIds, onConfirm } = deleteConfirmation;

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    hideDeleteConfirmation();
  };

  const handleCancel = () => {
    hideDeleteConfirmation();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30">
              <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <DialogTitle>Move to Trash?</DialogTitle>
              <DialogDescription className="mt-1">
                {entryIds.length === 1
                  ? "This entry will be moved to trash."
                  : `${entryIds.length} entries will be moved to trash.`}
                {" "}You can restore them later.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
