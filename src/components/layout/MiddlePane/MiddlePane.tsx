import { useState, useEffect, useRef } from "react";
import { LayoutGrid, List, Plus, SortAsc, SortDesc, File, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore, type Attachment } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { useImport } from "@/hooks/useLibrarySync";
import { getEntryAttachments } from "@/services/tauri";
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
    expandedEntryIds,
    toggleEntryExpanded,
    isLoading,
    searchQuery,
    attachmentVersion,
  } = useLibraryStore();
  const { openTab } = useTabStore();
  const { importFiles, importFolder } = useImport();

  // State for fetched attachments (keyed by entry ID)
  const [attachmentsMap, setAttachmentsMap] = useState<Record<string, Attachment[]>>({});
  const fetchedEntryIdsRef = useRef<Set<string>>(new Set());

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

  // Filter entries based on active filter and search query
  const filteredEntries = entries.filter((entry) => {
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

  const handleEntryDoubleClick = (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (entry) {
      openTab({
        type: "entry",
        title: entry.title,
        entryId: entry.id,
      });
    }
  };

  // Attachment handlers
  const handleAttachmentClick = (entryId: string, _attachmentId: string) => {
    selectEntry(entryId);
  };

  const handleAttachmentDoubleClick = (entryId: string, attachmentId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    const attachment = attachmentsMap[entryId]?.find((a) => a.id === attachmentId);
    if (entry) {
      openTab({
        type: "entry",
        title: attachment?.title || entry.title,
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
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <p className="text-sm">Loading...</p>
          </div>
        ) : sortedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-4">
            <div className="text-center">
              <p className="text-sm">No entries</p>
              <p className="text-xs">Import PDFs to get started</p>
            </div>
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
          </div>
        ) : viewMode === "list" ? (
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
        ) : (
          <EntryCardView
            entries={sortedEntries}
            selectedIds={selectedEntryIds}
            onEntryClick={handleEntryClick}
            onEntryDoubleClick={handleEntryDoubleClick}
          />
        )}
      </ScrollArea>
    </div>
  );
}
