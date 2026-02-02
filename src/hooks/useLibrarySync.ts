import { useEffect, useCallback, useRef } from "react";
import { useLibraryStore } from "@/stores/libraryStore";
import { toast } from "@/stores/toastStore";
import * as tauri from "@/services/tauri";

/**
 * Hook to sync library store with the Tauri backend.
 * Should be used once at the app root level.
 */
export function useLibrarySync() {
  const {
    setEntries,
    setCollections,
    setTags,
    setTrashCount,
    setLoading,
    setError,
    activeCollectionId,
    activeTagId,
    _setRefreshFn,
  } = useLibraryStore();

  const isMounted = useRef(false);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Load entries, collections, tags, and trash count in parallel
      const [entries, collections, tags, trashCount] = await Promise.all([
        tauri.getEntries({
          collectionId: activeCollectionId ? Number(activeCollectionId) : undefined,
          tagId: activeTagId ? Number(activeTagId) : undefined,
        }),
        tauri.getCollections(),
        tauri.getTags(),
        tauri.getTrashCount(),
      ]);

      // Set data directly - no ID conversion needed (using numbers now)
      setEntries(entries);
      setCollections(collections);
      setTags(tags);
      setTrashCount(trashCount);
    } catch (err) {
      console.error("Failed to load library:", err);
      const message = err instanceof Error ? err.message : "Failed to load library";
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
    activeCollectionId,
    activeTagId,
  ]);

  // Store refresh function in Zustand store (replaces global mutable state)
  useEffect(() => {
    _setRefreshFn(loadLibrary);
    return () => {
      _setRefreshFn(null);
    };
  }, [loadLibrary, _setRefreshFn]);

  // Load library on mount
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      loadLibrary();
    }
  }, [loadLibrary]);

  return { refresh: loadLibrary };
}

/**
 * Hook to import PDFs using the Tauri backend.
 * Uses store's refreshLibrary action for refresh.
 */
export function useImport() {
  const { setLoading, setError, refreshLibrary } = useLibraryStore();

  const importFiles = useCallback(
    async (filePaths: string[]) => {
      setLoading(true);
      setError(null);

      try {
        const results = await tauri.importPdfs(filePaths);

        // Check for any errors
        const errors = results.filter(
          (r) => !r.success && r.error !== "File already exists in library"
        );
        const successes = results.filter((r) => r.success);

        if (errors.length > 0) {
          console.warn("Some imports failed:", errors);
          toast.warning(`${errors.length} file(s) failed to import`);
        }

        if (successes.length > 0) {
          toast.success(`Imported ${successes.length} PDF${successes.length !== 1 ? "s" : ""}`);
        }

        // Refresh library to show new entries
        await refreshLibrary();

        return results;
      } catch (err) {
        console.error("Failed to import files:", err);
        const message = err instanceof Error ? err.message : "Failed to import files";
        setError(message);
        toast.error(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refreshLibrary, setLoading, setError]
  );

  const importFolder = useCallback(
    async (folderPath: string) => {
      setLoading(true);
      setError(null);

      try {
        const results = await tauri.importFolder(folderPath);

        // Check for any errors
        const errors = results.filter(
          (r) => !r.success && r.error !== "File already exists in library"
        );
        const successes = results.filter((r) => r.success);

        if (errors.length > 0) {
          console.warn("Some imports failed:", errors);
          toast.warning(`${errors.length} file(s) failed to import`);
        }

        if (successes.length > 0) {
          toast.success(`Imported ${successes.length} PDF${successes.length !== 1 ? "s" : ""} from folder`);
        } else if (errors.length === 0) {
          toast.info("No new PDFs found in folder");
        }

        // Refresh library to show new entries
        await refreshLibrary();

        return results;
      } catch (err) {
        console.error("Failed to import folder:", err);
        const message = err instanceof Error ? err.message : "Failed to import folder";
        setError(message);
        toast.error(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refreshLibrary, setLoading, setError]
  );

  return { importFiles, importFolder, refresh: refreshLibrary };
}
