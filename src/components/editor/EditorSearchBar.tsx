import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { SearchOptions } from "./useMarkdownSearch";

interface EditorSearchBarProps {
  onSearch: (query: string, options: SearchOptions) => void;
  onSearchNext: () => void;
  onSearchPrev: () => void;
  onSearchClear: () => void;
  searchMatchCount: number;
  searchCurrentMatch: number;
  onClose: () => void;
}

export function EditorSearchBar({
  onSearch,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  searchMatchCount,
  searchCurrentMatch,
  onClose,
}: EditorSearchBarProps) {
  const [query, setQuery] = useState("");
  const [highlightAll, setHighlightAll] = useState(true);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (value) {
        onSearch(value, { highlightAll, matchCase, wholeWords });
      } else {
        onSearchClear();
      }
    },
    [onSearch, onSearchClear, highlightAll, matchCase, wholeWords],
  );

  const handleOptionChange = useCallback(
    (opts: Partial<SearchOptions>) => {
      const next = { highlightAll, matchCase, wholeWords, ...opts };
      if (opts.highlightAll !== undefined) setHighlightAll(opts.highlightAll);
      if (opts.matchCase !== undefined) setMatchCase(opts.matchCase);
      if (opts.wholeWords !== undefined) setWholeWords(opts.wholeWords);
      if (query) {
        onSearch(query, next);
      }
    },
    [query, onSearch, highlightAll, matchCase, wholeWords],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          type="text"
          placeholder="Find in Document"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.shiftKey ? onSearchPrev() : onSearchNext();
            }
            if (e.key === "Escape") {
              onClose();
            }
          }}
          className="flex-1 h-8"
        />
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onSearchPrev} disabled={searchMatchCount === 0}>
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onSearchNext} disabled={searchMatchCount === 0}>
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {query && (
        <div className="text-xs text-muted-foreground">
          {searchMatchCount > 0
            ? `${searchCurrentMatch} of ${searchMatchCount} matches`
            : "No matches found"}
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Checkbox id="sb-highlight" checked={highlightAll} onCheckedChange={(c) => handleOptionChange({ highlightAll: c === true })} />
          <Label htmlFor="sb-highlight" className="text-xs cursor-pointer">Highlight all</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox id="sb-case" checked={matchCase} onCheckedChange={(c) => handleOptionChange({ matchCase: c === true })} />
          <Label htmlFor="sb-case" className="text-xs cursor-pointer">Match case</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox id="sb-words" checked={wholeWords} onCheckedChange={(c) => handleOptionChange({ wholeWords: c === true })} />
          <Label htmlFor="sb-words" className="text-xs cursor-pointer">Whole words</Label>
        </div>
      </div>
    </div>
  );
}
