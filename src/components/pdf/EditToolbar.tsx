import {
  Highlighter,
  ChevronDown,
  MessageSquareText,
  Square,
  BoxSelect,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

interface EditToolbarProps {
  toolMode: ToolMode;
  onToolModeChange: (mode: ToolMode) => void;
  highlightColor: string;
  onColorChange: (color: string) => void;
  areaHighlightColor: string;
  onAreaColorChange: (color: string) => void;
  drawingColor: string;
  onDrawingColorChange: (color: string) => void;
  shapeColor: string;
  onShapeColorChange: (color: string) => void;
}

interface ColorDropdownProps {
  colors: { name: string; value: string }[];
  selectedColor: string;
  onColorChange: (color: string) => void;
}

function ColorDropdown({ colors, selectedColor, onColorChange }: ColorDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-5 px-0">
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-0">
        <div className="flex gap-1 p-1">
          {colors.map((color) => (
            <button
              key={color.value}
              className={cn(
                "w-6 h-6 rounded-full transition-transform hover:scale-110",
                selectedColor === color.value && "ring-2 ring-foreground ring-offset-1"
              )}
              style={{ backgroundColor: color.value }}
              onClick={() => onColorChange(color.value)}
              title={color.name}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditToolbar({
  toolMode,
  onToolModeChange,
  highlightColor,
  onColorChange,
  areaHighlightColor,
  onAreaColorChange,
  drawingColor,
  onDrawingColorChange,
  shapeColor,
  onShapeColorChange,
}: EditToolbarProps) {
  return (
    <div className="flex items-center justify-center gap-1 px-3 py-1.5 border-t bg-muted/30">
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

      <ColorDropdown
        colors={HIGHLIGHT_COLORS}
        selectedColor={highlightColor}
        onColorChange={onColorChange}
      />

      <div className="w-px h-4 bg-border mx-1" />

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

      <ColorDropdown
        colors={HIGHLIGHT_COLORS}
        selectedColor={areaHighlightColor}
        onColorChange={onAreaColorChange}
      />

      <div className="w-px h-4 bg-border mx-1" />

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

      <ColorDropdown
        colors={STROKE_COLORS}
        selectedColor={shapeColor}
        onColorChange={onShapeColorChange}
      />

      <div className="w-px h-4 bg-border mx-1" />

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

      <ColorDropdown
        colors={STROKE_COLORS}
        selectedColor={drawingColor}
        onColorChange={onDrawingColorChange}
      />
    </div>
  );
}
