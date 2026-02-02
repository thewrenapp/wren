import {
  FileText,
  Files,
  Clock,
  Tag,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  FilePlus,
  Download,
  FolderPlus,
  FileJson,
  FileCode,
  Copy,
  Pencil,
  Copy as CopyIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { emptyTrash, createCollection, deleteCollection, updateCollection, getCollections, exportAllToBibtex, exportAllToCslJson, exportToBibtex, exportToCslJson, getEntries, updateTag, getTags, getDuplicateCount } from "@/services/tauri";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { filterEntriesByType, type FilterType } from "@/lib/filters";
import { toast } from "@/stores/toastStore";

// Map filter to display title
function getFilterTitle(filter: string): string {
  switch (filter) {
    case "pdfs":
      return "PDFs";
    case "notes":
      return "Notes";
    case "recent":
      return "Recently Added";
    case "untagged":
      return "Untagged";
    case "duplicates":
      return "Duplicates";
    case "trash":
      return "Trash";
    default:
      return "Library";
  }
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  allowContextMenu?: boolean;
}

function SidebarItem({ icon, label, count, active, onClick, allowContextMenu = false }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      onContextMenu={allowContextMenu ? undefined : (e) => e.preventDefault()}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
        "hover:bg-sidebar-accent",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/80"
      )}
    >
      <span className="flex-shrink-0 w-4 h-4">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onAdd?: () => void;
  contextMenuContent?: React.ReactNode;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  onAdd,
  contextMenuContent,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const headerContent = (
    <div className="flex items-center gap-1 px-2 py-1 group" onContextMenu={contextMenuContent ? undefined : (e) => e.preventDefault()}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 flex-1 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {onAdd && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100"
        >
          <Plus className="h-3 w-3" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="mb-2">
      {contextMenuContent ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {headerContent}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            {contextMenuContent}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        headerContent
      )}
      {isOpen && <div className="space-y-0.5 px-1">{children}</div>}
    </div>
  );
}

export function LibrarySidebar() {
  const { activeFilter, setActiveFilter, newCollectionDialogOpen, setNewCollectionDialogOpen } = useUIStore();
  const { collections, tags, entries, trashCount, setTrashCount, setTrashedEntries, setCollections, setActiveTag, setActiveCollection, activeTagId, activeCollectionId, entryVersion, clearSelection } = useLibraryStore();
  const { tabs, updateTab, setActiveTab } = useTabStore();
  const [showEmptyTrashDialog, setShowEmptyTrashDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [renameCollection, setRenameCollection] = useState<{ id: number; name: string } | null>(null);
  const [renameCollectionName, setRenameCollectionName] = useState("");
  const [renameTag, setRenameTag] = useState<{ id: number; name: string; color?: string } | null>(null);
  const [renameTagName, setRenameTagName] = useState("");
  const [renameTagColor, setRenameTagColor] = useState("");
  const [duplicateCount, setDuplicateCount] = useState(0);

  // Fetch duplicate count
  useEffect(() => {
    getDuplicateCount().then(setDuplicateCount).catch(console.error);
  }, [entries.length, entryVersion]); // Refresh when entries change or are modified

  // Update library tab title when filter changes
  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    // Clear tag/collection filters when switching to a basic filter
    setActiveTag(null);
    setActiveCollection(null);
    // Clear selection when switching views so info panel doesn't show stale data
    clearSelection();
    // Find and update the library tab title, and switch to it
    const libraryTab = tabs.find((t) => t.type === "library");
    if (libraryTab) {
      updateTab(libraryTab.id, { title: getFilterTitle(filter) });
      setActiveTab(libraryTab.id);
    }
  };

  // Handle tag selection
  const handleTagSelect = (tagId: number, tagName: string) => {
    setActiveTag(tagId);
    setActiveFilter("all"); // Clear basic filter when selecting a tag
    // Clear selection when switching views
    clearSelection();
    const libraryTab = tabs.find((t) => t.type === "library");
    if (libraryTab) {
      updateTab(libraryTab.id, { title: tagName });
      setActiveTab(libraryTab.id);
    }
  };

  // Handle collection selection
  const handleCollectionSelect = (collectionId: number, collectionName: string) => {
    setActiveCollection(collectionId);
    setActiveFilter("all"); // Clear basic filter when selecting a collection
    // Clear selection when switching views
    clearSelection();
    const libraryTab = tabs.find((t) => t.type === "library");
    if (libraryTab) {
      updateTab(libraryTab.id, { title: collectionName });
      setActiveTab(libraryTab.id);
    }
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

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    try {
      await createCollection({ name: newCollectionName.trim() });
      // Refresh collections list
      const allCollections = await getCollections();
      setCollections(allCollections);
      setNewCollectionName("");
      setNewCollectionDialogOpen(false);
    } catch (err) {
      console.error("Failed to create collection:", err);
    }
  };

  const handleDeleteCollection = async (collectionId: number, collectionName: string) => {
    try {
      await deleteCollection(collectionId);
      // Refresh collections list
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Clear selection if the deleted collection was selected
      if (activeCollectionId === collectionId) {
        setActiveCollection(null);
        setActiveFilter("all");
        const libraryTab = tabs.find((t) => t.type === "library");
        if (libraryTab) {
          updateTab(libraryTab.id, { title: "Library" });
        }
      }
      toast.success(`Collection "${collectionName}" deleted`);
    } catch (err) {
      console.error("Failed to delete collection:", err);
      toast.error("Failed to delete collection");
    }
  };

  const handleStartRenameCollection = (collection: { id: number; name: string }) => {
    setRenameCollection(collection);
    setRenameCollectionName(collection.name);
  };

  const handleRenameCollection = async () => {
    if (!renameCollection || !renameCollectionName.trim()) return;
    try {
      await updateCollection(renameCollection.id, { name: renameCollectionName.trim() });
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Update tab title if this collection is selected
      if (activeCollectionId === renameCollection.id) {
        const libraryTab = tabs.find((t) => t.type === "library");
        if (libraryTab) {
          updateTab(libraryTab.id, { title: renameCollectionName.trim() });
        }
      }
      setRenameCollection(null);
      setRenameCollectionName("");
    } catch (err) {
      console.error("Failed to rename collection:", err);
    }
  };

  const handleStartRenameTag = (tag: { id: number; name: string; color?: string }) => {
    setRenameTag(tag);
    setRenameTagName(tag.name);
    setRenameTagColor(tag.color || "");
  };

  const handleRenameTag = async () => {
    if (!renameTag || !renameTagName.trim()) return;
    try {
      await updateTag(
        renameTag.id,
        renameTagName.trim() !== renameTag.name ? renameTagName.trim() : undefined,
        renameTagColor !== renameTag.color ? renameTagColor || undefined : undefined
      );
      const allTags = await getTags();
      useLibraryStore.getState().setTags(allTags);
      // Update tab title if this tag is selected
      if (activeTagId === renameTag.id) {
        const libraryTab = tabs.find((t) => t.type === "library");
        if (libraryTab) {
          updateTab(libraryTab.id, { title: renameTagName.trim() });
        }
      }
      setRenameTag(null);
      setRenameTagName("");
      setRenameTagColor("");
    } catch (err) {
      console.error("Failed to rename tag:", err);
    }
  };

  // Export handlers for sidebar
  const handleExportAllCslJson = async () => {
    try {
      const content = await exportAllToCslJson();
      const filePath = await save({
        defaultPath: "library.json",
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to CSL JSON:", err);
    }
  };

  const handleExportAllBibtex = async () => {
    try {
      const content = await exportAllToBibtex();
      const filePath = await save({
        defaultPath: "library.bib",
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to BibTeX:", err);
    }
  };

  const handleCopyAllCslJson = async () => {
    try {
      const content = await exportAllToCslJson();
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy CSL JSON:", err);
    }
  };

  const handleCopyAllBibtex = async () => {
    try {
      const content = await exportAllToBibtex();
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy BibTeX:", err);
    }
  };

  // Export handlers for collections
  const handleExportCollectionCslJson = async (collectionId: number, collectionName: string) => {
    try {
      const collectionEntries = await getEntries({ collectionId });
      const entryIds = collectionEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries in this collection to export");
        return;
      }
      const content = await exportToCslJson(entryIds);
      const filePath = await save({
        defaultPath: `${collectionName}.json`,
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export collection to CSL JSON:", err);
    }
  };

  const handleExportCollectionBibtex = async (collectionId: number, collectionName: string) => {
    try {
      const collectionEntries = await getEntries({ collectionId });
      const entryIds = collectionEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries in this collection to export");
        return;
      }
      const content = await exportToBibtex(entryIds);
      const filePath = await save({
        defaultPath: `${collectionName}.bib`,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export collection to BibTeX:", err);
    }
  };

  // Export handlers for tags
  const handleExportTagCslJson = async (tagId: number, tagName: string) => {
    try {
      const tagEntries = await getEntries({ tagId });
      const entryIds = tagEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries with this tag to export");
        return;
      }
      const content = await exportToCslJson(entryIds);
      const filePath = await save({
        defaultPath: `${tagName}.json`,
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export tag to CSL JSON:", err);
    }
  };

  const handleExportTagBibtex = async (tagId: number, tagName: string) => {
    try {
      const tagEntries = await getEntries({ tagId });
      const entryIds = tagEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries with this tag to export");
        return;
      }
      const content = await exportToBibtex(entryIds);
      const filePath = await save({
        defaultPath: `${tagName}.bib`,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export tag to BibTeX:", err);
    }
  };

  // Helper to filter entries based on filter type (uses shared utility)
  const getFilteredEntries = (filterType: string) => {
    return filterEntriesByType(entries, filterType as FilterType);
  };

  // Export handlers for filtered views (All Items, PDFs, Notes, Recent, Untagged)
  const handleExportFilteredCslJson = async (filterType: string, fileName: string) => {
    try {
      const filteredEntries = getFilteredEntries(filterType);
      const entryIds = filteredEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries to export");
        return;
      }
      const content = await exportToCslJson(entryIds);
      const filePath = await save({
        defaultPath: `${fileName}.json`,
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to CSL JSON:", err);
    }
  };

  const handleExportFilteredBibtex = async (filterType: string, fileName: string) => {
    try {
      const filteredEntries = getFilteredEntries(filterType);
      const entryIds = filteredEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries to export");
        return;
      }
      const content = await exportToBibtex(entryIds);
      const filePath = await save({
        defaultPath: `${fileName}.bib`,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to BibTeX:", err);
    }
  };

  const handleCopyFilteredCslJson = async (filterType: string) => {
    try {
      const filteredEntries = getFilteredEntries(filterType);
      const entryIds = filteredEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries to copy");
        return;
      }
      const content = await exportToCslJson(entryIds);
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy CSL JSON:", err);
    }
  };

  const handleCopyFilteredBibtex = async (filterType: string) => {
    try {
      const filteredEntries = getFilteredEntries(filterType);
      const entryIds = filteredEntries.map(e => e.id);
      if (entryIds.length === 0) {
        alert("No entries to copy");
        return;
      }
      const content = await exportToBibtex(entryIds);
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy BibTeX:", err);
    }
  };

  // Calculate counts from entries (new model)
  const pdfCount = entries.filter((e) => e.hasPdf).length;
  const noteCount = entries.filter((e) => e.hasNote).length;
  const recentCount = entries.filter((e) => {
    const added = new Date(e.dateAdded);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return added > weekAgo;
  }).length;

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 px-2 pt-2">
          {/* Library section */}
          <CollapsibleSection
            title="Library"
            contextMenuContent={
              <>
                <ContextMenuItem disabled>
                  <FilePlus className="h-4 w-4 mr-2" />
                  Create New Reference
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Download className="h-4 w-4 mr-2" />
                    Export Library
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-48">
                    <ContextMenuItem onClick={handleExportAllCslJson}>
                      <FileJson className="h-4 w-4 mr-2" />
                      CSL JSON...
                    </ContextMenuItem>
                    <ContextMenuItem onClick={handleExportAllBibtex}>
                      <FileCode className="h-4 w-4 mr-2" />
                      BibTeX...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={handleCopyAllCslJson}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as CSL JSON
                    </ContextMenuItem>
                    <ContextMenuItem onClick={handleCopyAllBibtex}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as BibTeX
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            }
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarItem
                    icon={<Files className="h-4 w-4" />}
                    label="All Items"
                    count={entries.length}
                    active={activeFilter === "all"}
                    onClick={() => handleFilterChange("all")}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Download className="h-4 w-4 mr-2" />
                    Export All Items
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-40">
                    <ContextMenuItem onClick={() => handleExportFilteredCslJson("all", "all-items")}>
                      <FileJson className="h-4 w-4 mr-2" />
                      CSL JSON...
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleExportFilteredBibtex("all", "all-items")}>
                      <FileCode className="h-4 w-4 mr-2" />
                      BibTeX...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => handleCopyFilteredCslJson("all")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as CSL JSON
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleCopyFilteredBibtex("all")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as BibTeX
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuContent>
            </ContextMenu>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarItem
                    icon={<FileText className="h-4 w-4" />}
                    label="PDFs"
                    count={pdfCount}
                    active={activeFilter === "pdfs"}
                    onClick={() => handleFilterChange("pdfs")}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Download className="h-4 w-4 mr-2" />
                    Export PDFs
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-40">
                    <ContextMenuItem onClick={() => handleExportFilteredCslJson("pdfs", "pdfs")}>
                      <FileJson className="h-4 w-4 mr-2" />
                      CSL JSON...
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleExportFilteredBibtex("pdfs", "pdfs")}>
                      <FileCode className="h-4 w-4 mr-2" />
                      BibTeX...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => handleCopyFilteredCslJson("pdfs")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as CSL JSON
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleCopyFilteredBibtex("pdfs")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as BibTeX
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuContent>
            </ContextMenu>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarItem
                    icon={<FileText className="h-4 w-4" />}
                    label="Notes"
                    count={noteCount}
                    active={activeFilter === "notes"}
                    onClick={() => handleFilterChange("notes")}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Download className="h-4 w-4 mr-2" />
                    Export Notes
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-40">
                    <ContextMenuItem onClick={() => handleExportFilteredCslJson("notes", "notes")}>
                      <FileJson className="h-4 w-4 mr-2" />
                      CSL JSON...
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleExportFilteredBibtex("notes", "notes")}>
                      <FileCode className="h-4 w-4 mr-2" />
                      BibTeX...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => handleCopyFilteredCslJson("notes")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as CSL JSON
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleCopyFilteredBibtex("notes")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as BibTeX
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuContent>
            </ContextMenu>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarItem
                    icon={<Trash2 className="h-4 w-4 text-pink-600" />}
                    label="Trash"
                    count={trashCount}
                    active={activeFilter === "trash"}
                    onClick={() => handleFilterChange("trash")}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem
                  onClick={() => setShowEmptyTrashDialog(true)}
                  disabled={trashCount === 0}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Empty Trash
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </CollapsibleSection>

          {/* Smart Filters */}
          <CollapsibleSection title="Smart Filters">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarItem
                    icon={<Clock className="h-4 w-4" />}
                    label="Recently Added"
                    count={recentCount}
                    active={activeFilter === "recent"}
                    onClick={() => handleFilterChange("recent")}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Download className="h-4 w-4 mr-2" />
                    Export Recent
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-40">
                    <ContextMenuItem onClick={() => handleExportFilteredCslJson("recent", "recently-added")}>
                      <FileJson className="h-4 w-4 mr-2" />
                      CSL JSON...
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleExportFilteredBibtex("recent", "recently-added")}>
                      <FileCode className="h-4 w-4 mr-2" />
                      BibTeX...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => handleCopyFilteredCslJson("recent")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as CSL JSON
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleCopyFilteredBibtex("recent")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as BibTeX
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuContent>
            </ContextMenu>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <SidebarItem
                    icon={<Tag className="h-4 w-4" />}
                    label="Untagged"
                    active={activeFilter === "untagged"}
                    onClick={() => handleFilterChange("untagged")}
                    allowContextMenu
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Download className="h-4 w-4 mr-2" />
                    Export Untagged
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-40">
                    <ContextMenuItem onClick={() => handleExportFilteredCslJson("untagged", "untagged")}>
                      <FileJson className="h-4 w-4 mr-2" />
                      CSL JSON...
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleExportFilteredBibtex("untagged", "untagged")}>
                      <FileCode className="h-4 w-4 mr-2" />
                      BibTeX...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => handleCopyFilteredCslJson("untagged")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as CSL JSON
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleCopyFilteredBibtex("untagged")}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy as BibTeX
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuContent>
            </ContextMenu>
            <SidebarItem
              icon={<CopyIcon className="h-4 w-4" />}
              label="Duplicates"
              count={duplicateCount}
              active={activeFilter === "duplicates"}
              onClick={() => handleFilterChange("duplicates")}
            />
          </CollapsibleSection>

          {/* Collections */}
          <CollapsibleSection
            title="Collections"
            onAdd={() => setNewCollectionDialogOpen(true)}
            contextMenuContent={
              <ContextMenuItem onClick={() => setNewCollectionDialogOpen(true)}>
                <FolderPlus className="h-4 w-4 mr-2" />
                New Collection
              </ContextMenuItem>
            }
          >
            {collections.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">
                Right-click to create a collection
              </p>
            ) : (
              collections.map((collection) => (
                <ContextMenu key={collection.id}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <SidebarItem
                        icon={
                          <FolderOpen
                            className="h-4 w-4"
                            style={{ color: collection.color }}
                          />
                        }
                        label={collection.name}
                        count={collection.itemCount}
                        active={activeCollectionId === collection.id}
                        onClick={() => handleCollectionSelect(collection.id, collection.name)}
                        allowContextMenu
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => handleStartRenameCollection({ id: collection.id, name: collection.name })}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Download className="h-4 w-4 mr-2" />
                        Export Collection
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent className="w-40">
                        <ContextMenuItem onClick={() => handleExportCollectionCslJson(collection.id, collection.name)}>
                          <FileJson className="h-4 w-4 mr-2" />
                          CSL JSON...
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleExportCollectionBibtex(collection.id, collection.name)}>
                          <FileCode className="h-4 w-4 mr-2" />
                          BibTeX...
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => handleDeleteCollection(collection.id, collection.name)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Collection
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
          </CollapsibleSection>

          {/* Tags */}
          <CollapsibleSection title="Tags">
            {tags.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">
                Add tags to entries from the info panel
              </p>
            ) : (
              tags.map((tag) => (
                <ContextMenu key={tag.id}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <SidebarItem
                        icon={
                          <Tag
                            className="h-4 w-4"
                            style={{ color: tag.color }}
                          />
                        }
                        label={tag.name}
                        count={tag.itemCount}
                        active={activeTagId === tag.id}
                        onClick={() => handleTagSelect(tag.id, tag.name)}
                        allowContextMenu
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => handleStartRenameTag({ id: tag.id, name: tag.name, color: tag.color })}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <Download className="h-4 w-4 mr-2" />
                        Export Tag
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent className="w-40">
                        <ContextMenuItem onClick={() => handleExportTagCslJson(tag.id, tag.name)}>
                          <FileJson className="h-4 w-4 mr-2" />
                          CSL JSON...
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleExportTagBibtex(tag.id, tag.name)}>
                          <FileCode className="h-4 w-4 mr-2" />
                          BibTeX...
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
          </CollapsibleSection>
        </ScrollArea>

        {/* Empty Trash Confirmation Dialog */}
        <Dialog open={showEmptyTrashDialog} onOpenChange={setShowEmptyTrashDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Empty Trash?</DialogTitle>
              <DialogDescription>
                This will permanently delete {trashCount} {trashCount === 1 ? "item" : "items"} and their files.
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

        {/* New Collection Dialog */}
        <Dialog open={newCollectionDialogOpen} onOpenChange={setNewCollectionDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Collection</DialogTitle>
              <DialogDescription>
                Create a new collection to organize your references.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="collection-name">Name</Label>
              <Input
                id="collection-name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="Collection name..."
                className="mt-2"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCollection();
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setNewCollectionDialogOpen(false);
                setNewCollectionName("");
              }}>
                Cancel
              </Button>
              <Button onClick={handleCreateCollection} disabled={!newCollectionName.trim()}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Collection Dialog */}
        <Dialog open={renameCollection !== null} onOpenChange={(open) => !open && setRenameCollection(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Collection</DialogTitle>
              <DialogDescription>
                Enter a new name for this collection.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="rename-collection-name">Name</Label>
              <Input
                id="rename-collection-name"
                value={renameCollectionName}
                onChange={(e) => setRenameCollectionName(e.target.value)}
                placeholder="Collection name..."
                className="mt-2"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCollection();
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setRenameCollection(null);
                setRenameCollectionName("");
              }}>
                Cancel
              </Button>
              <Button onClick={handleRenameCollection} disabled={!renameCollectionName.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Tag Dialog */}
        <Dialog open={renameTag !== null} onOpenChange={(open) => !open && setRenameTag(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Tag</DialogTitle>
              <DialogDescription>
                Enter a new name for this tag.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <Label htmlFor="rename-tag-name">Name</Label>
                <Input
                  id="rename-tag-name"
                  value={renameTagName}
                  onChange={(e) => setRenameTagName(e.target.value)}
                  placeholder="Tag name..."
                  className="mt-2"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameTag();
                  }}
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="rename-tag-color">Color</Label>
                <Input
                  id="rename-tag-color"
                  type="color"
                  value={renameTagColor || "#808080"}
                  onChange={(e) => setRenameTagColor(e.target.value)}
                  className="mt-2 h-10 w-20"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setRenameTag(null);
                setRenameTagName("");
                setRenameTagColor("");
              }}>
                Cancel
              </Button>
              <Button onClick={handleRenameTag} disabled={!renameTagName.trim()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}
