import { useEffect, useRef } from "react";
import { BookOpen, FileSearch, Search, Sparkles, X } from "lucide-react";
import { isInActiveView } from "@/lib/isInActiveView";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLibraryStore, type LibrarySearchScope } from "@/stores/libraryStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

export function QuickSearchBar() {
  const { searchQuery, setSearchQuery, searchScope, setSearchScope } = useLibraryStore();
  const { setCommandPaletteOpen, setCommandPaletteMode } = useUIStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isInActiveView(containerRef.current)) return;
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
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search entries..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className={cn(
          "h-7 w-48 pl-6 pr-10 text-sm",
          searchQuery && "border-primary"
        )}
      />
      <div className="absolute left-1 top-1/2 flex h-6 -translate-y-1/2 items-center">
        <Select
          value={searchScope}
          onValueChange={(value) => {
            if (value === "full") {
              setCommandPaletteMode("full");
              setCommandPaletteOpen(true);
              return;
            }
            if (value === "advanced") {
              setCommandPaletteMode("advanced");
              setCommandPaletteOpen(true);
              return;
            }
            if (value === "ai") {
              setCommandPaletteMode("ai");
              setCommandPaletteOpen(true);
              return;
            }
            setSearchScope(value as LibrarySearchScope);
          }}
        >
          <SelectTrigger className="h-6 w-6 border-0 bg-transparent px-0 text-xs focus:ring-0 focus:ring-offset-0 [&>span]:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="title_creator_year">Title, Creator, Year</SelectItem>
            <SelectItem value="fields_tags">All Fields &amp; Tags</SelectItem>
            <SelectSeparator />
            <SelectItem value="full">
              <span className="flex items-center gap-2">
                <FileSearch className="h-3.5 w-3.5" />
                Full Search
              </span>
            </SelectItem>
            <SelectItem value="advanced">
              <span className="flex items-center gap-2">
                <BookOpen className="h-3.5 w-3.5" />
                Advanced Search
              </span>
            </SelectItem>
            <SelectItem value="ai">
              <span className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                AI Search
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Search className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      {searchQuery && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-7 top-1/2 h-5 w-5 -translate-y-1/2"
          onClick={() => setSearchQuery("")}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
