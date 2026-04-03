import { useState, useCallback, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from "lucide-react";
import { isInActiveView } from "@/lib/isInActiveView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchOptions {
  highlightAll: boolean;
  matchCase: boolean;
  wholeWords: boolean;
}

interface SearchPopoverProps {
  onSearch?: (query: string, options: SearchOptions) => void;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onSearchClear?: () => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}

export function SearchPopover({
  onSearch,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  searchMatchCount = 0,
  searchCurrentMatch = 0,
  toolbarRef,
}: SearchPopoverProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightAll, setHighlightAll] = useState(true);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const performSearch = useCallback((query: string) => {
    if (query) {
      onSearch?.(query, { highlightAll, matchCase, wholeWords });
    } else {
      onSearchClear?.();
    }
  }, [onSearch, onSearchClear, highlightAll, matchCase, wholeWords]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    performSearch(value);
  }, [performSearch]);

  const handleHighlightAllChange = useCallback((checked: boolean) => {
    setHighlightAll(checked);
    if (searchQuery) {
      onSearch?.(searchQuery, { highlightAll: checked, matchCase, wholeWords });
    }
  }, [searchQuery, onSearch, matchCase, wholeWords]);

  const handleMatchCaseChange = useCallback((checked: boolean) => {
    setMatchCase(checked);
    if (searchQuery) {
      onSearch?.(searchQuery, { highlightAll, matchCase: checked, wholeWords });
    }
  }, [searchQuery, onSearch, highlightAll, wholeWords]);

  const handleWholeWordsChange = useCallback((checked: boolean) => {
    setWholeWords(checked);
    if (searchQuery) {
      onSearch?.(searchQuery, { highlightAll, matchCase, wholeWords: checked });
    }
  }, [searchQuery, onSearch, highlightAll, matchCase]);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    onSearchClear?.();
  }, [onSearchClear]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isInActiveView(toolbarRef.current)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && searchOpen) {
        handleCloseSearch();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, handleCloseSearch, toolbarRef]);

  useEffect(() => {
    const handleOpenSearch = () => setSearchOpen(true);
    window.addEventListener("wren:pdf-search", handleOpenSearch);
    window.addEventListener("wren:epub-search", handleOpenSearch);
    return () => {
      window.removeEventListener("wren:pdf-search", handleOpenSearch);
      window.removeEventListener("wren:epub-search", handleOpenSearch);
    };
  }, []);

  return (
    <Popover open={searchOpen} onOpenChange={setSearchOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7", searchOpen && "bg-accent")}
        >
          <Search className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Find in Document"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (e.shiftKey) {
                    onSearchPrev?.();
                  } else {
                    onSearchNext?.();
                  }
                }
              }}
              className="flex-1 h-8"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onSearchPrev}
              disabled={searchMatchCount === 0}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onSearchNext}
              disabled={searchMatchCount === 0}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleCloseSearch}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {searchQuery && (
            <div className="text-xs text-muted-foreground">
              {searchMatchCount > 0
                ? `${searchCurrentMatch} of ${searchMatchCount} matches`
                : "No matches found"}
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="highlight-all"
                checked={highlightAll}
                onCheckedChange={(checked) => handleHighlightAllChange(checked === true)}
              />
              <Label htmlFor="highlight-all" className="text-xs cursor-pointer">
                Highlight all
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="match-case"
                checked={matchCase}
                onCheckedChange={(checked) => handleMatchCaseChange(checked === true)}
              />
              <Label htmlFor="match-case" className="text-xs cursor-pointer">
                Match case
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="whole-words"
                checked={wholeWords}
                onCheckedChange={(checked) => handleWholeWordsChange(checked === true)}
              />
              <Label htmlFor="whole-words" className="text-xs cursor-pointer">
                Whole words
              </Label>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
