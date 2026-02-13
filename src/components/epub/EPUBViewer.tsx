import { useState, useEffect, useRef, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { FileText } from "lucide-react";
import { toast } from "@/stores/toastStore";
import { useUIStore } from "@/stores/uiStore";
import { useEPUBSearch } from "./useEPUBSearch";
import { EPUBOutlinePanel } from "./EPUBOutlinePanel";
import { PDFToolbar, type SearchOptions } from "@/components/pdf/PDFToolbar";
import "./EPUBViewer.css";

interface EPUBViewerProps {
  filePath: string;
  attachmentId: string;
  title?: string;
  infoPaneOpen?: boolean;
  onToggleInfoPane?: () => void;
}

// No-ops for annotation toolbar props (annotations not supported in EPUB viewer)
const NOOP = () => {};
const NOOP_STR = (_s: string) => {};

/** Read current CSS custom property values and register them as epub.js themes */
function registerEpubThemes(rendition: Rendition) {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const fg = style.getPropertyValue("--foreground").trim();
  const bg = style.getPropertyValue("--background").trim();

  const baseStyles = {
    "max-width": "800px",
    margin: "0 auto",
    padding: "20px 40px",
    "line-height": "1.6",
  };

  // Current mode uses live CSS vars
  const isDark = root.classList.contains("dark");
  const currentColor = fg ? `hsl(${fg})` : (isDark ? "#ededed" : "#1c1f2e");
  const currentBg = bg ? `hsl(${bg})` : (isDark ? "#404040" : "#f8f9fb");

  // For the "other" mode, use the token values from index.css
  // Light: --foreground: 224 40% 12%, --background: 220 14% 98%
  // Dark:  --foreground: 0 0% 93%, --background: 0 0% 25%
  const lightColor = isDark ? "hsl(224 40% 12%)" : currentColor;
  const lightBg = isDark ? "hsl(220 14% 98%)" : currentBg;
  const darkColor = isDark ? currentColor : "hsl(0 0% 93%)";
  const darkBg = isDark ? currentBg : "hsl(0 0% 25%)";

  rendition.themes.register("light", { body: { color: lightColor, background: lightBg, ...baseStyles } });
  rendition.themes.register("dark", { body: { color: darkColor, background: darkBg, ...baseStyles } });
}

export function EPUBViewer({ filePath, infoPaneOpen: infoPaneOpenProp, onToggleInfoPane }: EPUBViewerProps) {
  // Core epub state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Navigation state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentHref, setCurrentHref] = useState<string>("");

  // Zoom / scale (font size based, 1.0 = 100%)
  const [scale, setScale] = useState(1.0);

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Dark mode
  const [darkMode, setDarkMode] = useState(false);

  // Refs
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<string>("");

  // Store (infoPaneOpen from parent props, left panel is per-instance)
  const {
    infoPaneOpen: globalInfoPaneOpen,
    libraryLayout,
  } = useUIStore();

  const infoPaneOpen = infoPaneOpenProp ?? globalInfoPaneOpen;
  const toggleInfoPane = onToggleInfoPane ?? (() => {});

  // Per-instance left panel state
  const [epubLeftPanelOpen, setEpubLeftPanelOpen] = useState(false);
  const toggleEpubLeftPanel = useCallback(() => setEpubLeftPanelOpen(prev => !prev), []);

  // Search hook
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
            const hasContentEncryption =
              encContent.includes("http://ns.adobe.com/adept") ||
              encContent.includes("http://www.w3.org/2001/04/xmlenc") ||
              archive?.zip?.file("META-INF/sinf.xml");
            if (hasContentEncryption) {
              throw new Error("This EPUB file is DRM-protected and cannot be opened. Only DRM-free EPUB files are supported.");
            }
          }
        } catch (drmErr) {
          if (drmErr instanceof Error && drmErr.message.includes("DRM")) {
            throw drmErr;
          }
        }

        // Generate locations for page-like navigation
        await book.locations.generate(1024);
        if (destroyed) return;

        setTotalPages(book.locations.length());

        if (!viewerRef.current) return;

        const rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          spread: "none",
          flow: "scrolled-doc",
        });

        renditionRef.current = rendition;

        // Register initial themes (will be re-registered on dark mode change)
        registerEpubThemes(rendition);

        rendition.themes.fontSize(`${Math.round(scale * 100)}%`);

        await rendition.display();
        if (destroyed) return;

        setLoading(false);

        // Track location changes
        rendition.on("relocated", (location: { start: { location: number; href: string }; end: { location: number } }) => {
          if (location.start) {
            setCurrentPage(location.start.location + 1);
            setCurrentHref(location.start.href);
          }
        });

        // Handle text selection for copy
        rendition.on("selected", (cfiRange: string) => {
          savedSelectionRef.current = "";
          try {
            const range = rendition.getRange(cfiRange);
            if (range) {
              savedSelectionRef.current = range.toString();
            }
          } catch (err) { console.warn("Failed to get range from selection:", err); }
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

  // Apply dark mode - re-register themes with current CSS variable values
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    registerEpubThemes(rendition);
    rendition.themes.select(darkMode ? "dark" : "light");
  }, [darkMode]);

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

      const rendition = renditionRef.current;
      if (!rendition) return;

      let selectedText = savedSelectionRef.current;

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

  // Keyboard shortcuts for zoom and page navigation
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

  // Listen for Command Palette events
  useEffect(() => {
    const events: [string, () => void][] = [
      ["wren:epub-zoom-in", zoomIn],
      ["wren:epub-zoom-out", zoomOut],
      ["wren:epub-next", nextPage],
      ["wren:epub-prev", prevPage],
    ];
    for (const [name, handler] of events) window.addEventListener(name, handler);
    return () => { for (const [name, handler] of events) window.removeEventListener(name, handler); };
  }, [zoomIn, zoomOut, nextPage, prevPage]);

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
      className="epub-viewer-container flex h-full flex-col bg-background"
    >
      {/* Toolbar */}
      <PDFToolbar
        scale={scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitWidth={fitWidth}
        onFitPage={fitPage}
        onScaleChange={handleScaleChange}
        highlightColor="#FFE28F"
        onColorChange={NOOP_STR}
        areaHighlightColor="#FFE28F"
        onAreaColorChange={NOOP_STR}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={goToPage}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        toolMode={null}
        onToolModeChange={NOOP}
        mode="pan"
        onModeChange={NOOP}
        drawingColor="#000000"
        onDrawingColorChange={NOOP_STR}
        shapeColor="#000000"
        onShapeColorChange={NOOP_STR}
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
        hideEditMode
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Chapters only */}
        {epubLeftPanelOpen && (
          <div className="w-[220px] border-r flex flex-col flex-shrink-0">
            <div className="flex border-b">
              <div className="flex-1 text-xs py-1.5 font-medium text-foreground border-b-2 border-primary text-center">
                Chapters
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <EPUBOutlinePanel
                book={bookRef.current}
                onNavigate={navigateToHref}
                currentHref={currentHref}
              />
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
        </div>
      </div>
    </div>
  );
}

export default EPUBViewer;
