import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ProfileBar } from "./Sidebar/ProfileBar";
import { LibrarySidebar } from "./Sidebar/LibrarySidebar";
import { TabBar } from "./TabBar/TabBar";
import { TabContent } from "./TabBar/TabContent";
import { TitleBar } from "./TitleBar";
import { CommandPalette } from "@/components/search/CommandPalette";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { DragDropProvider } from "@/components/dnd/DragDropProvider";
import { useUIStore, type LibraryLayout } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useLibrarySync } from "@/hooks/useLibrarySync";
import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

export function AppLayout() {
  const { sidebarWidth, setSidebarWidth, setLibraryLayout, settingsOpen, setSettingsOpen, commandPaletteMode } = useUIStore();
  const { tabs, openTab, updateTab } = useTabStore();
  const { showWelcomeOnStartup } = useSettingsStore();
  const hasInitialized = useRef(false);

  // Ref for expand collections callback (set by LibrarySidebar)
  const expandCollectionsRef = useRef<(() => void) | null>(null);

  const handleExpandCollections = useCallback(() => {
    expandCollectionsRef.current?.();
  }, []);

  useKeyboardShortcuts();
  useLibrarySync();

  // Listen for menu events from native menu bar
  useEffect(() => {
    const unlistenLayout = listen<string>("menu:set-library-layout", (event) => {
      setLibraryLayout(event.payload as LibraryLayout);
    });

    const unlistenSettings = listen("menu:open-settings", () => {
      setSettingsOpen(true);
    });

    return () => {
      unlistenLayout.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
  }, [setLibraryLayout, setSettingsOpen]);

  const totalWidth = typeof window !== "undefined" ? window.innerWidth : 1400;
  const sidebarPercent = (sidebarWidth / totalWidth) * 100;

  // Initialize tabs on startup
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Always ensure Library tab exists
    const libraryTab = tabs.find((t) => t.type === "library");
    if (!libraryTab) {
      openTab({
        type: "library",
        title: "Library",
      });
    } else {
      // Sync library tab title to "Library" on startup since activeFilter resets to "all"
      // This fixes stale tab titles like "Trash" from previous sessions
      if (libraryTab.title !== "Library") {
        updateTab(libraryTab.id, { title: "Library" });
      }
    }

    // Show Welcome tab on startup if enabled and not already open
    if (showWelcomeOnStartup) {
      const hasWelcomeTab = tabs.some((t) => t.type === "welcome");
      if (!hasWelcomeTab) {
        openTab({
          type: "welcome",
          title: "Welcome",
        });
      }
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Thin icon bar on the left */}
      <ProfileBar />

      {/* Main layout: title bar + content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Title bar with search */}
        <TitleBar />

        {/* Content below title bar */}
        <div className="flex-1 flex min-h-0">
          <DragDropProvider onExpandCollections={handleExpandCollections}>
            <ResizablePanelGroup direction="horizontal">
              {/* Library sidebar */}
              <ResizablePanel
                defaultSize={sidebarPercent}
                minSize={15}
                maxSize={25}
                onResize={(size) => {
                  const newWidth = (size / 100) * totalWidth;
                  setSidebarWidth(newWidth);
                }}
                className="bg-sidebar"
              >
                <LibrarySidebar expandCollectionsRef={expandCollectionsRef} />
              </ResizablePanel>

              <ResizableHandle className="w-[1px] bg-border hover:bg-primary/50 transition-colors" />

              {/* Main content area - tabs + content */}
              <ResizablePanel defaultSize={100 - sidebarPercent} minSize={50}>
                <div className="flex flex-col h-full">
                  {/* Tab bar */}
                  <div className="border-b border-border bg-background">
                    <TabBar />
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 min-h-0">
                    <TabContent />
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </DragDropProvider>
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        openMode={
          commandPaletteMode === 'advanced'
            ? 'advanced'
            : commandPaletteMode === 'ai'
              ? 'ai'
              : undefined
        }
      />

      {/* Settings Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
