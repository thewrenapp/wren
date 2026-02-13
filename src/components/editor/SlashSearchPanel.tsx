import { useState, useEffect, useRef, useCallback } from "react";
import { Command } from "cmdk";
import {
  FileText,
  Paperclip,
  Tag,
  Folder,
  ChevronRight,
} from "lucide-react";
import {
  getEntries,
  getTags,
  getCollections,
  getEntryAttachments,
  type EntrySummary,
  type Tag as TagType,
  type Collection,
  type Attachment,
} from "@/services/tauri/commands";

type SearchType = "entry" | "attachment" | "tag" | "collection";

interface SlashSearchPanelProps {
  type: SearchType;
  anchorPosition: { x: number; y: number };
  onSelect: (link: { label: string; url: string }) => void;
  onClose: () => void;
}

export function SlashSearchPanel({
  type,
  anchorPosition,
  onSelect,
  onClose,
}: SlashSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  // For attachment type: two-step flow
  const [selectedEntry, setSelectedEntry] = useState<EntrySummary | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Position the panel
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    let top = anchorPosition.y + 4;
    let left = anchorPosition.x;
    const panelWidth = 320;
    const panelHeight = 340;

    if (left + panelWidth > window.innerWidth) {
      left = window.innerWidth - panelWidth - 8;
    }
    if (top + panelHeight > window.innerHeight) {
      top = anchorPosition.y - panelHeight - 4;
    }

    setPosition({ top, left });
  }, [anchorPosition]);

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Fetch data based on type
  const fetchData = useCallback(async (searchQuery: string) => {
    setLoading(true);
    try {
      if (type === "entry" || (type === "attachment" && !selectedEntry)) {
        const results = await getEntries({
          searchQuery: searchQuery || undefined,
        });
        setEntries(results);
      } else if (type === "tag") {
        const allTags = await getTags();
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          setTags(allTags.filter((t) => t.name.toLowerCase().includes(q)));
        } else {
          setTags(allTags);
        }
      } else if (type === "collection") {
        const allCollections = await getCollections();
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          setCollections(
            allCollections.filter((c) => c.name.toLowerCase().includes(q)),
          );
        } else {
          setCollections(allCollections);
        }
      }
    } catch (err) {
      console.error("SlashSearchPanel fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [type, selectedEntry]);

  // Fetch attachments when entry is selected (attachment type)
  useEffect(() => {
    if (type === "attachment" && selectedEntry) {
      setLoading(true);
      getEntryAttachments(selectedEntry.id)
        .then((atts) => {
          setAttachments(atts);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [type, selectedEntry]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => fetchData(query), 150);
    return () => clearTimeout(timer);
  }, [query, fetchData]);

  const handleEntrySelect = (entry: EntrySummary) => {
    if (type === "attachment") {
      setSelectedEntry(entry);
      setQuery("");
    } else {
      onSelect({
        label: entry.title,
        url: `wren-entry:${entry.id}`,
      });
    }
  };

  const handleAttachmentSelect = (attachment: Attachment) => {
    const label =
      attachment.title ||
      attachment.attachmentType.toUpperCase();
    onSelect({
      label,
      url: `wren-attachment:${attachment.id}`,
    });
  };

  const handleTagSelect = (tag: TagType) => {
    onSelect({
      label: tag.name,
      url: `wren-tag:${tag.id}`,
    });
  };

  const handleCollectionSelect = (collection: Collection) => {
    onSelect({
      label: collection.name,
      url: `wren-collection:${collection.id}`,
    });
  };

  const getIcon = () => {
    switch (type) {
      case "entry":
        return <FileText className="h-4 w-4" />;
      case "attachment":
        return <Paperclip className="h-4 w-4" />;
      case "tag":
        return <Tag className="h-4 w-4" />;
      case "collection":
        return <Folder className="h-4 w-4" />;
    }
  };

  const getPlaceholder = () => {
    if (type === "attachment" && selectedEntry) {
      return "Select an attachment...";
    }
    switch (type) {
      case "entry":
        return "Search entries...";
      case "attachment":
        return "Search entries...";
      case "tag":
        return "Search tags...";
      case "collection":
        return "Search collections...";
    }
  };

  const getTitle = () => {
    if (type === "attachment" && selectedEntry) {
      return selectedEntry.title;
    }
    switch (type) {
      case "entry":
        return "Link to Entry";
      case "attachment":
        return "Link to Attachment";
      case "tag":
        return "Link to Tag";
      case "collection":
        return "Link to Collection";
    }
  };

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] w-[320px] max-h-[340px] rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden"
      style={{ top: position.top, left: position.left }}
    >
      <Command shouldFilter={false} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b text-xs text-muted-foreground">
          {getIcon()}
          <span className="font-medium">{getTitle()}</span>
          {type === "attachment" && selectedEntry && (
            <button
              className="ml-auto text-xs hover:text-foreground"
              onClick={() => {
                setSelectedEntry(null);
                setAttachments([]);
                setQuery("");
              }}
            >
              Back
            </button>
          )}
        </div>

        {/* Search input */}
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder={getPlaceholder()}
          className="w-full px-3 py-2 text-sm bg-transparent border-b outline-none placeholder:text-muted-foreground"
        />

        {/* Results */}
        <Command.List className="overflow-y-auto max-h-[240px] p-1">
          {loading && (
            <Command.Loading>
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                Loading...
              </div>
            </Command.Loading>
          )}

          <Command.Empty className="px-3 py-4 text-xs text-muted-foreground text-center">
            No results found
          </Command.Empty>

          {/* Entry results */}
          {(type === "entry" || (type === "attachment" && !selectedEntry)) &&
            entries.map((entry) => (
              <Command.Item
                key={entry.id}
                value={`entry-${entry.id}`}
                onSelect={() => handleEntrySelect(entry)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm hover:bg-accent aria-selected:bg-accent"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate">{entry.title}</span>
                  {entry.creatorsDisplay && (
                    <span className="text-xs text-muted-foreground truncate">
                      {entry.creatorsDisplay}
                      {entry.year ? ` (${entry.year})` : ""}
                    </span>
                  )}
                </div>
                {type === "attachment" && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                )}
              </Command.Item>
            ))}

          {/* Attachment results (after entry selection) */}
          {type === "attachment" &&
            selectedEntry &&
            attachments.map((att) => (
              <Command.Item
                key={att.id}
                value={`att-${att.id}`}
                onSelect={() => handleAttachmentSelect(att)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm hover:bg-accent aria-selected:bg-accent"
              >
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate">
                    {att.title || att.attachmentType.toUpperCase()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {att.attachmentType}
                  </span>
                </div>
              </Command.Item>
            ))}

          {/* Tag results */}
          {type === "tag" &&
            tags.map((tag) => (
              <Command.Item
                key={tag.id}
                value={`tag-${tag.id}`}
                onSelect={() => handleTagSelect(tag)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm hover:bg-accent aria-selected:bg-accent"
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0 border"
                  style={{
                    backgroundColor: tag.color || "hsl(var(--muted))",
                    borderColor: tag.color || "hsl(var(--border))",
                  }}
                />
                <span className="truncate flex-1">{tag.name}</span>
                <span className="text-xs text-muted-foreground">
                  {tag.itemCount}
                </span>
              </Command.Item>
            ))}

          {/* Collection results */}
          {type === "collection" &&
            collections.map((col) => (
              <Command.Item
                key={col.id}
                value={`col-${col.id}`}
                onSelect={() => handleCollectionSelect(col)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm hover:bg-accent aria-selected:bg-accent"
              >
                <Folder className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="truncate flex-1">{col.name}</span>
                <span className="text-xs text-muted-foreground">
                  {col.itemCount}
                </span>
              </Command.Item>
            ))}
        </Command.List>
      </Command>
    </div>
  );
}
