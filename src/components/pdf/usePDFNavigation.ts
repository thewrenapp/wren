import { useState, useCallback, useRef, useEffect, type MutableRefObject } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "@/stores/toastStore";
import type { PdfHighlighterUtils, PdfScaleValue } from "@/components/pdf/pdfjs";
import type { ToolMode } from "./usePDFAnnotations";
import { usePDFSearch } from "./usePDFSearch";
import { usePDFInteractions } from "./usePDFInteractions";

type ViewerMode = "pan" | "edit";

interface UsePDFNavigationOptions {
  filePath: string;
  initialPage?: number;
  pdfHighlighterUtilsRef: MutableRefObject<PdfHighlighterUtils | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  mode: ViewerMode;
  toolMode: ToolMode;
  setToolMode: (toolMode: ToolMode) => void;
  handleModeChange: (mode: ViewerMode) => void;
  onViewStateChange?: (state: { page: number; scale: number }) => void;
}

export function usePDFNavigation({
  filePath,
  initialPage,
  pdfHighlighterUtilsRef,
  containerRef,
  mode,
  handleModeChange,
}: UsePDFNavigationOptions) {
  const [scale, setScale] = useState<PdfScaleValue | undefined>(undefined);
  const [displayScale, setDisplayScale] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1);
  const [totalPages, setTotalPages] = useState(0);
  const [viewerReady, setViewerReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const hasInitializedUtilsRef = useRef(false);

  const viewStateRef = useRef({ page: initialPage ?? 1, scale: 1 });
  useEffect(() => {
    viewStateRef.current.page = currentPage;
  }, [currentPage]);
  useEffect(() => {
    viewStateRef.current.scale = displayScale;
  }, [displayScale]);

  const applyScale = useCallback((newScale: PdfScaleValue) => {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    if (!viewer) return;

    if (typeof newScale === "number") {
      viewer.currentScale = newScale;
    } else {
      viewer.currentScaleValue = newScale;
    }
  }, [pdfHighlighterUtilsRef]);

  const zoomIn = useCallback(() => {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    const currentScale = viewer?.currentScale || 1;
    const newScale = Math.min(currentScale + 0.25, 10);
    applyScale(newScale);
    setScale(newScale);
  }, [applyScale, pdfHighlighterUtilsRef]);

  const zoomOut = useCallback(() => {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    const currentScale = viewer?.currentScale || 1;
    const newScale = Math.max(currentScale - 0.25, 0.25);
    applyScale(newScale);
    setScale(newScale);
  }, [applyScale, pdfHighlighterUtilsRef]);

  const fitWidth = useCallback(() => {
    applyScale("page-width");
    setScale("page-width");
  }, [applyScale]);

  const fitPage = useCallback(() => {
    applyScale("page-fit");
    setScale("page-fit");
  }, [applyScale]);

  const handleScaleChange = useCallback((newScale: number) => {
    applyScale(newScale);
    setScale(newScale);
  }, [applyScale]);

  const goToPage = useCallback((page: number) => {
    pdfHighlighterUtilsRef.current?.goToPage(page);
    setCurrentPage(page);
  }, [pdfHighlighterUtilsRef]);

  const nextPage = useCallback(() => {
    if (currentPage < totalPages) goToPage(currentPage + 1);
  }, [currentPage, totalPages, goToPage]);

  const prevPage = useCallback(() => {
    if (currentPage > 1) goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const handlePrint = useCallback(() => {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}?print=1&file=${encodeURIComponent(filePath)}`;
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
      toast.error("Failed to open print dialog");
    });
  }, [filePath]);

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
  }, [containerRef]);

  // Track dark mode from document
  useEffect(() => {
    const checkDarkMode = () => {
      setDarkMode(document.documentElement.classList.contains("dark"));
    };

    checkDarkMode();

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

  // Track current page and scale when user scrolls/zooms
  useEffect(() => {
    if (!pdfHighlighterUtilsRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current.getEventBus() as any;
    if (!eventBus) return;

    const handlePageChange = (evt: { pageNumber: number }) => {
      setCurrentPage(evt.pageNumber);
    };

    const handleScaleEvt = (evt: { scale: number }) => {
      setDisplayScale(evt.scale);
    };

    eventBus.on("pagechanging", handlePageChange);
    eventBus.on("scalechanging", handleScaleEvt);

    const viewer = pdfHighlighterUtilsRef.current.getViewer();
    if (viewer?.currentScale) {
      setDisplayScale(viewer.currentScale);
    }

    return () => {
      eventBus.off("pagechanging", handlePageChange);
      eventBus.off("scalechanging", handleScaleEvt);
    };
  }, [pdfHighlighterUtilsRef.current]);

  const search = usePDFSearch({ pdfHighlighterUtilsRef, viewerReady });

  usePDFInteractions({
    pdfHighlighterUtilsRef,
    containerRef,
    mode,
    viewerReady,
    zoomIn,
    zoomOut,
    fitWidth,
    fitPage,
    handlePrint,
    handleModeChange,
    filePath,
  });

  const onUtilsRef = useCallback((utils: PdfHighlighterUtils) => {
    pdfHighlighterUtilsRef.current = utils;
    if (!hasInitializedUtilsRef.current) {
      hasInitializedUtilsRef.current = true;
      queueMicrotask(() => setViewerReady(true));
    }
  }, [pdfHighlighterUtilsRef]);

  const resetOnUrlChange = useCallback(() => {
    hasInitializedUtilsRef.current = false;
    setViewerReady(false);
  }, []);

  return {
    scale,
    displayScale,
    currentPage,
    setCurrentPage,
    totalPages,
    setTotalPages,
    searchMatchCount: search.searchMatchCount,
    searchCurrentMatch: search.searchCurrentMatch,
    viewerReady,
    isFullscreen,
    darkMode,
    viewStateRef,
    zoomIn,
    zoomOut,
    fitWidth,
    fitPage,
    handleScaleChange,
    goToPage,
    nextPage,
    prevPage,
    handlePrint,
    toggleFullscreen,
    handleSearch: search.handleSearch,
    handleSearchNext: search.handleSearchNext,
    handleSearchPrev: search.handleSearchPrev,
    handleSearchClear: search.handleSearchClear,
    onUtilsRef,
    resetOnUrlChange,
  };
}
