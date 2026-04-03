import React, { useRef, useState, useEffect, useMemo } from "react";
import { X, ChevronDown, Pin } from "lucide-react";
import { useTabStore, getTabsForPane, type Tab } from "@/stores/tabStore";
import { cn } from "@/lib/utils";
import { tabIconMap, getAttachmentIcon } from "@/lib/icons";
import { TabContextMenu } from "./TabContextMenu";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const tabIcons: Record<Tab["type"], React.ReactNode> = {
  library: <tabIconMap.library className="h-4 w-4" />,
  item: <tabIconMap.item className="h-4 w-4" />,
  entry: <tabIconMap.entry className="h-4 w-4" />,
  markdown: <tabIconMap.markdown className="h-4 w-4" />,
  parsed: <tabIconMap.parsed className="h-4 w-4" />,
  search: <tabIconMap.search className="h-4 w-4" />,
  collection: <tabIconMap.collection className="h-4 w-4" />,
  welcome: <tabIconMap.welcome className="h-4 w-4" />,
};

function getTabIcon(tab: Tab): React.ReactNode {
  // For entry tabs with an attachment type, show the file type icon
  const attachmentType = tab.data?.attachmentType as string | undefined;
  if (tab.type === "entry" && attachmentType) {
    const { icon: Icon, className: colorClass } = getAttachmentIcon(attachmentType);
    return <Icon className={`h-4 w-4 ${colorClass}`} />;
  }
  return tabIcons[tab.type];
}

interface SortableTabProps {
  tab: Tab;
  isDragDisabled: boolean;
  children: React.ReactNode;
}

function SortableTab({ tab, isDragDisabled, children }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.id,
    disabled: isDragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("min-w-0 flex-shrink", isDragging && "opacity-50")}
    >
      {children}
    </div>
  );
}

/** Inner tab visual — shared between static Library tab and sortable tabs */
const TabInner = React.forwardRef<
  HTMLDivElement,
  {
    tab: Tab;
    isActive: boolean;
    onActivate: () => void;
    onClose?: () => void;
  } & React.HTMLAttributes<HTMLDivElement>
>(({ tab, isActive, onActivate, onClose, className, ...props }, ref) => {
  const isLibrary = tab.type === "library";
  const isPinned = !!tab.pinned;

  return (
    <div
      ref={ref}
      onClick={onActivate}
      title={tab.title}
      {...props}
      className={cn(
        "group relative flex items-center gap-2 h-8 px-3 rounded-md cursor-pointer transition-all duration-200",
        "flex-shrink min-w-0",
        isPinned ? "max-w-[160px]" : "max-w-[200px]",
        // Library tab: subtle indigo theme
        isLibrary && !isActive && "bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900/70 dark:text-indigo-100/70 border border-indigo-200/30 dark:border-indigo-800/20",
        isLibrary && isActive && "bg-indigo-100/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 shadow-sm border border-indigo-200/50 dark:border-indigo-700/30",
        // Regular/pinned tab styling
        !isLibrary && isActive && "bg-accent text-foreground",
        !isLibrary && !isActive && "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        className
      )}
    >
      {/* Pin indicator for pinned tabs */}
      {isPinned && !isLibrary && (
        <Pin className="h-2.5 w-2.5 flex-shrink-0 text-muted-foreground/60 -mr-1" />
      )}

      {/* Icon */}
      <span
        className={cn(
          "flex-shrink-0",
          isLibrary && isActive ? "text-indigo-600 dark:text-indigo-400" : "",
          !isLibrary && isActive ? "text-primary" : "",
          !isActive ? "text-muted-foreground" : ""
        )}
      >
        {getTabIcon(tab)}
      </span>

      {/* Title */}
      <span className="text-sm truncate min-w-0">{tab.title}</span>

      {/* Close button - not shown for library tab or pinned tabs */}
      {!isLibrary && !isPinned && onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "flex-shrink-0 p-0.5 rounded hover:bg-muted transition-opacity ml-1",
            "opacity-0 group-hover:opacity-100",
            isActive && "opacity-60 hover:opacity-100"
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Active indicator line */}
      {isActive && (
        <div className={cn(
          "absolute bottom-0 left-2 right-2 h-0.5 rounded-full",
          isLibrary ? "bg-indigo-500 dark:bg-indigo-400" : "bg-primary"
        )} />
      )}
    </div>
  );
});
TabInner.displayName = "TabInner";

const MIN_TAB_WIDTH = 144;
const OVERFLOW_BTN_WIDTH = 40;

export function TabBar({ pane = "left" }: { pane?: "left" | "right" }) {
  const {
    tabs: allTabs,
    activeTabId,
    activeRightTabId,
    setActiveTab,
    closeTab,
    splitEnabled,
  } = useTabStore();

  // Pane-level drop zone for cross-pane tab moves
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `pane-drop-${pane}` });

  // Check if something is actively being dragged from the OTHER pane
  const { active } = useDndContext();
  const isDraggingFromOtherPane = (() => {
    if (!active || !splitEnabled) return false;
    const draggedTab = allTabs.find((t) => t.id === active.id);
    if (!draggedTab) return false;
    return (draggedTab.pane ?? "left") !== pane;
  })();

  // Filter tabs for this pane
  const paneTabs = getTabsForPane(allTabs, pane);
  const currentActiveId = pane === "left" ? activeTabId : activeRightTabId;

  // Separate library tab (static, not sortable) from other tabs — only in left pane
  const libraryTab = pane === "left" ? paneTabs.find((t) => t.type === "library") : undefined;
  const sortableTabs = paneTabs.filter((t) => t.type !== "library");

  // Overflow logic: measure container, calculate how many tabs fit at MIN_TAB_WIDTH
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(999);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const recalculate = () => {
      const available = el.offsetWidth;
      const count = sortableTabs.length;
      if (count === 0) { setVisibleCount(0); return; }
      if (count * MIN_TAB_WIDTH <= available) { setVisibleCount(count); return; }
      const usable = available - OVERFLOW_BTN_WIDTH;
      setVisibleCount(Math.max(1, Math.min(Math.floor(usable / MIN_TAB_WIDTH), count)));
    };
    recalculate();
    const observer = new ResizeObserver(recalculate);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sortableTabs.length]);

  // Ensure active tab is always in the visible set
  const { visibleTabs, overflowTabs } = useMemo(() => {
    if (visibleCount >= sortableTabs.length) {
      return { visibleTabs: sortableTabs, overflowTabs: [] as Tab[] };
    }
    const activeIdx = sortableTabs.findIndex((t) => t.id === currentActiveId);
    if (activeIdx >= visibleCount) {
      const reordered = [...sortableTabs];
      const [activeT] = reordered.splice(activeIdx, 1);
      reordered.splice(visibleCount - 1, 0, activeT);
      return {
        visibleTabs: reordered.slice(0, visibleCount),
        overflowTabs: reordered.slice(visibleCount),
      };
    }
    return {
      visibleTabs: sortableTabs.slice(0, visibleCount),
      overflowTabs: sortableTabs.slice(visibleCount),
    };
  }, [sortableTabs, visibleCount, currentActiveId]);

  const visibleIds = visibleTabs.map((t) => t.id);

  if (paneTabs.length === 0) {
    return (
      <div
        ref={setDropRef}
        className={cn(
          "h-10 flex items-center px-4 text-sm text-muted-foreground",
          isDraggingFromOtherPane && isOver && "bg-primary/10 ring-1 ring-inset ring-primary/30"
        )}
      >
        No open tabs
      </div>
    );
  }

  return (
    <div
      ref={setDropRef}
      className={cn(
        "flex items-center h-10 px-2 gap-1 overflow-hidden",
        isDraggingFromOtherPane && isOver && "bg-primary/10 ring-1 ring-inset ring-primary/30"
      )}
    >
      {/* Library tab — static, not part of sortable context */}
      {libraryTab && (
        <TabContextMenu tab={libraryTab} tabIndex={0} totalTabs={paneTabs.length} pane={pane}>
          <TabInner
            tab={libraryTab}
            isActive={libraryTab.id === currentActiveId}
            onActivate={() => setActiveTab(libraryTab.id)}
          />
        </TabContextMenu>
      )}

      {/* Sortable visible tabs */}
      <div ref={containerRef} className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        <SortableContext items={visibleIds} strategy={horizontalListSortingStrategy}>
          {visibleTabs.map((tab, index) => {
            const globalIndex = libraryTab ? index + 1 : index;
            return (
              <SortableTab key={tab.id} tab={tab} isDragDisabled={false}>
                <TabContextMenu tab={tab} tabIndex={globalIndex} totalTabs={paneTabs.length} pane={pane}>
                  <TabInner
                    tab={tab}
                    isActive={tab.id === currentActiveId}
                    onActivate={() => setActiveTab(tab.id)}
                    onClose={() => closeTab(tab.id)}
                  />
                </TabContextMenu>
              </SortableTab>
            );
          })}
        </SortableContext>
      </div>

      {/* Overflow dropdown */}
      {overflowTabs.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-0.5 px-1.5 h-7 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors flex-shrink-0"
              title={`${overflowTabs.length} more tab${overflowTabs.length > 1 ? "s" : ""}`}
            >
              {overflowTabs.length}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 max-h-[300px] overflow-y-auto" align="end">
            {overflowTabs.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                className="flex items-center gap-2"
                onSelect={() => setActiveTab(tab.id)}
              >
                <span className="flex-shrink-0">{getTabIcon(tab)}</span>
                <span className={cn("truncate flex-1", tab.id === currentActiveId && "font-medium text-primary")}>
                  {tab.title}
                </span>
                {!tab.pinned && (
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    className="flex-shrink-0 p-0.5 rounded-sm hover:bg-foreground/10 opacity-50 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
