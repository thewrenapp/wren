import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pencil as EditIcon,
  Printer,
  PanelRightClose,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ZoomControls } from "./ZoomControls";
import { PageNavigation } from "./PageNavigation";
import { SearchPopover, type SearchOptions } from "./SearchPopover";
import { EditToolbar } from "./EditToolbar";

export type { SearchOptions };

type ToolMode = "highlight" | "area" | "freetext" | "drawing" | "rectangle" | null;
type ViewerMode = "pan" | "edit";

interface PDFToolbarProps {
  scale: number | string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onScaleChange: (scale: number) => void;
  highlightColor: string;
  onColorChange: (color: string) => void;
  areaHighlightColor: string;
  onAreaColorChange: (color: string) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  toolMode: ToolMode;
  onToolModeChange: (mode: ToolMode) => void;
  mode: ViewerMode;
  onModeChange: (mode: ViewerMode) => void;
  drawingColor: string;
  onDrawingColorChange: (color: string) => void;
  shapeColor: string;
  onShapeColorChange: (color: string) => void;
  leftPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  infoPaneOpen: boolean;
  onToggleInfoPane: () => void;
  isStackedLayout: boolean;
  onSearch?: (query: string, options: SearchOptions) => void;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onSearchClear?: () => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  hideEditMode?: boolean;
  onPrint?: () => void;
}

export function PDFToolbar({
  scale,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  onScaleChange,
  highlightColor,
  onColorChange,
  areaHighlightColor,
  onAreaColorChange,
  currentPage,
  totalPages,
  onPageChange,
  onPrevPage,
  onNextPage,
  toolMode,
  onToolModeChange,
  mode,
  onModeChange,
  drawingColor,
  onDrawingColorChange,
  shapeColor,
  onShapeColorChange,
  leftPanelOpen,
  onToggleLeftPanel,
  infoPaneOpen,
  onToggleInfoPane,
  isStackedLayout,
  onSearch,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  searchMatchCount = 0,
  searchCurrentMatch = 0,
  isFullscreen = false,
  onToggleFullscreen,
  hideEditMode = false,
  onPrint,
}: PDFToolbarProps) {
  const scalePercent = typeof scale === "number" ? Math.round(scale * 100) : 100;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCompact(entry.contentRect.width < 600);
      }
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const handleEditModeToggle = useCallback(() => {
    if (mode === "edit") {
      onToolModeChange(null);
      onModeChange("pan");
      return;
    }
    onModeChange("edit");
  }, [mode, onModeChange, onToolModeChange]);

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={toolbarRef} className="flex flex-col border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-3 py-1.5 overflow-hidden min-w-0">
          <ZoomControls
            scalePercent={scalePercent}
            isCompact={isCompact}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onFitWidth={onFitWidth}
            onFitPage={onFitPage}
            onScaleChange={onScaleChange}
            leftPanelOpen={leftPanelOpen}
            onToggleLeftPanel={onToggleLeftPanel}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />

          <PageNavigation
            currentPage={currentPage}
            totalPages={totalPages}
            isCompact={isCompact}
            onPageChange={onPageChange}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
          />

          <div className="flex items-center gap-0.5 min-w-0">
            <SearchPopover
              onSearch={onSearch}
              onSearchNext={onSearchNext}
              onSearchPrev={onSearchPrev}
              onSearchClear={onSearchClear}
              searchMatchCount={searchMatchCount}
              searchCurrentMatch={searchCurrentMatch}
              toolbarRef={toolbarRef}
            />

            {!isCompact && onPrint && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrint}>
                    <Printer className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Print ({"\u2318"}P)</TooltipContent>
              </Tooltip>
            )}

            {!hideEditMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-7 w-7", mode === "edit" && "bg-accent text-accent-foreground")}
                    onClick={handleEditModeToggle}
                  >
                    <EditIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{mode === "edit" ? "Exit edit mode" : "Edit"}</TooltipContent>
              </Tooltip>
            )}

            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleInfoPane}>
                  {infoPaneOpen ? (
                    <PanelRightClose className={cn("h-4 w-4", isStackedLayout && "rotate-90")} />
                  ) : (
                    <PanelRight className={cn("h-4 w-4", isStackedLayout && "rotate-90")} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{infoPaneOpen ? "Hide info panel" : "Show info panel"}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {!hideEditMode && mode === "edit" && (
          <EditToolbar
            toolMode={toolMode}
            onToolModeChange={onToolModeChange}
            highlightColor={highlightColor}
            onColorChange={onColorChange}
            areaHighlightColor={areaHighlightColor}
            onAreaColorChange={onAreaColorChange}
            drawingColor={drawingColor}
            onDrawingColorChange={onDrawingColorChange}
            shapeColor={shapeColor}
            onShapeColorChange={onShapeColorChange}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
