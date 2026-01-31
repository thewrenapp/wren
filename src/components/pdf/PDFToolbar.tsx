import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize,
  ArrowLeftToLine,
  Highlighter,
  ChevronDown,
  MessageSquareText,
  Square,
  BoxSelect,
  Pencil,
  MousePointer2,
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#FFE28F" },
  { name: "Red", value: "#FF8A8A" },
  { name: "Green", value: "#A8E6A1" },
  { name: "Blue", value: "#8EC8FF" },
  { name: "Purple", value: "#D8B4FE" },
  { name: "Orange", value: "#FFBD70" },
];

const STROKE_COLORS = [
  { name: "Black", value: "#000000" },
  { name: "Red", value: "#EF4444" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Green", value: "#22C55E" },
  { name: "Purple", value: "#A855F7" },
  { name: "Orange", value: "#F97316" },
];

type ToolMode = "highlight" | "area" | "freetext" | "drawing" | "rectangle" | null;

interface PDFToolbarProps {
  scale: number | string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onScaleChange: (scale: number) => void;
  highlightColor: string;
  onColorChange: (color: string) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  toolMode: ToolMode;
  onToolModeChange: (mode: ToolMode) => void;
  drawingColor: string;
  onDrawingColorChange: (color: string) => void;
  shapeColor: string;
  onShapeColorChange: (color: string) => void;
  leftPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  infoPaneOpen: boolean;
  onToggleInfoPane: () => void;
  isStackedLayout: boolean;
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
  currentPage,
  totalPages,
  onPageChange,
  onPrevPage,
  onNextPage,
  toolMode,
  onToolModeChange,
  drawingColor,
  onDrawingColorChange,
  shapeColor,
  onShapeColorChange,
  leftPanelOpen,
  onToggleLeftPanel,
  infoPaneOpen,
  onToggleInfoPane,
  isStackedLayout,
}: PDFToolbarProps) {
  const scalePercent = typeof scale === "number" ? Math.round(scale * 100) : 100;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Left: Panel toggle + Zoom controls */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleLeftPanel}>
                {leftPanelOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{leftPanelOpen ? "Hide sidebar" : "Show sidebar"}</TooltipContent>
          </Tooltip>

          <div className="w-px h-4 bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomOut}>
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>

          {/* Scale input */}
          <div className="flex items-center">
            <Input
              type="number"
              min={25}
              max={1000}
              defaultValue={scalePercent}
              key={scalePercent}
              onBlur={(e) => {
                const percent = parseInt(e.target.value, 10);
                if (!isNaN(percent) && percent >= 25 && percent <= 1000) {
                  onScaleChange(percent / 100);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const percent = parseInt(e.currentTarget.value, 10);
                  if (!isNaN(percent) && percent >= 25 && percent <= 1000) {
                    onScaleChange(percent / 100);
                  }
                  e.currentTarget.blur();
                }
              }}
              className="w-14 h-6 text-center text-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-muted-foreground text-xs ml-0.5">%</span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomIn}>
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>

          <div className="w-px h-4 bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onFitWidth}>
                <ArrowLeftToLine className="h-4 w-4 rotate-90" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit width</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onFitPage}>
                <Maximize className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit page</TooltipContent>
          </Tooltip>
        </div>

        {/* Center: Page navigation */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1 text-sm">
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const page = parseInt(e.target.value, 10);
                if (page >= 1 && page <= totalPages) {
                  onPageChange(page);
                }
              }}
              className="w-10 h-6 text-center text-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-muted-foreground text-xs">/ {totalPages}</span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onNextPage}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: Tool buttons */}
        <div className="flex items-center gap-0.5">
          {/* Select/Pan tool */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${toolMode === null ? "bg-accent" : ""}`}
                onClick={() => onToolModeChange(null)}
              >
                <MousePointer2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Select</TooltipContent>
          </Tooltip>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Text Highlight tool with color dropdown */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 relative ${toolMode === "highlight" ? "bg-accent" : ""}`}
                onClick={() => onToolModeChange(toolMode === "highlight" ? null : "highlight")}
              >
                <Highlighter className="h-4 w-4" />
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full"
                  style={{ backgroundColor: highlightColor }}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Text Highlight</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-5 px-0">
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-0">
              <div className="flex gap-1 p-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                      highlightColor === color.value
                        ? "ring-2 ring-foreground ring-offset-1"
                        : ""
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => onColorChange(color.value)}
                    title={color.name}
                  />
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Area Highlight tool with color dropdown */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 relative ${toolMode === "area" ? "bg-accent" : ""}`}
                onClick={() => onToolModeChange(toolMode === "area" ? null : "area")}
              >
                <BoxSelect className="h-4 w-4" />
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full"
                  style={{ backgroundColor: highlightColor }}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Area Highlight</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-5 px-0">
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-0">
              <div className="flex gap-1 p-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                      highlightColor === color.value
                        ? "ring-2 ring-foreground ring-offset-1"
                        : ""
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => onColorChange(color.value)}
                    title={color.name}
                  />
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Note tool */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${toolMode === "freetext" ? "bg-accent" : ""}`}
                onClick={() => onToolModeChange(toolMode === "freetext" ? null : "freetext")}
              >
                <MessageSquareText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add Note</TooltipContent>
          </Tooltip>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Rectangle tool with color dropdown */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 relative ${toolMode === "rectangle" ? "bg-accent" : ""}`}
                onClick={() => onToolModeChange(toolMode === "rectangle" ? null : "rectangle")}
              >
                <Square className="h-4 w-4" />
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full"
                  style={{ backgroundColor: shapeColor }}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Draw Rectangle</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-5 px-0">
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-0">
              <div className="flex gap-1 p-1">
                {STROKE_COLORS.map((color) => (
                  <button
                    key={color.value}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                      shapeColor === color.value
                        ? "ring-2 ring-foreground ring-offset-1"
                        : ""
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => onShapeColorChange(color.value)}
                    title={color.name}
                  />
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Free Draw tool with color dropdown */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 relative ${toolMode === "drawing" ? "bg-accent" : ""}`}
                onClick={() => onToolModeChange(toolMode === "drawing" ? null : "drawing")}
              >
                <Pencil className="h-4 w-4" />
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full"
                  style={{ backgroundColor: drawingColor }}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Free Draw</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-5 px-0">
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-0">
              <div className="flex gap-1 p-1">
                {STROKE_COLORS.map((color) => (
                  <button
                    key={color.value}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                      drawingColor === color.value
                        ? "ring-2 ring-foreground ring-offset-1"
                        : ""
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => onDrawingColorChange(color.value)}
                    title={color.name}
                  />
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Info Pane toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleInfoPane}>
                {infoPaneOpen ? (
                  <PanelRightClose className={`h-4 w-4 ${isStackedLayout ? "rotate-90" : ""}`} />
                ) : (
                  <PanelRight className={`h-4 w-4 ${isStackedLayout ? "rotate-90" : ""}`} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{infoPaneOpen ? "Hide info panel" : "Show info panel"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
