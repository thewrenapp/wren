import DOMPurify from "dompurify";
import { Command } from "cmdk";
import {
  Search, File, FileText, StickyNote, Sparkles, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EntrySummary, FullSearchResult, RagSearchResult } from "@/services/tauri";

export interface SearchState {
  search: string;
  setSearch: (val: string) => void;
  searchMode: "quick" | "full" | "semantic";
  setSearchMode: (mode: "quick" | "full" | "semantic") => void;
  quickScope: "title_creator_year" | "fields_tags";
  setQuickScope: (scope: "title_creator_year" | "fields_tags") => void;
  searchResults: EntrySummary[];
  setSearchResults: React.Dispatch<React.SetStateAction<EntrySummary[]>>;
  fullSearchResults: FullSearchResult[];
  setFullSearchResults: React.Dispatch<React.SetStateAction<FullSearchResult[]>>;
  semanticResults: RagSearchResult[];
  setSemanticResults: React.Dispatch<React.SetStateAction<RagSearchResult[]>>;
  searchPipeline: { strategy: string; reranked: boolean; cragActive: boolean; raptorActive: boolean; queryTimeMs: number } | null;
  setSearchPipeline: React.Dispatch<React.SetStateAction<SearchState["searchPipeline"]>>;
  isSearching: boolean;
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>;
  searchTotal: number;
  setSearchTotal: React.Dispatch<React.SetStateAction<number>>;
  searchOffset: number;
  setSearchOffset: React.Dispatch<React.SetStateAction<number>>;
  hasMoreResults: boolean;
  setHasMoreResults: React.Dispatch<React.SetStateAction<boolean>>;
  searchError: string | null;
  setSearchError: React.Dispatch<React.SetStateAction<string | null>>;
}

interface SearchResultsProps {
  state: SearchState;
  isLoadingMoreResults: boolean;
  onSelect: (callback: () => void) => void;
  onOpenTab: (tab: { type: "entry"; title: string; entryId?: string; attachmentId?: string }) => void;
}

export function SearchResults({ state, isLoadingMoreResults, onSelect, onOpenTab }: SearchResultsProps) {
  const { searchResults, fullSearchResults, semanticResults, searchPipeline, isSearching, searchTotal, searchError, searchMode } = state;

  return (
    <>
      <Command.Empty className="py-12 text-center">
        <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        {isSearching ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {searchMode === "semantic" ? "Running semantic search\u2026" : "Searching\u2026"}
            </p>
            {searchMode === "semantic" && (
              <p className="text-[10px] text-muted-foreground/50">
                Embedding query → vector search → reranking → evaluating relevance
              </p>
            )}
          </div>
        ) : searchError ? (
          <>
            <p className="text-sm text-destructive">{searchError}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Open Settings to fix the configuration
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">No results found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Try adjusting your search or import new PDFs
            </p>
          </>
        )}
      </Command.Empty>

      {searchResults.length > 0 && (
        <Command.Group>
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            Entries
          </div>
          {searchResults.map((entry) => (
            <Command.Item
              key={entry.id}
              value={entry.title}
              onSelect={() =>
                onSelect(() =>
                  onOpenTab({
                    type: "entry",
                    title: entry.title,
                    entryId: String(entry.id),
                  })
                )
              }
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <div className={cn(
                "flex items-center justify-center h-8 w-8 rounded-lg",
                entry.hasPdf ? "bg-red-500/10" : "bg-primary/10"
              )}>
                {entry.hasPdf ? (
                  <File className="h-4 w-4 text-red-500" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{entry.title}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.creatorsDisplay || entry.itemType}
                </span>
              </div>
            </Command.Item>
          ))}
          {searchTotal > 0 && (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">
              {isLoadingMoreResults ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading more\u2026
                </span>
              ) : (
                `Showing ${searchResults.length} of ${searchTotal}`
              )}
            </div>
          )}
        </Command.Group>
      )}

      {fullSearchResults.length > 0 && (
        <Command.Group>
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            Content Matches ({fullSearchResults.length})
          </div>
          {fullSearchResults.map((result, idx) => (
            <Command.Item
              key={`${result.entryId}-${result.attachmentId ?? 'meta'}-${idx}`}
              value={`${result.title} ${result.snippet}`}
              onSelect={() =>
                onSelect(() =>
                  onOpenTab({
                    type: "entry",
                    title: result.title || "Untitled",
                    entryId: String(result.entryId),
                    attachmentId: result.attachmentId ? String(result.attachmentId) : undefined,
                  })
                )
              }
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <div className={cn(
                "flex items-center justify-center h-8 w-8 rounded-lg mt-0.5",
                result.contentSource === "pdf" ? "bg-red-500/10" : "bg-primary/10"
              )}>
                {result.contentSource === "pdf" ? (
                  <File className="h-4 w-4 text-red-500" />
                ) : result.contentSource === "note" ? (
                  <StickyNote className="h-4 w-4 text-primary" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{result.title || "Untitled"}</span>
                {result.snippet && (
                  <p
                    className="text-xs text-muted-foreground line-clamp-2 mt-0.5"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.snippet) }}
                  />
                )}
                <span className="text-xs text-muted-foreground/60 mt-0.5">
                  {result.contentSource} · score: {result.score.toFixed(2)}
                </span>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}

      {semanticResults.length > 0 && (
        <Command.Group>
          <div className="px-2 py-1.5 space-y-0.5">
            <div className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Semantic Results ({semanticResults.length})
            </div>
            {searchPipeline && (
              <div className="flex gap-2 text-[10px] text-muted-foreground/50">
                <span>{searchPipeline.strategy === "auto" ? "auto" : searchPipeline.strategy}</span>
                {searchPipeline.raptorActive && <span>+ RAPTOR</span>}
                {searchPipeline.reranked && <span>+ reranked</span>}
                {searchPipeline.cragActive && <span>+ CRAG</span>}
                <span>{searchPipeline.queryTimeMs}ms</span>
              </div>
            )}
          </div>
          {semanticResults.map((result, idx) => (
            <Command.Item
              key={`semantic-${result.chunkId}-${idx}`}
              value={`${result.entryTitle || result.filename} ${result.content.slice(0, 100)}`}
              onSelect={() =>
                result.entryId ? onSelect(() =>
                  onOpenTab({
                    type: "entry",
                    title: result.entryTitle || "Untitled",
                    entryId: String(result.entryId),
                  })
                ) : undefined
              }
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <div className="flex items-center justify-center h-8 w-8 rounded-lg mt-0.5 bg-violet-500/10">
                <Sparkles className="h-4 w-4 text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{result.entryTitle || result.filename || "Untitled"}</span>
                {result.sectionName && (
                  <span className="text-xs text-muted-foreground">{result.sectionName}</span>
                )}
                <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-2">{result.content.slice(0, 200)}</p>
                <span className="text-xs text-muted-foreground/60 mt-0.5">
                  relevance: {(result.relevanceScore * 100).toFixed(0)}%
                </span>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}
