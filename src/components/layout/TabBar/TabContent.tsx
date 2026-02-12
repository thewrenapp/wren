import { useTabStore, type Tab } from "@/stores/tabStore";
import { WelcomeTab } from "./WelcomeTab";
import { EntryTab } from "./EntryTab";
import { LibraryTab } from "./LibraryTab";

function renderTab(tab: Tab) {
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
      return <EntryTab entryId={tab.entryId} attachmentId={tab.attachmentId} />;

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

export function TabContent() {
  const { tabs, activeTabId } = useTabStore();

  if (tabs.length === 0) {
    return null;
  }

  // Render ALL tabs but only show the active one.
  // Each tab stays mounted with its own component tree, so state
  // (scroll position, page number, zoom) is preserved across tab switches.
  // Duplicate tabs get independent instances via unique keys (tab.id).
  return (
    <>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="h-full w-full"
          style={{ display: tab.id === activeTabId ? "contents" : "none" }}
        >
          {renderTab(tab)}
        </div>
      ))}
    </>
  );
}
