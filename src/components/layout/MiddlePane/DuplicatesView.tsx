import { useState, useEffect } from "react";
import { findDuplicates, mergeEntries, discardDuplicates, getTrashCount, type DuplicateGroup, type DuplicateEntry } from "@/services/tauri";
import { useLibraryStore } from "@/stores/libraryStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Check, Merge, AlertCircle, Loader2, Trash2, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toastStore";

export function DuplicatesView() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTargets, setSelectedTargets] = useState<Record<number, number>>({});
  const [processing, setProcessing] = useState<number | null>(null);
  const { refreshLibrary, setTrashCount } = useLibraryStore();

  // Load duplicate groups
  useEffect(() => {
    loadDuplicates();
  }, []);

  const loadDuplicates = async () => {
    setLoading(true);
    try {
      const duplicates = await findDuplicates();
      setGroups(duplicates);
      // Initialize selected targets to first entry in each group
      const targets: Record<number, number> = {};
      duplicates.forEach((group, i) => {
        if (group.entries.length > 0) {
          targets[i] = group.entries[0].id;
        }
      });
      setSelectedTargets(targets);
    } catch (err) {
      console.error("Failed to load duplicates:", err);
      toast.error("Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTarget = (groupIndex: number, entryId: number) => {
    setSelectedTargets(prev => ({ ...prev, [groupIndex]: entryId }));
  };

  const handleMerge = async (groupIndex: number) => {
    const group = groups[groupIndex];
    const targetId = selectedTargets[groupIndex];
    if (!targetId) return;

    const sourceIds = group.entries
      .filter(e => e.id !== targetId)
      .map(e => e.id);

    if (sourceIds.length === 0) return;

    setProcessing(groupIndex);
    try {
      await mergeEntries(targetId, sourceIds);
      toast.success("Entries merged successfully");
      // Remove merged group from state
      setGroups(prev => prev.filter((_, i) => i !== groupIndex));
      // Refresh library
      refreshLibrary();
    } catch (err) {
      console.error("Failed to merge entries:", err);
      toast.error("Failed to merge entries");
    } finally {
      setProcessing(null);
    }
  };

  const handleKeepAndDiscard = async (groupIndex: number) => {
    const group = groups[groupIndex];
    const keepId = selectedTargets[groupIndex];
    if (!keepId) return;

    const discardIds = group.entries
      .filter(e => e.id !== keepId)
      .map(e => e.id);

    if (discardIds.length === 0) return;

    setProcessing(groupIndex);
    try {
      await discardDuplicates(keepId, discardIds);
      toast.success("Kept selected entry, others moved to trash");
      // Remove group from state
      setGroups(prev => prev.filter((_, i) => i !== groupIndex));
      // Update trash count
      const count = await getTrashCount();
      setTrashCount(count);
      // Refresh library
      refreshLibrary();
    } catch (err) {
      console.error("Failed to discard duplicates:", err);
      toast.error("Failed to discard duplicates");
    } finally {
      setProcessing(null);
    }
  };

  const handleSkip = (groupIndex: number) => {
    // Simply remove the group from the view without any action
    setGroups(prev => prev.filter((_, i) => i !== groupIndex));
    toast.success("Skipped duplicate group");
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
        <Check className="h-12 w-12 mb-4 text-green-500" />
        <h2 className="text-lg font-medium mb-2">No Duplicates Found</h2>
        <p className="text-sm text-center max-w-md">
          Your library is clean! No duplicate entries were detected based on DOI or title matching.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <h2 className="text-sm font-semibold">
          {groups.length} Duplicate {groups.length === 1 ? "Group" : "Groups"} Found
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Select the entry to keep in each group, then merge to combine them.
        </p>
      </div>

      {/* Groups list */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {groups.map((group, groupIndex) => (
            <div key={groupIndex} className="border rounded-lg overflow-hidden">
              {/* Group header */}
              <div className="bg-muted/50 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">{group.matchReason}</span>
                </div>
              </div>

              {/* Entries */}
              <div className="divide-y">
                {group.entries.map((entry) => (
                  <DuplicateEntryRow
                    key={entry.id}
                    entry={entry}
                    isSelected={selectedTargets[groupIndex] === entry.id}
                    onSelect={() => handleSelectTarget(groupIndex, entry.id)}
                  />
                ))}
              </div>

              {/* Action buttons */}
              <div className="bg-muted/30 px-4 py-3 flex items-center gap-2 justify-end border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSkip(groupIndex)}
                  disabled={processing !== null}
                >
                  <SkipForward className="h-4 w-4 mr-1" />
                  Skip
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleKeepAndDiscard(groupIndex)}
                  disabled={processing !== null}
                >
                  {processing === groupIndex ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1" />
                  )}
                  Keep & Delete Others
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleMerge(groupIndex)}
                  disabled={processing !== null}
                >
                  {processing === groupIndex ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Merge className="h-4 w-4 mr-1" />
                  )}
                  Merge All
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface DuplicateEntryRowProps {
  entry: DuplicateEntry;
  isSelected: boolean;
  onSelect: () => void;
}

function DuplicateEntryRow({ entry, isSelected, onSelect }: DuplicateEntryRowProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 transition-colors",
        isSelected ? "bg-primary/10" : "hover:bg-muted/30"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Selection indicator */}
        <div className={cn(
          "mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30"
        )}>
          {isSelected && <Check className="h-3 w-3" />}
        </div>

        {/* Entry details */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-2">{entry.title}</p>
          {entry.creatorsDisplay && (
            <p className="text-xs text-muted-foreground mt-1">{entry.creatorsDisplay}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            {entry.date && <span>{entry.date}</span>}
            {entry.doi && <span className="truncate max-w-[200px]">DOI: {entry.doi}</span>}
            <span>{entry.attachmentCount} {entry.attachmentCount === 1 ? "file" : "files"}</span>
          </div>
        </div>

        {/* Keep indicator */}
        {isSelected && (
          <span className="px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded">
            Keep
          </span>
        )}
      </div>
    </button>
  );
}
