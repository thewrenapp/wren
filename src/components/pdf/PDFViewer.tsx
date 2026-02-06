import { useState, useCallback, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { GlobalWorkerOptions } from "pdfjs-dist";
import { toast } from "@/stores/toastStore";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

// CSS imports in correct order
import "pdfjs-dist/web/pdf_viewer.css";
import "@/components/pdf/pdfjs/style/style.css";
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
} from "@/components/pdf/pdfjs";

import { ChevronLeft } from "lucide-react";
import { PDFToolbar, type SearchOptions } from "./PDFToolbar";
import { HighlightPopup } from "./HighlightPopup";
import { AnnotationPanel } from "./AnnotationPanel";
import { OutlinePanel } from "./OutlinePanel";
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
  fontFamily?: string;
  // Shape properties
  shapeType?: ShapeType;
  strokeColor?: string;
  strokeWidth?: number;
}

interface PDFViewerProps {
  filePath: string;
  attachmentId: string;
}

// Tool modes
type ToolMode = "highlight" | "area" | "freetext" | "drawing" | "rectangle" | null;
type ViewerMode = "pan" | "edit";

const DEFAULT_TEXT_HIGHLIGHT_COLOR = "#FFE28F";
const DEFAULT_AREA_HIGHLIGHT_COLOR = "#FFE28F";

// Highlight container with click-to-show-popup
interface HighlightRendererProps {
  onColorChange: (highlightId: string, color: string) => void;
  onDelete: (highlightId: string) => void;
  onEdit: (highlightId: string, edit: Partial<AppHighlight>) => void;
  isEditable: boolean;
  showTipEnabled: boolean;
  selectionRects: DOMRect[];
}

function HighlightRenderer({
  onColorChange,
  onDelete,
  onEdit,
  isEditable,
  showTipEnabled,
  selectionRects,
}: HighlightRendererProps) {
  const { highlight, viewportToPdfScaled, screenshot, isScrolledTo, highlightBindings, zoomScale } =
    useHighlightContainerContext<AppHighlight>();
  const { toggleEditInProgress } = usePdfHighlighterContext();
  let component;

  if (highlight.type === "text") {
    component = (
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.highlightColor || DEFAULT_TEXT_HIGHLIGHT_COLOR}
        highlightStyle={"highlight"}
      />
    );
  } else if (highlight.type === "freetext") {
    // Scale font size with zoom level
    const baseFontSize = parseFloat(highlight.fontSize || "14");
    const scaledFontSize = `${Math.round(baseFontSize * zoomScale)}px`;
    component = (
      <FreetextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={highlightBindings.textLayer}
        color={highlight.color}
        backgroundColor={highlight.backgroundColor}
        fontSize={scaledFontSize}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
          });
          toggleEditInProgress(false);
        }}
        onTextChange={(newText) => {
          onEdit(highlight.id, { content: { text: newText } });
        }}
        onStyleChange={isEditable ? (style) => {
          onEdit(highlight.id, {
            ...(style.color !== undefined && { color: style.color }),
            ...(style.backgroundColor !== undefined && { backgroundColor: style.backgroundColor }),
            ...(style.fontSize !== undefined && { fontSize: style.fontSize }),
            ...(style.fontFamily !== undefined && { fontFamily: style.fontFamily }),
          });
        } : undefined}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onEditEnd={isEditable ? () => toggleEditInProgress(false) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
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
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
          });
        }}
        onStyleChange={(newImage, newStrokes) => {
          onEdit(highlight.id, {
            content: { image: newImage, strokes: newStrokes },
          });
        }}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onEditEnd={isEditable ? () => toggleEditInProgress(false) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
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
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
          });
        }}
        onStyleChange={isEditable ? (style) => {
          onEdit(highlight.id, {
            ...(style.strokeColor !== undefined && { strokeColor: style.strokeColor }),
            ...(style.strokeWidth !== undefined && { strokeWidth: style.strokeWidth }),
          });
        } : undefined}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onEditEnd={isEditable ? () => toggleEditInProgress(false) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
      />
    );
  } else {
    // Area highlight (default)
    component = (
      <AreaHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.highlightColor || DEFAULT_AREA_HIGHLIGHT_COLOR}
        bounds={highlightBindings.textLayer}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
            content: { image: screenshot(boundingRect) },
          });
          toggleEditInProgress(false);
        }}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
      />
    );
  }

  // Show popup tip for text, area, and shape highlights
  const showTip = highlight.type === "text" || highlight.type === "area" || highlight.type === "shape";

  const SHAPE_COLORS = [
    { name: "Black", value: "#000000" },
    { name: "Red", value: "#EF4444" },
    { name: "Blue", value: "#3B82F6" },
    { name: "Green", value: "#22C55E" },
    { name: "Purple", value: "#A855F7" },
    { name: "Orange", value: "#F97316" },
  ];

  const highlightTip: Tip = {
    position: highlight.position,
    content: showTip ? (
      <HighlightPopup
        currentColor={
          highlight.type === "shape"
            ? highlight.strokeColor || "#000000"
            : highlight.highlightColor ||
              (highlight.type === "area"
                ? DEFAULT_AREA_HIGHLIGHT_COLOR
                : DEFAULT_TEXT_HIGHLIGHT_COLOR)
        }
        colors={highlight.type === "shape" ? SHAPE_COLORS : undefined}
        onColorChange={(newColor) => {
          if (highlight.type === "shape") {
            onEdit(highlight.id, { strokeColor: newColor });
          } else {
            onColorChange(highlight.id, newColor);
          }
        }}
        onDelete={() => onDelete(highlight.id)}
      />
    ) : null,
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

export function PDFViewer({ filePath, attachmentId }: PDFViewerProps) {
  const [highlights, setHighlights] = useState<AppHighlight[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [scale, setScale] = useState<PdfScaleValue | undefined>(undefined);
  const [displayScale, setDisplayScale] = useState<number>(1);
  const [highlightColor, setHighlightColor] = useState(DEFAULT_TEXT_HIGHLIGHT_COLOR);
  const [areaHighlightColor, setAreaHighlightColor] = useState(DEFAULT_AREA_HIGHLIGHT_COLOR);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [toolMode, setToolMode] = useState<ToolMode>(null);
  const [mode, setMode] = useState<ViewerMode>("pan");
  const [selectionRects, setSelectionRects] = useState<DOMRect[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [drawingColor, setDrawingColor] = useState("#000000");
  const [shapeColor, setShapeColor] = useState("#000000");
  const [darkMode, setDarkMode] = useState(false);

  // Search state
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrentMatch, setSearchCurrentMatch] = useState(0);
  const [viewerReady, setViewerReady] = useState(false);

  // Left panel tab state
  const [leftPanelTab, setLeftPanelTab] = useState<"thumbnails" | "outline" | "annotations">("thumbnails");

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectingActiveRef = useRef(false);

  // Saved selection ref for Cmd+C copy
  const savedSelectionRef = useRef<string>("");

  // Get panel states from global store
  const {
    infoPaneOpen,
    toggleInfoPane,
    pdfLeftPanelOpen,
    togglePdfLeftPanel,
    libraryLayout,
  } = useUIStore();

  const pdfHighlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
  const hasInitializedUtilsRef = useRef(false);

  // Auto-save drawing on mouseup (each stroke = one drawing, like shape tool)
  useEffect(() => {
    if (toolMode !== "drawing") return;

    const handleMouseUp = () => {
      // Small delay to let the stroke complete
      setTimeout(() => {
        const doneButton = document.querySelector('.DrawingCanvas__doneButton') as HTMLButtonElement;
        if (doneButton) {
          doneButton.click();
        }
      }, 100);
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [toolMode]);

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

  // Fullscreen change handler
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Save selection for Cmd+C copy
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Save selection on mouseup (when user finishes selecting text)
    const handleMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection?.toString().trim();
        if (selectedText) {
          savedSelectionRef.current = selectedText;
        }
      }, 10);
    };

    // Also save on selectionchange for better tracking
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText) {
        const anchorNode = selection?.anchorNode;
        if (anchorNode && container.contains(anchorNode)) {
          savedSelectionRef.current = selectedText;
        }
      }
    };

    // Clear saved selection on left-click when selection is cleared
    const handleClick = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          savedSelectionRef.current = "";
        }
      }, 100);
    };

    container.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  const isTextSelectionMode = mode === "edit" && (toolMode === null || toolMode === "highlight");
  const isSelectMode = isTextSelectionMode;

  // Track active text selection and dim only overlapping text highlights (select mode)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerDown = () => {
      if (!isTextSelectionMode) return;
      selectingActiveRef.current = true;
    };

    const handlePointerMove = () => {
      if (!isTextSelectionMode || !selectingActiveRef.current) return;
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (!range || !container.contains(range.commonAncestorContainer)) {
        setSelectionRects([]);
        return;
      }
      if (selection.isCollapsed || selection.toString().trim().length === 0) {
        setSelectionRects([]);
        return;
      }
      const rects = Array.from(range.getClientRects());
      setSelectionRects(rects.length > 0 ? rects : [new DOMRect(0, 0, 1, 1)]);
    };

    const handlePointerUp = () => {
      if (!isTextSelectionMode) return;
      selectingActiveRef.current = false;
      // Keep selection rects until selection is cleared.
    };

    const handleSelectionChange = () => {
      if (!isTextSelectionMode) return;
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (
        !range ||
        !selection ||
        selection.isCollapsed ||
        selection.toString().trim().length === 0 ||
        !container.contains(range.commonAncestorContainer)
      ) {
        setSelectionRects([]);
        setIsSelecting(false);
        return;
      }
      const rects = Array.from(range.getClientRects());
      setSelectionRects(rects.length > 0 ? rects : [new DOMRect(0, 0, 1, 1)]);
      setIsSelecting(true);
    };

    container.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
      setSelectionRects([]);
      setIsSelecting(false);
    };
  }, [isTextSelectionMode, highlights]);

  // Copy selected text handler - Cmd+C / Ctrl+C
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Only handle Cmd+C / Ctrl+C
      if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return;

      // Get selected text (or use saved selection)
      const selection = window.getSelection();
      let selectedText = selection?.toString().trim();

      // If no current selection, try saved selection
      if (!selectedText && savedSelectionRef.current) {
        selectedText = savedSelectionRef.current;
      }
      if (!selectedText) return;

      // Check if we're in the PDF container
      const container = containerRef.current;
      const anchorNode = selection?.anchorNode;
      const inContainer = container && (
        (anchorNode && container.contains(anchorNode)) ||
        savedSelectionRef.current
      );
      if (!inContainer) return;

      // Prevent default and use Tauri clipboard
      e.preventDefault();
      e.stopPropagation();
      try {
        await writeText(selectedText);
        savedSelectionRef.current = ""; // Clear saved selection after copy
        toast.success("Copied to clipboard");
      } catch (err) {
        console.error("Failed to copy text:", err);
        toast.error(`Failed to copy: ${err}`);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Failed to toggle fullscreen:", err);
    }
  }, []);

  const handleModeChange = useCallback((nextMode: ViewerMode) => {
    setMode(nextMode);
    // Clear any active text selection when switching modes
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
    if (nextMode !== "edit") {
      setToolMode(null);
    }
  }, []);

  const handleToolModeChange = useCallback((nextTool: ToolMode) => {
    if (nextTool) {
      setMode("edit");
    }
    setToolMode(nextTool);
  }, []);


  // Reset utils initialization flag when URL changes
  useEffect(() => {
    hasInitializedUtilsRef.current = false;
    setViewerReady(false);
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

  // Set up search result event listeners when viewer is ready
  useEffect(() => {
    if (!viewerReady || !pdfHighlighterUtilsRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current.getEventBus() as any;
    if (!eventBus) return;

    // Listen for find results
    const handleUpdateFindMatchesCount = (evt: { matchesCount: { current: number; total: number } }) => {
      setSearchMatchCount(evt.matchesCount.total);
      setSearchCurrentMatch(evt.matchesCount.current);
    };

    const handleUpdateFindControlState = (evt: { matchesCount?: { current: number; total: number } }) => {
      if (evt.matchesCount) {
        setSearchMatchCount(evt.matchesCount.total);
        setSearchCurrentMatch(evt.matchesCount.current);
      }
    };

    eventBus.on("updatefindmatchescount", handleUpdateFindMatchesCount);
    eventBus.on("updatefindcontrolstate", handleUpdateFindControlState);

    return () => {
      eventBus.off("updatefindmatchescount", handleUpdateFindMatchesCount);
      eventBus.off("updatefindcontrolstate", handleUpdateFindControlState);
    };
  }, [viewerReady]);

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
        const annotations = await getAnnotations(parseInt(attachmentId, 10));
        const appHighlights = annotations.map(convertAnnotationToHighlight);
        setHighlights(appHighlights);
      } catch {
        // Failed to load annotations
      }
    }
    loadAnnotations();
  }, [attachmentId]);

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

    // Handle drawing content specially - stored as JSON in comment
    if (highlightType === "drawing" && annotation.comment) {
      try {
        const drawingContent = JSON.parse(annotation.comment);
        return {
          id: String(annotation.id),
          type: "drawing" as AppHighlight["type"],
          position,
          content: { image: drawingContent.image, strokes: drawingContent.strokes },
          highlightColor: annotation.color,
        };
      } catch {
        // Fall through to default handling
      }
    }

    // Handle shape content specially - stored as JSON in comment
    if (highlightType === "shape" && annotation.comment) {
      try {
        const shapeData = JSON.parse(annotation.comment);
        return {
          id: String(annotation.id),
          type: "shape" as AppHighlight["type"],
          position,
          content: { shape: shapeData },
          shapeType: shapeData.shapeType,
          strokeColor: shapeData.strokeColor,
          strokeWidth: shapeData.strokeWidth,
          highlightColor: annotation.color,
        };
      } catch {
        // Fall through to default handling
      }
    }

    // Use selectedText or comment for content
    const textContent = annotation.selectedText || annotation.comment || "";
    const fallbackColor =
      highlightType === "area" ? DEFAULT_AREA_HIGHLIGHT_COLOR : DEFAULT_TEXT_HIGHLIGHT_COLOR;

    // Parse freetext style from JSON color field
    if (highlightType === "freetext" && annotation.color?.startsWith("{")) {
      try {
        const style = JSON.parse(annotation.color);
        return {
          id: String(annotation.id),
          type: "freetext" as AppHighlight["type"],
          position,
          content: { text: textContent },
          backgroundColor: style.bg || "#FFFFA5",
          color: style.fg || "#000000",
          fontSize: style.fs || "14px",
          fontFamily: style.ff,
        };
      } catch {
        // Fall through to default
      }
    }

    return {
      id: String(annotation.id),
      type: highlightType as AppHighlight["type"],
      position,
      content: { text: textContent },
      highlightColor: annotation.color || fallbackColor,
      selectedText: textContent,
    };
  }

  const getNextId = () => `temp-${Date.now()}`;

  // Create text or area highlight based on selection type
  const handleSelection = useCallback(
    (selection: GhostHighlight & { makeGhostHighlight: () => GhostHighlight }) => {
      const { position, content, type } = selection;
      const tempId = getNextId();

      // Determine if this is an area or text highlight
      const isArea = type === "area" || toolMode === "area";
      const highlightType = isArea ? "area" : "text";
      const nextColor = isArea ? areaHighlightColor : highlightColor;

      const optimisticHighlight: AppHighlight = {
        id: tempId,
        type: highlightType,
        position,
        content,
        highlightColor: nextColor,
        selectedText: content?.text,
      };

      setHighlights((prev) => [...prev, optimisticHighlight]);

      (async () => {
        try {
          const annotation = await createAnnotation({
            attachmentId: parseInt(attachmentId, 10),
            annotationType: highlightType,
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: content?.text,
            color: nextColor,
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
    [attachmentId, areaHighlightColor, highlightColor, toolMode]
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
            attachmentId: parseInt(attachmentId, 10),
            annotationType: "freetext",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: "",
            color: JSON.stringify({ bg: "#FFFFA5", fg: "#000000", fs: "14px" }),
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
    [attachmentId]
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
      // Don't deactivate tool - keep drawing mode active for multiple strokes

      (async () => {
        try {
          const annotation = await createAnnotation({
            attachmentId: parseInt(attachmentId, 10),
            annotationType: "drawing",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: undefined,
            color: drawingColor,
            // Store drawing data (image + strokes) in comment as JSON
            comment: JSON.stringify({ image: dataUrl, strokes }),
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
    [attachmentId, drawingColor]
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
      // Keep rectangle mode active until user exits (Esc or tool toggle)

      (async () => {
        try {
          const annotation = await createAnnotation({
            attachmentId: parseInt(attachmentId, 10),
            annotationType: "shape",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: undefined,
            color: shape.strokeColor,
            // Store shape data in comment as JSON
            comment: JSON.stringify(shape),
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
    [attachmentId]
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
        const updates: { positionJson?: string; comment?: string; color?: string } = {};
        if (edit.position) {
          updates.positionJson = JSON.stringify(edit.position);
        }
        if (edit.content?.text !== undefined) {
          updates.comment = edit.content.text;
        }
        // Persist drawing content (image + strokes) as JSON in comment field
        if (edit.content?.image !== undefined || edit.content?.strokes !== undefined) {
          const current = highlights.find((h) => h.id === highlightId);
          if (current?.type === "drawing") {
            updates.comment = JSON.stringify({
              image: edit.content?.image ?? current.content?.image,
              strokes: edit.content?.strokes ?? current.content?.strokes,
            });
          }
        }
        // Persist shape style changes as JSON in comment field
        if (edit.strokeColor !== undefined || edit.strokeWidth !== undefined) {
          const current = highlights.find((h) => h.id === highlightId);
          if (current?.type === "shape" && current.content?.shape) {
            const updatedShape = {
              ...current.content.shape,
              strokeColor: edit.strokeColor ?? current.strokeColor,
              strokeWidth: edit.strokeWidth ?? current.strokeWidth,
            };
            updates.comment = JSON.stringify(updatedShape);
            updates.color = updatedShape.strokeColor;
          }
        }
        // Persist freetext style changes as JSON in the color field
        if (edit.color !== undefined || edit.backgroundColor !== undefined || edit.fontSize !== undefined || edit.fontFamily !== undefined) {
          const current = highlights.find((h) => h.id === highlightId);
          if (current?.type === "freetext") {
            updates.color = JSON.stringify({
              bg: edit.backgroundColor ?? current.backgroundColor ?? "#FFFFA5",
              fg: edit.color ?? current.color ?? "#000000",
              fs: edit.fontSize ?? current.fontSize ?? "14px",
              ff: edit.fontFamily ?? current.fontFamily,
            });
          }
        }
        if (Object.keys(updates).length > 0) {
          await updateAnnotation(parseInt(highlightId, 10), updates);
        }
      } catch {
        // Failed to update
      }
    },
    [highlights]
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

  // Store current search state for next/prev navigation
  const searchStateRef = useRef<{ query: string; options: SearchOptions }>({
    query: "",
    options: { highlightAll: true, matchCase: false, wholeWords: false },
  });

  // PDF-specific keyboard shortcuts (Cmd++/-/0 for zoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Don't handle if typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Zoom in: Cmd++ or Cmd+=
      if (isMeta && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomIn();
        return;
      }

      // Zoom out: Cmd+-
      if (isMeta && e.key === "-") {
        e.preventDefault();
        zoomOut();
        return;
      }

      // Reset zoom: Cmd+0
      if (isMeta && e.key === "0") {
        e.preventDefault();
        fitWidth();
        return;
      }

      // Print: Cmd+P — open print window and trigger OS print dialog
      if (isMeta && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        try {
          const baseUrl = window.location.origin;
          const url = `${baseUrl}?print=1&file=${encodeURIComponent(filePath)}`;
          const label = `print-${Date.now()}`;
          const printWindow = new WebviewWindow(label, {
            url,
            title: "Print",
            width: 900,
            height: 700,
            resizable: true,
            visible: true,
          });

          printWindow.once("tauri://error", (event) => {
            console.error("Failed to open print window:", event);
            toast.error("Failed to open print dialog");
          });
        } catch (err: unknown) {
          console.error("Failed to open print window:", err);
          toast.error(`Failed to open print dialog: ${err}`);
        }
        return;
      }
    };

    // Use capture phase to intercept before webview's default CMD+P handler
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [zoomIn, zoomOut, fitWidth, filePath]);

  // Hand tool - grab to pan
  useEffect(() => {
    if (mode !== "pan") return;

    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    const container = (viewer?.container ||
      containerRef.current?.querySelector(".PdfHighlighter")) as HTMLElement | null;
    if (!container) return;

    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;

    container.style.cursor = "grab";
    container.classList.add("PdfHighlighter--hand-tool");

    const handlePointerDown = (e: PointerEvent) => {
      // Only pan on left click, and not on interactive elements
      if (e.button !== 0 || !e.isPrimary) return;
      const target = e.target as HTMLElement;
      if (target.closest(".AreaHighlight, .FreetextHighlight, .DrawingHighlight, .ShapeHighlight")) return;

      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      scrollLeft = container.scrollLeft;
      scrollTop = container.scrollTop;
      container.style.cursor = "grabbing";
      container.style.userSelect = "none";
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is not available
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      container.scrollLeft = scrollLeft - dx;
      container.scrollTop = scrollTop - dy;
      e.preventDefault();
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!isPanning) return;
      isPanning = false;
      container.style.cursor = "grab";
      container.style.userSelect = "";
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is not available
      }
    };

    container.addEventListener("pointerdown", handlePointerDown, true);
    container.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);

    return () => {
      container.style.cursor = "";
      container.style.userSelect = "";
      container.classList.remove("PdfHighlighter--hand-tool");
      container.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, [mode, viewerReady]);

  // CMD/Ctrl + scroll wheel zoom
  useEffect(() => {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    const container = (viewer?.container ||
      containerRef.current?.querySelector(".PdfHighlighter")) as HTMLElement | null;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.deltaY < 0) {
        zoomIn();
      } else if (e.deltaY > 0) {
        zoomOut();
      }
    };

    const options: AddEventListenerOptions = { passive: false, capture: true };
    container.addEventListener("wheel", handleWheel, options);
    return () => container.removeEventListener("wheel", handleWheel, options);
  }, [zoomIn, zoomOut, viewerReady]);

  // Search functions using PDF.js findController (provided by local pdfjs viewer)
  const handleSearch = useCallback((query: string, options: SearchOptions) => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) {
      console.warn("FindController not initialized yet");
      return;
    }

    // Store search state for next/prev navigation
    searchStateRef.current = { query, options };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    // Dispatch find event with options
    eventBus.dispatch("find", {
      source: window,
      type: "find",
      query,
      phraseSearch: true,
      caseSensitive: options.matchCase,
      entireWord: options.wholeWords,
      highlightAll: options.highlightAll,
      findPrevious: false,
    });
  }, []);

  const handleSearchNext = useCallback(() => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    const { query, options } = searchStateRef.current;
    eventBus.dispatch("find", {
      source: window,
      type: "again",
      query,
      phraseSearch: true,
      caseSensitive: options.matchCase,
      entireWord: options.wholeWords,
      highlightAll: options.highlightAll,
      findPrevious: false,
    });
  }, []);

  const handleSearchPrev = useCallback(() => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    const { query, options } = searchStateRef.current;
    eventBus.dispatch("find", {
      source: window,
      type: "again",
      query,
      phraseSearch: true,
      caseSensitive: options.matchCase,
      entireWord: options.wholeWords,
      highlightAll: options.highlightAll,
      findPrevious: true,
    });
  }, []);

  const handleSearchClear = useCallback(() => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) {
      setSearchMatchCount(0);
      setSearchCurrentMatch(0);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    // Reset search state
    searchStateRef.current = {
      query: "",
      options: { highlightAll: true, matchCase: false, wholeWords: false },
    };

    // Clear search by dispatching empty query
    eventBus.dispatch("find", {
      source: window,
      type: "find",
      query: "",
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: false,
      findPrevious: false,
    });

    setSearchMatchCount(0);
    setSearchCurrentMatch(0);
  }, []);

  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-viewer-mode={mode}
      data-tool-mode={toolMode ?? "none"}
      data-selecting={isSelecting ? "true" : "false"}
      className="pdf-viewer-container flex h-full flex-col bg-muted/30"
    >
      <PDFToolbar
        scale={displayScale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitWidth={fitWidth}
        onFitPage={fitPage}
        onScaleChange={handleScaleChange}
        highlightColor={highlightColor}
        onColorChange={setHighlightColor}
        areaHighlightColor={areaHighlightColor}
        onAreaColorChange={setAreaHighlightColor}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={goToPage}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        toolMode={toolMode}
        onToolModeChange={handleToolModeChange}
        mode={mode}
        onModeChange={handleModeChange}
        drawingColor={drawingColor}
        onDrawingColorChange={setDrawingColor}
        shapeColor={shapeColor}
        onShapeColorChange={setShapeColor}
        leftPanelOpen={pdfLeftPanelOpen}
        onToggleLeftPanel={togglePdfLeftPanel}
        infoPaneOpen={infoPaneOpen}
        onToggleInfoPane={toggleInfoPane}
        isStackedLayout={libraryLayout === "stacked"}
        onSearch={handleSearch}
        onSearchNext={handleSearchNext}
        onSearchPrev={handleSearchPrev}
        onSearchClear={handleSearchClear}
        searchMatchCount={searchMatchCount}
        searchCurrentMatch={searchCurrentMatch}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      <div className="relative flex-1 overflow-hidden flex h-full">
        <PdfLoader document={pdfUrl}>
          {(pdfDocument) => {
            if (pdfDocument.numPages !== totalPages) {
              queueMicrotask(() => setTotalPages(pdfDocument.numPages));
            }

            return (
              <div className="flex h-full w-full">
                {/* Left Panel - Thumbnails, Outline & Annotations */}
                {pdfLeftPanelOpen && (
                  <div className="relative flex flex-col h-full w-[220px] border-r bg-background overflow-visible">
                    {/* Tab bar */}
                    <div className="flex border-b px-1 py-1 gap-1">
                      <button
                        onClick={() => setLeftPanelTab("thumbnails")}
                        className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                          leftPanelTab === "thumbnails"
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        Pages
                      </button>
                      <button
                        onClick={() => setLeftPanelTab("outline")}
                        className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                          leftPanelTab === "outline"
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        Outline
                      </button>
                      <button
                        onClick={() => setLeftPanelTab("annotations")}
                        className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                          leftPanelTab === "annotations"
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        Notes
                      </button>
                    </div>

                    {/* Panel content */}
                    <div className="flex-1 overflow-hidden">
                      {leftPanelTab === "annotations" ? (
                        <AnnotationPanel
                          annotations={highlights}
                          onAnnotationClick={(_id, page) => {
                            goToPage(page);
                            // Could also scroll to the specific highlight
                          }}
                          onDelete={handleDelete}
                        />
                      ) : leftPanelTab === "outline" ? (
                        <OutlinePanel
                          pdfDocument={pdfDocument}
                          goToPage={goToPage}
                          currentPage={currentPage}
                        />
                      ) : (
                        <LeftPanel
                          pdfDocument={pdfDocument}
                          viewer={pdfHighlighterUtilsRef.current?.getViewer()}
                          linkService={pdfHighlighterUtilsRef.current?.getLinkService()}
                          eventBus={pdfHighlighterUtilsRef.current?.getEventBus()}
                          goToPage={pdfHighlighterUtilsRef.current?.goToPage}
                          isOpen={true}
                          onOpenChange={(open) => { if (!open) togglePdfLeftPanel(); }}
                          width={220}
                          defaultTab={leftPanelTab}
                        />
                      )}
                    </div>

                    {/* Toggle button for annotations/outline tabs - matches LeftPanel style */}
                    {(leftPanelTab === "annotations" || leftPanelTab === "outline") && (
                      <button
                        onClick={togglePdfLeftPanel}
                        style={{
                          position: "absolute",
                          top: "50%",
                          transform: "translateY(-50%)",
                          left: 219,
                          zIndex: 20,
                          width: 24,
                          height: 48,
                          backgroundColor: "#ffffff",
                          border: "1px solid #e5e7eb",
                          borderLeft: "none",
                          borderRadius: "0 6px 6px 0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          boxShadow: "2px 0 8px rgba(0,0,0,0.08)",
                        }}
                        aria-label="Close panel"
                      >
                        <ChevronLeft style={{ width: 14, height: 14, color: "#6b7280" }} />
                      </button>
                    )}
                  </div>
                )}

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
                        queueMicrotask(() => setViewerReady(true));
                      }
                    }}
                    // Text and Area highlight modes
                    textSelectionColor={
                      mode === "edit" && toolMode === "highlight"
                        ? highlightColor
                        : isSelectMode
                          ? "rgba(59, 130, 246, 0.8)"
                          : undefined
                    }
                    onSelection={mode === "edit" && (toolMode === "highlight" || toolMode === "area") ? handleSelection : undefined}
                    // Area highlight mode
                    enableAreaSelection={() => mode === "edit" && toolMode === "area"}
                    areaSelectionMode={mode === "edit" && toolMode === "area"}
                    // Freetext mode
                    enableFreetextCreation={() => mode === "edit" && toolMode === "freetext"}
                    onFreetextClick={handleFreetextClick}
                    // Drawing mode
                    enableDrawingMode={mode === "edit" && toolMode === "drawing"}
                    onDrawingComplete={handleDrawingComplete}
                    onDrawingCancel={() => setToolMode(null)}
                    drawingStrokeColor={drawingColor}
                    drawingStrokeWidth={3}
                    // Shape mode (rectangle)
                    enableShapeMode={mode === "edit" && toolMode === "rectangle" ? "rectangle" : null}
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
                      isEditable={mode === "edit"}
                      showTipEnabled={mode === "edit"}
                      selectionRects={selectionRects}
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
