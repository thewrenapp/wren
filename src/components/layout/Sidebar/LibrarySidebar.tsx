import {
  FileText,
  Files,
  Clock,
  Tag,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { cn } from "@/lib/utils";

// Map filter to display title
function getFilterTitle(filter: string): string {
  switch (filter) {
    case "pdfs":
      return "PDFs";
    case "notes":
      return "Notes";
    case "recent":
      return "Recently Added";
    case "untagged":
      return "Untagged";
    default:
      return "Library";
  }
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}

function SidebarItem({ icon, label, count, active, onClick }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
        "hover:bg-sidebar-accent",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/80"
      )}
    >
      <span className="flex-shrink-0 w-4 h-4">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onAdd?: () => void;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  onAdd,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1 px-2 py-1 group">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 flex-1 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {title}
        </button>
        {onAdd && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>
      {isOpen && <div className="space-y-0.5 px-1">{children}</div>}
    </div>
  );
}

export function LibrarySidebar() {
  const { activeFilter, setActiveFilter } = useUIStore();
  const { collections, tags, items } = useLibraryStore();
  const { tabs, updateTab } = useTabStore();

  // Update library tab title when filter changes
  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    // Find and update the library tab title
    const libraryTab = tabs.find((t) => t.type === "library");
    if (libraryTab) {
      updateTab(libraryTab.id, { title: getFilterTitle(filter) });
    }
  };

  // Calculate counts
  const pdfCount = items.filter((i) => i.type === "pdf").length;
  const noteCount = items.filter((i) => i.type === "markdown").length;
  const recentCount = items.filter((i) => {
    const added = new Date(i.dateAdded);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return added > weekAgo;
  }).length;

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 px-2 pt-2">
          {/* Library section */}
          <CollapsibleSection title="Library">
            <SidebarItem
              icon={<Files className="h-4 w-4" />}
              label="All Items"
              count={items.length}
              active={activeFilter === "all"}
              onClick={() => handleFilterChange("all")}
            />
            <SidebarItem
              icon={<FileText className="h-4 w-4" />}
              label="PDFs"
              count={pdfCount}
              active={activeFilter === "pdfs"}
              onClick={() => handleFilterChange("pdfs")}
            />
            <SidebarItem
              icon={<FileText className="h-4 w-4" />}
              label="Notes"
              count={noteCount}
              active={activeFilter === "notes"}
              onClick={() => handleFilterChange("notes")}
            />
          </CollapsibleSection>

          {/* Smart Filters */}
          <CollapsibleSection title="Smart Filters">
            <SidebarItem
              icon={<Clock className="h-4 w-4" />}
              label="Recently Added"
              count={recentCount}
              active={activeFilter === "recent"}
              onClick={() => handleFilterChange("recent")}
            />
            <SidebarItem
              icon={<Tag className="h-4 w-4" />}
              label="Untagged"
              active={activeFilter === "untagged"}
              onClick={() => handleFilterChange("untagged")}
            />
          </CollapsibleSection>

          {/* Collections */}
          <CollapsibleSection
            title="Collections"
            onAdd={() => {
              // TODO: Create collection dialog
            }}
          >
            {collections.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">
                No collections yet
              </p>
            ) : (
              collections.map((collection) => (
                <SidebarItem
                  key={collection.id}
                  icon={
                    <FolderOpen
                      className="h-4 w-4"
                      style={{ color: collection.color }}
                    />
                  }
                  label={collection.name}
                  count={collection.itemCount}
                  onClick={() => {
                    // TODO: Filter by collection
                  }}
                />
              ))
            )}
          </CollapsibleSection>

          {/* Tags */}
          <CollapsibleSection title="Tags">
            {tags.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">
                No tags yet
              </p>
            ) : (
              tags.map((tag) => (
                <SidebarItem
                  key={tag.id}
                  icon={
                    <Tag
                      className="h-4 w-4"
                      style={{ color: tag.color }}
                    />
                  }
                  label={tag.name}
                  count={tag.itemCount}
                  onClick={() => {
                    // TODO: Filter by tag
                  }}
                />
              ))
            )}
          </CollapsibleSection>
        </ScrollArea>
      </div>
  );
}
