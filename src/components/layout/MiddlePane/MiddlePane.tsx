import { useState, useEffect, useRef, useCallback } from "react";
import { LayoutGrid, List, Plus, SortAsc, SortDesc, File, FolderOpen, RotateCcw, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore, type Attachment } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { useImport, useLibrarySync } from "@/hooks/useLibrarySync";
import { getEntryAttachments, getTrashedEntries, restoreEntry, emptyTrash, getTrashCount } from "@/services/tauri";
import { EntryTable } from "./EntryTable";
import { EntryCardView } from "./EntryCardView";
import { ColumnConfigDropdown } from "./ColumnConfigDropdown";
import { QuickSearchBar } from "./QuickSearchBar";
import { cn } from "@/lib/utils";

export function MiddlePane() {
  const {
    viewMode,
    setViewMode,
    sortField,
    sortDirection,
    setSort,
    activeFilter,
  } = useUIStore();
  const {
    entries,
    selectedEntryIds,
    selectEntry,
    clearSelection,
    expandedEntryIds,
    toggleEntryExpanded,
    isLoading,
    searchQuery,
    attachmentVersion,
    trashedEntries,
    setTrashedEntries,
    setTrashCount,
  } = useLibraryStore();
  const { openTab } = useTabStore();
  const { importFiles, importFolder } = useImport();
  const { refresh } = useLibrarySync();

  // Trash state
  const [showEmptyTrashDialog, setShowEmptyTrashDialog] = useState(false);
  const [isTrashLoading, setIsTrashLoading] = useState(false);

  // State for fetched attachments (keyed by entry ID)
  const [attachmentsMap, setAttachmentsMap] = useState<Record<string, Attachment[]>>({});
  const fetchedEntryIdsRef = useRef<Set<string>>(new Set());

  // Load trashed entries when filter changes to trash
  const loadTrashedEntries = useCallback(async () => {
    setIsTrashLoading(true);
    try {
      const trashed = await getTrashedEntries();
      const mappedTrashed = trashed.map((entry) => ({
        ...entry,
        id: String(entry.id),
        tags: entry.tags.map((t) => ({ ...t, id: String(t.id) })),
      }));
      setTrashedEntries(mappedTrashed);
    } catch (err) {
      console.error("Failed to load trashed entries:", err);
    } finally {
      setIsTrashLoading(false);
    }
  }, [setTrashedEntries]);

  useEffect(() => {
    if (activeFilter === "trash") {
      loadTrashedEntries();
    }
  }, [activeFilter, loadTrashedEntries]);

  // Trash actions
  const handleRestoreSelected = async () => {
    for (const id of selectedEntryIds) {
      try {
        await restoreEntry(Number(id));
      } catch (err) {
        console.error(`Failed to restore entry ${id}:`, err);
      }
    }
    clearSelection();
    await loadTrashedEntries();
    const count = await getTrashCount();
    setTrashCount(count);
    await refresh();
  };

  const handleEmptyTrash = async () => {
    setShowEmptyTrashDialog(false);
    try {
      await emptyTrash();
      setTrashedEntries([]);
      setTrashCount(0);
    } catch (err) {
      console.error("Failed to empty trash:", err);
    }
  };

  // Clear attachment cache when version changes (e.g., after adding an attachment)
  useEffect(() => {
    if (attachmentVersion > 0) {
      fetchedEntryIdsRef.current.clear();
      setAttachmentsMap({});
    }
  }, [attachmentVersion]);

  // Fetch attachments when entries are expanded or cache is invalidated
  useEffect(() => {
    const fetchAttachments = async () => {
      for (const entryId of expandedEntryIds) {
        // Skip if already fetched
        if (fetchedEntryIdsRef.current.has(entryId)) continue;
        fetchedEntryIdsRef.current.add(entryId);

        try {
          const attachments = await getEntryAttachments(Number(entryId));
          setAttachmentsMap((prev) => ({
            ...prev,
            [entryId]: attachments.map((a) => ({
              ...a,
              id: String(a.id),
              entryId: String(a.entryId),
            })),
          }));
        } catch (err) {
          console.error(`Failed to fetch attachments for entry ${entryId}:`, err);
          fetchedEntryIdsRef.current.delete(entryId);
        }
      }
    };

    fetchAttachments();
  }, [expandedEntryIds, attachmentVersion]);

  const handleImportFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        await importFiles(selected);
      }
    } catch (err) {
      console.error("Import error:", err);
    }
  };

  const handleImportFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (selected && typeof selected === "string") {
      await importFolder(selected);
    }
  };

  // Determine which entries to display (regular or trashed)
  const isTrashView = activeFilter === "trash";
  const displayEntries = isTrashView ? trashedEntries : entries;

  // Filter entries based on active filter and search query
  const filteredEntries = displayEntries.filter((entry) => {
    // Skip sidebar filter for trash view (already showing trash)
    if (!isTrashView) {
      // Apply sidebar filter
      let matchesFilter = true;
      switch (activeFilter) {
        case "pdfs":
          matchesFilter = entry.hasPdf;
          break;
        case "notes":
          matchesFilter = entry.hasNote;
          break;
        case "recent":
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          matchesFilter = new Date(entry.dateAdded) > weekAgo;
          break;
        case "untagged":
          matchesFilter = entry.tags.length === 0;
          break;
      }

      if (!matchesFilter) return false;
    }

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        entry.title.toLowerCase().includes(query) ||
        (entry.creatorsDisplay?.toLowerCase().includes(query) ?? false) ||
        entry.tags.some((tag) => tag.name.toLowerCase().includes(query)) ||
        (entry.year?.includes(query) ?? false);
      return matchesSearch;
    }

    return true;
  });

  // Sort entries
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case "title":
        comparison = a.title.localeCompare(b.title);
        break;
      case "creator":
        comparison = (a.creatorsDisplay || "").localeCompare(b.creatorsDisplay || "");
        break;
      case "year":
        comparison = (a.year || "").localeCompare(b.year || "");
        break;
      case "dateAdded":
        comparison = new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
        break;
      default:
        comparison = new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  // Entry handlers
  const handleEntryClick = (entryId: string, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      selectEntry(entryId, true);
    } else {
      selectEntry(entryId);
    }
  };

  const handleEntryDoubleClick = async (entryId: string) => {
    console.log("handleEntryDoubleClick called with entryId:", entryId);

    // Don't open trashed entries - user should restore first
    if (isTrashView) {
      console.log("In trash view, returning early");
      return;
    }

    // Find entry from the displayed entries, not just the store entries
    const entry = sortedEntries.find((e) => e.id === entryId);
    console.log("Found entry:", entry);
    if (!entry) {
      console.log("Entry not found, returning early");
      return;
    }

    // Get attachments - from cache or fetch
    let attachments = attachmentsMap[entryId];
    console.log("Cached attachments:", attachments);
    if (!attachments) {
      try {
        console.log("Fetching attachments for entry:", entryId);
        const fetched = await getEntryAttachments(Number(entryId));
        console.log("Fetched attachments:", fetched);
        attachments = fetched.map((a) => ({
          ...a,
          id: String(a.id),
          entryId: String(a.entryId),
        }));
        setAttachmentsMap((prev) => ({ ...prev, [entryId]: attachments! }));
      } catch (err) {
        console.error("Failed to fetch attachments:", err);
        // Fallback: just open entry tab
        openTab({ type: "entry", title: entry.title, entryId: entry.id });
        return;
      }
    }

    // Determine which attachment to open based on filter
    let targetAttachment: Attachment | undefined;

    if (activeFilter === "notes") {
      // Notes filter: only open notes
      targetAttachment = attachments.find((a) => a.attachmentType === "note");
    } else if (activeFilter === "pdfs") {
      // PDFs filter: only open PDFs
      targetAttachment = attachments.find((a) => a.attachmentType === "pdf");
    } else {
      // For "all", "recent", "untagged", collections, etc.
      // Priority: PDF > Note > Weblink
      targetAttachment =
        attachments.find((a) => a.attachmentType === "pdf") ||
        attachments.find((a) => a.attachmentType === "note") ||
        attachments.find((a) => a.attachmentType === "weblink");
    }

    console.log("Target attachment:", targetAttachment);

    if (targetAttachment) {
      if (targetAttachment.attachmentType === "weblink" && targetAttachment.url) {
        // Open weblink in browser
        try {
          await openInBrowser(targetAttachment.url);
        } catch (err) {
          console.error("Failed to open URL:", err);
        }
      } else {
        // Open PDF or note in app tab
        console.log("Opening tab for attachment:", targetAttachment.id);
        openTab({
          type: "entry",
          title: targetAttachment.title || entry.title,
          entryId: entry.id,
          attachmentId: targetAttachment.id,
        });
      }
    } else {
      // No matching attachment, just open entry details
      console.log("No attachment found, opening entry details");
      openTab({ type: "entry", title: entry.title, entryId: entry.id });
    }
  };

  // Attachment handlers
  const handleAttachmentClick = (entryId: string, _attachmentId: string) => {
    selectEntry(entryId);
  };

  const handleAttachmentDoubleClick = async (entryId: string, attachmentId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    const attachment = attachmentsMap[entryId]?.find((a) => a.id === attachmentId);
    if (!entry || !attachment) return;

    if (attachment.attachmentType === "weblink" && attachment.url) {
      // Open weblink in browser
      try {
        await openInBrowser(attachment.url);
      } catch (err) {
        console.error("Failed to open URL:", err);
      }
    } else {
      // Open PDF or note in app tab
      openTab({
        type: "entry",
        title: attachment.title || entry.title,
        entryId: entry.id,
        attachmentId: attachmentId,
      });
    }
  };

  const getFilterTitle = () => {
    switch (activeFilter) {
      case "pdfs":
        return "PDFs";
      case "notes":
        return "Notes";
      case "recent":
        return "Recently Added";
      case "untagged":
        return "Untagged";
      case "trash":
        return "Trash";
      default:
        return "All Items";
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm">{getFilterTitle()}</h2>
          <span className="text-xs text-muted-foreground">
            {sortedEntries.length} {sortedEntries.length !== 1 ? "entries" : "entry"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Trash actions */}
          {isTrashView && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestoreSelected}
                disabled={selectedEntryIds.length === 0}
                className="h-7"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Restore
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowEmptyTrashDialog(true)}
                disabled={trashedEntries.length === 0}
                className="h-7"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Empty Trash
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}

          <QuickSearchBar />

          {viewMode === "list" && <ColumnConfigDropdown />}

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSort(sortField)}
            className="h-7 w-7"
            title={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
          >
            {sortDirection === "asc" ? (
              <SortAsc className="h-4 w-4" />
            ) : (
              <SortDesc className="h-4 w-4" />
            )}
          </Button>

          <div className="flex items-center border rounded-md">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewMode("list")}
              className={cn(
                "h-7 w-7 rounded-r-none",
                viewMode === "list" && "bg-accent"
              )}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewMode("card")}
              className={cn(
                "h-7 w-7 rounded-l-none",
                viewMode === "card" && "bg-accent"
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>

          {/* Hide import button in trash view */}
          {!isTrashView && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="h-7 w-7" disabled={isLoading}>
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleImportFiles}>
                  <File className="h-4 w-4 mr-2" />
                  Import PDFs...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleImportFolder}>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Import Folder...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content */}
      {(isLoading || isTrashLoading) ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Loading...</p>
        </div>
      ) : sortedEntries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
          <div className="text-center">
            {isTrashView ? (
              <>
                <Trash2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Trash is empty</p>
                <p className="text-xs">Deleted items will appear here</p>
              </>
            ) : (
              <>
                <p className="text-sm">No entries</p>
                <p className="text-xs">Import PDFs to get started</p>
              </>
            )}
          </div>
          {!isTrashView && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleImportFiles}>
                <File className="h-4 w-4 mr-2" />
                Import PDFs
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportFolder}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Import Folder
              </Button>
            </div>
          )}
        </div>
      ) : viewMode === "list" ? (
        <div className="flex-1 overflow-hidden">
          <EntryTable
            entries={sortedEntries}
            selectedIds={selectedEntryIds}
            expandedIds={expandedEntryIds}
            onEntryClick={handleEntryClick}
            onEntryDoubleClick={handleEntryDoubleClick}
            onToggleExpand={toggleEntryExpanded}
            attachmentsMap={attachmentsMap}
            onAttachmentClick={handleAttachmentClick}
            onAttachmentDoubleClick={handleAttachmentDoubleClick}
          />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <EntryCardView
            entries={sortedEntries}
            selectedIds={selectedEntryIds}
            onEntryClick={handleEntryClick}
            onEntryDoubleClick={handleEntryDoubleClick}
          />
        </ScrollArea>
      )}

      {/* Empty Trash Confirmation Dialog */}
      <Dialog open={showEmptyTrashDialog} onOpenChange={setShowEmptyTrashDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empty Trash?</DialogTitle>
            <DialogDescription>
              This will permanently delete {trashedEntries.length} {trashedEntries.length === 1 ? "item" : "items"} and their files.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmptyTrashDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleEmptyTrash}>
              Empty Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
