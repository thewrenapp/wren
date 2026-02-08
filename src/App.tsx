import { useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PDFPrintView } from "@/components/pdf/PDFPrintView";
import { Toaster } from "@/components/ui/Toaster";
import { DeleteConfirmationDialog } from "@/components/dialogs/DeleteConfirmationDialog";
import { AdvancedSearchDialog } from "@/components/search/AdvancedSearchDialog";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";

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
