import { useRef, useState, useEffect } from "react";
import { Command } from "cmdk";
import {
  Search, Zap, Loader2, FileSearch, Sparkles, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getEntriesPaged,
  fullTextSearch,
  ragSearch,
  type EntrySummary,
  type FullSearchResult,
  type RagSearchResult,
} from "@/services/tauri";

import type { SearchState } from "./SearchResults";
export { SearchResults } from "./SearchResults";
export type { SearchState };

export type SearchMode = "quick" | "full" | "semantic";
export type QuickSearchScope = "title_creator_year" | "fields_tags";

const searchModeConfig = {
  quick: { icon: Zap, label: "Quick", description: "Title search", hasScope: true },
  full: { icon: FileSearch, label: "Full", description: "Content search" },
  semantic: { icon: Sparkles, label: "AI", description: "Semantic" },
};

export function useSearchState(): SearchState {
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("quick");
  const [quickScope, setQuickScope] = useState<QuickSearchScope>("title_creator_year");
  const [searchResults, setSearchResults] = useState<EntrySummary[]>([]);
  const [fullSearchResults, setFullSearchResults] = useState<FullSearchResult[]>([]);
  const [semanticResults, setSemanticResults] = useState<RagSearchResult[]>([]);
  const [searchPipeline, setSearchPipeline] = useState<SearchState["searchPipeline"]>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  return {
    search, setSearch,
    searchMode, setSearchMode,
    quickScope, setQuickScope,
    searchResults, setSearchResults,
    fullSearchResults, setFullSearchResults,
    semanticResults, setSemanticResults,
    searchPipeline, setSearchPipeline,
    isSearching, setIsSearching,
    searchTotal, setSearchTotal,
    searchOffset, setSearchOffset,
    hasMoreResults, setHasMoreResults,
    searchError, setSearchError,
  };
}

export function useSearchEffects(state: SearchState) {
  const searchTimeoutRef = useRef<number | null>(null);
  const {
    search, searchMode, quickScope,
    setSearchResults, setFullSearchResults, setSemanticResults, setSearchPipeline,
    setIsSearching, setSearchError, setSearchTotal, setSearchOffset, setHasMoreResults,
  } = state;

  useEffect(() => {
    if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
    if (!search.trim()) {
      setSearchResults([]); setFullSearchResults([]); setSemanticResults([]);
      setIsSearching(false); setSearchError(null);
      setSearchTotal(0); setSearchOffset(0); setHasMoreResults(false);
      return;
    }
    setIsSearching(true); setSearchError(null);
    searchTimeoutRef.current = window.setTimeout(async () => {
      try {
        if (searchMode === "semantic") {
          setSearchPipeline(null);
          const response = await ragSearch(search.trim(), 20);
          setSemanticResults(response.results);
          setSearchPipeline({ reranked: response.reranked, queryTimeMs: response.queryTimeMs });
          setSearchResults([]); setFullSearchResults([]);
          setSearchTotal(response.totalResults); setHasMoreResults(false);
        } else if (searchMode === "full") {
          const results = await fullTextSearch(search.trim(), 50, 0);
          setFullSearchResults(results); setSearchResults([]); setSemanticResults([]);
          setSearchTotal(results.length); setHasMoreResults(false);
        } else {
          const result = await getEntriesPaged({ searchQuery: search.trim(), searchScope: quickScope, limit: 20, offset: 0 });
          setSearchResults(result.entries); setFullSearchResults([]); setSemanticResults([]);
          setSearchTotal(result.total); setSearchOffset(result.entries.length);
          setHasMoreResults(result.entries.length < result.total);
        }
      } catch (err) {
        console.error("Search error:", err);
        const errMsg = String(err);
        if (searchMode === "semantic") {
          if (errMsg.includes("dimension") || errMsg.includes("vector")) setSearchError("Embedding model mismatch — rebuild the Knowledge Graph in Settings.");
          else if (errMsg.includes("fastembed") || errMsg.includes("onnx")) setSearchError("Embedding model failed to load. Try a different model in Settings > Semantic Search.");
          else setSearchError("Concept search failed. Check your embedding configuration in Settings.");
        } else if (searchMode === "full") { setSearchError("Full-text search failed. Try rebuilding the search index in Settings."); }
        else { setSearchError(`Search failed: ${errMsg.slice(0, 120)}`); }
        setSearchResults([]); setFullSearchResults([]); setSemanticResults([]);
        setSearchTotal(0); setSearchOffset(0); setHasMoreResults(false);
      } finally { setIsSearching(false); }
    }, searchMode === "semantic" ? 600 : 150);
  }, [search, searchMode, quickScope]);
}

interface SearchInputProps {
  state: SearchState;
}

export function SearchInput({ state }: SearchInputProps) {
  const { search, setSearch, searchMode, setSearchMode, setQuickScope, isSearching } = state;

  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
      {isSearching && searchMode === "semantic" ? (
        <Loader2 className="h-5 w-5 text-primary shrink-0 animate-spin" />
      ) : (
        <Search className="h-5 w-5 text-primary shrink-0" />
      )}
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search entries, run commands..."
        className="flex-1 text-base bg-transparent outline-none placeholder:text-muted-foreground/60"
        autoFocus
      />
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
          {(["quick", "full", "semantic"] as const).map((mode) => {
            const config = searchModeConfig[mode];
            const Icon = config.icon;
            const isActive = searchMode === mode;
            const buttonClasses = cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-all",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            );

            if (mode === "quick") {
              return (
                <div key={mode} className="flex">
                  <button
                    onClick={() => { setSearchMode("quick"); setQuickScope("title_creator_year"); }}
                    title={config.description}
                    className={cn(
                      "flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-l-md transition-all",
                      isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{config.label}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        title="Change search scope"
                        className={cn(
                          "flex items-center px-1 py-1.5 text-xs font-medium rounded-r-md transition-all border-l",
                          isActive ? "bg-primary text-primary-foreground shadow-sm border-primary-foreground/20" : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
                        )}
                      >
                        <ChevronDown className="h-3 w-3 opacity-70" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[220px]">
                      <DropdownMenuItem onClick={() => { setSearchMode("quick"); setQuickScope("title_creator_year"); }}>
                        Title, Creator, Year
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setSearchMode("quick"); setQuickScope("fields_tags"); }}>
                        All Fields &amp; Tags
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            }

            return (
              <button
                key={mode}
                onClick={() => setSearchMode(mode)}
                title={config.description}
                className={buttonClasses}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{config.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function hasSearchResults(state: SearchState): boolean {
  return state.isSearching || state.searchResults.length > 0 || state.fullSearchResults.length > 0 || state.semanticResults.length > 0;
}
