import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Merge, Replace } from "lucide-react";

interface BackupImportModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: "merge" | "replace") => void;
}

export function BackupImportModeDialog({
  open,
  onOpenChange,
  onConfirm,
}: BackupImportModeDialogProps) {
  const [mode, setMode] = useState<"merge" | "replace">("merge");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import Library Backup</DialogTitle>
          <DialogDescription>
            Choose how to import the backup into your library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <button
            onClick={() => setMode("merge")}
            className={cn(
              "w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left",
              mode === "merge"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-accent"
            )}
          >
            <Merge className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-sm font-medium">Merge</div>
              <div className="text-xs text-muted-foreground">
                Add new entries and update existing ones. Nothing is deleted.
              </div>
            </div>
          </button>

          <button
            onClick={() => setMode("replace")}
            className={cn(
              "w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left",
              mode === "replace"
                ? "border-destructive bg-destructive/5"
                : "border-border hover:bg-accent"
            )}
          >
            <Replace className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-sm font-medium">Replace</div>
              <div className="text-xs text-muted-foreground">
                Remove all existing entries and replace with the backup.
              </div>
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={mode === "replace" ? "destructive" : "default"}
            onClick={() => onConfirm(mode)}
          >
            {mode === "merge" ? "Merge Import" : "Replace & Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
