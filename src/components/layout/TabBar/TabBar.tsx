import { X, FileText, File, Search, Home, Library, BookOpen } from "lucide-react";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { cn } from "@/lib/utils";

const tabIcons: Record<Tab["type"], React.ReactNode> = {
  library: <Library className="h-4 w-4" />,
  item: <FileText className="h-4 w-4" />,
  entry: <BookOpen className="h-4 w-4" />,
  search: <Search className="h-4 w-4" />,
  collection: <File className="h-4 w-4" />,
  welcome: <Home className="h-4 w-4" />,
};

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
    <div className="flex items-center h-10 px-2 gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group relative flex items-center gap-2 h-8 px-3 rounded-md cursor-pointer transition-colors",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            {/* Icon */}
            <span className={cn(
              isActive ? "text-primary" : "text-muted-foreground"
            )}>
              {tabIcons[tab.type]}
            </span>

            {/* Title */}
            <span className="text-sm max-w-[150px] truncate">
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
                  "p-0.5 rounded hover:bg-muted transition-opacity ml-1",
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
