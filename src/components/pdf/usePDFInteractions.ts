import { useEffect, useCallback, type MutableRefObject } from "react";
import type { PdfHighlighterUtils } from "@/components/pdf/pdfjs";

type ViewerMode = "pan" | "edit";

interface UsePDFInteractionsOptions {
  pdfHighlighterUtilsRef: MutableRefObject<PdfHighlighterUtils | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  mode: ViewerMode;
  viewerReady: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fitWidth: () => void;
  fitPage: () => void;
  handlePrint: () => void;
  handleModeChange: (mode: ViewerMode) => void;
  filePath: string;
}

export function usePDFInteractions({
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
}: UsePDFInteractionsOptions) {

  // PDF-specific keyboard shortcuts
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
        fitWidth();
        return;
      }

      if (isMeta && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        handlePrint();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [zoomIn, zoomOut, fitWidth, filePath, handlePrint]);

  // Listen for Command Palette events
  useEffect(() => {
    const handleToggleEdit = () => handleModeChange(mode === "edit" ? "pan" : "edit");
    const events: [string, () => void][] = [
      ["wren:pdf-zoom-in", zoomIn],
      ["wren:pdf-zoom-out", zoomOut],
      ["wren:pdf-fit-width", fitWidth],
      ["wren:pdf-fit-page", fitPage],
      ["wren:pdf-toggle-edit", handleToggleEdit],
      ["wren:pdf-print", handlePrint],
    ];
    for (const [name, handler] of events) window.addEventListener(name, handler);
    return () => { for (const [name, handler] of events) window.removeEventListener(name, handler); };
  }, [zoomIn, zoomOut, fitWidth, fitPage, handlePrint, handleModeChange, mode]);

  // Hand tool - grab to pan
  const setupHandTool = useCallback(() => {
    if (mode !== "pan") return undefined;

    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    const container = (viewer?.container ||
      containerRef.current?.querySelector(".PdfHighlighter")) as HTMLElement | null;
    if (!container) return undefined;

    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;

    container.style.cursor = "grab";
    container.classList.add("PdfHighlighter--hand-tool");

    const handlePointerDown = (e: PointerEvent) => {
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
  }, [mode, pdfHighlighterUtilsRef, containerRef]);

  useEffect(() => {
    const cleanup = setupHandTool();
    return cleanup;
  }, [mode, viewerReady, setupHandTool]);

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
  }, [zoomIn, zoomOut, viewerReady, pdfHighlighterUtilsRef, containerRef]);
}
