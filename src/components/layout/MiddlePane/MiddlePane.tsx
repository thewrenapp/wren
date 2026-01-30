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
import { useLibraryStore } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { useImport } from "@/hooks/useLibrarySync";
import { ItemListView } from "./ItemListView";
import { ItemCardView } from "./ItemCardView";
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
  const { items, selectedItemIds, selectItem, isLoading } = useLibraryStore();
  const { openTab } = useTabStore();
  const { importFiles, importFolder } = useImport();

  const handleImportFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (selected && Array.isArray(selected) && selected.length > 0) {
      await importFiles(selected);
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

  // Filter items based on active filter
  const filteredItems = items.filter((item) => {
    switch (activeFilter) {
      case "pdfs":
        return item.type === "pdf";
      case "notes":
        return item.type === "markdown";
      case "recent":
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return new Date(item.dateAdded) > weekAgo;
      case "untagged":
        return item.tags.length === 0;
      default:
        return true;
    }
  });

  // Sort items
  const sortedItems = [...filteredItems].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case "title":
        comparison = a.title.localeCompare(b.title);
        break;
      case "dateAdded":
        comparison = new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
        break;
      case "dateModified":
        comparison = new Date(a.dateModified).getTime() - new Date(b.dateModified).getTime();
        break;
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  const handleItemClick = (itemId: string, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      selectItem(itemId, true);
    } else {
      selectItem(itemId);
    }
  };

  const handleItemDoubleClick = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item) {
      openTab({
        type: "item",
        title: item.title,
        itemId: item.id,
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
            {sortedItems.length} item{sortedItems.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Sort button */}
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

          {/* View toggle */}
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

          {/* Import dropdown */}
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

      {/* Items */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <p className="text-sm">Loading...</p>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-4">
            <div className="text-center">
              <p className="text-sm">No items</p>
              <p className="text-xs">Import PDFs or create notes to get started</p>
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
          <ItemListView
            items={sortedItems}
            selectedIds={selectedItemIds}
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemDoubleClick}
          />
        ) : (
          <ItemCardView
            items={sortedItems}
            selectedIds={selectedItemIds}
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemDoubleClick}
          />
        )}
      </ScrollArea>
    </div>
  );
}
