import { useState, useEffect, useRef, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { FileText } from "lucide-react";
import { toast } from "@/stores/toastStore";
import { useUIStore } from "@/stores/uiStore";
import { useEPUBAnnotations } from "./useEPUBAnnotations";
import { useEPUBSearch } from "./useEPUBSearch";
import { EPUBOutlinePanel } from "./EPUBOutlinePanel";
import { PDFToolbar, type SearchOptions } from "@/components/pdf/PDFToolbar";
import { AnnotationPanel } from "@/components/pdf/AnnotationPanel";
import { HighlightPopup } from "@/components/pdf/HighlightPopup";
import { HTML_HIGHLIGHT_COLORS, HTML_STROKE_COLORS } from "@/components/viewer/annotationColors";
import { cn } from "@/lib/utils";
import "./EPUBViewer.css";

interface EPUBViewerProps {
  filePath: string;
  attachmentId: string;
  title?: string;
}

type ToolMode = "highlight" | "area" | "freetext" | "drawing" | "rectangle" | null;
type ViewerMode = "pan" | "edit";

const DEFAULT_HIGHLIGHT_COLOR = "#FFE28F";
const DEFAULT_AREA_COLOR = "#FFE28F";

export function EPUBViewer({ filePath, attachmentId, title }: EPUBViewerProps) {
  // Core epub state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Navigation state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentHref, setCurrentHref] = useState<string>("");

  // Zoom / scale (font size based, 1.0 = 100%)
  const [scale, setScale] = useState(1.0);

  // Tool mode
  const [toolMode, setToolMode] = useState<ToolMode>(null);
  const [mode, setMode] = useState<ViewerMode>("pan");
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT_COLOR);
  const [areaHighlightColor, setAreaHighlightColor] = useState(DEFAULT_AREA_COLOR);
  const [drawingColor, setDrawingColor] = useState("#000000");
  const [shapeColor, setShapeColor] = useState("#000000");

  // Left panel
  const [leftPanelTab, setLeftPanelTab] = useState<"chapters" | "annotations">("chapters");

  // Popup state for highlight color/delete
  const [popupState, setPopupState] = useState<{
    highlightId: string;
    color: string;
    type: string;
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
  const [noteDraft, setNoteDraft] = useState("");
  const [noteInputOpen, setNoteInputOpen] = useState(false);
  const [noteInputPos, setNoteInputPos] = useState<{ x: number; y: number } | null>(null);
  const [noteDocPos, setNoteDocPos] = useState<{ x: number; y: number } | null>(null);

  // Dark mode
  const [darkMode, setDarkMode] = useState(false);

  // Refs
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const popupHoverRef = useRef(false);
  const popupCloseTimerRef = useRef<number | null>(null);
  const savedSelectionRef = useRef<string>("");

  // Store
  const {
    epubLeftPanelOpen,
    toggleEpubLeftPanel,
    infoPaneOpen,
    toggleInfoPane,
    libraryLayout,
  } = useUIStore();

  // Hooks
  const annotations = useEPUBAnnotations(renditionRef, bookRef, attachmentId);
  const epubSearch = useEPUBSearch(renditionRef, bookRef);

  // Track dark mode from document
  useEffect(() => {
    const checkDarkMode = () => {
      setDarkMode(document.documentElement.classList.contains("dark"));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Load EPUB file
  useEffect(() => {
    if (!filePath) return;

    let destroyed = false;

    async function loadEpub() {
      setLoading(true);
      setError(null);

      try {
        // Fetch EPUB binary via Tauri asset protocol, then pass ArrayBuffer to epub.js
        // epub.js needs clean binary data to decompress the ZIP archive
        const assetUrl = convertFileSrc(filePath);
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch EPUB: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();

        const book = ePub(arrayBuffer);
        bookRef.current = book;

        await book.ready;
        if (destroyed) return;

        // Check for DRM encryption
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const archive = (book as any).archive;
          const encFile = archive?.zip?.file("META-INF/encryption.xml");
          if (encFile) {
            const encContent = await encFile.async("string");
            // Check if it's actual content encryption (not just font obfuscation)
            const hasContentEncryption =
              encContent.includes("http://ns.adobe.com/adept") ||
              encContent.includes("http://www.w3.org/2001/04/xmlenc") ||
              archive?.zip?.file("META-INF/sinf.xml"); // Apple FairPlay
            if (hasContentEncryption) {
              throw new Error("This EPUB file is DRM-protected and cannot be opened. Only DRM-free EPUB files are supported.");
            }
          }
        } catch (drmErr) {
          if (drmErr instanceof Error && drmErr.message.includes("DRM")) {
            throw drmErr;
          }
          // Ignore other diagnostic errors
        }

        // Generate locations for page-like navigation
        await book.locations.generate(1024);
        if (destroyed) return;

        const locationCount = book.locations.length();
        setTotalPages(locationCount);

        // Render into the container
        if (!viewerRef.current) return;

        const rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          spread: "none",
          flow: "scrolled-doc",
        });

        renditionRef.current = rendition;

        // Apply dark mode theme with readable styling
        rendition.themes.register("light", {
          body: {
            color: "#000000",
            background: "#ffffff",
            "max-width": "800px",
            margin: "0 auto",
            padding: "20px 40px",
            "line-height": "1.6",
          },
        });
        rendition.themes.register("dark", {
          body: {
            color: "#e2e8f0",
            background: "#1e293b",
            "max-width": "800px",
            margin: "0 auto",
            padding: "20px 40px",
            "line-height": "1.6",
          },
        });

        // Apply initial font size
        rendition.themes.fontSize(`${Math.round(scale * 100)}%`);

        // Display the first page
        await rendition.display();
        if (destroyed) return;

        setLoading(false);

        // Track location changes
        rendition.on("relocated", (location: { start: { location: number; href: string }; end: { location: number } }) => {
          if (location.start) {
            setCurrentPage(location.start.location + 1);
            setCurrentHref(location.start.href);

            // Re-render annotations for current section
            annotations.renderHighlightsForSection(location.start.href);
          }
        });

        // Handle text selection for highlighting
        rendition.on("selected", (cfiRange: string) => {
          savedSelectionRef.current = "";
          try {
            const range = rendition.getRange(cfiRange);
            if (range) {
              savedSelectionRef.current = range.toString();
            }
          } catch { /* ignore */ }
        });

      } catch (err) {
        if (!destroyed) {
          console.error("Failed to load EPUB:", err);
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Failed to load EPUB file: ${msg}`);
          setLoading(false);
        }
      }
    }

    loadEpub();

    return () => {
      destroyed = true;
      if (bookRef.current) {
        try {
          bookRef.current.destroy();
        } catch { /* ignore */ }
        bookRef.current = null;
        renditionRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Apply dark mode
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.select(darkMode ? "dark" : "light");
  }, [darkMode]);

  // Render annotations when ready
  useEffect(() => {
    if (!currentHref || annotations.loading) return;
    const timeoutId = setTimeout(() => {
      annotations.renderHighlightsForSection(currentHref);
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [currentHref, annotations.loading, annotations.renderHighlightsForSection]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setScale((prev) => {
      const next = Math.min(3.0, prev + 0.1);
      renditionRef.current?.themes.fontSize(`${Math.round(next * 100)}%`);
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => {
      const next = Math.max(0.5, prev - 0.1);
      renditionRef.current?.themes.fontSize(`${Math.round(next * 100)}%`);
      return next;
    });
  }, []);

  const handleScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
    renditionRef.current?.themes.fontSize(`${Math.round(newScale * 100)}%`);
  }, []);

  const fitWidth = useCallback(() => {
    handleScaleChange(1.0);
  }, [handleScaleChange]);

  const fitPage = useCallback(() => {
    handleScaleChange(1.0);
  }, [handleScaleChange]);

  // Page navigation
  const goToPage = useCallback((page: number) => {
    const rendition = renditionRef.current;
    const book = bookRef.current;
    if (!rendition || !book) return;

    const cfi = book.locations.cfiFromLocation(page - 1);
    if (cfi) {
      rendition.display(cfi);
    }
    setCurrentPage(page);
  }, []);

  const nextPage = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const prevPage = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  // Navigate to chapter by href
  const navigateToHref = useCallback((href: string) => {
    renditionRef.current?.display(href);
  }, []);

  // Mode changes
  const handleModeChange = useCallback((nextMode: ViewerMode) => {
    setMode(nextMode);
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

  // Fullscreen
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

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Search
  const handleSearch = useCallback((query: string, options: SearchOptions) => {
    epubSearch.search(query, options);
  }, [epubSearch]);

  const handleSearchClear = useCallback(() => {
    epubSearch.clearSearch();
  }, [epubSearch]);

  // Copy selected text - Cmd+C / Ctrl+C
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return;

      // Get text from epub.js iframe
      const rendition = renditionRef.current;
      if (!rendition) return;

      let selectedText = savedSelectionRef.current;

      // Also try getting from iframe selection
      if (!selectedText) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
        for (const content of contents) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const doc = (content as any).document as Document | undefined;
          if (doc) {
            const sel = doc.getSelection();
            const text = sel?.toString().trim();
            if (text) {
              selectedText = text;
              break;
            }
          }
        }
      }

      if (!selectedText) return;

      // Check if we're in the EPUB container
      const container = containerRef.current;
      if (!container) return;

      e.preventDefault();
      e.stopPropagation();
      try {
        await writeText(selectedText);
        savedSelectionRef.current = "";
        toast.success("Copied to clipboard");
      } catch (err) {
        console.error("Failed to copy text:", err);
        toast.error(`Failed to copy: ${err}`);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Keyboard shortcuts for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

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

      // Left/Right arrow keys for page navigation
      if (e.key === "ArrowLeft" && !isMeta) {
        e.preventDefault();
        prevPage();
        return;
      }
      if (e.key === "ArrowRight" && !isMeta) {
        e.preventDefault();
        nextPage();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomIn, zoomOut, handleScaleChange, prevPage, nextPage]);

  // Scroll wheel zoom (Cmd+scroll)
  useEffect(() => {
    const container = contentRef.current;
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
  }, [zoomIn, zoomOut]);

  // Handle text selection for highlight tool
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    const handleSelected = (cfiRange: string) => {
      if (mode !== "edit") return;

      // Save for Cmd+C
      try {
        const range = rendition.getRange(cfiRange);
        if (range) {
          savedSelectionRef.current = range.toString();
        }
      } catch { /* ignore */ }

      if (toolMode === "highlight") {
        const selectedText = savedSelectionRef.current;
        if (selectedText) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const location = rendition.currentLocation() as any;
          const sectionHref = location?.start?.href || currentHref;
          const pageNumber = currentPage;
          annotations.addTextHighlight(cfiRange, selectedText, highlightColor, sectionHref, pageNumber);

          // Clear selection in iframe
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
          for (const content of contents) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc = (content as any).document as Document | undefined;
            if (doc) {
              doc.getSelection()?.removeAllRanges();
            }
          }
        }
      }
    };

    rendition.on("selected", handleSelected);
    return () => {
      rendition.off("selected", handleSelected);
    };
  }, [mode, toolMode, highlightColor, currentHref, currentPage, annotations]);

  // Handle highlight popup on hover in iframe
  const popupEnabled = mode === "edit" && toolMode === null;

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    const setupContentEvents = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
      for (const content of contents) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (content as any).document as Document | undefined;
        if (!doc) continue;

        const handleMouseOver = (e: Event) => {
          if (!popupEnabled) return;
          const target = e.target as HTMLElement;
          const highlightEl = target.closest("[data-epub-highlight-id]") as HTMLElement | null;

          if (highlightEl) {
            if (popupCloseTimerRef.current) {
              window.clearTimeout(popupCloseTimerRef.current);
              popupCloseTimerRef.current = null;
            }
            const highlightId = highlightEl.dataset.epubHighlightId!;
            const highlight = annotations.highlights.find((h) => h.id === highlightId);
            if (highlight) {
              const contentRect = contentRef.current?.getBoundingClientRect();
              const viewerRect = viewerRef.current?.getBoundingClientRect();
              const rect = highlightEl.getBoundingClientRect();
              if (!contentRect || !viewerRect) return;
              const x = rect.left + viewerRect.left - contentRect.left + rect.width / 2;
              const y = rect.top + viewerRect.top - contentRect.top - 8;
              setPopupState({
                highlightId,
                color: highlight.color,
                type: highlight.type,
                x,
                y,
              });
            }
          }
        };

        const handleMouseOut = (e: Event) => {
          if (popupHoverRef.current) return;
          const relTarget = (e as MouseEvent).relatedTarget as HTMLElement | null;
          if (relTarget?.closest("[data-epub-highlight-id]")) return;

          if (popupCloseTimerRef.current) {
            window.clearTimeout(popupCloseTimerRef.current);
          }
          popupCloseTimerRef.current = window.setTimeout(() => {
            if (!popupHoverRef.current) {
              setPopupState(null);
            }
          }, 150);
        };

        doc.addEventListener("mouseover", handleMouseOver);
        doc.addEventListener("mouseout", handleMouseOut);
      }
    };

    // Set up events when content is rendered
    rendition.on("rendered", setupContentEvents);
    // Also set up for current content
    setupContentEvents();

    return () => {
      rendition.off("rendered", setupContentEvents);
    };
  }, [popupEnabled, annotations.highlights]);

  // Overlay: freetext click handler
  const handleFreetextClick = useCallback(
    (e: React.MouseEvent) => {
      if (toolMode !== "freetext") return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const xViewport = e.clientX - rect.left;
      const yViewport = e.clientY - rect.top;

      // Approximate doc coordinates
      const docX = xViewport / scale;
      const docY = yViewport / scale;

      setNoteDocPos({ x: docX, y: docY });
      setNoteInputPos({ x: xViewport, y: yViewport });
      setNoteDraft("");
      setNoteInputOpen(true);
    },
    [toolMode, scale]
  );

  const handleNoteSave = useCallback(() => {
    const text = noteDraft.trim();
    if (!text || !noteDocPos) {
      setNoteInputOpen(false);
      return;
    }

    annotations.addFreetextNote(noteDocPos.x, noteDocPos.y, text, currentHref, currentPage);
    setNoteInputOpen(false);
  }, [noteDraft, noteDocPos, annotations, currentHref, currentPage]);

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

    if (toolMode === "drawing" && currentStroke && currentStroke.points.length >= 2) {
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
        { strokes: normalizedStrokes },
        currentHref,
        currentPage
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

      if (w > 10 && h > 10) {
        if (toolMode === "area") {
          annotations.addAreaHighlight(minX, minY, w, h, areaHighlightColor, currentHref, currentPage);
        } else {
          annotations.addShapeHighlight(minX, minY, w, h, shapeColor, {
            shapeType: "rectangle",
            strokeColor: shapeColor,
            strokeWidth: 2,
          }, currentHref, currentPage);
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
    areaHighlightColor,
    shapeColor,
    scale,
    annotations,
    currentHref,
    currentPage,
  ]);

  // Map EPUBHighlights to AnnotationPanel format
  const annotationPanelHighlights = annotations.highlights.map((h) => ({
    id: h.id,
    type: h.type,
    position: {
      boundingRect: {
        pageNumber: h.position.pageNumber,
      },
    },
    content: {
      text: h.selectedText || h.comment || "",
    },
    highlightColor: h.color,
    selectedText: h.selectedText || h.comment || "",
  }));

  // Scroll to annotation on click in panel
  const handleAnnotationClick = useCallback(
    (annotationId: string, pageNumber: number) => {
      const highlight = annotations.highlights.find((h) => h.id === annotationId);
      if (!highlight) return;

      // Navigate to the section
      if (highlight.position.type === "text") {
        const textPos = highlight.position;
        if (textPos.cfiRange) {
          renditionRef.current?.display(textPos.cfiRange);
        } else if (textPos.sectionHref) {
          renditionRef.current?.display(textPos.sectionHref);
        }
      } else {
        const spatialPos = highlight.position;
        if (spatialPos.sectionHref) {
          renditionRef.current?.display(spatialPos.sectionHref);
        } else {
          goToPage(pageNumber);
        }
      }
    },
    [annotations.highlights, goToPage]
  );

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-4">
          <FileText className="h-12 w-12 mx-auto opacity-50" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-viewer-mode={mode}
      data-tool-mode={toolMode ?? "none"}
      className="epub-viewer-container flex h-full flex-col bg-background"
    >
      {/* Toolbar - reuse PDFToolbar */}
      <PDFToolbar
        scale={scale}
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
        leftPanelOpen={epubLeftPanelOpen}
        onToggleLeftPanel={toggleEpubLeftPanel}
        infoPaneOpen={infoPaneOpen}
        onToggleInfoPane={toggleInfoPane}
        isStackedLayout={libraryLayout === "stacked"}
        onSearch={handleSearch}
        onSearchNext={epubSearch.searchNext}
        onSearchPrev={epubSearch.searchPrev}
        onSearchClear={handleSearchClear}
        searchMatchCount={epubSearch.matchCount}
        searchCurrentMatch={epubSearch.currentMatch}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        {epubLeftPanelOpen && (
          <div className="w-[220px] border-r flex flex-col flex-shrink-0">
            {/* Tab buttons */}
            <div className="flex border-b">
              <button
                onClick={() => setLeftPanelTab("chapters")}
                className={cn(
                  "flex-1 text-xs py-1.5 font-medium transition-colors",
                  leftPanelTab === "chapters"
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Chapters
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
              {leftPanelTab === "chapters" ? (
                <EPUBOutlinePanel
                  book={bookRef.current}
                  onNavigate={navigateToHref}
                  currentHref={currentHref}
                />
              ) : (
                <AnnotationPanel
                  annotations={annotationPanelHighlights}
                  onAnnotationClick={handleAnnotationClick}
                  onDelete={annotations.deleteHighlight}
                  pdfTitle={title}
                />
              )}
            </div>
          </div>
        )}

        {/* Content area */}
        <div ref={contentRef} className="flex-1 relative overflow-hidden epub-content-area">
          {/* Loading spinner */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          )}

          {/* epub.js render target */}
          <div
            ref={viewerRef}
            className="w-full h-full overflow-y-auto"
            style={{ opacity: loading ? 0 : 1 }}
          />

          {/* Overlay for area/rectangle/drawing tools */}
          {spatialToolActive && (
            <div
              ref={overlayRef}
              className="absolute inset-0 z-20"
              style={{ cursor: "crosshair" }}
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
                      borderColor: toolMode === "area" ? areaHighlightColor : shapeColor,
                      backgroundColor: toolMode === "area" ? `${areaHighlightColor}33` : "transparent",
                    }}
                  />
                )}

              {/* Drawing SVG for freehand */}
              {toolMode === "drawing" && (
                <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
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

          {/* Overlay for freetext notes */}
          {toolMode === "freetext" && (
            <div
              ref={overlayRef}
              className="absolute inset-0 z-20"
              style={{ cursor: "text" }}
              onClick={handleFreetextClick}
            />
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
              onMouseEnter={() => {
                popupHoverRef.current = true;
                if (popupCloseTimerRef.current) {
                  window.clearTimeout(popupCloseTimerRef.current);
                  popupCloseTimerRef.current = null;
                }
              }}
              onMouseLeave={() => {
                popupHoverRef.current = false;
                if (popupCloseTimerRef.current) {
                  window.clearTimeout(popupCloseTimerRef.current);
                }
                popupCloseTimerRef.current = window.setTimeout(() => {
                  if (!popupHoverRef.current) {
                    setPopupState(null);
                  }
                }, 150);
              }}
            >
              <HighlightPopup
                currentColor={popupState.color}
                colors={
                  popupState.type === "shape" || popupState.type === "drawing"
                    ? HTML_STROKE_COLORS
                    : HTML_HIGHLIGHT_COLORS
                }
                onColorChange={(color) => {
                  annotations.updateHighlightColor(popupState.highlightId, color);
                  setPopupState((prev) => (prev ? { ...prev, color } : null));
                }}
                onDelete={() => {
                  annotations.deleteHighlight(popupState.highlightId);
                  setPopupState(null);
                }}
              />
            </div>
          )}

          {/* Note input */}
          {noteInputOpen && noteInputPos && (
            <div
              className="absolute z-40 bg-background border rounded-md shadow-md p-2 w-56"
              style={{
                left: noteInputPos.x,
                top: noteInputPos.y,
                transform: "translate(8px, 8px)",
              }}
            >
              <div className="text-[10px] text-muted-foreground mb-1">Add note</div>
              <textarea
                className="w-full h-20 text-xs p-1 border rounded-sm resize-none focus:outline-none"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleNoteSave();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setNoteInputOpen(false);
                  }
                }}
                autoFocus
              />
              <div className="flex justify-end gap-1 mt-1">
                <button
                  className="text-[10px] px-2 py-0.5 rounded border"
                  onClick={() => setNoteInputOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="text-[10px] px-2 py-0.5 rounded border bg-primary text-primary-foreground"
                  onClick={handleNoteSave}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EPUBViewer;
