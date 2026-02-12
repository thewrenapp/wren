import { useCallback } from "react";
import { X, Pin, FolderOpen, FileText, Copy, Library, ChevronRight } from "lucide-react";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { cn } from "@/lib/utils";
import { tabIconMap, getAttachmentIcon } from "@/lib/icons";
import { showEntryInFinder } from "@/services/tauri/commands";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const tabIcons: Record<Tab["type"], React.ReactNode> = {
  library: <tabIconMap.library className="h-4 w-4" />,
  item: <tabIconMap.item className="h-4 w-4" />,
  entry: <tabIconMap.entry className="h-4 w-4" />,
  markdown: <tabIconMap.markdown className="h-4 w-4" />,
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
      className={cn(isDragging && "opacity-50")}
    >
      {children}
    </div>
  );
}

function TabContextMenu({ tab, tabIndex, totalTabs, children }: {
  tab: Tab;
  tabIndex: number;
  totalTabs: number;
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
  } = useTabStore();

  const hasEntryId = !!tab.entryId;
  const isLibrary = tab.type === "library";
  const isWelcome = tab.type === "welcome";
  const isEntry = tab.type === "entry";
  const isMarkdown = tab.type === "markdown";
  const hasTabsToRight = tabIndex < totalTabs - 1;

  const handleShowInLibrary = useCallback(() => {
    if (!tab.entryId) return;
    openTab({ type: "library", title: "Library" });
    const { selectEntry } = useLibraryStore.getState();
    selectEntry(Number(tab.entryId));
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("wren:scroll-to-entry", {
          detail: { entryId: Number(tab.entryId) },
        })
      );
    }, 50);
  }, [tab.entryId, openTab]);

  const handleFindInFinder = useCallback(async () => {
    if (!tab.entryId) return;
    try {
      await showEntryInFinder(Number(tab.entryId));
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
  }, [tab.entryId]);

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
            <ContextMenuSeparator />
          </>
        )}

        {/* Cross-navigation */}
        {isEntry && hasEntryId && (
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

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, reorderTabs } = useTabStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderTabs(oldIndex, newIndex);
      }
    },
    [tabs, reorderTabs]
  );

  if (tabs.length === 0) {
    return (
      <div className="h-10 flex items-center px-4 text-sm text-muted-foreground">
        No open tabs
      </div>
    );
  }

  const tabIds = tabs.map((t) => t.id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <div className="flex items-center h-10 px-2 gap-1 overflow-hidden">
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            const isLibrary = tab.type === "library";
            const isPinned = !!tab.pinned;
            const isDragDisabled = isLibrary;

            return (
              <SortableTab
                key={tab.id}
                tab={tab}
                isDragDisabled={isDragDisabled}
              >
                <TabContextMenu tab={tab} tabIndex={index} totalTabs={tabs.length}>
                  <div
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "group relative flex items-center gap-2 h-8 px-3 rounded-md cursor-pointer transition-colors",
                      "flex-shrink min-w-0",
                      isPinned ? "max-w-[160px]" : "max-w-[200px]",
                      // Library tab: special styling
                      isLibrary && !isActive && "bg-muted/50 text-foreground/80 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]",
                      isLibrary && isActive && "bg-muted text-foreground shadow-sm",
                      // Regular/pinned tab styling
                      !isLibrary && isActive && "bg-accent text-foreground",
                      !isLibrary && !isActive && "text-muted-foreground hover:text-foreground hover:bg-accent/50"
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
                        isActive ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {getTabIcon(tab)}
                    </span>

                    {/* Title */}
                    <span className="text-sm truncate min-w-0">{tab.title}</span>

                    {/* Close button - not shown for library tab or pinned tabs */}
                    {!isLibrary && !isPinned && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.id);
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
                      <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
                    )}
                  </div>
                </TabContextMenu>
              </SortableTab>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
