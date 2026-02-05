import { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronRight, FileQuestion } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SidebarSearchInput } from "@/components/pdf/SidebarSearchInput";

interface HeadingItem {
  id: string;
  title: string;
  level: number;
  element: Element;
  children: HeadingItem[];
}

interface HTMLOutlinePanelProps {
  iframeDoc: Document | null;
  onReady?: boolean;
}

function buildHeadingTree(headings: Element[]): HeadingItem[] {
  const root: HeadingItem[] = [];
  const stack: { item: HeadingItem; level: number }[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const level = parseInt(heading.tagName[1], 10);
    const item: HeadingItem = {
      id: `heading-${i}`,
      title: heading.textContent?.trim() || `(${heading.tagName})`,
      level,
      element: heading,
      children: [],
    };

    // Pop stack until we find a parent with lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(item);
    } else {
      stack[stack.length - 1].item.children.push(item);
    }

    stack.push({ item, level });
  }

  return root;
}

export function HTMLOutlinePanel({ iframeDoc, onReady }: HTMLOutlinePanelProps) {
  const [outline, setOutline] = useState<HeadingItem[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  // Extract headings from iframe document
  useEffect(() => {
    if (!iframeDoc || !onReady) {
      setOutline(null);
      return;
    }

    const headings = Array.from(
      iframeDoc.querySelectorAll("h1, h2, h3, h4, h5, h6")
    );

    if (headings.length === 0) {
      setOutline(null);
      return;
    }

    const tree = buildHeadingTree(headings);
    setOutline(tree);

    // Initially expand top-level items
    const initialExpanded = new Set<string>();
    tree.forEach((item) => {
      if (item.children.length > 0) {
        initialExpanded.add(item.id);
      }
    });
    setExpandedItems(initialExpanded);

    // Set up IntersectionObserver for active heading tracking
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = headings.indexOf(entry.target);
            if (idx >= 0) {
              setActiveHeadingId(`heading-${idx}`);
            }
          }
        }
      },
      {
        root: null,
        rootMargin: "-10% 0px -80% 0px",
        threshold: 0,
      }
    );

    headings.forEach((h) => observer.observe(h));

    return () => observer.disconnect();
  }, [iframeDoc, onReady]);

  // Filter outline
  const filteredOutline = useMemo(() => {
    if (!outline || !searchQuery.trim()) return outline;

    const query = searchQuery.toLowerCase();

    const filterItems = (items: HeadingItem[]): HeadingItem[] => {
      const result: HeadingItem[] = [];
      for (const item of items) {
        const matchesTitle = item.title.toLowerCase().includes(query);
        const filteredChildren = filterItems(item.children);
        if (matchesTitle || filteredChildren.length > 0) {
          result.push({ ...item, children: filteredChildren });
        }
      }
      return result;
    };

    return filterItems(outline);
  }, [outline, searchQuery]);

  // Auto-expand all when searching
  useEffect(() => {
    if (searchQuery.trim() && filteredOutline) {
      const collectIds = (items: HeadingItem[]): string[] =>
        items.flatMap((item) => [item.id, ...collectIds(item.children)]);
      setExpandedItems(new Set(collectIds(filteredOutline)));
    }
  }, [searchQuery, filteredOutline]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleItemClick = useCallback((item: HeadingItem) => {
    item.element.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveHeadingId(item.id);
  }, []);

  const renderItem = (item: HeadingItem) => {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isActive = item.id === activeHeadingId;

    return (
      <div key={item.id}>
        <button
          onClick={() => handleItemClick(item)}
          className={cn(
            "w-full text-left px-2 py-1 flex items-start gap-1 rounded text-xs transition-colors",
            "hover:bg-muted/50",
            isActive && "bg-primary/10 text-primary"
          )}
          style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
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
          <span className={cn("flex-1 leading-tight", item.level <= 2 && "font-semibold")}>
            {item.title}
          </span>
        </button>
        {hasChildren && isExpanded && (
          <div>{item.children.map(renderItem)}</div>
        )}
      </div>
    );
  };

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
          This document doesn't have headings
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-sidebar-panel>
      <div className="px-2 py-1.5 border-b">
        <SidebarSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search outline..."
        />
      </div>

      {searchQuery && filteredOutline && filteredOutline.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 px-4">
          <p className="text-xs text-muted-foreground text-center">
            No items matching &quot;{searchQuery}&quot;
          </p>
        </div>
      )}

      {filteredOutline && filteredOutline.length > 0 && (
        <ScrollArea className="flex-1">
          <div className="py-1">{filteredOutline.map(renderItem)}</div>
        </ScrollArea>
      )}
    </div>
  );
}
