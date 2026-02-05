import { useState, useEffect, useRef, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useHTMLAnnotations } from "./useHTMLAnnotations";
import { useHTMLSearch } from "./useHTMLSearch";
import { HTMLToolbar, type ToolMode } from "./HTMLToolbar";
import { HTMLOutlinePanel } from "./HTMLOutlinePanel";
import { HTMLAnnotationPanel } from "./HTMLAnnotationPanel";
import { HighlightPopup } from "@/components/pdf/HighlightPopup";
import { cn } from "@/lib/utils";
import { openFileWithDefaultApp } from "@/services/tauri/commands";

interface HTMLViewerProps {
  filePath: string;
  attachmentId: string;
  title?: string;
}

export function HTMLViewer({ filePath, attachmentId, title }: HTMLViewerProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeDoc, setIframeDoc] = useState<Document | null>(null);

  // Scale / zoom
  const [scale, setScale] = useState(1.0);

  // Tool mode
  const [toolMode, setToolMode] = useState<ToolMode>(null);
  const [highlightColor, setHighlightColor] = useState("#FFE28F");
  const [drawingColor, setDrawingColor] = useState("#000000");
  const [shapeColor, setShapeColor] = useState("#000000");

  // Left panel tab
  const [leftPanelTab, setLeftPanelTab] = useState<"outline" | "annotations">("outline");

  // Popup state
  const [popupState, setPopupState] = useState<{
    highlightId: string;
    color: string;
    x: number;
    y: number;
  } | null>(null);

  // Overlay drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [drawingStrokes, setDrawingStrokes] = useState<Array<{ points: Array<{ x: number; y: number }>; color: string; width: number }>>([]);
  const [currentStroke, setCurrentStroke] = useState<{ points: Array<{ x: number; y: number }>; color: string; width: number } | null>(null);

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Store
  const {
    htmlLeftPanelOpen,
    toggleHtmlLeftPanel,
    infoPaneOpen,
    toggleInfoPane,
    libraryLayout,
  } = useUIStore();

  // Hooks
  const annotations = useHTMLAnnotations(iframeRef, attachmentId);
  const htmlSearch = useHTMLSearch(iframeRef);

  // Load HTML content via filesystem API to avoid cross-origin iframe issues.
  // Using srcdoc makes the iframe same-origin, enabling contentDocument access
  // for zoom, search, and annotations.
  useEffect(() => {
    if (!filePath) return;

    async function loadFile() {
      try {
        const content = await readTextFile(filePath);

        // Inject a <base> tag so relative resources (images, CSS) resolve
        // through the Tauri asset protocol to the file's original directory.
        const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
        const baseUrl = convertFileSrc(dirPath) + "/";
        const baseTag = `<base href="${baseUrl}">`;

        let processed: string;
        if (/<head[\s>]/i.test(content)) {
          processed = content.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
        } else if (/<html[\s>]/i.test(content)) {
          processed = content.replace(/(<html[^>]*>)/i, `$1<head>${baseTag}</head>`);
        } else {
          processed = `<head>${baseTag}</head>${content}`;
        }

        setHtmlContent(processed);
        setError(null);
      } catch (err) {
        console.error("Failed to load HTML file:", err);
        setError("Failed to load HTML file");
        setLoading(false);
      }
    }

    loadFile();
  }, [filePath]);

  // Apply zoom to iframe body
  const applyZoom = useCallback((doc: Document, zoomScale: number) => {
    if (!doc.body) return;
    doc.body.style.transformOrigin = "top left";
    doc.body.style.transform = `scale(${zoomScale})`;
    doc.body.style.width = `${100 / zoomScale}%`;
  }, []);

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    setLoading(false);
    setIframeReady(true);

    const doc = iframeRef.current?.contentDocument;
    setIframeDoc(doc || null);

    if (doc) {
      // Apply initial zoom
      applyZoom(doc, scale);
    }
  }, [scale, applyZoom]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setScale((prev) => {
      const next = Math.min(3.0, prev + 0.1);
      const doc = iframeRef.current?.contentDocument;
      if (doc) applyZoom(doc, next);
      return next;
    });
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    setScale((prev) => {
      const next = Math.max(0.3, prev - 0.1);
      const doc = iframeRef.current?.contentDocument;
      if (doc) applyZoom(doc, next);
      return next;
    });
  }, [applyZoom]);

  const handleScaleChange = useCallback(
    (newScale: number) => {
      setScale(newScale);
      const doc = iframeRef.current?.contentDocument;
      if (doc) applyZoom(doc, newScale);
    },
    [applyZoom]
  );

  // Handle open external
  const handleOpenExternal = useCallback(async () => {
    try {
      await openFileWithDefaultApp(filePath);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [filePath]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setIframeReady(false);
    setIframeDoc(null);
    setHtmlContent(null);

    try {
      const content = await readTextFile(filePath);
      const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
      const baseUrl = convertFileSrc(dirPath) + "/";
      const baseTag = `<base href="${baseUrl}">`;

      let processed: string;
      if (/<head[\s>]/i.test(content)) {
        processed = content.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
      } else if (/<html[\s>]/i.test(content)) {
        processed = content.replace(/(<html[^>]*>)/i, `$1<head>${baseTag}</head>`);
      } else {
        processed = `<head>${baseTag}</head>${content}`;
      }

      // Force re-render by briefly clearing then setting content
      setTimeout(() => setHtmlContent(processed), 50);
    } catch (err) {
      console.error("Failed to refresh:", err);
      setError("Failed to reload HTML file");
      setLoading(false);
    }
  }, [filePath]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (isFullscreen) {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    } else {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    }
  }, [isFullscreen]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Render annotations once both iframe and DB data are ready
  useEffect(() => {
    if (!iframeDoc || annotations.loading) return;

    // Small delay to ensure DOM is stable after iframe load
    const timeoutId = setTimeout(() => {
      annotations.renderAllHighlights();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [iframeDoc, annotations.loading, annotations.renderAllHighlights]);

  // Keyboard shortcuts for zoom and print
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (isMeta && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomIn();
        return;
      }

      if (isMeta && e.key === "-") {
        e.preventDefault();
        zoomOut();
        return;
      }

      if (isMeta && e.key === "0") {
        e.preventDefault();
        handleScaleChange(1.0);
        return;
      }

      // Print: Cmd+P — open in system default app
      if (isMeta && e.key === "p") {
        e.preventDefault();
        openFileWithDefaultApp(filePath).catch((err: unknown) =>
          console.error("Failed to open for print:", err)
        );
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomIn, zoomOut, handleScaleChange, filePath]);

  // Handle text selection for highlight mode — depends on iframeDoc state
  // so listeners are re-attached when iframe becomes available
  useEffect(() => {
    if (!iframeDoc) return;

    const handleMouseUp = () => {
      if (toolMode === "highlight") {
        const selection = iframeDoc.getSelection();
        if (selection && !selection.isCollapsed) {
          annotations.addTextHighlight(highlightColor);
        }
      }
    };

    // Handle click for freetext mode
    const handleClick = (e: MouseEvent) => {
      if (toolMode === "freetext") {
        const iframeRect = iframeRef.current?.getBoundingClientRect();
        if (!iframeRect) return;

        const x = (e.clientX - iframeRect.left) / scale;
        const y = (e.clientY - iframeRect.top) / scale + (iframeDoc.documentElement.scrollTop || 0);

        const text = prompt("Enter note text:");
        if (text) {
          annotations.addFreetextNote(x, y, text);
        }
      }
    };

    // Handle hover for highlight popup
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const highlightEl = target.closest("[data-highlight-id]") as HTMLElement | null;

      if (highlightEl) {
        const highlightId = highlightEl.dataset.highlightId!;
        const highlight = annotations.highlights.find((h) => h.id === highlightId);
        if (highlight) {
          const rect = highlightEl.getBoundingClientRect();
          const iframeRect = iframeRef.current?.getBoundingClientRect();
          if (iframeRect) {
            setPopupState({
              highlightId,
              color: highlight.color,
              x: rect.left - iframeRect.left + rect.width / 2,
              y: rect.top - iframeRect.top - 10,
            });
          }
        }
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.relatedTarget as HTMLElement | null;
      if (!target?.closest("[data-highlight-id]")) {
        setPopupState(null);
      }
    };

    iframeDoc.addEventListener("mouseup", handleMouseUp);
    iframeDoc.addEventListener("click", handleClick);
    iframeDoc.addEventListener("mouseover", handleMouseOver);
    iframeDoc.addEventListener("mouseout", handleMouseOut);

    return () => {
      iframeDoc.removeEventListener("mouseup", handleMouseUp);
      iframeDoc.removeEventListener("click", handleClick);
      iframeDoc.removeEventListener("mouseover", handleMouseOver);
      iframeDoc.removeEventListener("mouseout", handleMouseOut);
    };
  }, [iframeDoc, toolMode, highlightColor, scale, annotations]);

  // Overlay mouse handlers for area/rectangle/drawing
  const spatialToolActive = toolMode === "area" || toolMode === "rectangle" || toolMode === "drawing";

  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!spatialToolActive) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (toolMode === "drawing") {
        setIsDrawing(true);
        setCurrentStroke({
          points: [{ x: x / scale, y: y / scale }],
          color: drawingColor,
          width: 2,
        });
      } else {
        setIsDrawing(true);
        setDrawStart({ x, y });
        setDrawCurrent({ x, y });
      }
    },
    [spatialToolActive, toolMode, scale, drawingColor]
  );

  const handleOverlayMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (toolMode === "drawing" && currentStroke) {
        setCurrentStroke((prev) =>
          prev
            ? { ...prev, points: [...prev.points, { x: x / scale, y: y / scale }] }
            : null
        );
      } else {
        setDrawCurrent({ x, y });
      }
    },
    [isDrawing, toolMode, currentStroke, scale]
  );

  const handleOverlayMouseUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeDoc) return;

    if (toolMode === "drawing" && currentStroke && currentStroke.points.length >= 2) {
      // Complete drawing stroke — accumulate strokes
      const newStrokes = [...drawingStrokes, currentStroke];
      setDrawingStrokes(newStrokes);
      setCurrentStroke(null);

      // Auto-save drawing after each stroke
      const allPoints = newStrokes.flatMap((s) => s.points);
      const minX = Math.min(...allPoints.map((p) => p.x));
      const minY = Math.min(...allPoints.map((p) => p.y));
      const maxX = Math.max(...allPoints.map((p) => p.x));
      const maxY = Math.max(...allPoints.map((p) => p.y));
      const width = maxX - minX + 10;
      const height = maxY - minY + 10;

      // Normalize strokes as percentages
      const normalizedStrokes = newStrokes.map((s) => ({
        ...s,
        points: s.points.map((p) => ({
          x: (p.x - minX + 5) / width,
          y: (p.y - minY + 5) / height,
        })),
      }));

      annotations.addDrawingHighlight(
        minX - 5,
        minY - 5,
        width,
        height,
        drawingColor,
        { strokes: normalizedStrokes }
      );

      setDrawingStrokes([]);
    } else if (
      (toolMode === "area" || toolMode === "rectangle") &&
      drawStart &&
      drawCurrent
    ) {
      const minX = Math.min(drawStart.x, drawCurrent.x) / scale;
      const minY = Math.min(drawStart.y, drawCurrent.y) / scale;
      const w = Math.abs(drawCurrent.x - drawStart.x) / scale;
      const h = Math.abs(drawCurrent.y - drawStart.y) / scale;

      // Add iframe scroll offset
      const scrollTop = iframeDoc.documentElement.scrollTop || 0;

      if (w > 10 && h > 10) {
        if (toolMode === "area") {
          annotations.addAreaHighlight(minX, minY + scrollTop, w, h, highlightColor);
        } else {
          annotations.addShapeHighlight(minX, minY + scrollTop, w, h, shapeColor, {
            shapeType: "rectangle",
            strokeColor: shapeColor,
            strokeWidth: 2,
          });
        }
      }

      setDrawStart(null);
      setDrawCurrent(null);
    }
  }, [
    isDrawing,
    toolMode,
    currentStroke,
    drawStart,
    drawCurrent,
    drawingStrokes,
    drawingColor,
    highlightColor,
    shapeColor,
    scale,
    annotations,
  ]);

  // Scroll to annotation on click in panel
  const handleAnnotationClick = useCallback(
    (annotationId: string) => {
      const highlight = annotations.highlights.find((h) => h.id === annotationId);
      if (!highlight) return;

      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      const element = iframeDoc.querySelector(`[data-highlight-id="${annotationId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [annotations.highlights]
  );

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-4">
          <FileText className="h-12 w-12 mx-auto opacity-50" />
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={handleOpenExternal}>
            Open in Browser
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full flex flex-col bg-background">
      {/* Toolbar */}
      <HTMLToolbar
        scale={scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onScaleChange={handleScaleChange}
        highlightColor={highlightColor}
        onColorChange={setHighlightColor}
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        drawingColor={drawingColor}
        onDrawingColorChange={setDrawingColor}
        shapeColor={shapeColor}
        onShapeColorChange={setShapeColor}
        leftPanelOpen={htmlLeftPanelOpen}
        onToggleLeftPanel={toggleHtmlLeftPanel}
        infoPaneOpen={infoPaneOpen}
        onToggleInfoPane={toggleInfoPane}
        isStackedLayout={libraryLayout === "stacked"}
        onSearch={htmlSearch.search}
        onSearchNext={htmlSearch.searchNext}
        onSearchPrev={htmlSearch.searchPrev}
        onSearchClear={htmlSearch.clearSearch}
        searchMatchCount={htmlSearch.matchCount}
        searchCurrentMatch={htmlSearch.currentMatch}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onRefresh={handleRefresh}
        onOpenExternal={handleOpenExternal}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        {htmlLeftPanelOpen && (
          <div className="w-[220px] border-r flex flex-col flex-shrink-0">
            {/* Tab buttons */}
            <div className="flex border-b">
              <button
                onClick={() => setLeftPanelTab("outline")}
                className={cn(
                  "flex-1 text-xs py-1.5 font-medium transition-colors",
                  leftPanelTab === "outline"
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Outline
              </button>
              <button
                onClick={() => setLeftPanelTab("annotations")}
                className={cn(
                  "flex-1 text-xs py-1.5 font-medium transition-colors",
                  leftPanelTab === "annotations"
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Notes {annotations.highlights.length > 0 && `(${annotations.highlights.length})`}
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {leftPanelTab === "outline" ? (
                <HTMLOutlinePanel iframeDoc={iframeDoc} onReady={iframeReady} />
              ) : (
                <HTMLAnnotationPanel
                  annotations={annotations.highlights}
                  onAnnotationClick={handleAnnotationClick}
                  onDelete={annotations.deleteHighlight}
                  title={title}
                />
              )}
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 relative overflow-hidden">
          {/* Loading spinner */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          )}

          {/* Iframe — srcdoc makes it same-origin so contentDocument is accessible */}
          {htmlContent && (
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={() => {
                setLoading(false);
                setError("Failed to load HTML content");
              }}
              title={title || "HTML Viewer"}
              sandbox="allow-same-origin"
            />
          )}

          {/* Overlay for area/rectangle/drawing tools */}
          {spatialToolActive && (
            <div
              ref={overlayRef}
              className="absolute inset-0 z-20"
              style={{ cursor: toolMode === "drawing" ? "crosshair" : "crosshair" }}
              onMouseDown={handleOverlayMouseDown}
              onMouseMove={handleOverlayMouseMove}
              onMouseUp={handleOverlayMouseUp}
              onMouseLeave={handleOverlayMouseUp}
            >
              {/* Drawing preview rect */}
              {isDrawing &&
                (toolMode === "area" || toolMode === "rectangle") &&
                drawStart &&
                drawCurrent && (
                  <div
                    className="absolute border-2 border-dashed"
                    style={{
                      left: Math.min(drawStart.x, drawCurrent.x),
                      top: Math.min(drawStart.y, drawCurrent.y),
                      width: Math.abs(drawCurrent.x - drawStart.x),
                      height: Math.abs(drawCurrent.y - drawStart.y),
                      borderColor:
                        toolMode === "area" ? highlightColor : shapeColor,
                      backgroundColor:
                        toolMode === "area"
                          ? `${highlightColor}33`
                          : "transparent",
                    }}
                  />
                )}

              {/* Drawing SVG for freehand */}
              {toolMode === "drawing" && (
                <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
                  {/* Completed strokes */}
                  {drawingStrokes.map((stroke, i) => (
                    <path
                      key={i}
                      d={stroke.points
                        .map((p, j) =>
                          j === 0
                            ? `M ${p.x * scale} ${p.y * scale}`
                            : `L ${p.x * scale} ${p.y * scale}`
                        )
                        .join(" ")}
                      stroke={stroke.color}
                      strokeWidth={stroke.width}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {/* Current stroke */}
                  {currentStroke && currentStroke.points.length >= 2 && (
                    <path
                      d={currentStroke.points
                        .map((p, j) =>
                          j === 0
                            ? `M ${p.x * scale} ${p.y * scale}`
                            : `L ${p.x * scale} ${p.y * scale}`
                        )
                        .join(" ")}
                      stroke={currentStroke.color}
                      strokeWidth={currentStroke.width}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
              )}
            </div>
          )}

          {/* Highlight popup */}
          {popupState && (
            <div
              className="absolute z-30"
              style={{
                left: popupState.x,
                top: popupState.y,
                transform: "translate(-50%, -100%)",
              }}
            >
              <HighlightPopup
                currentColor={popupState.color}
                onColorChange={(color) => {
                  annotations.updateHighlightColor(popupState.highlightId, color);
                  setPopupState((prev) =>
                    prev ? { ...prev, color } : null
                  );
                }}
                onDelete={() => {
                  annotations.deleteHighlight(popupState.highlightId);
                  setPopupState(null);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
