import { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronRight, FileQuestion } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SidebarSearchInput } from "@/components/pdf/SidebarSearchInput";
import type { Book, NavItem } from "epubjs";

interface TocItem {
  id: string;
  label: string;
  href: string;
  children: TocItem[];
}

interface EPUBOutlinePanelProps {
  book: Book | null;
  onNavigate: (href: string) => void;
  currentHref?: string;
}

function buildTocTree(navItems: NavItem[], prefix = ""): TocItem[] {
  return navItems.map((item, i) => ({
    id: `${prefix}toc-${i}`,
    label: item.label?.trim() || "(Untitled)",
    href: item.href,
    children: item.subitems ? buildTocTree(item.subitems, `${prefix}${i}-`) : [],
  }));
}

export function EPUBOutlinePanel({ book, onNavigate, currentHref }: EPUBOutlinePanelProps) {
  const [outline, setOutline] = useState<TocItem[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Extract TOC from epub book
  useEffect(() => {
    if (!book) {
      setOutline(null);
      return;
    }

    book.loaded.navigation.then((nav) => {
      const toc = nav.toc;
      if (!toc || toc.length === 0) {
        setOutline(null);
        return;
      }

      const tree = buildTocTree(toc);
      setOutline(tree);

      // Initially expand top-level items
      const initialExpanded = new Set<string>();
      tree.forEach((item) => {
        if (item.children.length > 0) {
          initialExpanded.add(item.id);
        }
      });
      setExpandedItems(initialExpanded);
    }).catch(() => {
      setOutline(null);
    });
  }, [book]);

  // Update active item based on current href
  useEffect(() => {
    if (!outline || !currentHref) return;

    const findItem = (items: TocItem[]): string | null => {
      for (const item of items) {
        // Match href (may include fragment)
        if (currentHref.includes(item.href) || item.href.includes(currentHref.split("#")[0])) {
          return item.id;
        }
        const childMatch = findItem(item.children);
        if (childMatch) return childMatch;
      }
      return null;
    };

    const matched = findItem(outline);
    if (matched) {
      setActiveItemId(matched);
    }
  }, [outline, currentHref]);

  // Filter outline
  const filteredOutline = useMemo(() => {
    if (!outline || !searchQuery.trim()) return outline;

    const query = searchQuery.toLowerCase();

    const filterItems = (items: TocItem[]): TocItem[] => {
      const result: TocItem[] = [];
      for (const item of items) {
        const matchesLabel = item.label.toLowerCase().includes(query);
        const filteredChildren = filterItems(item.children);
        if (matchesLabel || filteredChildren.length > 0) {
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
      const collectIds = (items: TocItem[]): string[] =>
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

  const handleItemClick = useCallback(
    (item: TocItem) => {
      onNavigate(item.href);
      setActiveItemId(item.id);
    },
    [onNavigate]
  );

  const renderItem = (item: TocItem, depth = 0) => {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isActive = item.id === activeItemId;

    return (
      <div key={item.id}>
        <button
          onClick={() => handleItemClick(item)}
          className={cn(
            "w-full text-left px-2 py-1 flex items-start gap-1 rounded text-xs transition-colors",
            "hover:bg-muted/50",
            isActive && "bg-primary/10 text-primary"
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
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
          <span className={cn("flex-1 leading-tight", depth === 0 && "font-semibold")}>
            {item.label}
          </span>
        </button>
        {hasChildren && isExpanded && (
          <div>{item.children.map((child) => renderItem(child, depth + 1))}</div>
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
          No table of contents
        </p>
        <p className="text-xs text-muted-foreground text-center">
          This EPUB doesn&apos;t have a table of contents
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
          placeholder="Search chapters..."
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
          <div className="py-1">{filteredOutline.map((item) => renderItem(item))}</div>
        </ScrollArea>
      )}
    </div>
  );
}
