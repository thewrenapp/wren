import { Search } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const { toggleCommandPalette } = useUIStore();

  const startDrag = async (e: React.MouseEvent) => {
    // Don't drag if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("input")) {
      return;
    }
    e.preventDefault();
    await getCurrentWindow().startDragging();
  };

  return (
    <div
      onMouseDown={startDrag}
      className="flex items-center justify-center h-12 px-4 titlebar-gradient border-b border-sidebar-border cursor-default"
    >
      {/* Search bar - centered, the area around it is draggable */}
      <button
        onClick={toggleCommandPalette}
        className="flex items-center gap-2 w-full max-w-lg h-8 px-3 rounded-md bg-background/60 border border-border/50 text-muted-foreground hover:bg-background hover:border-border transition-colors"
      >
        <Search className="h-4 w-4" />
        <span className="text-sm flex-1 text-left">Search...</span>
        <kbd className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground/70">
          ⌘K
        </kbd>
      </button>
    </div>
  );
}
