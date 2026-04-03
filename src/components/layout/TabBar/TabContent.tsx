import { useCallback } from "react";
import { useTabStore, getTabsForPane, type Tab } from "@/stores/tabStore";
import { WelcomeTab } from "./WelcomeTab";
import { EntryTab } from "./EntryTab";
import { LibraryTab } from "./LibraryTab";

function RenderTab({ tab, onViewStateChange }: { tab: Tab; onViewStateChange?: (state: Record<string, unknown>) => void }) {
  switch (tab.type) {
    case "library":
      return <LibraryTab />;

    case "welcome":
      return <WelcomeTab />;

    case "entry":
      if (!tab.entryId) {
        return (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Entry not found
          </div>
        );
      }
      return (
        <EntryTab
          entryId={tab.entryId}
          attachmentId={tab.attachmentId}
          initialPdfPage={tab.data?.pdfPage as number | undefined}
          pdfPageRequestId={tab.data?.pdfPageRequestId as number | undefined}
          initialHtmlScale={tab.data?.htmlScale as number | undefined}
          onViewStateChange={onViewStateChange}
        />
      );

    case "markdown":
      if (!tab.entryId || !tab.attachmentId) {
        return (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            No attachment specified
          </div>
        );
      }
      return (
        <EntryTab
          entryId={tab.entryId}
          attachmentId={tab.attachmentId}
          viewMode="extracted"
        />
      );

    case "parsed":
      if (!tab.entryId || !tab.attachmentId) {
        return (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            No attachment specified
          </div>
        );
      }
      return (
        <EntryTab
          entryId={tab.entryId}
          attachmentId={tab.attachmentId}
          viewMode="parsed"
        />
      );

    case "search":
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Search Results
        </div>
      );

    case "collection":
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Collection View
        </div>
      );

    default:
      return null;
  }
}

export function TabContent({ pane = "left" }: { pane?: "left" | "right" }) {
  const { tabs: allTabs, activeTabId, activeRightTabId, updateTab } = useTabStore();

  // Filter tabs for this pane
  const tabs = getTabsForPane(allTabs, pane);
  const currentActiveId = pane === "left" ? activeTabId : activeRightTabId;

  const activeTab = tabs.find((t) => t.id === currentActiveId);

  // Save view state (page, scale) into tab.data when a viewer unmounts
  const handleViewStateChange = useCallback(
    (state: Record<string, unknown>) => {
      if (currentActiveId) {
        updateTab(currentActiveId, {
          data: { ...activeTab?.data, ...state },
        });
      }
    },
    [currentActiveId, activeTab?.data, updateTab]
  );

  if (!activeTab) {
    return null;
  }

  // Only render the active tab. Inactive tabs are unmounted to free memory
  // (PDF documents, canvases, iframes). View state (page number, zoom) is
  // saved to tab.data on unmount and restored on remount.
  // Library and welcome tabs are lightweight and always re-mount cleanly.
  return (
    <div key={activeTab.id} className="flex-1 flex flex-col min-h-0">
      <RenderTab tab={activeTab} onViewStateChange={handleViewStateChange} />
    </div>
  );
}
