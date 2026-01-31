import { useState, useCallback, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { GlobalWorkerOptions } from "pdfjs-dist";

// CSS imports in correct order
import "pdfjs-dist/web/pdf_viewer.css";
import "react-pdf-highlighter-plus/style/style.css";
import "./PDFViewer.css";

import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  AreaHighlight,
  FreetextHighlight,
  DrawingHighlight,
  ShapeHighlight,
  MonitoredHighlightContainer,
  useHighlightContainerContext,
  usePdfHighlighterContext,
  LeftPanel,
  type Highlight,
  type PdfHighlighterUtils,
  type GhostHighlight,
  type ScaledPosition,
  type PdfScaleValue,
  type Tip,
  type DrawingStroke,
  type ShapeData,
  type ShapeType,
} from "react-pdf-highlighter-plus";

import { PDFToolbar } from "./PDFToolbar";
import { HighlightPopup } from "./HighlightPopup";
import {
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  type Annotation,
} from "@/services/tauri/commands";
import { useUIStore } from "@/stores/uiStore";

// Set up PDF.js worker
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface AppHighlight extends Highlight {
  highlightColor?: string;
  selectedText?: string;
  // Freetext properties
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  // Shape properties
  shapeType?: ShapeType;
  strokeColor?: string;
  strokeWidth?: number;
}

interface PDFViewerProps {
  filePath: string;
  itemId: string;
}

// Tool modes
type ToolMode = "highlight" | "area" | "freetext" | "drawing" | "rectangle" | null;

// Highlight container with click-to-show-popup
interface HighlightRendererProps {
  onColorChange: (highlightId: string, color: string) => void;
  onDelete: (highlightId: string) => void;
  onEdit: (highlightId: string, edit: Partial<AppHighlight>) => void;
}

function HighlightRenderer({ onColorChange, onDelete, onEdit }: HighlightRendererProps) {
  const { highlight, viewportToScaled, screenshot, isScrolledTo, highlightBindings } =
    useHighlightContainerContext<AppHighlight>();
  const { toggleEditInProgress } = usePdfHighlighterContext();

  let component;

  if (highlight.type === "text") {
    component = (
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.highlightColor}
      />
    );
  } else if (highlight.type === "freetext") {
    component = (
      <FreetextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={highlightBindings.textLayer}
        color={highlight.color}
        backgroundColor={highlight.backgroundColor}
        fontSize={highlight.fontSize}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToScaled(boundingRect),
              rects: [],
            },
          });
          toggleEditInProgress(false);
        }}
        onTextChange={(newText) => {
          onEdit(highlight.id, { content: { text: newText } });
        }}
        onEditStart={() => toggleEditInProgress(true)}
        onEditEnd={() => toggleEditInProgress(false)}
        onDelete={() => onDelete(highlight.id)}
      />
    );
  } else if (highlight.type === "drawing") {
    component = (
      <DrawingHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={highlightBindings.textLayer}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToScaled(boundingRect),
              rects: [],
            },
          });
        }}
        onStyleChange={(newImage, newStrokes) => {
          onEdit(highlight.id, {
            content: { image: newImage, strokes: newStrokes },
          });
        }}
        onEditStart={() => toggleEditInProgress(true)}
        onEditEnd={() => toggleEditInProgress(false)}
        onDelete={() => onDelete(highlight.id)}
      />
    );
  } else if (highlight.type === "shape") {
    component = (
      <ShapeHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={highlightBindings.textLayer}
        shapeType={highlight.shapeType || "rectangle"}
        strokeColor={highlight.strokeColor || "#000000"}
        strokeWidth={highlight.strokeWidth || 2}
        startPoint={highlight.content?.shape?.startPoint}
        endPoint={highlight.content?.shape?.endPoint}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToScaled(boundingRect),
              rects: [],
            },
          });
        }}
        onEditStart={() => toggleEditInProgress(true)}
        onEditEnd={() => toggleEditInProgress(false)}
        onDelete={() => onDelete(highlight.id)}
      />
    );
  } else {
    // Area highlight (default)
    component = (
      <AreaHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.highlightColor}
        bounds={highlightBindings.textLayer}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToScaled(boundingRect),
              rects: [],
            },
            content: { image: screenshot(boundingRect) },
          });
          toggleEditInProgress(false);
        }}
        onEditStart={() => toggleEditInProgress(true)}
        onDelete={() => onDelete(highlight.id)}
      />
    );
  }

  // Only show popup tip for text and area highlights
  const showTip = highlight.type === "text" || highlight.type === "area";

  const highlightTip: Tip = {
    position: highlight.position,
    content: (
      <HighlightPopup
        currentColor={highlight.highlightColor}
        onColorChange={(newColor) => onColorChange(highlight.id, newColor)}
        onDelete={() => onDelete(highlight.id)}
      />
    ),
  };

  return (
    <MonitoredHighlightContainer
      highlightTip={showTip ? highlightTip : undefined}
      key={highlight.id}
    >
      {component}
    </MonitoredHighlightContainer>
  );
}

export function PDFViewer({ filePath, itemId }: PDFViewerProps) {
  const [highlights, setHighlights] = useState<AppHighlight[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [scale, setScale] = useState<PdfScaleValue | undefined>(undefined);
  const [displayScale, setDisplayScale] = useState<number>(1);
  const [highlightColor, setHighlightColor] = useState("#FFE28F");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [toolMode, setToolMode] = useState<ToolMode>("highlight");
  const [drawingColor, setDrawingColor] = useState("#000000");
  const [shapeColor, setShapeColor] = useState("#000000");
  const [darkMode, setDarkMode] = useState(false);

  // Get panel states from global store
  const {
    infoPaneOpen,
    toggleInfoPane,
    pdfLeftPanelOpen,
    togglePdfLeftPanel,
    libraryLayout,
  } = useUIStore();

  const pdfHighlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
  const [, forceUpdate] = useState({});
  const hasInitializedUtilsRef = useRef(false);

  // Track dark mode from document
  useEffect(() => {
    const checkDarkMode = () => {
      setDarkMode(document.documentElement.classList.contains("dark"));
    };

    checkDarkMode();

    // Observe class changes on document element
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // Reset utils initialization flag when URL changes
  useEffect(() => {
    hasInitializedUtilsRef.current = false;
  }, [pdfUrl]);

  // Helper to apply scale to viewer
  const applyScale = useCallback((newScale: PdfScaleValue) => {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    if (!viewer) return;

    if (typeof newScale === "number") {
      viewer.currentScale = newScale;
    } else {
      viewer.currentScaleValue = newScale;
    }
  }, []);

  // Track current page and scale when user scrolls/zooms
  useEffect(() => {
    if (!pdfHighlighterUtilsRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current.getEventBus() as any;
    if (!eventBus) return;

    const handlePageChange = (evt: { pageNumber: number }) => {
      setCurrentPage(evt.pageNumber);
    };

    const handleScaleChange = (evt: { scale: number }) => {
      setDisplayScale(evt.scale);
    };

    eventBus.on("pagechanging", handlePageChange);
    eventBus.on("scalechanging", handleScaleChange);

    // Get initial scale
    const viewer = pdfHighlighterUtilsRef.current.getViewer();
    if (viewer?.currentScale) {
      setDisplayScale(viewer.currentScale);
    }

    return () => {
      eventBus.off("pagechanging", handlePageChange);
      eventBus.off("scalechanging", handleScaleChange);
    };
  }, [pdfHighlighterUtilsRef.current]);

  // Convert file path to Tauri asset URL
  useEffect(() => {
    if (filePath) {
      const url = convertFileSrc(filePath);
      setPdfUrl(url);
    }
  }, [filePath]);

  // Load annotations from database
  useEffect(() => {
    async function loadAnnotations() {
      try {
        const annotations = await getAnnotations(parseInt(itemId, 10));
        const appHighlights = annotations.map(convertAnnotationToHighlight);
        setHighlights(appHighlights);
      } catch {
        // Failed to load annotations
      }
    }
    loadAnnotations();
  }, [itemId]);

  function convertAnnotationToHighlight(annotation: Annotation): AppHighlight {
    const position = JSON.parse(annotation.positionJson) as ScaledPosition;

    // Ensure position has width/height (imported annotations may lack these)
    if (position.boundingRect && !position.boundingRect.width) {
      position.boundingRect.width = position.boundingRect.x2 - position.boundingRect.x1;
      position.boundingRect.height = position.boundingRect.y2 - position.boundingRect.y1;
    }
    if (position.rects) {
      position.rects = position.rects.map(rect => ({
        ...rect,
        width: rect.width || (rect.x2 - rect.x1),
        height: rect.height || (rect.y2 - rect.y1),
      }));
    }

    // Map annotation types - "highlight" from import should be "text"
    let highlightType = annotation.annotationType;
    if (highlightType === "highlight") {
      highlightType = "text";
    }

    // Use selectedText or comment for content
    const textContent = annotation.selectedText || annotation.comment || "";

    return {
      id: String(annotation.id),
      type: highlightType as AppHighlight["type"],
      position,
      content: { text: textContent },
      highlightColor: annotation.color,
      selectedText: textContent,
    };
  }

  const getNextId = () => `temp-${Date.now()}`;

  // Create text or area highlight based on selection type
  const handleSelection = useCallback(
    (selection: GhostHighlight & { makeGhostHighlight: () => GhostHighlight }) => {
      const ghost = selection.makeGhostHighlight();
      const { position, content, type } = ghost;
      const tempId = getNextId();

      // Determine if this is an area or text highlight
      const isArea = type === "area" || toolMode === "area";
      const highlightType = isArea ? "area" : "text";

      const optimisticHighlight: AppHighlight = {
        id: tempId,
        type: highlightType,
        position,
        content,
        highlightColor: highlightColor,
        selectedText: content?.text,
      };

      setHighlights((prev) => [...prev, optimisticHighlight]);

      (async () => {
        try {
          const annotation = await createAnnotation({
            itemId: parseInt(itemId, 10),
            annotationType: highlightType,
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: content?.text,
            color: highlightColor,
          });

          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [itemId, highlightColor, toolMode]
  );

  // Create freetext note
  const handleFreetextClick = useCallback(
    (position: ScaledPosition) => {
      const tempId = getNextId();
      const newHighlight: AppHighlight = {
        id: tempId,
        type: "freetext",
        position,
        content: { text: "" },
        color: "#000000",
        backgroundColor: "#FFFFA5",
        fontSize: "14px",
      };
      setHighlights((prev) => [...prev, newHighlight]);

      (async () => {
        try {
          const annotation = await createAnnotation({
            itemId: parseInt(itemId, 10),
            annotationType: "freetext",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: "",
            color: "#FFFFA5",
          });
          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [itemId]
  );

  // Create drawing highlight
  const handleDrawingComplete = useCallback(
    (dataUrl: string, position: ScaledPosition, strokes: DrawingStroke[]) => {
      const tempId = getNextId();
      const newHighlight: AppHighlight = {
        id: tempId,
        type: "drawing",
        position,
        content: { image: dataUrl, strokes },
      };
      setHighlights((prev) => [...prev, newHighlight]);
      setToolMode(null);

      (async () => {
        try {
          const annotation = await createAnnotation({
            itemId: parseInt(itemId, 10),
            annotationType: "drawing",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: undefined,
            color: drawingColor,
          });
          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [itemId, drawingColor]
  );

  // Create shape highlight
  const handleShapeComplete = useCallback(
    (position: ScaledPosition, shape: ShapeData) => {
      const tempId = getNextId();
      const newHighlight: AppHighlight = {
        id: tempId,
        type: "shape",
        position,
        content: { shape },
        shapeType: shape.shapeType,
        strokeColor: shape.strokeColor,
        strokeWidth: shape.strokeWidth,
      };
      setHighlights((prev) => [...prev, newHighlight]);
      setToolMode(null);

      (async () => {
        try {
          const annotation = await createAnnotation({
            itemId: parseInt(itemId, 10),
            annotationType: "shape",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: undefined,
            color: shape.strokeColor,
          });
          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [itemId]
  );

  // Change highlight color
  const handleColorChange = useCallback(
    async (highlightId: string, newColor: string) => {
      // Update local state first for immediate feedback
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === highlightId ? { ...h, highlightColor: newColor } : h
        )
      );

      // Skip DB update for temp IDs (not yet saved)
      if (highlightId.startsWith("temp-")) {
        return;
      }

      try {
        await updateAnnotation(parseInt(highlightId, 10), { color: newColor });
      } catch {
        // Failed to update in DB
      }
    },
    []
  );

  // Edit highlight
  const handleEdit = useCallback(
    async (highlightId: string, edit: Partial<AppHighlight>) => {
      // Update local state first
      setHighlights((prev) =>
        prev.map((h) => (h.id === highlightId ? { ...h, ...edit } : h))
      );

      // Skip DB update for temp IDs (not yet saved)
      if (highlightId.startsWith("temp-")) {
        return;
      }

      try {
        const updates: { positionJson?: string; comment?: string } = {};
        if (edit.position) {
          updates.positionJson = JSON.stringify(edit.position);
        }
        if (edit.content?.text) {
          updates.comment = edit.content.text;
        }
        if (Object.keys(updates).length > 0) {
          await updateAnnotation(parseInt(highlightId, 10), updates);
        }
      } catch {
        // Failed to update
      }
    },
    []
  );

  // Delete highlight
  const handleDelete = useCallback(async (highlightId: string) => {
    // Check if this is a temp ID (not yet saved to DB)
    if (highlightId.startsWith("temp-")) {
      // Just remove from local state
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
      return;
    }

    try {
      await deleteAnnotation(parseInt(highlightId, 10));
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    } catch {
      // Failed to delete from DB, but still remove from UI
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    }
  }, []);

  // Zoom controls - apply scale directly to viewer
  const zoomIn = useCallback(() => {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    const currentScale = viewer?.currentScale || 1;
    const newScale = Math.min(currentScale + 0.25, 10);
    applyScale(newScale);
    setScale(newScale);
  }, [applyScale]);

  const zoomOut = useCallback(() => {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    const currentScale = viewer?.currentScale || 1;
    const newScale = Math.max(currentScale - 0.25, 0.25);
    applyScale(newScale);
    setScale(newScale);
  }, [applyScale]);

  const fitWidth = useCallback(() => {
    applyScale("page-width");
    setScale("page-width");
  }, [applyScale]);

  const fitPage = useCallback(() => {
    applyScale("page-fit");
    setScale("page-fit");
  }, [applyScale]);

  // Handle manual scale input from toolbar
  const handleScaleChange = useCallback((newScale: number) => {
    applyScale(newScale);
    setScale(newScale);
  }, [applyScale]);

  // Page navigation
  const goToPage = useCallback((page: number) => {
    pdfHighlighterUtilsRef.current?.goToPage(page);
    setCurrentPage(page);
  }, []);

  const nextPage = useCallback(() => {
    if (currentPage < totalPages) goToPage(currentPage + 1);
  }, [currentPage, totalPages, goToPage]);

  const prevPage = useCallback(() => {
    if (currentPage > 1) goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <PDFToolbar
        scale={displayScale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitWidth={fitWidth}
        onFitPage={fitPage}
        onScaleChange={handleScaleChange}
        highlightColor={highlightColor}
        onColorChange={setHighlightColor}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={goToPage}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        drawingColor={drawingColor}
        onDrawingColorChange={setDrawingColor}
        shapeColor={shapeColor}
        onShapeColorChange={setShapeColor}
        leftPanelOpen={pdfLeftPanelOpen}
        onToggleLeftPanel={togglePdfLeftPanel}
        infoPaneOpen={infoPaneOpen}
        onToggleInfoPane={toggleInfoPane}
        isStackedLayout={libraryLayout === "stacked"}
      />

      <div className="relative flex-1 overflow-hidden flex h-full">
        <PdfLoader document={pdfUrl}>
          {(pdfDocument) => {
            if (pdfDocument.numPages !== totalPages) {
              queueMicrotask(() => setTotalPages(pdfDocument.numPages));
            }

            return (
              <div className="flex h-full w-full">
                {/* Left Panel - Outline & Thumbnails */}
                <LeftPanel
                  pdfDocument={pdfDocument}
                  viewer={pdfHighlighterUtilsRef.current?.getViewer()}
                  linkService={pdfHighlighterUtilsRef.current?.getLinkService()}
                  eventBus={pdfHighlighterUtilsRef.current?.getEventBus()}
                  goToPage={pdfHighlighterUtilsRef.current?.goToPage}
                  isOpen={pdfLeftPanelOpen}
                  onOpenChange={(open) => useUIStore.getState().setPdfLeftPanelOpen(open)}
                  width={220}
                  defaultTab="thumbnails"
                />

                <div className="flex-1 relative overflow-hidden">
                  <PdfHighlighter
                    pdfDocument={pdfDocument}
                    pdfScaleValue={scale}
                    highlights={highlights}
                    theme={{ mode: darkMode ? "dark" : "light" }}
                    utilsRef={(utils) => {
                      pdfHighlighterUtilsRef.current = utils;
                      if (!hasInitializedUtilsRef.current) {
                        hasInitializedUtilsRef.current = true;
                        forceUpdate({});
                      }
                    }}
                    // Text and Area highlight modes
                    textSelectionColor={(toolMode === "highlight" || toolMode === "area") ? highlightColor : undefined}
                    onSelection={(toolMode === "highlight" || toolMode === "area") ? handleSelection : undefined}
                    // Area highlight mode
                    enableAreaSelection={() => toolMode === "area"}
                    areaSelectionMode={toolMode === "area"}
                    // Freetext mode
                    enableFreetextCreation={() => toolMode === "freetext"}
                    onFreetextClick={handleFreetextClick}
                    // Drawing mode
                    enableDrawingMode={toolMode === "drawing"}
                    onDrawingComplete={handleDrawingComplete}
                    onDrawingCancel={() => setToolMode(null)}
                    drawingStrokeColor={drawingColor}
                    drawingStrokeWidth={3}
                    // Shape mode (rectangle)
                    enableShapeMode={toolMode === "rectangle" ? "rectangle" : null}
                    onShapeComplete={handleShapeComplete}
                    onShapeCancel={() => setToolMode(null)}
                    shapeStrokeColor={shapeColor}
                    shapeStrokeWidth={2}
                    style={{ height: "100%" }}
                  >
                    <HighlightRenderer
                      onColorChange={handleColorChange}
                      onDelete={handleDelete}
                      onEdit={handleEdit}
                    />
                  </PdfHighlighter>
                </div>
              </div>
            );
          }}
        </PdfLoader>
      </div>
    </div>
  );
}

export default PDFViewer;
