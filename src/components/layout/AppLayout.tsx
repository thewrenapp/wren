import { ProfileBar } from './Sidebar/ProfileBar';
import { LibrarySidebar } from './Sidebar/LibrarySidebar';
import { TabBar } from './TabBar/TabBar';
import { TabContent } from './TabBar/TabContent';
import { TitleBar } from './TitleBar';
import { CommandPalette } from '@/components/search/CommandPalette';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { DragDropProvider } from '@/components/dnd/DragDropProvider';
import { useUIStore, type LibraryLayout } from '@/stores/uiStore';
import { useTabStore } from '@/stores/tabStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLibrarySync } from '@/hooks/useLibrarySync';
import { useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from '@/stores/toastStore';

type ImportDetailProgress = {
  fileName: string;
  step: string;
  method: string | null;
  status: string;
  message: string | null;
};

export function AppLayout() {
  const { setLibraryLayout, settingsOpen, setSettingsOpen, commandPaletteMode } = useUIStore();
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
            <div className='flex flex-1 min-h-0'>
              {/* Library sidebar - fixed width */}
              <div className='w-[200px] shrink-0 bg-sidebar border-r border-border'>
                <LibrarySidebar expandCollectionsRef={expandCollectionsRef} />
              </div>

              {/* Main content area - tabs + content */}
              <div className='flex-1 flex flex-col min-w-0'>
                {/* Tab bar */}
                <div className='border-b border-border bg-background'>
                  <TabBar />
                </div>

                {/* Tab content */}
                <div className='flex-1 min-h-0'>
                  <TabContent />
                </div>
              </div>
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
