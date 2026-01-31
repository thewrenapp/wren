import { ChevronDown, ChevronRight, FileText, File, Link, Paperclip } from "lucide-react";
import { type EntrySummary, type Attachment } from "@/stores/libraryStore";
import { useUIStore, type ColumnId } from "@/stores/uiStore";
import { formatRelativeDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { EntryContextMenu } from "./EntryContextMenu";

interface EntryTableProps {
  entries: EntrySummary[];
  selectedIds: string[];
  expandedIds: string[];
  onEntryClick: (id: string, event: React.MouseEvent) => void;
  onEntryDoubleClick: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onAttachmentClick?: (entryId: string, attachmentId: string) => void;
  onAttachmentDoubleClick?: (entryId: string, attachmentId: string) => void;
  // Attachments lookup - in a real implementation, this would be fetched per entry
  attachmentsMap?: Record<string, Attachment[]>;
}

export function EntryTable({
  entries,
  selectedIds,
  expandedIds,
  onEntryClick,
  onEntryDoubleClick,
  onToggleExpand,
  onAttachmentClick,
  onAttachmentDoubleClick,
  attachmentsMap = {},
}: EntryTableProps) {
  const { columns, sortField, sortDirection, setSort } = useUIStore();
  const visibleColumns = columns.filter((col) => col.visible);

  const handleHeaderClick = (columnId: ColumnId) => {
    // Map column IDs to sort fields
    const sortFieldMap: Partial<Record<ColumnId, typeof sortField>> = {
      title: "title",
      creator: "creator",
      year: "year",
      entryType: "entryType",
      dateAdded: "dateAdded",
      dateModified: "dateModified",
    };

    const field = sortFieldMap[columnId];
    if (field) {
      setSort(field);
    }
  };

  return (
    <div className="w-full">
      {/* Table Header */}
      <div className="flex items-center border-b bg-muted/30 text-xs font-medium text-muted-foreground sticky top-0 z-10">
        {/* Expand chevron column */}
        <div className="w-6 flex-shrink-0" />

        {visibleColumns.map((column) => (
          <div
            key={column.id}
            className={cn(
              "px-2 py-1.5 truncate cursor-pointer hover:bg-muted/50 select-none",
              column.id === "title" ? "flex-1 min-w-0" : "flex-shrink-0"
            )}
            style={{
              width: column.id === "title" ? undefined : column.width,
            }}
            onClick={() => handleHeaderClick(column.id)}
          >
            <span className="flex items-center gap-1">
              {column.label}
              {sortField === column.id && (
                <span className="text-primary">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Table Body */}
      <div className="divide-y">
        {entries.map((entry) => {
          const isSelected = selectedIds.includes(entry.id);
          const isExpanded = expandedIds.includes(entry.id);
          const attachments = attachmentsMap[entry.id] || [];

          return (
            <EntryContextMenu key={entry.id} entry={entry}>
              <div>
                {/* Entry Row */}
                <div
                  className={cn(
                    "flex items-center cursor-pointer transition-colors",
                    "hover:bg-accent/50",
                    isSelected && "bg-accent"
                  )}
                  onClick={(e) => onEntryClick(entry.id, e)}
                  onDoubleClick={() => onEntryDoubleClick(entry.id)}
                >
                  {/* Expand chevron */}
                  <div
                    className="w-6 flex-shrink-0 flex items-center justify-center cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand(entry.id);
                    }}
                  >
                    {entry.attachmentCount > 0 && (
                      isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )
                    )}
                  </div>

                  {visibleColumns.map((column) => (
                    <div
                      key={column.id}
                      className={cn(
                        "px-2 py-1.5 truncate text-sm",
                        column.id === "title" ? "flex-1 min-w-0" : "flex-shrink-0"
                      )}
                      style={{
                        width: column.id === "title" ? undefined : column.width,
                      }}
                    >
                      <EntryCell entry={entry} columnId={column.id} />
                    </div>
                  ))}
                </div>

                {/* Attachment Rows (when expanded) */}
                {isExpanded && attachments.length > 0 && (
                  <div className="bg-muted/20">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className={cn(
                          "flex items-center pl-6 cursor-pointer transition-colors",
                          "hover:bg-accent/30"
                        )}
                        onClick={() => onAttachmentClick?.(entry.id, attachment.id)}
                        onDoubleClick={() =>
                          onAttachmentDoubleClick?.(entry.id, attachment.id)
                        }
                      >
                        {/* Attachment icon */}
                        <div className="w-6 flex-shrink-0 flex items-center justify-center">
                          <AttachmentIcon type={attachment.attachmentType} />
                        </div>

                        {/* Attachment title */}
                        <div className="flex-1 px-2 py-1 text-sm text-muted-foreground truncate">
                          {attachment.title || getAttachmentDefaultTitle(attachment)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </EntryContextMenu>
          );
        })}
      </div>
    </div>
  );
}

// Entry cell renderer
function EntryCell({
  entry,
  columnId,
}: {
  entry: EntrySummary;
  columnId: ColumnId;
}) {
  switch (columnId) {
    case "title":
      return <span className="font-medium">{entry.title}</span>;

    case "creator":
      return (
        <span className="text-muted-foreground">
          {entry.creatorsDisplay || "—"}
        </span>
      );

    case "year":
      return (
        <span className="text-muted-foreground">{entry.year || "—"}</span>
      );

    case "entryType":
      return (
        <span className="text-muted-foreground capitalize">
          {entry.entryType.replace(/_/g, " ")}
        </span>
      );

    case "dateAdded":
      return (
        <span className="text-muted-foreground">
          {formatRelativeDate(entry.dateAdded)}
        </span>
      );

    case "dateModified":
      return (
        <span className="text-muted-foreground">
          {formatRelativeDate(entry.dateAdded)}
        </span>
      );

    case "attachments":
      return (
        <div className="flex items-center gap-1">
          {entry.hasPdf && <File className="h-3 w-3 text-red-500" />}
          {entry.hasNote && <FileText className="h-3 w-3 text-blue-500" />}
          {entry.attachmentCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {entry.attachmentCount}
            </span>
          )}
        </div>
      );

    case "tags":
      return (
        <div className="flex items-center gap-1 overflow-hidden">
          {entry.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="px-1 py-0.5 text-xs bg-muted rounded truncate max-w-[60px]"
            >
              {tag.name}
            </span>
          ))}
          {entry.tags.length > 2 && (
            <span className="text-xs text-muted-foreground">
              +{entry.tags.length - 2}
            </span>
          )}
        </div>
      );

    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

// Attachment icon based on type
function AttachmentIcon({ type }: { type: string }) {
  switch (type) {
    case "pdf":
      return <File className="h-3 w-3 text-red-500" />;
    case "note":
      return <FileText className="h-3 w-3 text-blue-500" />;
    case "weblink":
      return <Link className="h-3 w-3 text-green-500" />;
    default:
      return <Paperclip className="h-3 w-3 text-muted-foreground" />;
  }
}

// Default title for attachment if none provided
function getAttachmentDefaultTitle(attachment: Attachment): string {
  if (attachment.filePath) {
    const parts = attachment.filePath.split("/");
    return parts[parts.length - 1];
  }
  if (attachment.url) {
    return attachment.url;
  }
  return `${attachment.attachmentTypeDisplay}`;
}
