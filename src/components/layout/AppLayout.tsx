import { ProfileBar } from './Sidebar/ProfileBar';
import { LibrarySidebar } from './Sidebar/LibrarySidebar';
import { TabPane } from './TabBar/TabPane';
import { TitleBar } from './TitleBar';
import { CommandPalette } from '@/components/search/CommandPalette';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { DragDropProvider } from '@/components/dnd/DragDropProvider';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { useUIStore, type LibraryLayout } from '@/stores/uiStore';
import { useTabStore } from '@/stores/tabStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLibrarySync } from '@/hooks/useLibrarySync';
import { useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from '@/stores/toastStore';
import { useJobStore } from '@/stores/jobStore';
import { cn } from '@/lib/utils';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';

type ImportDetailProgress = {
  fileName: string;
  step: string;
  method: string | null;
  status: string;
  message: string | null;
};

export function AppLayout() {
  const { setLibraryLayout, settingsOpen, setSettingsOpen, commandPaletteMode, sidebarCollapsed, setSidebarCollapsed } = useUIStore();
  const { tabs, openTab, updateTab, splitEnabled } = useTabStore();
  const { showWelcomeOnStartup } = useSettingsStore();
  const hasInitialized = useRef(false);

  // Ref for expand collections callback (set by LibrarySidebar)
  const expandCollectionsRef = useRef<(() => void) | null>(null);

  const handleExpandCollections = useCallback(() => {
    expandCollectionsRef.current?.();
  }, []);

  useKeyboardShortcuts();
  useLibrarySync();

  // Shared DnD for tab reordering (within pane) and cross-pane moves
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleTabDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const { tabs: allTabs, reorderTabs, moveTabToPane } = useTabStore.getState();
    const activeTab = allTabs.find((t) => t.id === active.id);
    if (!activeTab) return;

    const overId = String(over.id);

    // Check if dropped on a pane drop zone (cross-pane move)
    if (overId === 'pane-drop-left' || overId === 'pane-drop-right') {
      const targetPane = overId === 'pane-drop-left' ? 'left' : 'right';
      const activePane = activeTab.pane ?? 'left';
      if (activePane !== targetPane) {
        moveTabToPane(String(active.id), targetPane);
      }
      return;
    }

    // Dropped on a specific tab
    const overTab = allTabs.find((t) => t.id === over.id);
    if (!overTab) return;

    const activePane = activeTab.pane ?? 'left';
    const overPane = overTab.pane ?? 'left';

    if (activePane === overPane) {
      // Same pane: reorder
      const oldIndex = allTabs.findIndex((t) => t.id === active.id);
      const newIndex = allTabs.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderTabs(oldIndex, newIndex);
      }
    } else {
      // Cross-pane: move tab to the other pane
      moveTabToPane(String(active.id), overPane as 'left' | 'right');
    }
  }, []);

  // Listen for menu events from native menu bar
  useEffect(() => {
    const unlistenLayout = listen<string>('menu:set-library-layout', (event) => {
      setLibraryLayout(event.payload as LibraryLayout);
    });

    const unlistenSettings = listen('menu:open-settings', () => {
      setSettingsOpen(true);
    });

    return () => {
      unlistenLayout.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
  }, [setLibraryLayout, setSettingsOpen]);

  // Listen for import:detail events to show toast notifications for individual file extractions
  // This provides feedback when adding attachments to existing entries
  useEffect(() => {
    const unlisten = listen<ImportDetailProgress>('import:detail', (event) => {
      const { fileName, step, method, status, message } = event.payload;

      // Only show toast when indexing completes (not during extraction to avoid spam)
      if (step === 'indexing') {
        const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName;

        if (status === 'success') {
          const methodInfo = method ? ` (${method})` : '';
          toast.success(`Indexed: ${shortName}${methodInfo}`);
        } else if (status === 'failed') {
          const errorInfo = message ? `: ${message}` : '';
          toast.error(`Failed to index: ${shortName}${errorInfo}`);
        } else if (status === 'skipped' && message) {
          toast.info(`Skipped: ${shortName} - ${message}`);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Initialize job queue listener
  useEffect(() => {
    useJobStore.getState().startListening();
    return () => useJobStore.getState().stopListening();
  }, []);

  // Auto-hide sidebar when window is narrow
  useEffect(() => {
    const checkWidth = () => {
      const { sidebarCollapsed } = useUIStore.getState();
      if (window.innerWidth < 900 && !sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', checkWidth);
    checkWidth();
    return () => window.removeEventListener('resize', checkWidth);
  }, [setSidebarCollapsed]);

  // Initialize tabs on startup
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Always ensure Library tab exists
    const libraryTab = tabs.find((t) => t.type === 'library');
    if (!libraryTab) {
      openTab({
        type: 'library',
        title: 'Library',
      });
    } else {
      // Sync library tab title to "Library" on startup since activeFilter resets to "all"
      // This fixes stale tab titles like "Trash" from previous sessions
      if (libraryTab.title !== 'Library') {
        updateTab(libraryTab.id, { title: 'Library' });
      }
    }

    // Show Welcome tab on startup if enabled and not already open
    if (showWelcomeOnStartup) {
      const hasWelcomeTab = tabs.some((t) => t.type === 'welcome');
      if (!hasWelcomeTab) {
        openTab({
          type: 'welcome',
          title: 'Welcome',
        });
      }
    }
  }, []);

  return (
    <div className='flex h-screen w-screen overflow-hidden bg-background'>
      {/* Thin icon bar on the left */}
      <ProfileBar />

      {/* Main layout: title bar + content */}
      <div className='flex-1 flex flex-col min-w-0'>
        {/* Title bar with search */}
        <TitleBar />

        {/* Content below title bar */}
        <div className='flex-1 flex min-h-0'>
          <DragDropProvider onExpandCollections={handleExpandCollections}>
            <div className='flex flex-1 min-h-0 min-w-0'>
              {/* Library sidebar - collapsible */}
              <div className={cn(
                'shrink-0 sidebar-gradient border-r border-border transition-all duration-300 overflow-hidden',
                sidebarCollapsed ? 'w-0 border-r-0 opacity-0' : 'w-[200px] opacity-100'
              )}>
                <LibrarySidebar expandCollectionsRef={expandCollectionsRef} />
              </div>

              {/* Main content area - tabs + content (with optional split) */}
              <DndContext
                sensors={tabSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleTabDragEnd}
              >
                {!splitEnabled ? (
                  <TabPane pane="left" />
                ) : (
                  <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0">
                    <ResizablePanel defaultSize={50} minSize={25}>
                      <TabPane pane="left" />
                    </ResizablePanel>
                    <ResizableHandle className="w-[1px] bg-border hover:bg-primary/50 transition-colors" />
                    <ResizablePanel defaultSize={50} minSize={25}>
                      <TabPane pane="right" />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                )}
              </DndContext>
            </div>
          </DragDropProvider>
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        openMode={
          commandPaletteMode === 'advanced'
            ? 'advanced'
            : commandPaletteMode === 'full'
              ? 'full'
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
