import { Check, ChevronLeft, ChevronRight, Settings2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

export function ColumnConfigDropdown() {
  const {
    columns,
    toggleColumnVisibility,
    moveColumn,
    resetColumns,
  } = useUIStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="h-7 w-7">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Table Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {columns.map((column, index) => (
          <DropdownMenuItem
            key={column.id}
            className="flex items-center justify-between"
            onSelect={(e) => e.preventDefault()}
          >
            <div
              className="flex items-center gap-2 flex-1 cursor-pointer"
              onClick={() => toggleColumnVisibility(column.id)}
            >
              <div
                className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center",
                  column.visible
                    ? "bg-primary border-primary"
                    : "border-muted-foreground"
                )}
              >
                {column.visible && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
              <span>{column.label}</span>
            </div>

            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => moveColumn(column.id, "left")}
                disabled={index === 0}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => moveColumn(column.id, "right")}
                disabled={index === columns.length - 1}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={resetColumns}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset to Default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
