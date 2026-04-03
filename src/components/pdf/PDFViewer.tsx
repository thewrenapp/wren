import { useState, useCallback, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { GlobalWorkerOptions } from "pdfjs-dist";

import "pdfjs-dist/web/pdf_viewer.css";
import "@/components/pdf/pdfjs/style/style.css";
import "./PDFViewer.css";

import {
  PdfLoader,
  PdfHighlighter,
  type PdfHighlighterUtils,
} from "@/components/pdf/pdfjs";

import { PDFToolbar } from "./PDFToolbar";
import { HighlightRenderer } from "./HighlightRenderer";
import { PDFLeftPanel } from "./PDFLeftPanel";
import { useUIStore } from "@/stores/uiStore";
import { usePDFAnnotations, type ToolMode } from "./usePDFAnnotations";
import { usePDFNavigation } from "./usePDFNavigation";
import { usePDFTextSelection } from "./usePDFTextSelection";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PDFViewerProps {
  filePath: string;
  attachmentId: string;
  entryKey?: string;
  attachmentKey?: string;
  infoPaneOpen?: boolean;
  onToggleInfoPane?: () => void;
  initialPage?: number;
  pageRequestId?: number;
  onViewStateChange?: (state: { page: number; scale: number }) => void;
}

type ViewerMode = "pan" | "edit";

export function PDFViewer({ filePath, attachmentId, entryKey, attachmentKey, infoPaneOpen: infoPaneOpenProp, onToggleInfoPane, initialPage, pageRequestId, onViewStateChange }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [toolMode, setToolMode] = useState<ToolMode>(null);
  const [mode, setMode] = useState<ViewerMode>("pan");
  const [leftPanelTab, setLeftPanelTab] = useState<"thumbnails" | "outline" | "annotations">("thumbnails");

  const containerRef = useRef<HTMLDivElement>(null);
  const pdfHighlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);

  const { infoPaneOpen: globalInfoPaneOpen, libraryLayout } = useUIStore();
  const infoPaneOpen = infoPaneOpenProp ?? globalInfoPaneOpen;
  const toggleInfoPane = onToggleInfoPane ?? (() => {});

  const [pdfLeftPanelOpen, setPdfLeftPanelOpen] = useState(false);
  const togglePdfLeftPanel = useCallback(() => setPdfLeftPanelOpen(prev => !prev), []);

  const handleModeChange = useCallback((nextMode: ViewerMode) => {
    setMode(nextMode);
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    if (nextMode !== "edit") setToolMode(null);
  }, []);

  const handleToolModeChange = useCallback((nextTool: ToolMode) => {
    if (nextTool) setMode("edit");
    setToolMode(nextTool);
  }, []);

  const annotations = usePDFAnnotations({ attachmentId, toolMode });
  const navigation = usePDFNavigation({
    filePath, initialPage, pageRequestId, pdfHighlighterUtilsRef, containerRef,
    mode, toolMode, setToolMode, handleModeChange, onViewStateChange,
  });

  const isTextSelectionMode = mode === "edit" && (toolMode === null || toolMode === "highlight");
  const isSelectMode = isTextSelectionMode;

  const { selectionRects, isSelecting } = usePDFTextSelection({
    containerRef, isTextSelectionMode, highlights: annotations.highlights,
  });

  useEffect(() => {
    return () => { onViewStateChange?.(navigation.viewStateRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { navigation.resetOnUrlChange(); }, [pdfUrl, navigation.resetOnUrlChange]);

  useEffect(() => {
    if (toolMode !== "drawing") return;
    const handleMouseUp = () => {
      setTimeout(() => {
        const doneButton = document.querySelector('.DrawingCanvas__doneButton') as HTMLButtonElement;
        if (doneButton) doneButton.click();
      }, 100);
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [toolMode]);

  useEffect(() => {
    if (filePath) setPdfUrl(convertFileSrc(filePath));
  }, [filePath]);

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
      className="pdf-viewer-container flex h-full flex-col bg-muted/30 overflow-hidden"
    >
      <PDFToolbar
        scale={navigation.displayScale}
        onZoomIn={navigation.zoomIn}
        onZoomOut={navigation.zoomOut}
        onFitWidth={navigation.fitWidth}
        onFitPage={navigation.fitPage}
        onScaleChange={navigation.handleScaleChange}
        highlightColor={annotations.highlightColor}
        onColorChange={annotations.setHighlightColor}
        areaHighlightColor={annotations.areaHighlightColor}
        onAreaColorChange={annotations.setAreaHighlightColor}
        currentPage={navigation.currentPage}
        totalPages={navigation.totalPages}
        onPageChange={navigation.goToPage}
        onPrevPage={navigation.prevPage}
        onNextPage={navigation.nextPage}
        toolMode={toolMode}
        onToolModeChange={handleToolModeChange}
        mode={mode}
        onModeChange={handleModeChange}
        drawingColor={annotations.drawingColor}
        onDrawingColorChange={annotations.setDrawingColor}
        shapeColor={annotations.shapeColor}
        onShapeColorChange={annotations.setShapeColor}
        leftPanelOpen={pdfLeftPanelOpen}
        onToggleLeftPanel={togglePdfLeftPanel}
        infoPaneOpen={infoPaneOpen}
        onToggleInfoPane={toggleInfoPane}
        isStackedLayout={libraryLayout === "stacked"}
        onSearch={navigation.handleSearch}
        onSearchNext={navigation.handleSearchNext}
        onSearchPrev={navigation.handleSearchPrev}
        onSearchClear={navigation.handleSearchClear}
        searchMatchCount={navigation.searchMatchCount}
        searchCurrentMatch={navigation.searchCurrentMatch}
        isFullscreen={navigation.isFullscreen}
        onToggleFullscreen={navigation.toggleFullscreen}
        onPrint={navigation.handlePrint}
      />

      <div className="relative flex-1 overflow-hidden flex h-full">
        <PdfLoader document={pdfUrl}>
          {(pdfDocument) => {
            if (pdfDocument.numPages !== navigation.totalPages) {
              queueMicrotask(() => navigation.setTotalPages(pdfDocument.numPages));
            }

            return (
              <div className="flex h-full w-full">
                {pdfLeftPanelOpen && (
                  <PDFLeftPanel
                    leftPanelTab={leftPanelTab}
                    setLeftPanelTab={setLeftPanelTab}
                    annotations={annotations.highlights}
                    onAnnotationClick={(_id, page) => { navigation.goToPage(page); }}
                    onDelete={annotations.handleDelete}
                    pdfDocument={pdfDocument}
                    goToPage={navigation.goToPage}
                    currentPage={navigation.currentPage}
                    pdfHighlighterUtils={pdfHighlighterUtilsRef.current}
                    togglePdfLeftPanel={togglePdfLeftPanel}
                    entryKey={entryKey}
                    attachmentKey={attachmentKey}
                  />
                )}

                <div className="flex-1 relative overflow-hidden">
                  <PdfHighlighter
                    pdfDocument={pdfDocument}
                    pdfScaleValue={navigation.scale}
                    highlights={annotations.highlights}
                    theme={{ mode: navigation.darkMode ? "dark" : "light" }}
                    utilsRef={navigation.onUtilsRef}
                    textSelectionColor={
                      mode === "edit" && toolMode === "highlight"
                        ? annotations.highlightColor
                        : isSelectMode ? "hsl(var(--primary) / 0.8)" : undefined
                    }
                    onSelection={mode === "edit" && (toolMode === "highlight" || toolMode === "area") ? annotations.handleSelection : undefined}
                    enableAreaSelection={() => mode === "edit" && toolMode === "area"}
                    areaSelectionMode={mode === "edit" && toolMode === "area"}
                    enableFreetextCreation={() => mode === "edit" && toolMode === "freetext"}
                    onFreetextClick={annotations.handleFreetextClick}
                    enableDrawingMode={mode === "edit" && toolMode === "drawing"}
                    onDrawingComplete={annotations.handleDrawingComplete}
                    onDrawingCancel={() => setToolMode(null)}
                    drawingStrokeColor={annotations.drawingColor}
                    drawingStrokeWidth={3}
                    enableShapeMode={mode === "edit" && toolMode === "rectangle" ? "rectangle" : null}
                    onShapeComplete={annotations.handleShapeComplete}
                    onShapeCancel={() => setToolMode(null)}
                    shapeStrokeColor={annotations.shapeColor}
                    shapeStrokeWidth={2}
                    style={{ height: "100%" }}
                  >
                    <HighlightRenderer
                      onColorChange={annotations.handleColorChange}
                      onDelete={annotations.handleDelete}
                      onEdit={annotations.handleEdit}
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
