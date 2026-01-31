import { ReactNode } from "react";
import {
  ExternalLink,
  FolderOpen,
  Plus,
  FileText,
  File,
  Link,
  Copy,
  Trash2,
  FolderPlus,
  Tags,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { useLibraryStore, type EntrySummary } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import {
  showEntryInFinder,
  addEntryToCollection,
  deleteEntry,
  addPdfAttachment,
  getTrashCount,
} from "@/services/tauri";
import { open } from "@tauri-apps/plugin-dialog";

interface EntryContextMenuProps {
  entry: EntrySummary;
  children: ReactNode;
}

interface EntryContextMenuContentProps {
  entry: EntrySummary;
  onClose?: () => void;
}

// Standalone content component for controlled dropdown menus (used in EntryTable)
export function EntryContextMenuContent({ entry, onClose }: EntryContextMenuContentProps) {
  const { openTab } = useTabStore();
  const { collections, removeEntry, invalidateAttachments, setTrashCount } = useLibraryStore();

  const handleOpen = () => {
    openTab({
      type: "entry",
      title: entry.title,
      entryId: entry.id,
    });
    onClose?.();
  };

  const handleShowInFinder = async () => {
    try {
      await showEntryInFinder(Number(entry.id));
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
    onClose?.();
  };

  const handleCopyTitle = async () => {
    try {
      await navigator.clipboard.writeText(entry.title);
    } catch (err) {
      console.error("Failed to copy title:", err);
    }
    onClose?.();
  };

  const handleAddToCollection = async (collectionId: string) => {
    try {
      await addEntryToCollection(Number(entry.id), Number(collectionId));
    } catch (err) {
      console.error("Failed to add to collection:", err);
    }
    onClose?.();
  };

  const handleAddPdfAttachment = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected) {
        await addPdfAttachment(Number(entry.id), selected);
        invalidateAttachments();
      }
    } catch (err) {
      console.error("Failed to add PDF attachment:", err);
    }
    onClose?.();
  };

  const handleDelete = async () => {
    if (!confirm(`Move "${entry.title}" to Trash?`)) {
      return;
    }
    try {
      await deleteEntry(Number(entry.id));
      removeEntry(entry.id);
      const count = await getTrashCount();
      setTrashCount(count);
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
    onClose?.();
  };

  return (
    <>
      <DropdownMenuItem onClick={handleOpen}>
        <ExternalLink className="h-4 w-4 mr-2" />
        Open
        <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
      </DropdownMenuItem>

      <DropdownMenuItem onClick={handleShowInFinder}>
        <FolderOpen className="h-4 w-4 mr-2" />
        Show in Finder
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Plus className="h-4 w-4 mr-2" />
          Add Attachment
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-48">
          <DropdownMenuItem onClick={handleAddPdfAttachment}>
            <File className="h-4 w-4 mr-2" />
            PDF...
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FileText className="h-4 w-4 mr-2" />
            Note
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Link className="h-4 w-4 mr-2" />
            Weblink...
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator />

      {collections.length > 0 && (
        <>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderPlus className="h-4 w-4 mr-2" />
              Add to Collection
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              {collections.map((collection) => (
                <DropdownMenuItem
                  key={collection.id}
                  onClick={() => handleAddToCollection(collection.id)}
                >
                  {collection.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
        </>
      )}

      <DropdownMenuItem disabled>
        <Tags className="h-4 w-4 mr-2" />
        Add Tag...
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={handleCopyTitle}>
        <Copy className="h-4 w-4 mr-2" />
        Copy Title
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        onClick={handleDelete}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Delete Entry
        <DropdownMenuShortcut>Del</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

// Original wrapper component for backwards compatibility
export function EntryContextMenu({ entry, children }: EntryContextMenuProps) {
  const { openTab } = useTabStore();
  const { collections, removeEntry, invalidateAttachments, setTrashCount } = useLibraryStore();

  const handleOpen = () => {
    openTab({
      type: "entry",
      title: entry.title,
      entryId: entry.id,
    });
  };

  const handleShowInFinder = async () => {
    try {
      await showEntryInFinder(Number(entry.id));
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
  };

  const handleCopyTitle = async () => {
    try {
      await navigator.clipboard.writeText(entry.title);
    } catch (err) {
      console.error("Failed to copy title:", err);
    }
  };

  const handleAddToCollection = async (collectionId: string) => {
    try {
      await addEntryToCollection(Number(entry.id), Number(collectionId));
    } catch (err) {
      console.error("Failed to add to collection:", err);
    }
  };

  const handleAddPdfAttachment = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected) {
        await addPdfAttachment(Number(entry.id), selected);
        invalidateAttachments();
      }
    } catch (err) {
      console.error("Failed to add PDF attachment:", err);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Move "${entry.title}" to Trash?`)) {
      return;
    }
    try {
      await deleteEntry(Number(entry.id));
      removeEntry(entry.id);
      const count = await getTrashCount();
      setTrashCount(count);
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={handleOpen}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Open
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleShowInFinder}>
          <FolderOpen className="h-4 w-4 mr-2" />
          Show in Finder
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Plus className="h-4 w-4 mr-2" />
            Add Attachment
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem onClick={handleAddPdfAttachment}>
              <File className="h-4 w-4 mr-2" />
              PDF...
            </ContextMenuItem>
            <ContextMenuItem disabled>
              <FileText className="h-4 w-4 mr-2" />
              Note
            </ContextMenuItem>
            <ContextMenuItem disabled>
              <Link className="h-4 w-4 mr-2" />
              Weblink...
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {collections.length > 0 && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderPlus className="h-4 w-4 mr-2" />
                Add to Collection
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                {collections.map((collection) => (
                  <ContextMenuItem
                    key={collection.id}
                    onClick={() => handleAddToCollection(collection.id)}
                  >
                    {collection.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem disabled>
          <Tags className="h-4 w-4 mr-2" />
          Add Tag...
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleCopyTitle}>
          <Copy className="h-4 w-4 mr-2" />
          Copy Title
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={handleDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Entry
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
