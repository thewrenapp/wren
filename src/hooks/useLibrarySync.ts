import { useEffect, useCallback, useRef } from 'react';
import { useLibraryStore } from '@/stores/libraryStore';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/stores/toastStore';
import * as tauri from '@/services/tauri';

/**
 * Hook to sync library store with the Tauri backend.
 * Should be used once at the app root level.
 */
export function useLibrarySync() {
  const {
    setEntries,
    appendEntries,
    setCollections,
    setTags,
    setTrashCount,
    setLoading,
    setLoadingMore,
    setError,
    setEntryCounts,
    setCurrentTotal,
    setHasMore,
    setPageOffset,
    resetPaging,
    activeCollectionId,
    activeTagIds,
    tagFilterMode,
    activeFilter,
    searchQuery,
    searchScope,
    _setRefreshFn,
    _setLoadMoreFn,
    hasMore,
    pageOffset,
    isLoadingMore,
  } = useLibraryStore();
  const {
    activeFilter: uiFilter,
    sortField,
    sortDirection,
    secondarySortField,
    secondarySortDirection,
  } = useUIStore();

  const isMounted = useRef(false);
  const pageSize = 20;

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Check if we're in tag mode with no tags selected - show empty
      const isEmptyTagMode = activeFilter.type === 'tag' && activeTagIds.length === 0;

      resetPaging();
      // Load entries (first page), counts, collections, tags, and trash count in parallel
      const [page, counts, collections, tags, trashCount] = await Promise.all([
        isEmptyTagMode
          ? Promise.resolve({ entries: [], total: 0 }) // Empty entries for tag mode with no selection
          : tauri.getEntriesPaged({
              collectionId: activeCollectionId ? Number(activeCollectionId) : undefined,
              tagIds: activeTagIds.length > 0 ? activeTagIds : undefined,
              tagMode: activeTagIds.length > 1 ? tagFilterMode : undefined,
              searchQuery: searchQuery || undefined,
              searchScope,
              filterType: uiFilter || undefined,
              sortField,
              sortDirection,
              secondarySortField: secondarySortField || undefined,
              secondarySortDirection: secondarySortDirection || undefined,
              limit: pageSize,
              offset: 0,
            }),
        tauri.getEntryCounts(),
        tauri.getCollections(),
        tauri.getTags(),
        tauri.getTrashCount(),
      ]);

      // Debug: log first entry to check itemType fields
      if (page.entries.length > 0) {
        console.log('First entry itemType data:', {
          itemType: page.entries[0].itemType,
          itemTypeDisplay: page.entries[0].itemTypeDisplay,
        });
      }

      // Set data directly - no ID conversion needed (using numbers now)
      setEntries(page.entries);
      setCurrentTotal(page.total);
      setHasMore(page.entries.length < page.total);
      setPageOffset(page.entries.length);
      setEntryCounts(counts);
      setCollections(collections);
      setTags(tags);
      setTrashCount(trashCount);
    } catch (err) {
      console.error('Failed to load library:', err);
      const message = err instanceof Error ? err.message : 'Failed to load library';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [
    setEntries,
    setCollections,
    setTags,
    setTrashCount,
    setLoading,
    setError,
    setEntryCounts,
    setCurrentTotal,
    setHasMore,
    setPageOffset,
    resetPaging,
    activeCollectionId,
    activeTagIds,
    tagFilterMode,
    activeFilter,
    searchQuery,
    searchScope,
    pageSize,
    uiFilter,
    sortField,
    sortDirection,
    secondarySortField,
    secondarySortDirection,
  ]);

  const loadMoreInFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current || isLoadingMore || !hasMore) return;
    loadMoreInFlight.current = true;
    setLoadingMore(true);
    try {
      const page = await tauri.getEntriesPaged({
        collectionId: activeCollectionId ? Number(activeCollectionId) : undefined,
        tagIds: activeTagIds.length > 0 ? activeTagIds : undefined,
        tagMode: activeTagIds.length > 1 ? tagFilterMode : undefined,
        searchQuery: searchQuery || undefined,
        searchScope,
        filterType: uiFilter || undefined,
        sortField,
        sortDirection,
        secondarySortField: secondarySortField || undefined,
        secondarySortDirection: secondarySortDirection || undefined,
        limit: pageSize,
        offset: pageOffset,
      });
      appendEntries(page.entries);
      setCurrentTotal(page.total);
      setHasMore(pageOffset + page.entries.length < page.total);
      setPageOffset(pageOffset + page.entries.length);
    } catch (err) {
      console.error('Failed to load more entries:', err);
    } finally {
      setLoadingMore(false);
      loadMoreInFlight.current = false;
    }
  }, [
    activeCollectionId,
    activeTagIds,
    tagFilterMode,
    searchQuery,
    searchScope,
    uiFilter,
    sortField,
    sortDirection,
    secondarySortField,
    secondarySortDirection,
    pageSize,
    pageOffset,
    hasMore,
    isLoadingMore,
    appendEntries,
    setCurrentTotal,
    setHasMore,
    setPageOffset,
    setLoadingMore,
  ]);

  // Store refresh function in Zustand store (replaces global mutable state)
  useEffect(() => {
    _setRefreshFn(loadLibrary);
    _setLoadMoreFn(loadMore);
    return () => {
      _setRefreshFn(null);
      _setLoadMoreFn(null);
    };
  }, [loadLibrary, loadMore, _setRefreshFn, _setLoadMoreFn]);

  // Load library on mount
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      loadLibrary();
    }
  }, [loadLibrary]);

  // Reload library when filters/search change
  useEffect(() => {
    if (isMounted.current) {
      loadLibrary();
    }
  }, [activeCollectionId, activeTagIds, tagFilterMode, uiFilter, searchQuery, searchScope, sortField, sortDirection, secondarySortField, secondarySortDirection, loadLibrary]);

  return { refresh: loadLibrary, loadMore };
}

/**
 * Hook to import PDFs using the Tauri backend.
 * Uses store's refreshLibrary action for refresh.
 */
export function useImport() {
  const { setLoading, setError, refreshLibrary, invalidateAttachments } = useLibraryStore();

  const importFiles = useCallback(
    async (filePaths: string[]) => {
      setLoading(true);
      setError(null);

      try {
        const results = await tauri.importPdfs(filePaths);

        // Check for any errors
        const errors = results.filter(
          (r) => !r.success && r.error !== 'File already exists in library',
        );
        const successes = results.filter((r) => r.success);

        if (errors.length > 0) {
          console.warn('Some imports failed:', errors);
          toast.warning(`${errors.length} file(s) failed to import`);
        }

        if (successes.length > 0) {
          toast.success(`Imported ${successes.length} PDF${successes.length !== 1 ? 's' : ''}`);
        }

        // Invalidate attachment cache so expanded rows refetch attachment names
        invalidateAttachments();
        // Refresh library to show new entries
        await refreshLibrary();

        return results;
      } catch (err) {
        console.error('Failed to import files:', err);
        const message = err instanceof Error ? err.message : 'Failed to import files';
        setError(message);
        toast.error(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refreshLibrary, setLoading, setError, invalidateAttachments],
  );

  const importFolder = useCallback(
    async (folderPath: string) => {
      setLoading(true);
      setError(null);

      try {
        const results = await tauri.importFolder(folderPath);

        // Check for any errors
        const errors = results.filter(
          (r) => !r.success && r.error !== 'File already exists in library',
        );
        const successes = results.filter((r) => r.success);

        if (errors.length > 0) {
          console.warn('Some imports failed:', errors);
          toast.warning(`${errors.length} file(s) failed to import`);
        }

        if (successes.length > 0) {
          toast.success(
            `Imported ${successes.length} PDF${successes.length !== 1 ? 's' : ''} from folder`,
          );
        } else if (errors.length === 0) {
          toast.info('No new PDFs found in folder');
        }

        // Invalidate attachment cache so expanded rows refetch attachment names
        invalidateAttachments();
        // Refresh library to show new entries
        await refreshLibrary();

        return results;
      } catch (err) {
        console.error('Failed to import folder:', err);
        const message = err instanceof Error ? err.message : 'Failed to import folder';
        setError(message);
        toast.error(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refreshLibrary, setLoading, setError, invalidateAttachments],
  );

  const importBiblatex = useCallback(
    async (biblatexPath: string, filesBasePath?: string) => {
      setLoading(true);
      setError(null);

      try {
        const result = await tauri.importBiblatexWithFiles(biblatexPath, filesBasePath);

        if (result.errors.length > 0) {
          console.warn('Some imports failed:', result.errors);
          toast.warning(`${result.errors.length} entry/entries failed to import`);
        }

        if (result.imported > 0) {
          let message = `Imported ${result.imported} ${result.imported !== 1 ? 'entries' : 'entry'}`;
          if (result.filesImported > 0) {
            message += ` with ${result.filesImported} file${result.filesImported !== 1 ? 's' : ''}`;
          }
          if (result.tagsCreated > 0) {
            message += ` and ${result.tagsCreated} tag${result.tagsCreated !== 1 ? 's' : ''}`;
          }
          toast.success(message);
        } else if (result.skipped > 0) {
          toast.info(`${result.skipped} entries skipped (already exist)`);
        } else {
          toast.info('No entries imported');
        }

        // Invalidate attachment cache so expanded rows refetch attachment names
        invalidateAttachments();
        // Refresh library to show new entries
        await refreshLibrary();

        return result;
      } catch (err) {
        console.error('Failed to import BibLaTeX:', err);
        const message = err instanceof Error ? err.message : 'Failed to import BibLaTeX';
        setError(message);
        toast.error(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refreshLibrary, setLoading, setError, invalidateAttachments],
  );

  return { importFiles, importFolder, importBiblatex, refresh: refreshLibrary };
}
