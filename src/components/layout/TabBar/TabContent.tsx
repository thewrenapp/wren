import { useTabStore } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { WelcomeTab } from "./WelcomeTab";
import { ItemTab } from "./ItemTab";
import { LibraryTab } from "./LibraryTab";

export function TabContent() {
  const { tabs, activeTabId } = useTabStore();
  const { items } = useLibraryStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return null;
  }

  switch (activeTab.type) {
    case "library":
      return <LibraryTab />;

    case "welcome":
      return <WelcomeTab />;

    case "item":
      const item = items.find((i) => i.id === activeTab.itemId);
      if (!item) {
        return (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Item not found
          </div>
        );
      }
      return <ItemTab item={item} />;

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
