import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#FFE28F" },
  { name: "Red", value: "#FF8A8A" },
  { name: "Green", value: "#A8E6A1" },
  { name: "Blue", value: "#8EC8FF" },
  { name: "Purple", value: "#D8B4FE" },
  { name: "Orange", value: "#FFBD70" },
];

interface HighlightPopupProps {
  currentColor?: string;
  onColorChange: (color: string) => void;
  onDelete: () => void;
}

export function HighlightPopup({
  currentColor,
  onColorChange,
  onDelete,
}: HighlightPopupProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-popover p-1.5 shadow-lg">
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color.value}
          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
            currentColor === color.value
              ? "border-foreground"
              : "border-transparent"
          }`}
          style={{ backgroundColor: color.value }}
          onClick={() => onColorChange(color.value)}
          title={color.name}
        />
      ))}
      <div className="w-px h-5 bg-border mx-1" />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={onDelete}
        title="Delete highlight"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
