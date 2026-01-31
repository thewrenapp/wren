import { useLibraryStore } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { EntryInfoPanel } from "./EntryInfoPanel";

export function RightPane() {
  const { entries, selectedEntryIds } = useLibraryStore();
  const { tabs, activeTabId } = useTabStore();

  // Get the active tab
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Get selected entry - either from selection or from active entry tab
  const selectedEntry =
    selectedEntryIds.length === 1
      ? entries.find((e) => String(e.id) === String(selectedEntryIds[0]))
      : activeTab?.type === "entry" && activeTab.entryId
        ? entries.find((e) => String(e.id) === String(activeTab.entryId))
        : null;

  // Multiple entries selected
  if (selectedEntryIds.length > 1) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center px-3 py-2 border-b">
          <h3 className="text-sm font-semibold">Details</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
          {selectedEntryIds.length} entries selected
        </div>
      </div>
    );
  }

  // Single entry selected or viewing entry tab
  if (selectedEntry) {
    return <EntryInfoPanel entry={selectedEntry} />;
  }

  // No entry selected
  return null;
}
