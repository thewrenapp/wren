import { useTabStore } from "@/stores/tabStore";
import { WelcomeTab } from "./WelcomeTab";
import { EntryTab } from "./EntryTab";
import { LibraryTab } from "./LibraryTab";

export function TabContent() {
  const { tabs, activeTabId } = useTabStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return null;
  }

  switch (activeTab.type) {
    case "library":
      return <LibraryTab />;

    case "welcome":
      return <WelcomeTab />;

    case "entry":
      if (!activeTab.entryId) {
        return (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Entry not found
          </div>
        );
      }
      return <EntryTab entryId={activeTab.entryId} attachmentId={activeTab.attachmentId} />;

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
