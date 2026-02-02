import { useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/Toaster";
import { DeleteConfirmationDialog } from "@/components/dialogs/DeleteConfirmationDialog";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

function App() {
  const { theme, showWelcomeOnStartup } = useSettingsStore();
  const { openTab, tabs } = useTabStore();
  const hasInitialized = useRef(false);

  // Open welcome tab on startup if enabled
  useEffect(() => {
    if (!hasInitialized.current && showWelcomeOnStartup && tabs.length === 0) {
      openTab({ type: "welcome", title: "Welcome" });
      hasInitialized.current = true;
    }
  }, [showWelcomeOnStartup, openTab, tabs.length]);

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
    </>
  );
}

export default App;
