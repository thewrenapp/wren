import { useState, useCallback, useEffect, useRef } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
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
  RefreshCw,
  ExternalLink,
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

export type ToolMode = "highlight" | "area" | "freetext" | "drawing" | "rectangle" | null;

export interface SearchOptions {
  highlightAll: boolean;
  matchCase: boolean;
  wholeWords: boolean;
}

interface HTMLToolbarProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onScaleChange: (scale: number) => void;
  highlightColor: string;
  onColorChange: (color: string) => void;
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
  onSearch?: (query: string, options: SearchOptions) => void;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onSearchClear?: () => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onRefresh?: () => void;
  onOpenExternal?: () => void;
}

export function HTMLToolbar({
  scale,
  onZoomIn,
  onZoomOut,
  onScaleChange,
  highlightColor,
  onColorChange,
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
  onSearch,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  searchMatchCount = 0,
  searchCurrentMatch = 0,
  isFullscreen = false,
  onToggleFullscreen,
  onRefresh,
  onOpenExternal,
}: HTMLToolbarProps) {
  const scalePercent = Math.round(scale * 100);
  const [editMode, setEditMode] = useState(false);
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
        setIsCompact(entry.contentRect.width < 600);
      }
    });

    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const handleEditModeToggle = useCallback(() => {
    if (editMode) {
      onToolModeChange(null);
    }
    setEditMode(!editMode);
  }, [editMode, onToolModeChange]);

  const performSearch = useCallback(
    (query: string) => {
      if (query) {
        onSearch?.(query, { highlightAll, matchCase, wholeWords });
      } else {
        onSearchClear?.();
      }
    },
    [onSearch, onSearchClear, highlightAll, matchCase, wholeWords]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      performSearch(value);
    },
    [performSearch]
  );

  const handleHighlightAllChange = useCallback(
    (checked: boolean) => {
      setHighlightAll(checked);
      if (searchQuery) {
        onSearch?.(searchQuery, { highlightAll: checked, matchCase, wholeWords });
      }
    },
    [searchQuery, onSearch, matchCase, wholeWords]
  );

  const handleMatchCaseChange = useCallback(
    (checked: boolean) => {
      setMatchCase(checked);
      if (searchQuery) {
        onSearch?.(searchQuery, { highlightAll, matchCase: checked, wholeWords });
      }
    },
    [searchQuery, onSearch, highlightAll, wholeWords]
  );

  const handleWholeWordsChange = useCallback(
    (checked: boolean) => {
      setWholeWords(checked);
      if (searchQuery) {
        onSearch?.(searchQuery, { highlightAll, matchCase, wholeWords: checked });
      }
    },
    [searchQuery, onSearch, highlightAll, matchCase]
  );

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    onSearchClear?.();
  }, [onSearchClear]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  // Keyboard shortcuts
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

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={toolbarRef}
        className="flex flex-col border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      >
        {/* Main Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5">
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

            {!isCompact && (
              <div className="flex items-center">
                <Input
                  type="number"
                  min={30}
                  max={300}
                  defaultValue={scalePercent}
                  key={scalePercent}
                  onBlur={(e) => {
                    const percent = parseInt(e.target.value, 10);
                    if (!isNaN(percent) && percent >= 30 && percent <= 300) {
                      onScaleChange(percent / 100);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const percent = parseInt(e.currentTarget.value, 10);
                      if (!isNaN(percent) && percent >= 30 && percent <= 300) {
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

            {onToggleFullscreen && (
              <>
                <div className="w-px h-4 bg-border mx-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleFullscreen}>
                      {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</TooltipContent>
                </Tooltip>
              </>
            )}

            {/* Refresh and Open External */}
            {!isCompact && (
              <>
                <div className="w-px h-4 bg-border mx-1" />
                {onRefresh && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh</TooltipContent>
                  </Tooltip>
                )}
                {onOpenExternal && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOpenExternal}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open in browser</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          </div>

          {/* Right: Search, Edit toggle, Panel toggle */}
          <div className="flex items-center gap-0.5">
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
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onSearchPrev} disabled={searchMatchCount === 0}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onSearchNext} disabled={searchMatchCount === 0}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCloseSearch}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {searchQuery && (
                    <div className="text-xs text-muted-foreground">
                      {searchMatchCount > 0
                        ? `${searchCurrentMatch} of ${searchMatchCount} matches`
                        : "No matches found"}
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <Checkbox id="html-highlight-all" checked={highlightAll} onCheckedChange={(checked) => handleHighlightAllChange(checked === true)} />
                      <Label htmlFor="html-highlight-all" className="text-xs cursor-pointer">Highlight all</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox id="html-match-case" checked={matchCase} onCheckedChange={(checked) => handleMatchCaseChange(checked === true)} />
                      <Label htmlFor="html-match-case" className="text-xs cursor-pointer">Match case</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox id="html-whole-words" checked={wholeWords} onCheckedChange={(checked) => handleWholeWordsChange(checked === true)} />
                      <Label htmlFor="html-whole-words" className="text-xs cursor-pointer">Whole words</Label>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", editMode && "bg-accent text-accent-foreground")}
                  onClick={handleEditModeToggle}
                >
                  <EditIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{editMode ? "Exit edit mode" : "Edit"}</TooltipContent>
            </Tooltip>

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

        {/* Edit Toolbar */}
        {editMode && (
          <div className="flex items-center justify-center gap-1 px-3 py-1.5 border-t bg-muted/30">
            {/* Text Highlight */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "highlight" && "bg-accent")}
                  onClick={() => onToolModeChange(toolMode === "highlight" ? null : "highlight")}
                >
                  <Highlighter className="h-4 w-4" />
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full" style={{ backgroundColor: highlightColor }} />
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
                      className={cn("w-6 h-6 rounded-full transition-transform hover:scale-110", highlightColor === color.value && "ring-2 ring-foreground ring-offset-1")}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onColorChange(color.value)}
                      title={color.name}
                    />
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-4 bg-border mx-1" />

            {/* Area Highlight */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "area" && "bg-accent")}
                  onClick={() => onToolModeChange(toolMode === "area" ? null : "area")}
                >
                  <BoxSelect className="h-4 w-4" />
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full" style={{ backgroundColor: highlightColor }} />
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
                      className={cn("w-6 h-6 rounded-full transition-transform hover:scale-110", highlightColor === color.value && "ring-2 ring-foreground ring-offset-1")}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onColorChange(color.value)}
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

            {/* Rectangle tool */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "rectangle" && "bg-accent")}
                  onClick={() => onToolModeChange(toolMode === "rectangle" ? null : "rectangle")}
                >
                  <Square className="h-4 w-4" />
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full" style={{ backgroundColor: shapeColor }} />
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
                      className={cn("w-6 h-6 rounded-full transition-transform hover:scale-110", shapeColor === color.value && "ring-2 ring-foreground ring-offset-1")}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onShapeColorChange(color.value)}
                      title={color.name}
                    />
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-4 bg-border mx-1" />

            {/* Free Draw tool */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 relative", toolMode === "drawing" && "bg-accent")}
                  onClick={() => onToolModeChange(toolMode === "drawing" ? null : "drawing")}
                >
                  <Pencil className="h-4 w-4" />
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full" style={{ backgroundColor: drawingColor }} />
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
                      className={cn("w-6 h-6 rounded-full transition-transform hover:scale-110", drawingColor === color.value && "ring-2 ring-foreground ring-offset-1")}
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
