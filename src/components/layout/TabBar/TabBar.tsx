import React, { useCallback } from "react";
import { X, Pin, FolderOpen, FileText, Copy, Library, ChevronRight, ArrowRightFromLine, ArrowLeftFromLine, Scale } from "lucide-react";
import { useTabStore, getTabsForPane, type Tab } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { cn } from "@/lib/utils";
import { tabIconMap, getAttachmentIcon } from "@/lib/icons";
import { showEntryInFinder, showAttachmentInFinder, showMarkdownInFinder, getEntry } from "@/services/tauri/commands";
import { useUIStore } from "@/stores/uiStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

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

function TabContextMenu({ tab, tabIndex, totalTabs, pane = "left", children }: {
  tab: Tab;
  tabIndex: number;
  totalTabs: number;
  pane?: "left" | "right";
  children: React.ReactNode;
}) {
  const {
    openTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeTabsToRight,
    pinTab,
    unpinTab,
    duplicateTab,
    moveTabToPane,
    splitEnabled,
  } = useTabStore();

  const hasEntryId = !!tab.entryId;
  const isLibrary = tab.type === "library";
  const isWelcome = tab.type === "welcome";
  const isEntry = tab.type === "entry";
  const isMarkdown = tab.type === "markdown";
  const isNote = tab.data?.attachmentType === "note";
  const hasTabsToRight = tabIndex < totalTabs - 1;

  const handleShowInLibrary = useCallback(async () => {
    if (!tab.entryId) return;
    const entryId = Number(tab.entryId);
    openTab({ type: "library", title: "Library" });

    // Check if entry is trashed (getEntry without includeDeleted throws for trashed entries)
    let isTrashed = false;
    try {
      await getEntry(entryId);
    } catch {
      isTrashed = true;
    }

    const { selectEntry, setFilter, setSearchQuery } = useLibraryStore.getState();
    const { setActiveFilter } = useUIStore.getState();

    if (isTrashed) {
      setActiveFilter("trash");
    } else {
      // Reset filters so the entry is guaranteed to be visible
      setActiveFilter("all");
      setFilter({ type: "all" });
      setSearchQuery("");
    }
    selectEntry(entryId);

    // Delay to allow library data to reload after filter change
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("wren:scroll-to-entry", {
          detail: { entryId },
        })
      );
    }, 200);
  }, [tab.entryId, openTab]);

  const handleFindInFinder = useCallback(async () => {
    if (!tab.entryId) return;
    try {
      if ((isMarkdown || tab.type === "parsed") && tab.attachmentId) {
        await showMarkdownInFinder(Number(tab.attachmentId), tab.type === "parsed");
      } else if (tab.attachmentId) {
        await showAttachmentInFinder(Number(tab.attachmentId));
      } else {
        await showEntryInFinder(Number(tab.entryId));
      }
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
  }, [tab.entryId, tab.attachmentId, tab.type, isMarkdown]);

  const handleOpenExtracted = useCallback(() => {
    if (!tab.entryId) return;
    openTab({
      type: "markdown",
      title: tab.title,
      entryId: tab.entryId,
      attachmentId: tab.attachmentId,
    });
  }, [tab, openTab]);

  const handleOpenMainFile = useCallback(() => {
    if (!tab.entryId) return;
    openTab({
      type: "entry",
      title: tab.title,
      entryId: tab.entryId,
      attachmentId: tab.attachmentId,
    });
  }, [tab, openTab]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* Navigation actions */}
        {hasEntryId && (
          <>
            <ContextMenuItem onClick={handleShowInLibrary}>
              <Library className="h-4 w-4 mr-2" />
              Show in Library
            </ContextMenuItem>
            <ContextMenuItem onClick={handleFindInFinder}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Find in Finder
            </ContextMenuItem>
            <ContextMenuItem onClick={() => useUIStore.getState().showClaimRelations(Number(tab.entryId), tab.title)}>
              <Scale className="h-4 w-4 mr-2" />
              View Claim Relations
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        {/* Cross-navigation */}
        {isEntry && hasEntryId && !isNote && (
          <>
            <ContextMenuItem onClick={handleOpenExtracted}>
              <FileText className="h-4 w-4 mr-2" />
              Open Extracted Content
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {isMarkdown && hasEntryId && (
          <>
            <ContextMenuItem onClick={handleOpenMainFile}>
              <ChevronRight className="h-4 w-4 mr-2" />
              Open Main File
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        {/* Pin/Unpin & Duplicate */}
        {!isLibrary && (
          <>
            {tab.pinned ? (
              <ContextMenuItem onClick={() => unpinTab(tab.id)}>
                <Pin className="h-4 w-4 mr-2" />
                Unpin Tab
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onClick={() => pinTab(tab.id)}>
                <Pin className="h-4 w-4 mr-2" />
                Pin Tab
              </ContextMenuItem>
            )}
          </>
        )}
        {!isLibrary && !isWelcome && (
          <ContextMenuItem onClick={() => duplicateTab(tab.id)}>
            <Copy className="h-4 w-4 mr-2" />
            Duplicate Tab
          </ContextMenuItem>
        )}

        {/* Split pane actions */}
        {!isLibrary && (
          <>
            <ContextMenuSeparator />
            {pane === "left" && (
              <ContextMenuItem onClick={() => moveTabToPane(tab.id, "right")}>
                <ArrowRightFromLine className="h-4 w-4 mr-2" />
                {splitEnabled ? "Move to Right Pane" : "Split Right"}
              </ContextMenuItem>
            )}
            {pane === "right" && (
              <ContextMenuItem onClick={() => moveTabToPane(tab.id, "left")}>
                <ArrowLeftFromLine className="h-4 w-4 mr-2" />
                Move to Left Pane
              </ContextMenuItem>
            )}
          </>
        )}

        <ContextMenuSeparator />

        {/* Close actions */}
        {!isLibrary && (
          <ContextMenuItem onClick={() => closeTab(tab.id)}>
            <X className="h-4 w-4 mr-2" />
            Close Tab
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => closeOtherTabs(tab.id)}>
          Close Other Tabs
        </ContextMenuItem>
        {hasTabsToRight && (
          <ContextMenuItem onClick={() => closeTabsToRight(tab.id)}>
            Close Tabs to the Right
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => closeAllTabs()}>
          Close All Tabs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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

  // Separate library tab (static, not sortable) from other tabs — only in left pane
  const libraryTab = pane === "left" ? paneTabs.find((t) => t.type === "library") : undefined;
  const sortableTabs = paneTabs.filter((t) => t.type !== "library");
  const sortableIds = sortableTabs.map((t) => t.id);

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

      {/* Sortable tabs — DndContext is provided by TabDndProvider above */}
      <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
        {sortableTabs.map((tab, index) => {
          // tabIndex accounts for the library tab at position 0
          const globalIndex = libraryTab ? index + 1 : index;

          return (
            <SortableTab
              key={tab.id}
              tab={tab}
              isDragDisabled={false}
            >
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
  );
}
