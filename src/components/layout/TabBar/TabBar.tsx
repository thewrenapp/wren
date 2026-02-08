import { X } from "lucide-react";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { cn } from "@/lib/utils";
import { tabIconMap, getAttachmentIcon } from "@/lib/icons";

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

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabStore();

  if (tabs.length === 0) {
    return (
      <div className="h-10 flex items-center px-4 text-sm text-muted-foreground">
        No open tabs
      </div>
    );
  }

  return (
    <div className="flex items-center h-10 px-2 gap-1 overflow-hidden">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group relative flex items-center gap-2 h-8 px-3 rounded-md cursor-pointer transition-colors",
              "flex-shrink min-w-0 max-w-[200px]",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            {/* Icon */}
            <span className={cn(
              "flex-shrink-0",
              isActive ? "text-primary" : "text-muted-foreground"
            )}>
              {getTabIcon(tab)}
            </span>

            {/* Title */}
            <span className="text-sm truncate min-w-0">
              {tab.title}
            </span>

            {/* Close button - not shown for library tab */}
            {tab.type !== "library" && (
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
        );
      })}
    </div>
  );
}
