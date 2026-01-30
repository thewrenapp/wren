import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { MiddlePane } from "../MiddlePane/MiddlePane";
import { RightPane } from "../RightPane/RightPane";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";

export function LibraryTab() {
  const {
    rightPaneWidth,
    setRightPaneWidth,
    infoPanelHeight,
    setInfoPanelHeight,
    libraryLayout,
  } = useUIStore();
  const { selectedItemIds } = useLibraryStore();

  // Show info pane only when an item is selected
  const showInfoPane = selectedItemIds.length > 0;

  const totalWidth = typeof window !== "undefined" ? window.innerWidth : 1000;
  const totalHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const rightPanePercent = (rightPaneWidth / totalWidth) * 100;
  const bottomPanePercent = (infoPanelHeight / totalHeight) * 100;

  // Stacked layout: vertical split (list on top, info on bottom)
  if (libraryLayout === "stacked") {
    return (
      <div className="h-full w-full">
        <ResizablePanelGroup direction="vertical">
          {/* Item list */}
          <ResizablePanel
            defaultSize={showInfoPane ? 100 - bottomPanePercent : 100}
            minSize={30}
          >
            <MiddlePane />
          </ResizablePanel>

          {/* Bottom pane (details) - shown when item is selected */}
          {showInfoPane && (
            <>
              <ResizableHandle className="h-[1px] bg-border hover:bg-primary/50 transition-colors" />
              <ResizablePanel
                defaultSize={bottomPanePercent}
                minSize={15}
                maxSize={50}
                onResize={(size) => {
                  const newHeight = (size / 100) * totalHeight;
                  setInfoPanelHeight(newHeight);
                }}
                className="bg-background"
              >
                <RightPane />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    );
  }

  // Normal layout: horizontal split (list on left, info on right)
  return (
    <div className="h-full w-full">
      <ResizablePanelGroup direction="horizontal">
        {/* Item list */}
        <ResizablePanel
          defaultSize={showInfoPane ? 100 - rightPanePercent : 100}
          minSize={40}
        >
          <MiddlePane />
        </ResizablePanel>

        {/* Right pane (details) - shown when item is selected */}
        {showInfoPane && (
          <>
            <ResizableHandle className="w-[1px] bg-border hover:bg-primary/50 transition-colors" />
            <ResizablePanel
              defaultSize={rightPanePercent}
              minSize={15}
              maxSize={35}
              onResize={(size) => {
                const newWidth = (size / 100) * totalWidth;
                setRightPaneWidth(newWidth);
              }}
              className="bg-background"
            >
              <RightPane />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
