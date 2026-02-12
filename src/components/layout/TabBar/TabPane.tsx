import { useTabStore } from "@/stores/tabStore";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { cn } from "@/lib/utils";

export function TabPane({ pane }: { pane: "left" | "right" }) {
  const { setFocusedPane, focusedPane, splitEnabled } = useTabStore();

  return (
    <div
      className={cn(
        "flex-1 h-full flex flex-col min-w-0",
        splitEnabled && focusedPane === pane && "ring-1 ring-inset ring-primary/20"
      )}
      onClickCapture={() => setFocusedPane(pane)}
    >
      <div className="border-b border-border bg-background overflow-hidden">
        <TabBar pane={pane} />
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <TabContent pane={pane} />
      </div>
    </div>
  );
}
