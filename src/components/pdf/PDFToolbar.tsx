import { useState, useCallback, useEffect, useRef } from "react";
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Maximize2,
  Minimize2,
  ArrowLeftToLine,
  Highlighter,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  Square,
  BoxSelect,
  Pencil,
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  PanelRight,
  Search,
  X,
  Pencil as EditIcon,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
type ViewerMode = "pan" | "edit";

export interface SearchOptions {
  highlightAll: boolean;
  matchCase: boolean;
  wholeWords: boolean;
}

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
  // Search props
  onSearch?: (query: string, options: SearchOptions) => void;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onSearchClear?: () => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
  // Fullscreen props
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Hide the edit mode toggle and edit toolbar */
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightAll, setHighlightAll] = useState(true);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  // Track toolbar width for responsive layout
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Switch to compact mode when width is less than 600px
        setIsCompact(entry.contentRect.width < 600);
      }
    });

    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  // Toggle edit mode; exiting edit clears tool selection.
  const handleEditModeToggle = useCallback(() => {
    if (mode === "edit") {
      onToolModeChange(null);
      onModeChange("pan");
      return;
    }
    onModeChange("edit");
  }, [mode, onModeChange, onToolModeChange]);

  // Perform search with current options
  const performSearch = useCallback((query: string) => {
    if (query) {
      onSearch?.(query, { highlightAll, matchCase, wholeWords });
    } else {
      onSearchClear?.();
    }
  }, [onSearch, onSearchClear, highlightAll, matchCase, wholeWords]);

  // Handle search input change
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    performSearch(value);
  }, [performSearch]);

  // Handle option changes - re-run search with new options
  const handleHighlightAllChange = useCallback((checked: boolean) => {
    setHighlightAll(checked);
    if (searchQuery) {
      onSearch?.(searchQuery, { highlightAll: checked, matchCase, wholeWords });
    }
  }, [searchQuery, onSearch, matchCase, wholeWords]);

  const handleMatchCaseChange = useCallback((checked: boolean) => {
    setMatchCase(checked);
    if (searchQuery) {
      onSearch?.(searchQuery, { highlightAll, matchCase: checked, wholeWords });
    }
  }, [searchQuery, onSearch, highlightAll, wholeWords]);

  const handleWholeWordsChange = useCallback((checked: boolean) => {
    setWholeWords(checked);
    if (searchQuery) {
      onSearch?.(searchQuery, { highlightAll, matchCase, wholeWords: checked });
    }
  }, [searchQuery, onSearch, highlightAll, matchCase]);

  // Handle close search
  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    onSearchClear?.();
  }, [onSearchClear]);

  // Focus input when popover opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  // Handle keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && searchOpen) {
        handleCloseSearch();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, handleCloseSearch]);

  // Listen for Command Palette search events (shared toolbar for PDF/EPUB/HTML)
  useEffect(() => {
    const handleOpenSearch = () => setSearchOpen(true);
    window.addEventListener("wren:pdf-search", handleOpenSearch);
    window.addEventListener("wren:epub-search", handleOpenSearch);
    return () => {
      window.removeEventListener("wren:pdf-search", handleOpenSearch);
      window.removeEventListener("wren:epub-search", handleOpenSearch);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={toolbarRef} className="flex flex-col border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Main Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 overflow-hidden min-w-0">
          {/* Left: Panel toggle + Zoom controls */}
          <div className="flex items-center gap-0.5 min-w-0">
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

            {/* Scale input - hidden in compact mode */}
            {!isCompact && (
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
            )}

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

            {onToggleFullscreen && (
              <>
                <div className="w-px h-4 bg-border mx-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleFullscreen}>
                      {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</TooltipContent>
                </Tooltip>
              </>
            )}
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
              {/* Hide total pages in compact mode */}
              {!isCompact && (
                <span className="text-muted-foreground text-xs">/ {totalPages}</span>
              )}
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

          {/* Right: Search, Edit toggle, Panel toggle */}
          <div className="flex items-center gap-0.5 min-w-0">
            {/* Search popover */}
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", searchOpen && "bg-accent")}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3">
                <div className="space-y-3">
                  {/* Search input row */}
                  <div className="flex items-center gap-2">
                    <Input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Find in Document"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (e.shiftKey) {
                            onSearchPrev?.();
                          } else {
                            onSearchNext?.();
                          }
                        }
                      }}
                      className="flex-1 h-8"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={onSearchPrev}
                      disabled={searchMatchCount === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={onSearchNext}
                      disabled={searchMatchCount === 0}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={handleCloseSearch}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Match count */}
                  {searchQuery && (
                    <div className="text-xs text-muted-foreground">
                      {searchMatchCount > 0
                        ? `${searchCurrentMatch} of ${searchMatchCount} matches`
                        : "No matches found"}
                    </div>
                  )}

                  {/* Options */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id="highlight-all"
                        checked={highlightAll}
                        onCheckedChange={(checked) => handleHighlightAllChange(checked === true)}
                      />
                      <Label htmlFor="highlight-all" className="text-xs cursor-pointer">
                        Highlight all
                      </Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id="match-case"
                        checked={matchCase}
                        onCheckedChange={(checked) => handleMatchCaseChange(checked === true)}
                      />
                      <Label htmlFor="match-case" className="text-xs cursor-pointer">
                        Match case
                      </Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id="whole-words"
                        checked={wholeWords}
                        onCheckedChange={(checked) => handleWholeWordsChange(checked === true)}
                      />
                      <Label htmlFor="whole-words" className="text-xs cursor-pointer">
                        Whole words
                      </Label>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Print - hidden in compact mode */}
            {!isCompact && onPrint && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrint}>
                    <Printer className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Print (⌘P)</TooltipContent>
              </Tooltip>
            )}

            {/* Edit mode toggle */}
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

            {/* Info Pane toggle */}
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

        {/* Edit Toolbar - shown when edit mode is on */}
        {!hideEditMode && mode === "edit" && (
          <div className="flex items-center justify-center gap-1 px-3 py-1.5 border-t bg-muted/30">
            {/* Text Highlight tool with color dropdown */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "highlight" && "bg-accent")}
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
              <DropdownMenuContent align="start" className="min-w-0">
                <div className="flex gap-1 p-1">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color.value}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform hover:scale-110",
                        highlightColor === color.value && "ring-2 ring-foreground ring-offset-1"
                      )}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onColorChange(color.value)}
                      title={color.name}
                    />
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-4 bg-border mx-1" />

            {/* Area Highlight tool with color dropdown */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "area" && "bg-accent")}
                  onClick={() => onToolModeChange(toolMode === "area" ? null : "area")}
                >
                  <BoxSelect className="h-4 w-4" />
                  <span
                    className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full"
                    style={{ backgroundColor: areaHighlightColor }}
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
              <DropdownMenuContent align="start" className="min-w-0">
                <div className="flex gap-1 p-1">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color.value}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform hover:scale-110",
                        areaHighlightColor === color.value && "ring-2 ring-foreground ring-offset-1"
                      )}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onAreaColorChange(color.value)}
                      title={color.name}
                    />
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-4 bg-border mx-1" />

            {/* Note tool */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", toolMode === "freetext" && "bg-accent")}
                  onClick={() => onToolModeChange(toolMode === "freetext" ? null : "freetext")}
                >
                  <MessageSquareText className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add Note</TooltipContent>
            </Tooltip>

            <div className="w-px h-4 bg-border mx-1" />

            {/* Rectangle tool with color dropdown */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "rectangle" && "bg-accent")}
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
              <DropdownMenuContent align="start" className="min-w-0">
                <div className="flex gap-1 p-1">
                  {STROKE_COLORS.map((color) => (
                    <button
                      key={color.value}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform hover:scale-110",
                        shapeColor === color.value && "ring-2 ring-foreground ring-offset-1"
                      )}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onShapeColorChange(color.value)}
                      title={color.name}
                    />
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-4 bg-border mx-1" />

            {/* Free Draw tool with color dropdown */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "drawing" && "bg-accent")}
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
              <DropdownMenuContent align="start" className="min-w-0">
                <div className="flex gap-1 p-1">
                  {STROKE_COLORS.map((color) => (
                    <button
                      key={color.value}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform hover:scale-110",
                        drawingColor === color.value && "ring-2 ring-foreground ring-offset-1"
                      )}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onDrawingColorChange(color.value)}
                      title={color.name}
                    />
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
