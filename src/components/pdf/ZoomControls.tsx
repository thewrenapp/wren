import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Maximize2,
  Minimize2,
  ArrowLeftToLine,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ZoomControlsProps {
  scalePercent: number;
  isCompact: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onScaleChange: (scale: number) => void;
  leftPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function ZoomControls({
  scalePercent,
  isCompact,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  onScaleChange,
  leftPanelOpen,
  onToggleLeftPanel,
  isFullscreen = false,
  onToggleFullscreen,
}: ZoomControlsProps) {
  return (
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
  );
}
