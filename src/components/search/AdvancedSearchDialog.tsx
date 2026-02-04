import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  X,
  File,
  FileText,
  BookmarkPlus,
  Loader2,
  BookOpen,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { getEntriesPaged, type EntrySummary } from "@/services/tauri";
import { SaveSearchDialog } from "@/components/dialogs/SaveSearchDialog";
import { cn } from "@/lib/utils";

type AdvancedMatchMode = "all" | "any";
type AdvancedCriterion = {
  id: string;
  field: string;
  operator: string;
  value: string;
};
type AdvancedScope = "all" | "collection";

const advancedFields = [
  { value: "title", label: "Title" },
  { value: "creator", label: "Creator" },
  { value: "year", label: "Year" },
  { value: "publication_title", label: "Publication Title" },
  { value: "abstract", label: "Abstract" },
  { value: "tags", label: "Tags" },
  { value: "collection", label: "Collection" },
  { value: "saved_search", label: "Smart Filter" },
  { value: "item_type", label: "Item Type" },
  { value: "date_added", label: "Date Added" },
];

const advancedOperators = [
  { value: "contains", label: "contains", requiresValue: true },
  { value: "does_not_contain", label: "does not contain", requiresValue: true },
  { value: "is", label: "is", requiresValue: true },
  { value: "is_not", label: "is not", requiresValue: true },
  { value: "begins_with", label: "begins with", requiresValue: true },
  { value: "ends_with", label: "ends with", requiresValue: true },
  { value: "is_before", label: "is before", requiresValue: true },
  { value: "is_after", label: "is after", requiresValue: true },
  { value: "is_empty", label: "is empty", requiresValue: false },
  { value: "is_not_empty", label: "is not empty", requiresValue: false },
];

export function AdvancedSearchDialog() {
  const { advancedSearchOpen, setAdvancedSearchOpen } = useUIStore();
  const { collections, savedSearches, activeCollectionId } = useLibraryStore();
  const { openTab } = useTabStore();

  const [advancedMatch, setAdvancedMatch] = useState<AdvancedMatchMode>("all");
  const [advancedScope, setAdvancedScope] = useState<AdvancedScope>("all");
  const [advancedCollectionId, setAdvancedCollectionId] = useState<string>("");
  const [advancedCriteria, setAdvancedCriteria] = useState<AdvancedCriterion[]>([
    {
      id: "advanced-0",
      field: "title",
      operator: "contains",
      value: "",
    },
  ]);
  const advancedCounterRef = useRef(1);
  const [showSaveSearchDialog, setShowSaveSearchDialog] = useState(false);

  const [searchResults, setSearchResults] = useState<EntrySummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [isLoadingMoreResults, setIsLoadingMoreResults] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);

  // Initialize scope from active collection when opening
  useEffect(() => {
    if (advancedSearchOpen) {
      if (activeCollectionId) {
        setAdvancedScope("collection");
        setAdvancedCollectionId(activeCollectionId.toString());
      } else {
        setAdvancedScope("all");
        setAdvancedCollectionId("");
      }
    }
  }, [advancedSearchOpen, activeCollectionId]);

  // Search when criteria change
  useEffect(() => {
    if (!advancedSearchOpen) return;

    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    const filteredCriteria = advancedCriteria.filter((criterion) => {
      const operator = advancedOperators.find((op) => op.value === criterion.operator);
      if (!operator) return false;
      if (!operator.requiresValue) return true;
      return criterion.value.trim().length > 0;
    });

    if (filteredCriteria.length === 0) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchTotal(0);
      setSearchOffset(0);
      setHasMoreResults(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = window.setTimeout(async () => {
      try {
        const advancedSearch = {
          matchMode: advancedMatch,
          criteria: filteredCriteria.map((criterion) => ({
            field: criterion.field,
            operator: criterion.operator,
            value: criterion.value.trim() || null,
          })),
        };
        const result = await getEntriesPaged({
          advancedSearch,
          collectionId:
            advancedScope === "collection" && advancedCollectionId
              ? Number(advancedCollectionId)
              : undefined,
          limit: 20,
          offset: 0,
        });
        setSearchResults(result.entries);
        setSearchTotal(result.total);
        setSearchOffset(result.entries.length);
        setHasMoreResults(result.entries.length < result.total);
      } catch (err) {
        console.error("Search error:", err);
        setSearchResults([]);
        setSearchTotal(0);
        setSearchOffset(0);
        setHasMoreResults(false);
      } finally {
        setIsSearching(false);
      }
    }, 150);
  }, [advancedSearchOpen, advancedMatch, advancedCriteria, advancedScope, advancedCollectionId]);

  const handleLoadMoreResults = useCallback(async () => {
    if (isLoadingMoreResults || !hasMoreResults) return;
    setIsLoadingMoreResults(true);
    try {
      const filteredCriteria = advancedCriteria.filter((criterion) => {
        const operator = advancedOperators.find((op) => op.value === criterion.operator);
        if (!operator) return false;
        if (!operator.requiresValue) return true;
        return criterion.value.trim().length > 0;
      });
      const advancedSearch = {
        matchMode: advancedMatch,
        criteria: filteredCriteria.map((criterion) => ({
          field: criterion.field,
          operator: criterion.operator,
          value: criterion.value.trim() || null,
        })),
      };
      const result = await getEntriesPaged({
        advancedSearch,
        collectionId:
          advancedScope === "collection" && advancedCollectionId
            ? Number(advancedCollectionId)
            : undefined,
        limit: 20,
        offset: searchOffset,
      });
      setSearchResults((prev) => [...prev, ...result.entries]);
      const nextOffset = searchOffset + result.entries.length;
      setSearchOffset(nextOffset);
      setSearchTotal(result.total);
      setHasMoreResults(nextOffset < result.total);
    } catch (err) {
      console.error("Load more search results failed:", err);
    } finally {
      setIsLoadingMoreResults(false);
    }
  }, [advancedMatch, advancedCriteria, advancedScope, advancedCollectionId, searchOffset, hasMoreResults, isLoadingMoreResults]);

  const handleResultsScroll = useCallback(() => {
    const el = resultsContainerRef.current;
    if (!el || isLoadingMoreResults || !hasMoreResults) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      handleLoadMoreResults();
    }
  }, [isLoadingMoreResults, hasMoreResults, handleLoadMoreResults]);

  const addAdvancedCriterion = useCallback(() => {
    const id = `advanced-${advancedCounterRef.current}`;
    advancedCounterRef.current += 1;
    setAdvancedCriteria((prev) => [
      ...prev,
      {
        id,
        field: "title",
        operator: "contains",
        value: "",
      },
    ]);
  }, []);

  const updateAdvancedCriterion = useCallback(
    (id: string, updates: Partial<AdvancedCriterion>) => {
      setAdvancedCriteria((prev) =>
        prev.map((criterion) => (criterion.id === id ? { ...criterion, ...updates } : criterion))
      );
    },
    []
  );

  const removeAdvancedCriterion = useCallback((id: string) => {
    setAdvancedCriteria((prev) => (prev.length > 1 ? prev.filter((criterion) => criterion.id !== id) : prev));
  }, []);

  const handleSelectEntry = (entry: EntrySummary) => {
    openTab({
      type: "entry",
      title: entry.title,
      entryId: String(entry.id),
    });
    setAdvancedSearchOpen(false);
  };

  const hasValidCriteria = advancedCriteria.some((c) => {
    const op = advancedOperators.find((o) => o.value === c.operator);
    return !op?.requiresValue || c.value.trim();
  });

  return (
    <>
      <Dialog open={advancedSearchOpen} onOpenChange={setAdvancedSearchOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Advanced Search
            </DialogTitle>
          </DialogHeader>

          {/* Search Options */}
          <div className="px-6 py-4 border-b bg-muted/30 space-y-4">
            {/* Scope and Match controls */}
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <span className="text-muted-foreground">Search in</span>
              <Select value={advancedScope} onValueChange={(value) => setAdvancedScope(value as AdvancedScope)}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Library</SelectItem>
                  <SelectItem value="collection">Collection</SelectItem>
                </SelectContent>
              </Select>
              {advancedScope === "collection" && (
                <Select
                  value={advancedCollectionId}
                  onValueChange={(value) => setAdvancedCollectionId(value)}
                >
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue placeholder="Select collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((collection) => (
                      <SelectItem key={collection.id} value={collection.id.toString()}>
                        {collection.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <span className="text-muted-foreground/60 mx-1">|</span>
              <span className="text-muted-foreground">Match</span>
              <Select value={advancedMatch} onValueChange={(value) => setAdvancedMatch(value as AdvancedMatchMode)}>
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="any">any</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">of the following:</span>
            </div>

            {/* Criteria rows */}
            <div className="space-y-2">
              {advancedCriteria.map((criterion) => {
                const operator = advancedOperators.find((op) => op.value === criterion.operator);
                const requiresValue = operator ? operator.requiresValue : true;
                const isCollection = criterion.field === "collection";
                const isSavedSearch = criterion.field === "saved_search";
                const isDropdownField = isCollection || isSavedSearch;
                return (
                  <div key={criterion.id} className="flex items-center gap-2">
                    <Select
                      value={criterion.field}
                      onValueChange={(value) => updateAdvancedCriterion(criterion.id, { field: value })}
                    >
                      <SelectTrigger className="h-8 w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {advancedFields.map((field) => (
                          <SelectItem key={field.value} value={field.value}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={criterion.operator}
                      onValueChange={(value) => updateAdvancedCriterion(criterion.id, { operator: value })}
                    >
                      <SelectTrigger className="h-8 w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {advancedOperators
                          .filter((op) => (isDropdownField ? ["is", "is_not"].includes(op.value) : true))
                          .map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {isCollection ? (
                      <Select
                        value={criterion.value}
                        onValueChange={(value) => updateAdvancedCriterion(criterion.id, { value })}
                      >
                        <SelectTrigger className="h-8 flex-1">
                          <SelectValue placeholder="Select collection" />
                        </SelectTrigger>
                        <SelectContent>
                          {collections.map((collection) => (
                            <SelectItem key={collection.id} value={collection.id.toString()}>
                              {collection.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : isSavedSearch ? (
                      <Select
                        value={criterion.value}
                        onValueChange={(value) => updateAdvancedCriterion(criterion.id, { value })}
                      >
                        <SelectTrigger className="h-8 flex-1">
                          <SelectValue placeholder="Select smart filter" />
                        </SelectTrigger>
                        <SelectContent>
                          {savedSearches.map((search) => (
                            <SelectItem key={search.id} value={search.id.toString()}>
                              {search.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={criterion.value}
                        onChange={(event) =>
                          updateAdvancedCriterion(criterion.id, { value: event.target.value })
                        }
                        placeholder={requiresValue ? "Value" : "No value needed"}
                        disabled={!requiresValue}
                        className="h-8 flex-1"
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAdvancedCriterion(criterion.id)}
                      className="h-8 w-8 shrink-0"
                      aria-label="Remove rule"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={addAdvancedCriterion}>
                <Plus className="h-4 w-4 mr-1" />
                Add Rule
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSaveSearchDialog(true)}
                disabled={!hasValidCriteria}
              >
                <BookmarkPlus className="h-4 w-4 mr-1" />
                Save as Smart Filter
              </Button>
            </div>
          </div>

          {/* Results */}
          <div
            ref={resultsContainerRef}
            onScroll={handleResultsScroll}
            className="flex-1 overflow-y-auto min-h-0"
          >
            {isSearching && searchResults.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {hasValidCriteria ? "No results found" : "Add search criteria to find entries"}
                </p>
              </div>
            ) : (
              <div className="divide-y">
                <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30 sticky top-0">
                  Showing {searchResults.length} of {searchTotal} entries
                </div>
                {searchResults.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => handleSelectEntry(entry)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center h-8 w-8 rounded-lg shrink-0",
                        entry.hasPdf ? "bg-red-500/10" : "bg-primary/10"
                      )}
                    >
                      {entry.hasPdf ? (
                        <File className="h-4 w-4 text-red-500" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{entry.title}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {entry.creatorsDisplay}
                        {entry.year && ` (${entry.year})`}
                      </p>
                    </div>
                  </button>
                ))}
                {isLoadingMoreResults && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SaveSearchDialog
        open={showSaveSearchDialog}
        onOpenChange={setShowSaveSearchDialog}
        matchMode={advancedMatch}
        criteria={advancedCriteria.filter((c) => {
          const op = advancedOperators.find((o) => o.value === c.operator);
          return !op?.requiresValue || c.value.trim();
        }).map((c) => ({
          field: c.field,
          operator: c.operator,
          value: c.value.trim() || null,
        }))}
        scope={advancedScope}
        collectionId={advancedScope === "collection" && advancedCollectionId ? Number(advancedCollectionId) : undefined}
      />
    </>
  );
}
