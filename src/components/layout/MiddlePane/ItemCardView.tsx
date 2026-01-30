import { FileText, File } from "lucide-react";
import { type Item } from "@/stores/libraryStore";
import { formatRelativeDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface ItemCardViewProps {
  items: Item[];
  selectedIds: string[];
  onItemClick: (id: string, event: React.MouseEvent) => void;
  onItemDoubleClick: (id: string) => void;
}

export function ItemCardView({
  items,
  selectedIds,
  onItemClick,
  onItemDoubleClick,
}: ItemCardViewProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3">
      {items.map((item) => {
        const isSelected = selectedIds.includes(item.id);
        const Icon = item.type === "pdf" ? File : FileText;

        return (
          <div
            key={item.id}
            onClick={(e) => onItemClick(item.id, e)}
            onDoubleClick={() => onItemDoubleClick(item.id)}
            className={cn(
              "flex flex-col p-3 rounded-lg border cursor-pointer transition-all",
              "hover:border-primary/50 hover:shadow-sm",
              isSelected && "border-primary bg-accent"
            )}
          >
            {/* Preview/Icon area */}
            <div
              className={cn(
                "flex items-center justify-center h-24 mb-2 rounded",
                item.type === "pdf"
                  ? "bg-red-50 dark:bg-red-900/20"
                  : "bg-blue-50 dark:bg-blue-900/20"
              )}
            >
              <Icon
                className={cn(
                  "h-10 w-10",
                  item.type === "pdf"
                    ? "text-red-400"
                    : "text-blue-400"
                )}
              />
            </div>

            {/* Title */}
            <h3 className="text-sm font-medium line-clamp-2 mb-1">
              {item.title}
            </h3>

            {/* Metadata */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto">
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded text-xs",
                  item.type === "pdf"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                )}
              >
                {item.type === "pdf" ? "PDF" : "Note"}
              </span>
              <span className="truncate">{formatRelativeDate(item.dateAdded)}</span>
            </div>

            {/* Tags */}
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {item.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag.id}
                    className="px-1.5 py-0.5 text-xs bg-muted rounded truncate max-w-full"
                  >
                    {tag.name}
                  </span>
                ))}
                {item.tags.length > 2 && (
                  <span className="text-xs text-muted-foreground">
                    +{item.tags.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
