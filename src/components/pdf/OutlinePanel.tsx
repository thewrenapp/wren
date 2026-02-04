import { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronRight, FileQuestion } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SidebarSearchInput } from "./SidebarSearchInput";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface OutlineItem {
  title: string;
  bold: boolean;
  italic: boolean;
  color?: Uint8ClampedArray;
  dest: string | unknown[] | null;
  url: string | null;
  unsafeUrl: string | undefined;
  newWindow: boolean | undefined;
  count: number | undefined;
  items: OutlineItem[];
}

interface ProcessedOutlineItem extends OutlineItem {
  id: string;
  pageNumber: number | null;
  depth: number;
  children: ProcessedOutlineItem[];
}

interface OutlinePanelProps {
  pdfDocument: PDFDocumentProxy | null;
  goToPage?: (page: number) => void;
  currentPage?: number;
}

export function OutlinePanel({ pdfDocument, goToPage, currentPage = 1 }: OutlinePanelProps) {
  const [outline, setOutline] = useState<ProcessedOutlineItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Fetch and process outline
  useEffect(() => {
    async function loadOutline() {
      if (!pdfDocument) {
        setOutline(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const rawOutline = await pdfDocument.getOutline() as OutlineItem[] | null;

        if (!rawOutline || rawOutline.length === 0) {
          setOutline(null);
          setIsLoading(false);
          return;
        }

        // Process outline items to add IDs and resolve page numbers
        const processItems = async (
          items: OutlineItem[],
          depth: number,
          parentId: string
        ): Promise<ProcessedOutlineItem[]> => {
          const processed: ProcessedOutlineItem[] = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const id = `${parentId}-${i}`;
            let pageNumber: number | null = null;

            // Try to resolve the destination to a page number
            if (item.dest) {
              try {
                let destArray: unknown[] | null = null;
                if (typeof item.dest === "string") {
                  destArray = await pdfDocument.getDestination(item.dest);
                } else if (Array.isArray(item.dest)) {
                  destArray = item.dest;
                }
                if (destArray && destArray.length > 0) {
                  const ref = destArray[0];
                  if (ref && typeof ref === "object" && "num" in ref && "gen" in ref) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    pageNumber = await pdfDocument.getPageIndex(ref as any) + 1;
                  }
                }
              } catch {
                // Could not resolve page number
              }
            }

            const children = item.items?.length > 0
              ? await processItems(item.items, depth + 1, id)
              : [];

            processed.push({
              ...item,
              id,
              pageNumber,
              depth,
              children,
            });
          }

          return processed;
        };

        const processedOutline = await processItems(rawOutline, 0, "outline");
        setOutline(processedOutline);

        // Initially expand top-level items
        const initialExpanded = new Set<string>();
        processedOutline.forEach((item) => {
          if (item.children.length > 0) {
            initialExpanded.add(item.id);
          }
        });
        setExpandedItems(initialExpanded);
      } catch (error) {
        console.error("Failed to load outline:", error);
        setOutline(null);
      } finally {
        setIsLoading(false);
      }
    }

    loadOutline();
  }, [pdfDocument]);

  // Filter outline based on search query
  const filteredOutline = useMemo(() => {
    if (!outline || !searchQuery.trim()) return outline;

    const query = searchQuery.toLowerCase();

    const filterItems = (items: ProcessedOutlineItem[]): ProcessedOutlineItem[] => {
      const result: ProcessedOutlineItem[] = [];

      for (const item of items) {
        const matchesTitle = item.title.toLowerCase().includes(query);
        const filteredChildren = filterItems(item.children);

        // Include item if it matches or has matching children
        if (matchesTitle || filteredChildren.length > 0) {
          result.push({
            ...item,
            children: filteredChildren,
          });
        }
      }

      return result;
    };

    return filterItems(outline);
  }, [outline, searchQuery]);

  // Auto-expand all when searching
  useEffect(() => {
    if (searchQuery.trim() && filteredOutline) {
      const collectIds = (items: ProcessedOutlineItem[]): string[] => {
        return items.flatMap((item) => [item.id, ...collectIds(item.children)]);
      };
      setExpandedItems(new Set(collectIds(filteredOutline)));
    }
  }, [searchQuery, filteredOutline]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleItemClick = useCallback(
    (item: ProcessedOutlineItem) => {
      if (item.pageNumber && goToPage) {
        goToPage(item.pageNumber);
      }
    },
    [goToPage]
  );

  // Render outline item recursively
  const renderItem = (item: ProcessedOutlineItem) => {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isCurrentPage = item.pageNumber === currentPage;

    return (
      <div key={item.id}>
        <button
          onClick={() => handleItemClick(item)}
          className={cn(
            "w-full text-left px-2 py-1 flex items-start gap-1 rounded text-xs transition-colors",
            "hover:bg-muted/50",
            isCurrentPage && "bg-primary/10 text-primary"
          )}
          style={{ paddingLeft: `${8 + item.depth * 12}px` }}
        >
          {hasChildren ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(item.id);
              }}
              className="mt-0.5 flex-shrink-0 cursor-pointer hover:bg-muted rounded"
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <span
            className={cn(
              "flex-1 leading-tight",
              item.bold && "font-semibold",
              item.italic && "italic"
            )}
          >
            {item.title}
          </span>
          {item.pageNumber && (
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {item.pageNumber}
            </span>
          )}
        </button>
        {hasChildren && isExpanded && (
          <div>{item.children.map(renderItem)}</div>
        )}
      </div>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-muted-foreground border-t-transparent mb-3" />
        <p className="text-xs text-muted-foreground">Loading outline...</p>
      </div>
    );
  }

  // Empty state
  if (!outline || outline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <FileQuestion className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          No outline available
        </p>
        <p className="text-xs text-muted-foreground text-center">
          This document doesn't have a table of contents
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-sidebar-panel>
      {/* Search header */}
      <div className="px-2 py-1.5 border-b">
        <SidebarSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search outline..."
        />
      </div>

      {/* No search results */}
      {searchQuery && filteredOutline && filteredOutline.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 px-4">
          <p className="text-xs text-muted-foreground text-center">
            No items matching "{searchQuery}"
          </p>
        </div>
      )}

      {/* Outline list */}
      {filteredOutline && filteredOutline.length > 0 && (
        <ScrollArea className="flex-1">
          <div className="py-1">
            {filteredOutline.map(renderItem)}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
