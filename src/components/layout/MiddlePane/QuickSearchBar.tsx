import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLibraryStore } from "@/stores/libraryStore";
import { cn } from "@/lib/utils";

export function QuickSearchBar() {
  const { searchQuery, setSearchQuery } = useLibraryStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+F to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Escape to clear and blur search
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        setSearchQuery("");
        inputRef.current?.blur();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setSearchQuery]);

  return (
    <div className="relative flex items-center">
      <Search className="absolute left-2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search entries..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className={cn(
          "h-7 w-48 pl-8 pr-8 text-sm",
          searchQuery && "border-primary"
        )}
      />
      {searchQuery && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 h-7 w-7"
          onClick={() => setSearchQuery("")}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
