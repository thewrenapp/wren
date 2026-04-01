import { useState, useEffect, useCallback } from "react";
import { toast } from "@/stores/toastStore";
import {
  Info,
  FileText,
  Paperclip,
  FolderOpen,
  Tags,
  Link2,
  ExternalLink,
  Users,
  Copy,
  Check,
  Pencil,
  X,
  Save,
  Trash2,
  Sparkles,
  Network,
  CheckCircle2,
  TreePine,
} from "lucide-react";
import { AttachmentIcon } from "@/lib/icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoSection } from "./InfoSection";
import { useLibraryStore, type EntrySummary } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";
import { useSchemaStore } from "@/stores/schemaStore";
import { formatDate } from "@/lib/utils";
import {
  getEntry,
  updateEntry,
  addEntryTag,
  removeEntryTag,
  addEntryToCollection,
  removeEntryFromCollection,
  getTags,
  getCollections,
  getEntryBacklinks,
  type Entry as TauriEntry,
  type Creator,
  type BacklinkInfo,
} from "@/services/tauri";
import { openFileWithDefaultApp, getLibraryPath, parseDocument } from "@/services/tauri/commands";
import type { ItemTypeInfo } from "@/types/schema";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

interface EntryInfoPanelProps {
  entry: EntrySummary;
}

export function EntryInfoPanel({ entry }: EntryInfoPanelProps) {
  const { collections, setTags, setCollections, entryVersion, invalidateEntry, invalidateAttachments, refreshLibrary } = useLibraryStore();
  const { tabs, activeTabId, updateTab } = useTabStore();
  const { activeFilter } = useUIStore();
  const { getItemTypeInfo, loadSchema, isLoaded, itemTypes } = useSchemaStore();
  const isTrashView = activeFilter === "trash";
  const [fullEntry, setFullEntry] = useState<TauriEntry | null>(null);
  const [itemTypeInfo, setItemTypeInfo] = useState<ItemTypeInfo | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editedItemType, setEditedItemType] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDate, setEditedDate] = useState("");
  const [editedUrl, setEditedUrl] = useState("");
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [editedCreators, setEditedCreators] = useState<Creator[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Tag/Collection adding state
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [isAddingCollection, setIsAddingCollection] = useState(false);

  // Backlinks state
  const [backlinks, setBacklinks] = useState<BacklinkInfo[]>([]);

  // Load schema on mount
  useEffect(() => {
    if (!isLoaded) {
      loadSchema();
    }
  }, [isLoaded, loadSchema]);

  // Fetch full entry details (also refetch when entryVersion changes)
  // Pass includeDeleted=true when viewing trash items
  useEffect(() => {
    getEntry(entry.id, isTrashView)
      .then((data) => {
        setFullEntry(data);
      })
      .catch(console.error);
  }, [entry.id, entryVersion, isTrashView]);

  // Fetch backlinks
  useEffect(() => {
    getEntryBacklinks(entry.id)
      .then(setBacklinks)
      .catch(() => setBacklinks([]));
  }, [entry.id, entryVersion]);

  // Fetch item type info when entry changes or edited item type changes
  useEffect(() => {
    const typeToFetch = isEditing ? editedItemType : entry.itemType;
    if (typeToFetch) {
      getItemTypeInfo(typeToFetch).then(setItemTypeInfo);
    }
  }, [entry.itemType, editedItemType, isEditing, getItemTypeInfo]);

  // Initialize edit state when entering edit mode
  const startEditing = useCallback(() => {
    if (fullEntry) {
      setEditedItemType(fullEntry.itemType || "");
      setEditedTitle(fullEntry.title || "");
      setEditedDate(fullEntry.date || "");
      setEditedUrl(fullEntry.url || "");
      setEditedFields({ ...fullEntry.fields });
      setEditedCreators([...fullEntry.creators]);
      setIsEditing(true);
    }
  }, [fullEntry]);

  // Cancel editing
  const cancelEditing = () => {
    setIsEditing(false);
  };

  // Save changes
  const saveChanges = async () => {
    if (!fullEntry) return;

    setIsSaving(true);
    try {
      await updateEntry(fullEntry.id, {
        itemType: editedItemType !== fullEntry.itemType ? editedItemType : undefined,
        title: editedTitle,
        date: editedDate || undefined,
        url: editedUrl || undefined,
        fields: editedFields,
        creators: editedCreators.map((c) => ({
          creatorType: c.creatorType,
          firstName: c.firstName,
          lastName: c.lastName,
          name: c.name,
        })),
      });

      // Refresh entry data (includes updated attachments with renamed files)
      const updated = await getEntry(fullEntry.id, isTrashView);
      setFullEntry(updated);
      // Update any open tabs for this entry with the new title
      const entryTabs = tabs.filter(t => t.type === "entry" && t.entryId === String(fullEntry.id));
      entryTabs.forEach(t => {
        // For entry tabs with attachments, update with attachment title
        if (t.attachmentId) {
          const attachment = updated.attachments.find(a => String(a.id) === t.attachmentId);
          if (attachment?.title) {
            updateTab(t.id, { title: attachment.title });
          }
        } else {
          // For entry tabs without attachment, update with entry title
          updateTab(t.id, { title: editedTitle });
        }
      });
      // Invalidate to trigger refresh in other components (e.g., entry list, entry tabs)
      invalidateEntry();
      // Invalidate attachments cache so expanded rows in entry table show updated names
      invalidateAttachments();
      // Refresh entries list to update table/card views
      await refreshLibrary();
      setIsEditing(false);
      toast.success("Changes saved");
    } catch (err) {
      console.error("Failed to save:", err);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  // Update a field value
  const updateField = (fieldName: string, value: string) => {
    if (fieldName === "title") setEditedTitle(value);
    else if (fieldName === "date") setEditedDate(value);
    else if (fieldName === "url") setEditedUrl(value);
    else setEditedFields((prev) => ({ ...prev, [fieldName]: value }));
  };

  // Get field value (edited or original)
  const getFieldValue = (fieldName: string): string => {
    if (isEditing) {
      if (fieldName === "title") return editedTitle;
      if (fieldName === "date") return editedDate;
      if (fieldName === "url") return editedUrl;
      return editedFields[fieldName] || "";
    }

    if (!fullEntry) return "";
    if (fieldName === "title") return fullEntry.title || "";
    if (fieldName === "date") return fullEntry.date || "";
    if (fieldName === "url") return fullEntry.url || "";
    if (fieldName === "accessDate") return fullEntry.accessDate || "";
    return fullEntry.fields?.[fieldName] || "";
  };

  // Get collections this entry belongs to
  const entryCollections = fullEntry?.collections
    ? collections.filter((c) => fullEntry.collections.includes(c.id))
    : [];

  // Filter fields that have values (when not editing)
  const fieldsWithValues =
    itemTypeInfo?.fields.filter((field) => {
      if (isEditing) return true; // Show all fields when editing
      const value = getFieldValue(field.name);
      return value && value.trim() !== "";
    }) || [];

  // Add creator
  const addCreator = () => {
    const primaryType = itemTypeInfo?.creatorTypes.find((ct) => ct.isPrimary);
    setEditedCreators((prev) => [
      ...prev,
      {
        creatorType: primaryType?.name || "author",
        firstName: "",
        lastName: "",
        sortOrder: prev.length,
      },
    ]);
  };

  // Update creator
  const updateCreator = (index: number, field: keyof Creator, value: string) => {
    setEditedCreators((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  };

  // Remove creator
  const removeCreator = (index: number) => {
    setEditedCreators((prev) => prev.filter((_, i) => i !== index));
  };

  // Add tag
  const handleAddTag = async () => {
    if (!fullEntry || !newTagName.trim()) return;
    try {
      await addEntryTag(fullEntry.id, newTagName.trim());
      // Refresh entry to get updated tags
      const updated = await getEntry(fullEntry.id, isTrashView);
      setFullEntry(updated);
      // Refresh global tags list for sidebar
      const allTags = await getTags();
      setTags(allTags);
      // Refresh entries list to update tag dots
      await refreshLibrary();
      setNewTagName("");
      setIsAddingTag(false);
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };

  // Remove tag
  const handleRemoveTag = async (tagId: number) => {
    if (!fullEntry) return;
    try {
      await removeEntryTag(fullEntry.id, tagId);
      const updated = await getEntry(fullEntry.id, isTrashView);
      setFullEntry(updated);
      // Refresh global tags for sidebar count
      const allTags = await getTags();
      setTags(allTags);
      // Refresh entries list to update tag dots
      await refreshLibrary();
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  // Add to collection
  const handleAddToCollection = async (collectionId: number) => {
    if (!fullEntry) return;
    try {
      await addEntryToCollection(fullEntry.id, collectionId);
      const updated = await getEntry(fullEntry.id, isTrashView);
      setFullEntry(updated);
      // Refresh collections to update sidebar counts
      const allCollections = await getCollections();
      setCollections(allCollections);
      setIsAddingCollection(false);
    } catch (err) {
      console.error("Failed to add to collection:", err);
    }
  };

  // Remove from collection
  const handleRemoveFromCollection = async (collectionId: number) => {
    if (!fullEntry) return;
    try {
      await removeEntryFromCollection(fullEntry.id, collectionId);
      const updated = await getEntry(fullEntry.id, isTrashView);
      setFullEntry(updated);
      // Refresh collections to update sidebar counts
      const allCollections = await getCollections();
      setCollections(allCollections);
    } catch (err) {
      console.error("Failed to remove from collection:", err);
    }
  };

  const currentCreators = isEditing ? editedCreators : fullEntry?.creators || [];

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <Input
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              className="text-sm font-semibold h-auto py-1"
              placeholder="Title"
            />
          ) : (
            <h3 className="text-sm font-semibold line-clamp-2">{fullEntry?.title || entry.title}</h3>
          )}
          {!isEditing && (fullEntry?.creators?.length || entry.creatorsDisplay) && (
            <p className="text-xs text-muted-foreground mt-1">
              {fullEntry?.creators?.length
                ? fullEntry.creators
                    .map((c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "))
                    .join(", ")
                : entry.creatorsDisplay}
            </p>
          )}
        </div>
        {!isEditing ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={startEditing}
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <div className="flex gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={cancelEditing}
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="default"
              size="icon"
              className="h-7 w-7"
              onClick={saveChanges}
              disabled={isSaving}
              title="Save"
            >
              <Save className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        {/* Info Section - Dynamic Fields */}
        <InfoSection
          title="Info"
          icon={<Info className="h-4 w-4" />}
          defaultOpen={true}
        >
          <div className="space-y-2">
            {/* Item Type */}
            <div className="flex items-start">
              <span className="text-xs text-muted-foreground w-24 flex-shrink-0 pt-1.5">
                Item Type
              </span>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <select
                    value={editedItemType}
                    onChange={(e) => setEditedItemType(e.target.value)}
                    className="w-full text-sm bg-background border rounded px-2 py-1 h-7"
                  >
                    {itemTypes.map((type) => (
                      <option key={type.name} value={type.name}>
                        {type.displayName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm pt-0.5 block">
                    {itemTypeInfo?.displayName || entry.itemTypeDisplay || formatItemType(fullEntry?.itemType || entry.itemType)}
                  </span>
                )}
              </div>
            </div>

            {/* Dynamic fields based on item type */}
            {fieldsWithValues.map((field) => {
              // Skip title - it's in the header
              // Skip abstractNote - it has its own section
              if (field.name === "title" || field.name === "abstractNote") return null;

              const value = getFieldValue(field.name);
              if (!isEditing && !value) return null;

              return (
                <MetadataField
                  key={field.name}
                  label={field.displayName}
                  value={value}
                  isEditing={isEditing}
                  onChange={(val) => updateField(field.name, val)}
                  copyable={field.fieldType === "identifier"}
                  link={field.fieldType === "url" && !isEditing}
                  inputType={field.fieldType === "date" ? "date" : "text"}
                />
              );
            })}

            {/* Date Added (always show, not editable) */}
            <MetadataField
              label="Date Added"
              value={formatDate(entry.dateAdded)}
              isEditing={false}
            />

            {/* Date Modified */}
            {(fullEntry?.dateModified || entry.dateModified) && (
              <MetadataField
                label="Date Modified"
                value={formatDate((fullEntry?.dateModified || entry.dateModified)!)}
                isEditing={false}
              />
            )}
          </div>
        </InfoSection>

        {/* Creators Section */}
        <InfoSection
          title="Creators"
          icon={<Users className="h-4 w-4" />}
          count={currentCreators.length}
          onAdd={isEditing ? addCreator : undefined}
        >
          {currentCreators.length > 0 ? (
            <div className="space-y-2">
              {currentCreators.map((creator, index) => (
                <div key={index} className="flex items-start gap-2">
                  {isEditing ? (
                    <>
                      <select
                        value={creator.creatorType}
                        onChange={(e) =>
                          updateCreator(index, "creatorType", e.target.value)
                        }
                        className="text-xs bg-background border rounded px-1 py-1 w-20"
                      >
                        {itemTypeInfo?.creatorTypes.map((ct) => (
                          <option key={ct.name} value={ct.name}>
                            {ct.displayName}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={creator.firstName || ""}
                        onChange={(e) =>
                          updateCreator(index, "firstName", e.target.value)
                        }
                        placeholder="First"
                        className="h-7 text-sm flex-1"
                      />
                      <Input
                        value={creator.lastName || ""}
                        onChange={(e) =>
                          updateCreator(index, "lastName", e.target.value)
                        }
                        placeholder="Last"
                        className="h-7 text-sm flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 flex-shrink-0"
                        onClick={() => removeCreator(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5 capitalize">
                        {creator.creatorType}
                      </span>
                      <span className="flex-1 text-sm min-w-0 break-words">
                        {creator.name ||
                          [creator.firstName, creator.lastName]
                            .filter(Boolean)
                            .join(" ")}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isEditing ? "Click + to add creators" : "No creators"}
            </p>
          )}
        </InfoSection>

        {/* Abstract Section */}
        {(isEditing || fullEntry?.fields?.abstractNote) && (
          <InfoSection title="Abstract" icon={<FileText className="h-4 w-4" />}>
            {isEditing ? (
              <textarea
                value={editedFields.abstractNote || ""}
                onChange={(e) => updateField("abstractNote", e.target.value)}
                className="w-full text-sm bg-background border rounded px-2 py-1 min-h-[100px] resize-y"
                placeholder="Abstract..."
              />
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {fullEntry?.fields?.abstractNote}
              </p>
            )}
          </InfoSection>
        )}

        {/* Attachments Section */}
        <InfoSection
          title="Attachments"
          icon={<Paperclip className="h-4 w-4" />}
          count={fullEntry?.attachments?.length ?? entry.attachmentCount}
        >
          {fullEntry?.attachments && fullEntry.attachments.length > 0 ? (
            <div className="space-y-1">
              {fullEntry.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer"
                  onClick={() => {
                    const { openTab } = useTabStore.getState();
                    openTab({
                      type: "entry",
                      title: attachment.title || getAttachmentTitle(attachment),
                      entryId: String(entry.id),
                      attachmentId: String(attachment.id),
                    });
                  }}
                >
                  <AttachmentIcon type={attachment.attachmentType} />
                  <span className="text-sm flex-1 truncate">
                    {attachment.title || getAttachmentTitle(attachment)}
                  </span>
                  {attachment.markdownPath && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Parse with AI"
                      onClick={(e) => {
                        e.stopPropagation();
                        parseDocument(attachment.id, entry.id)
                          .then(() => toast.info("Parsing started"))
                          .catch((err) => toast.error(`Failed to start parsing: ${err}`));
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No attachments</p>
          )}
        </InfoSection>

        {/* Collections Section */}
        <InfoSection
          title="Collections"
          icon={<FolderOpen className="h-4 w-4" />}
          count={entryCollections.length}
          onAdd={() => setIsAddingCollection(true)}
        >
          {isAddingCollection && (
            <div className="mb-2">
              <select
                className="w-full text-sm bg-background border rounded px-2 py-1"
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddToCollection(Number(e.target.value));
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Select collection...</option>
                {collections
                  .filter((c) => !entryCollections.some((ec) => ec.id === c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </div>
          )}
          {entryCollections.length > 0 ? (
            <div className="space-y-1">
              {entryCollections.map((collection) => (
                <div
                  key={collection.id}
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 group cursor-pointer"
                  onClick={() => {
                    const { setActiveCollection } = useLibraryStore.getState();
                    setActiveCollection(collection.id);
                    const { openTab } = useTabStore.getState();
                    openTab({ type: "library", title: "Library" });
                  }}
                  title={`Show "${collection.name}" collection`}
                >
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm flex-1">{collection.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFromCollection(collection.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 rounded"
                    title="Remove from collection"
                  >
                    <X className="h-3 w-3 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not in any collections
            </p>
          )}
        </InfoSection>

        {/* Tags Section */}
        <InfoSection
          title="Tags"
          icon={<Tags className="h-4 w-4" />}
          count={fullEntry?.tags?.length || 0}
          onAdd={() => setIsAddingTag(true)}
        >
          {isAddingTag && (
            <div className="mb-2 flex gap-1">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name..."
                className="h-7 text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTag();
                  if (e.key === "Escape") {
                    setIsAddingTag(false);
                    setNewTagName("");
                  }
                }}
                autoFocus
              />
              <Button size="sm" className="h-7 px-2" onClick={handleAddTag}>
                Add
              </Button>
            </div>
          )}
          {(fullEntry?.tags?.length || 0) > 0 ? (
            <div className="flex flex-wrap gap-1">
              {fullEntry?.tags?.map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 text-xs bg-muted rounded-full flex items-center gap-1 group cursor-pointer hover:bg-muted/80"
                  onClick={() => {
                    const { setActiveTags } = useLibraryStore.getState();
                    setActiveTags([tag.id]);
                    const { openTab } = useTabStore.getState();
                    openTab({ type: "library", title: "Library" });
                  }}
                  title={`Filter by "${tag.name}"`}
                >
                  {tag.name}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTag(tag.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                    title="Remove tag"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Click + to add tags</p>
          )}
        </InfoSection>

        {/* Semantic Index Section */}
        <InfoSection
          title="Semantic Index"
          icon={<Network className="h-4 w-4" />}
        >
          {entry.ragIndexed ? (
            <SemanticIndexContent entry={entry} collectionIds={fullEntry?.collections ?? []} />
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Not yet indexed</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={async () => {
                  try {
                    const { ragIndexEntry } = await import('@/services/tauri/commands');
                    await ragIndexEntry(entry.id);
                    toast.info('Indexing started in background');
                  } catch (err) {
                    toast.error(`Failed: ${err}`);
                  }
                }}
              >
                <Network className="h-3.5 w-3.5" />
                Build Semantic Index
              </Button>
            </div>
          )}
        </InfoSection>

        {/* Backlinks Section */}
        <InfoSection
          title="Backlinks"
          icon={<Link2 className="h-4 w-4" />}
          count={backlinks.length}
        >
          {backlinks.length > 0 ? (
            <div className="space-y-1">
              {backlinks.map((bl) => (
                <div
                  key={bl.id}
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer"
                  onClick={() => {
                    const { openTab } = useTabStore.getState();
                    openTab({
                      type: "entry",
                      title: bl.sourceEntryTitle,
                      entryId: String(bl.sourceEntryId),
                      attachmentId: bl.noteAttachmentId ? String(bl.noteAttachmentId) : undefined,
                    });
                  }}
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm flex-1 truncate">{bl.sourceEntryTitle}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No notes reference this entry</p>
          )}
        </InfoSection>

        {/* Actions */}
        {!isEditing && (() => {
          const activeTab = tabs.find(t => t.id === activeTabId);
          const currentAttachment = activeTab?.attachmentId
            ? fullEntry?.attachments?.find(a => String(a.id) === activeTab.attachmentId && (a.filePath || a.markdownPath))
            : fullEntry?.attachments?.find(a => a.filePath || a.markdownPath);
          const openPath = currentAttachment?.filePath || currentAttachment?.markdownPath;
          if (!openPath) return null;
          return (
            <div className="p-3 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start overflow-hidden"
                onClick={async () => {
                  try {
                    let resolvedPath = openPath;
                    // markdownPath is relative to library root, needs resolving
                    if (!currentAttachment?.filePath && currentAttachment?.markdownPath) {
                      const libPath = await getLibraryPath();
                      resolvedPath = `${libPath}/${currentAttachment.markdownPath}`;
                    }
                    await openFileWithDefaultApp(resolvedPath);
                  } catch (err) {
                    toast.error(`Failed to open file: ${err}`);
                  }
                }}
              >
                <ExternalLink className="h-4 w-4 mr-2 flex-shrink-0" />
                <span className="truncate">Open in External App</span>
              </Button>
            </div>
          );
        })()}
      </ScrollArea>
    </div>
  );
}

// Helper components

interface MetadataFieldProps {
  label: string;
  value: string;
  isEditing?: boolean;
  onChange?: (value: string) => void;
  copyable?: boolean;
  link?: boolean;
  inputType?: "text" | "date" | "url";
}

function MetadataField({
  label,
  value,
  isEditing,
  onChange,
  copyable,
  link,
  inputType = "text",
}: MetadataFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="flex items-start">
      <span className="text-xs text-muted-foreground w-24 flex-shrink-0 pt-1.5">
        {label}
      </span>
      <div className="flex-1 min-w-0 flex items-start gap-1">
        {isEditing ? (
          <Input
            type={inputType}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className="h-7 text-sm"
          />
        ) : link ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline break-all block flex-1 pt-0.5"
          >
            {value}
          </a>
        ) : (
          <span className="text-sm flex-1 break-all pt-0.5">{value}</span>
        )}
        {copyable && !isEditing && (
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-muted flex-shrink-0 mt-0.5"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}


function formatRelativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function getAttachmentTitle(attachment: {
  filePath?: string;
  url?: string;
  attachmentType: string;
}): string {
  if (attachment.filePath) {
    const parts = attachment.filePath.split("/");
    return parts[parts.length - 1];
  }
  if (attachment.url) {
    return attachment.url;
  }
  return `${attachment.attachmentType} attachment`;
}

function formatItemType(type: string): string {
  const typeMap: Record<string, string> = {
    journalArticle: "Journal Article",
    book: "Book",
    bookSection: "Book Section",
    conferencePaper: "Conference Paper",
    thesis: "Thesis",
    report: "Report",
    preprint: "Preprint",
    webpage: "Web Page",
    blogPost: "Blog Post",
    magazineArticle: "Magazine Article",
    newspaperArticle: "Newspaper Article",
    computerProgram: "Software",
    document: "Document",
    dataset: "Dataset",
    patent: "Patent",
    artwork: "Artwork",
    film: "Film",
    podcast: "Podcast",
    note: "Note",
    attachment: "Attachment",
  };
  return typeMap[type] || type.replace(/([A-Z])/g, " $1").trim();
}

/** Semantic Index panel content — shows status, RAPTOR summaries, and collection cross-doc summaries. */
function SemanticIndexContent({ entry, collectionIds }: { entry: EntrySummary; collectionIds: number[] }) {
  const { showRaptorDialog } = useUIStore();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        Indexed for semantic search
      </div>
      {entry.ragIndexedAt && (
        <p className="text-[10px] text-muted-foreground/50">
          Indexed {formatRelativeDate(entry.ragIndexedAt)}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={() => showRaptorDialog(entry.id, entry.title, collectionIds)}
      >
        <TreePine className="h-3.5 w-3.5" />
        View RAPTOR Summaries
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={async () => {
          try {
            const { ragIndexEntry } = await import('@/services/tauri/commands');
            await ragIndexEntry(entry.id);
            toast.info('Re-indexing started');
          } catch (err) {
            toast.error(`Failed: ${err}`);
          }
        }}
      >
        <Network className="h-3.5 w-3.5" />
        Re-index
      </Button>
    </div>
  );
}
