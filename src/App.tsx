import { useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PDFPrintView } from "@/components/pdf/PDFPrintView";
import { Toaster } from "@/components/ui/Toaster";
import { DeleteConfirmationDialog } from "@/components/dialogs/DeleteConfirmationDialog";
import { AdvancedSearchDialog } from "@/components/search/AdvancedSearchDialog";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { getEntry, getAttachment } from "@/services/tauri";

function AppShell() {
  const { theme, showWelcomeOnStartup } = useSettingsStore();
  const { openTab, tabs } = useTabStore();
  const { setAdvancedSearchOpen } = useUIStore();
  const hasInitialized = useRef(false);

  // Open welcome tab on startup if enabled
  useEffect(() => {
    if (!hasInitialized.current && showWelcomeOnStartup && tabs.length === 0) {
      openTab({ type: "welcome", title: "Welcome" });
      hasInitialized.current = true;
    }
  }, [showWelcomeOnStartup, openTab, tabs.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+F: Advanced Search
      if (e.metaKey && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setAdvancedSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setAdvancedSearchOpen]);

  // Apply theme on mount and when it changes
  useEffect(() => {
    const root = document.documentElement;

    if (theme === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", isDark);

      // Listen for system theme changes
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e: MediaQueryListEvent) => {
        root.classList.toggle("dark", e.matches);
      };
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      root.classList.toggle("dark", theme === "dark");
    }
  }, [theme]);

  // Disable native context menu globally
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Global navigation event listeners for internal links (wren-entry:, wren-tag:, etc.)
  useEffect(() => {
    const handleOpenEntry = async (e: Event) => {
      const { entryId } = (e as CustomEvent).detail;
      // Navigate to library and select the entry
      useTabStore.getState().openTab({ type: 'library', title: 'Library' });
      useLibraryStore.getState().selectEntries([entryId]);
    };

    const handleOpenAttachment = async (e: Event) => {
      const { attachmentId } = (e as CustomEvent).detail;
      try {
        // Look up which entry owns this attachment
        const attachment = await getAttachment(attachmentId);
        const entry = await getEntry(attachment.entryId);
        useTabStore.getState().openTab({
          type: 'entry',
          title: entry.title,
          entryId: String(attachment.entryId),
          attachmentId: String(attachmentId),
        });
      } catch {
        console.error('Failed to open attachment', attachmentId);
      }
    };

    const handleNavigateTag = (e: Event) => {
      const { tagId } = (e as CustomEvent).detail;
      // Switch to library tab and apply tag filter
      useTabStore.getState().openTab({ type: 'library', title: 'Library' });
      useLibraryStore.getState().setFilter({ type: 'tag', ids: [tagId] });
    };

    const handleNavigateCollection = (e: Event) => {
      const { collectionId } = (e as CustomEvent).detail;
      // Switch to library tab and apply collection filter
      useTabStore.getState().openTab({ type: 'library', title: 'Library' });
      useLibraryStore.getState().setActiveCollection(collectionId);
    };

    window.addEventListener("wren:open-entry", handleOpenEntry);
    window.addEventListener("wren:open-attachment", handleOpenAttachment);
    window.addEventListener("wren:navigate-tag", handleNavigateTag);
    window.addEventListener("wren:navigate-collection", handleNavigateCollection);
    return () => {
      window.removeEventListener("wren:open-entry", handleOpenEntry);
      window.removeEventListener("wren:open-attachment", handleOpenAttachment);
      window.removeEventListener("wren:navigate-tag", handleNavigateTag);
      window.removeEventListener("wren:navigate-collection", handleNavigateCollection);
    };
  }, []);

  return (
    <>
      <AppLayout />
      <Toaster />
      <DeleteConfirmationDialog />
      <AdvancedSearchDialog />
    </>
  );
}

function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const isPrintView = searchParams.get("print") === "1";

  if (isPrintView) {
    return <PDFPrintView />;
  }

  return <AppShell />;
}

export default App;
