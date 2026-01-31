import { useEffect, useCallback, useRef } from "react";
import { useLibraryStore } from "@/stores/libraryStore";
import * as tauri from "@/services/tauri";

// Shared refresh function reference
let refreshFn: (() => Promise<void>) | null = null;

/**
 * Hook to sync library store with the Tauri backend.
 * Should be used once at the app root level.
 */
export function useLibrarySync() {
  const {
    setEntries,
    setCollections,
    setTags,
    setLoading,
    setError,
    activeCollectionId,
    activeTagId,
  } = useLibraryStore();

  const isMounted = useRef(false);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    console.log("Loading library...");

    try {
      // Load entries, collections, and tags in parallel
      const [entries, collections, tags] = await Promise.all([
        tauri.getEntries({
          collectionId: activeCollectionId ? Number(activeCollectionId) : undefined,
          tagId: activeTagId ? Number(activeTagId) : undefined,
        }),
        tauri.getCollections(),
        tauri.getTags(),
      ]);

      console.log("Loaded entries:", entries);
      console.log("Entries with PDF:", entries.filter(e => e.hasPdf));

      // Map entries - id conversion
      const mappedEntries = entries.map((entry) => ({
        ...entry,
        id: String(entry.id),
        tags: entry.tags.map((t) => ({ ...t, id: String(t.id) })),
      }));

      const mappedCollections = collections.map((c) => ({
        ...c,
        id: String(c.id),
      }));

      const mappedTags = tags.map((t) => ({
        ...t,
        id: String(t.id),
      }));

      setEntries(mappedEntries);
      setCollections(mappedCollections);
      setTags(mappedTags);
    } catch (err) {
      console.error("Failed to load library:", err);
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [
    setEntries,
    setCollections,
    setTags,
    setLoading,
    setError,
    activeCollectionId,
    activeTagId,
  ]);

  // Store refresh function for useImport
  useEffect(() => {
    refreshFn = loadLibrary;
    return () => {
      refreshFn = null;
    };
  }, [loadLibrary]);

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
 * Does NOT trigger useLibrarySync - call refresh separately after importing.
 */
export function useImport() {
  const { setLoading, setError } = useLibraryStore();

  const refresh = useCallback(async () => {
    if (refreshFn) {
      await refreshFn();
    }
  }, []);

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
        if (errors.length > 0) {
          console.warn("Some imports failed:", errors);
        }

        // Refresh library to show new entries
        await refresh();

        return results;
      } catch (err) {
        console.error("Failed to import files:", err);
        setError(err instanceof Error ? err.message : "Failed to import files");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refresh, setLoading, setError]
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
        if (errors.length > 0) {
          console.warn("Some imports failed:", errors);
        }

        // Refresh library to show new entries
        await refresh();

        return results;
      } catch (err) {
        console.error("Failed to import folder:", err);
        setError(
          err instanceof Error ? err.message : "Failed to import folder"
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refresh, setLoading, setError]
  );

  return { importFiles, importFolder, refresh };
}
