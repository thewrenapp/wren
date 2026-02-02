import { ReactNode } from "react";
import { toast } from "@/stores/toastStore";
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
  FolderMinus,
  Tags,
  Download,
  FileJson,
  FileCode,
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
  removeEntryFromCollection,
  deleteEntry,
  addPdfAttachment,
  createAttachment,
  getTrashCount,
  exportToCslJson,
  exportToBibtex,
  getCollections,
  getTags,
  getEntries,
  addTagToEntries,
} from "@/services/tauri";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

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
  const { openTab, tabs, closeTab } = useTabStore();
  const { collections, tags, removeEntry, invalidateAttachments, setTrashCount, setCollections, setTags, setEntries, invalidateEntry, selectedEntryIds, activeCollectionId } = useLibraryStore();

  // Use all selected entries for export when multiple are selected
  const exportIds = selectedEntryIds.length > 1 && selectedEntryIds.includes(entry.id)
    ? selectedEntryIds
    : [entry.id];
  const isMultiSelect = exportIds.length > 1;

  const handleOpen = () => {
    openTab({
      type: "entry",
      title: entry.title,
      entryId: String(entry.id),
    });
    onClose?.();
  };

  const handleShowInFinder = async () => {
    try {
      await showEntryInFinder(entry.id);
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
    onClose?.();
  };

  const handleCopyTitle = async () => {
    try {
      await writeText(entry.title);
      toast.success("Title copied to clipboard");
    } catch (err) {
      console.error("Failed to copy title:", err);
      toast.error("Failed to copy title");
    }
    onClose?.();
  };

  const handleAddToCollection = async (collectionId: number) => {
    try {
      await addEntryToCollection(entry.id, collectionId);
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Invalidate entry to refresh info panel
      invalidateEntry();
    } catch (err) {
      console.error("Failed to add to collection:", err);
    }
    onClose?.();
  };

  const handleRemoveFromCollection = async (collectionId: number) => {
    try {
      // Remove all selected entries from the collection
      const entriesToRemove = isMultiSelect ? exportIds : [entry.id];
      for (const entryId of entriesToRemove) {
        await removeEntryFromCollection(entryId, collectionId);
      }
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Refresh ALL entries (not filtered) to update the store
      const allEntries = await getEntries({});
      setEntries(allEntries);
      // Invalidate entry to refresh info panel
      invalidateEntry();
    } catch (err) {
      console.error("Failed to remove from collection:", err);
    }
    onClose?.();
  };

  const handleAddTag = async (tagName: string) => {
    try {
      const entriesToTag = isMultiSelect ? exportIds : [entry.id];
      await addTagToEntries(tagName, entriesToTag);
      // Refresh tags to update item count
      const allTags = await getTags();
      setTags(allTags);
      // Invalidate entry to refresh info panel
      invalidateEntry();
      toast.success(isMultiSelect ? `Tag added to ${entriesToTag.length} entries` : "Tag added");
    } catch (err) {
      console.error("Failed to add tag:", err);
      toast.error("Failed to add tag");
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
        await addPdfAttachment(entry.id, selected);
        invalidateAttachments();
        toast.success("PDF attached");
      }
    } catch (err) {
      console.error("Failed to add PDF attachment:", err);
      toast.error("Failed to attach PDF");
    }
    onClose?.();
  };

  const handleCreateNote = async () => {
    try {
      const note = await createAttachment({
        entryId: entry.id,
        attachmentType: "note",
        title: `Notes - ${entry.title}`,
      });
      invalidateAttachments();
      // Open the note in a new tab
      openTab({
        type: "entry",
        title: note.title || `Notes - ${entry.title}`,
        entryId: String(entry.id),
        attachmentId: String(note.id),
      });
      toast.success("Note created");
    } catch (err) {
      console.error("Failed to create note:", err);
      toast.error("Failed to create note");
    }
    onClose?.();
  };

  const handleDelete = async () => {
    try {
      await deleteEntry(entry.id);
      removeEntry(entry.id);
      // Close any open tabs for this entry
      const entryTabs = tabs.filter(t => t.type === "entry" && t.entryId === String(entry.id));
      entryTabs.forEach(t => closeTab(t.id));
      const count = await getTrashCount();
      setTrashCount(count);
      // Refresh collections and tags to update item counts
      const allCollections = await getCollections();
      setCollections(allCollections);
      const allTags = await getTags();
      setTags(allTags);
      toast.success("Moved to Trash");
    } catch (err) {
      console.error("Failed to delete entry:", err);
      toast.error("Failed to move to Trash");
    }
    onClose?.();
  };

  const handleExportCslJson = async () => {
    try {
      const content = await exportToCslJson(exportIds);
      const defaultName = isMultiSelect ? "export" : (entry.key || "export");
      const filePath = await save({
        defaultPath: `${defaultName}.json`,
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to CSL JSON:", err);
    }
    onClose?.();
  };

  const handleExportBibtex = async () => {
    try {
      const content = await exportToBibtex(exportIds);
      const defaultName = isMultiSelect ? "export" : (entry.key || "export");
      const filePath = await save({
        defaultPath: `${defaultName}.bib`,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to BibTeX:", err);
    }
    onClose?.();
  };

  const handleCopyCslJson = async () => {
    try {
      const content = await exportToCslJson(exportIds);
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy CSL JSON:", err);
    }
    onClose?.();
  };

  const handleCopyBibtex = async () => {
    try {
      const content = await exportToBibtex(exportIds);
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy BibTeX:", err);
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
          <DropdownMenuItem onClick={handleCreateNote}>
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
          {activeCollectionId && (
            <DropdownMenuItem onClick={() => handleRemoveFromCollection(activeCollectionId)}>
              <FolderMinus className="h-4 w-4 mr-2" />
              {isMultiSelect ? `Remove ${exportIds.length} from Collection` : "Remove from Collection"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
        </>
      )}

      {tags.length > 0 ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Tags className="h-4 w-4 mr-2" />
            {isMultiSelect ? `Add Tag to ${exportIds.length} Items` : "Add Tag"}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {tags.map((tag) => (
              <DropdownMenuItem
                key={tag.id}
                onClick={() => handleAddTag(tag.name)}
              >
                <span
                  className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: tag.color || "#6b7280" }}
                />
                {tag.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <DropdownMenuItem disabled>
          <Tags className="h-4 w-4 mr-2" />
          Add Tag (no tags exist)
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Download className="h-4 w-4 mr-2" />
          {isMultiSelect ? `Export ${exportIds.length} Items` : "Export As"}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-48">
          <DropdownMenuItem onClick={handleExportCslJson}>
            <FileJson className="h-4 w-4 mr-2" />
            CSL JSON...
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportBibtex}>
            <FileCode className="h-4 w-4 mr-2" />
            BibTeX...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyCslJson}>
            <Copy className="h-4 w-4 mr-2" />
            Copy as CSL JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyBibtex}>
            <Copy className="h-4 w-4 mr-2" />
            Copy as BibTeX
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

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
  const { openTab, tabs, closeTab } = useTabStore();
  const { collections, tags, removeEntry, invalidateAttachments, setTrashCount, setCollections, setTags, setEntries, invalidateEntry, selectedEntryIds, activeCollectionId } = useLibraryStore();

  // Use all selected entries for export when multiple are selected
  const exportIds = selectedEntryIds.length > 1 && selectedEntryIds.includes(entry.id)
    ? selectedEntryIds
    : [entry.id];
  const isMultiSelect = exportIds.length > 1;

  const handleOpen = () => {
    openTab({
      type: "entry",
      title: entry.title,
      entryId: String(entry.id),
    });
  };

  const handleShowInFinder = async () => {
    try {
      await showEntryInFinder(entry.id);
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
  };

  const handleCopyTitle = async () => {
    try {
      await writeText(entry.title);
    } catch (err) {
      console.error("Failed to copy title:", err);
    }
  };

  const handleAddToCollection = async (collectionId: number) => {
    try {
      await addEntryToCollection(entry.id, collectionId);
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Invalidate entry to refresh info panel
      invalidateEntry();
    } catch (err) {
      console.error("Failed to add to collection:", err);
    }
  };

  const handleRemoveFromCollection = async (collectionId: number) => {
    try {
      // Remove all selected entries from the collection
      const entriesToRemove = isMultiSelect ? exportIds : [entry.id];
      for (const entryId of entriesToRemove) {
        await removeEntryFromCollection(entryId, collectionId);
      }
      // Refresh collections to update item count
      const allCollections = await getCollections();
      setCollections(allCollections);
      // Refresh ALL entries (not filtered) to update the store
      const allEntries = await getEntries({});
      setEntries(allEntries);
      // Invalidate entry to refresh info panel
      invalidateEntry();
    } catch (err) {
      console.error("Failed to remove from collection:", err);
    }
  };

  const handleAddTag = async (tagName: string) => {
    try {
      const entriesToTag = isMultiSelect ? exportIds : [entry.id];
      await addTagToEntries(tagName, entriesToTag);
      // Refresh tags to update item count
      const allTags = await getTags();
      setTags(allTags);
      // Invalidate entry to refresh info panel
      invalidateEntry();
      toast.success(isMultiSelect ? `Tag added to ${entriesToTag.length} entries` : "Tag added");
    } catch (err) {
      console.error("Failed to add tag:", err);
      toast.error("Failed to add tag");
    }
  };

  const handleAddPdfAttachment = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected) {
        await addPdfAttachment(entry.id, selected);
        invalidateAttachments();
        toast.success("PDF attached");
      }
    } catch (err) {
      console.error("Failed to add PDF attachment:", err);
      toast.error("Failed to attach PDF");
    }
  };

  const handleCreateNote = async () => {
    try {
      const note = await createAttachment({
        entryId: entry.id,
        attachmentType: "note",
        title: `Notes - ${entry.title}`,
      });
      invalidateAttachments();
      // Open the note in a new tab
      openTab({
        type: "entry",
        title: note.title || `Notes - ${entry.title}`,
        entryId: String(entry.id),
        attachmentId: String(note.id),
      });
      toast.success("Note created");
    } catch (err) {
      console.error("Failed to create note:", err);
      toast.error("Failed to create note");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteEntry(entry.id);
      removeEntry(entry.id);
      // Close any open tabs for this entry
      const entryTabs = tabs.filter(t => t.type === "entry" && t.entryId === String(entry.id));
      entryTabs.forEach(t => closeTab(t.id));
      const count = await getTrashCount();
      setTrashCount(count);
      // Refresh collections and tags to update item counts
      const allCollections = await getCollections();
      setCollections(allCollections);
      const allTags = await getTags();
      setTags(allTags);
      toast.success("Moved to Trash");
    } catch (err) {
      console.error("Failed to delete entry:", err);
      toast.error("Failed to move to Trash");
    }
  };

  const handleExportCslJson = async () => {
    try {
      const content = await exportToCslJson(exportIds);
      const defaultName = isMultiSelect ? "export" : (entry.key || "export");
      const filePath = await save({
        defaultPath: `${defaultName}.json`,
        filters: [{ name: "CSL JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to CSL JSON:", err);
    }
  };

  const handleExportBibtex = async () => {
    try {
      const content = await exportToBibtex(exportIds);
      const defaultName = isMultiSelect ? "export" : (entry.key || "export");
      const filePath = await save({
        defaultPath: `${defaultName}.bib`,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (err) {
      console.error("Failed to export to BibTeX:", err);
    }
  };

  const handleCopyCslJson = async () => {
    try {
      const content = await exportToCslJson(exportIds);
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy CSL JSON:", err);
    }
  };

  const handleCopyBibtex = async () => {
    try {
      const content = await exportToBibtex(exportIds);
      await writeText(content);
    } catch (err) {
      console.error("Failed to copy BibTeX:", err);
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
            <ContextMenuItem onClick={handleCreateNote}>
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
            {activeCollectionId && (
              <ContextMenuItem onClick={() => handleRemoveFromCollection(activeCollectionId)}>
                <FolderMinus className="h-4 w-4 mr-2" />
                {isMultiSelect ? `Remove ${exportIds.length} from Collection` : "Remove from Collection"}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}

        {tags.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Tags className="h-4 w-4 mr-2" />
              {isMultiSelect ? `Add Tag to ${exportIds.length} Items` : "Add Tag"}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              {tags.map((tag) => (
                <ContextMenuItem
                  key={tag.id}
                  onClick={() => handleAddTag(tag.name)}
                >
                  <span
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: tag.color || "#6b7280" }}
                  />
                  {tag.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem disabled>
            <Tags className="h-4 w-4 mr-2" />
            Add Tag (no tags exist)
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Download className="h-4 w-4 mr-2" />
            {isMultiSelect ? `Export ${exportIds.length} Items` : "Export As"}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem onClick={handleExportCslJson}>
              <FileJson className="h-4 w-4 mr-2" />
              CSL JSON...
            </ContextMenuItem>
            <ContextMenuItem onClick={handleExportBibtex}>
              <FileCode className="h-4 w-4 mr-2" />
              BibTeX...
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleCopyCslJson}>
              <Copy className="h-4 w-4 mr-2" />
              Copy as CSL JSON
            </ContextMenuItem>
            <ContextMenuItem onClick={handleCopyBibtex}>
              <Copy className="h-4 w-4 mr-2" />
              Copy as BibTeX
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

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
