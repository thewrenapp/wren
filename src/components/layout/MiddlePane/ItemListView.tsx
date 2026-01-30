import { FileText, File } from "lucide-react";
import { type Item } from "@/stores/libraryStore";
import { formatRelativeDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface ItemListViewProps {
  items: Item[];
  selectedIds: string[];
  onItemClick: (id: string, event: React.MouseEvent) => void;
  onItemDoubleClick: (id: string) => void;
}

export function ItemListView({
  items,
  selectedIds,
  onItemClick,
  onItemDoubleClick,
}: ItemListViewProps) {
  return (
    <div className="divide-y">
      {items.map((item) => {
        const isSelected = selectedIds.includes(item.id);
        const Icon = item.type === "pdf" ? File : FileText;

        return (
          <div
            key={item.id}
            onClick={(e) => onItemClick(item.id, e)}
            onDoubleClick={() => onItemDoubleClick(item.id)}
            className={cn(
              "flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors",
              "hover:bg-accent/50",
              isSelected && "bg-accent"
            )}
          >
            {/* Icon */}
            <div
              className={cn(
                "flex-shrink-0 w-8 h-8 rounded flex items-center justify-center",
                item.type === "pdf"
                  ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
              )}
            >
              <Icon className="h-4 w-4" />
            </div>

            {/* Title and metadata */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium truncate">{item.title}</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{item.type === "pdf" ? "PDF" : "Note"}</span>
                <span>·</span>
                <span>{formatRelativeDate(item.dateAdded)}</span>
                {item.tags.length > 0 && (
                  <>
                    <span>·</span>
                    <span className="truncate">
                      {item.tags.map((t) => t.name).join(", ")}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
