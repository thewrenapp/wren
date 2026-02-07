import { useState, useRef, useCallback, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ZoomIn, ZoomOut, RotateCw, Scan, Printer, PanelRight, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

interface ImageViewerProps {
  filePath: string;
  title?: string;
}

export function ImageViewer({ filePath, title }: ImageViewerProps) {
  const { infoPaneOpen, toggleInfoPane, libraryLayout } = useUIStore();
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const src = convertFileSrc(filePath);

  const zoomIn = useCallback(() => setScale((s) => Math.min(5, s + 0.25)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(0.1, s - 0.25)), []);
  const resetZoom = useCallback(() => { setScale(1); setRotation(0); }, []);
  const rotate = useCallback(() => setRotation((r) => (r + 90) % 360), []);

  const handlePrint = useCallback(() => {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}?print=1&type=image&file=${encodeURIComponent(filePath)}`;
    const printWin = new WebviewWindow("print-view", {
      url,
      title: "Print",
      width: 900,
      height: 700,
      resizable: true,
      visible: true,
    });
    printWin.once("tauri://error", (event) => {
      console.error("Failed to open print window:", event);
    });
  }, [filePath]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && (e.key === "+" || e.key === "=")) { e.preventDefault(); zoomIn(); }
      if (isMeta && e.key === "-") { e.preventDefault(); zoomOut(); }
      if (isMeta && e.key === "0") { e.preventDefault(); resetZoom(); }
      if (isMeta && e.key === "p") { e.preventDefault(); e.stopPropagation(); handlePrint(); }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [zoomIn, zoomOut, resetZoom, handlePrint]);

  // Scroll wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn(); else zoomOut();
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoomIn, zoomOut]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p className="text-sm">Failed to load image</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-background shrink-0 overflow-hidden min-w-0">
        {title && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px] mr-2">
            {title}
          </span>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut} title="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn} title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={rotate} title="Rotate">
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom} title="Reset">
          <Scan className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrint}>
                <Printer className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Print ({"\u2318"}P)</TooltipContent>
          </Tooltip>

          <div className="w-px h-4 bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleInfoPane}>
                {infoPaneOpen ? (
                  <PanelRightClose className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
                ) : (
                  <PanelRight className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{infoPaneOpen ? "Hide info panel" : "Show info panel"}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex items-center justify-center bg-muted/30"
      >
        <img
          ref={imgRef}
          src={src}
          alt={title || "Image"}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          draggable={false}
          className="select-none"
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            maxWidth: scale === 1 ? "100%" : "none",
            maxHeight: scale === 1 ? "100%" : "none",
            opacity: loaded ? 1 : 0,
            transition: "transform 0.15s ease",
          }}
        />
      </div>
    </div>
  );
}
