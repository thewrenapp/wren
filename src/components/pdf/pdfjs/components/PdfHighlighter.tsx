import debounce from "lodash.debounce";
import {
  CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PdfHighlighterContext,
} from "../contexts/PdfHighlighterContext";
import {
  GhostHighlight,
  HighlightBindings,
  PdfSelection,
  Tip,
} from "../types";
import { DrawingCanvas } from "./DrawingCanvas";
import { MouseSelection } from "./MouseSelection";
import { ShapeCanvas } from "./ShapeCanvas";
import { TipContainer } from "./TipContainer";
import { createPdfHighlighterEvents } from "./usePdfHighlighterEvents";
import { createHighlightRendering } from "./usePdfHighlighterRendering";
import { createPdfHighlighterUtils } from "./usePdfHighlighterUtils";
import {
  defaultLightTheme,
  defaultDarkTheme,
  DEFAULT_SCALE_VALUE,
  DEFAULT_TEXT_SELECTION_COLOR,
} from "./PdfHighlighterTypes";
export type { PdfHighlighterProps, PdfHighlighterTheme } from "./PdfHighlighterTypes";
import type { PdfHighlighterProps } from "./PdfHighlighterTypes";

import type { EventBus as TEventBus, PDFLinkService as TPDFLinkService, PDFViewer as TPDFViewer, PDFFindController as TPDFFindController } from "pdfjs-dist/web/pdf_viewer.mjs";

let EventBus: typeof TEventBus, PDFLinkService: typeof TPDFLinkService, PDFViewer: typeof TPDFViewer, PDFFindController: typeof TPDFFindController;

(async () => {
  const pdfjs = await import("pdfjs-dist/web/pdf_viewer.mjs");
  EventBus = pdfjs.EventBus;
  PDFLinkService = pdfjs.PDFLinkService;
  PDFViewer = pdfjs.PDFViewer;
  PDFFindController = pdfjs.PDFFindController;
})();

const disableTextSelection = (viewer: InstanceType<typeof TPDFViewer>, flag: boolean) => {
  viewer.viewer?.classList.toggle("PdfHighlighter--disable-selection", flag);
};

export const PdfHighlighter = ({
  highlights,
  onScrollAway,
  pdfScaleValue = DEFAULT_SCALE_VALUE,
  onSelection: onSelectionFinished,
  onCreateGhostHighlight,
  onRemoveGhostHighlight,
  selectionTip,
  enableAreaSelection,
  areaSelectionMode,
  mouseSelectionStyle,
  pdfDocument,
  children,
  textSelectionColor = DEFAULT_TEXT_SELECTION_COLOR,
  utilsRef,
  style,
  enableFreetextCreation,
  onFreetextClick,
  enableImageCreation,
  onImageClick,
  enableDrawingMode,
  onDrawingComplete,
  onDrawingCancel,
  drawingStrokeColor = "#000000",
  drawingStrokeWidth = 3,
  enableShapeMode,
  onShapeComplete,
  onShapeCancel,
  shapeStrokeColor = "#000000",
  shapeStrokeWidth = 2,
  theme: userTheme,
}: PdfHighlighterProps) => {
  const resolvedTheme = useMemo(() => {
    const mode = userTheme?.mode ?? "light";
    const defaults = mode === "light" ? defaultLightTheme : defaultDarkTheme;
    return { ...defaults, ...userTheme, mode };
  }, [userTheme]);

  const [tip, setTip] = useState<Tip | null>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);

  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const highlightBindingsRef = useRef<{ [page: number]: HighlightBindings }>({});
  const ghostHighlightRef = useRef<GhostHighlight | null>(null);
  const selectionRef = useRef<PdfSelection | null>(null);
  const scrolledToHighlightIdRef = useRef<string | null>(null);
  const isAreaSelectionInProgressRef = useRef(false);
  const isEditInProgressRef = useRef(false);
  const updateTipPositionRef = useRef(() => { });

  const eventBusRef = useRef<InstanceType<typeof TEventBus>>(new EventBus());
  const linkServiceRef = useRef<InstanceType<typeof TPDFLinkService>>(
    new PDFLinkService({ eventBus: eventBusRef.current, externalLinkTarget: 2 }),
  );
  const findControllerRef = useRef<InstanceType<typeof TPDFFindController> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const viewerRef = useRef<InstanceType<typeof TPDFViewer> | null>(null);

  // Rendering (needs to be created first for handleScroll dependency)
  const { renderHighlightLayers } = createHighlightRendering({
    viewerRef, highlightBindingsRef, ghostHighlightRef, scrolledToHighlightIdRef,
    highlights, pdfDocument, pdfHighlighterUtils: null!, children,
  });

  // Utils
  const handleScrollForUtils = () => {
    onScrollAway && onScrollAway();
    scrolledToHighlightIdRef.current = null;
    renderHighlightLayers();
  };

  const { pdfHighlighterUtils, clearTextSelection, removeGhostHighlight, toggleEditInProgress } =
    createPdfHighlighterUtils({
      containerNodeRef, viewerRef, ghostHighlightRef, selectionRef,
      scrolledToHighlightIdRef, isAreaSelectionInProgressRef, isEditInProgressRef,
      updateTipPositionRef, eventBusRef, linkServiceRef, findControllerRef,
      tip, setTip, onRemoveGhostHighlight, renderHighlightLayers,
      handleScroll: handleScrollForUtils,
    });

  // Re-create rendering with actual utils
  const rendering = createHighlightRendering({
    viewerRef, highlightBindingsRef, ghostHighlightRef, scrolledToHighlightIdRef,
    highlights, pdfDocument, pdfHighlighterUtils, children,
  });

  // Events
  const { handleMouseUp, handleMouseDown, handleKeyDown, handleScaleValue } =
    createPdfHighlighterEvents({
      containerNodeRef, viewerRef, ghostHighlightRef, selectionRef,
      scrolledToHighlightIdRef, isEditInProgressRef, onScrollAway,
      onSelectionFinished, onCreateGhostHighlight, selectionTip, setTip,
      enableFreetextCreation, onFreetextClick, enableImageCreation, onImageClick,
      clearTextSelection, removeGhostHighlight, toggleEditInProgress,
      renderHighlightLayers: rendering.renderHighlightLayers, pdfScaleValue,
    });

  // Initialise PDF Viewer
  useLayoutEffect(() => {
    if (!containerNodeRef.current) return;
    const debouncedDocumentInit = debounce(() => {
      if (!findControllerRef.current) {
        findControllerRef.current = new PDFFindController({
          eventBus: eventBusRef.current, linkService: linkServiceRef.current,
        });
      }
      viewerRef.current = viewerRef.current || new PDFViewer({
        container: containerNodeRef.current!, eventBus: eventBusRef.current,
        textLayerMode: 2, removePageBorders: true,
        linkService: linkServiceRef.current, findController: findControllerRef.current,
      });
      viewerRef.current.setDocument(pdfDocument);
      linkServiceRef.current.setDocument(pdfDocument);
      linkServiceRef.current.setViewer(viewerRef.current);
      findControllerRef.current.setDocument(pdfDocument);
      setIsViewerReady(true);
    }, 100);
    debouncedDocumentInit();
    return () => { debouncedDocumentInit.cancel(); };
  }, [document]);

  // Initialise viewer event listeners
  useLayoutEffect(() => {
    if (!containerNodeRef.current) return;
    resizeObserverRef.current = new ResizeObserver(handleScaleValue);
    resizeObserverRef.current.observe(containerNodeRef.current);
    const doc = containerNodeRef.current.ownerDocument;
    eventBusRef.current.on("textlayerrendered", rendering.renderHighlightLayers);
    eventBusRef.current.on("pagerendered", rendering.renderHighlightLayers);
    eventBusRef.current.on("pagesinit", handleScaleValue);
    doc.addEventListener("keydown", handleKeyDown);
    rendering.renderHighlightLayers();
    return () => {
      eventBusRef.current.off("pagesinit", handleScaleValue);
      eventBusRef.current.off("textlayerrendered", rendering.renderHighlightLayers);
      eventBusRef.current.off("pagerendered", rendering.renderHighlightLayers);
      doc.removeEventListener("keydown", handleKeyDown);
      resizeObserverRef.current?.disconnect();
    };
  }, [selectionTip, highlights, onSelectionFinished, pdfScaleValue]);

  const utilsRefCalledRef = useRef(false);
  useEffect(() => {
    if (viewerRef.current && !utilsRefCalledRef.current) {
      utilsRefCalledRef.current = true;
      utilsRef(pdfHighlighterUtils);
    }
  }, [pdfHighlighterUtils, utilsRef]);

  const isFreetextMode = enableFreetextCreation?.({} as MouseEvent) ?? false;
  const isImageMode = enableImageCreation?.({} as MouseEvent) ?? false;

  let containerClassName = 'PdfHighlighter';
  if (resolvedTheme.mode === 'dark') containerClassName += ' PdfHighlighter--dark';
  if (isFreetextMode) containerClassName += ' PdfHighlighter--freetext-mode';
  if (isImageMode) containerClassName += ' PdfHighlighter--image-mode';
  if (enableDrawingMode) containerClassName += ' PdfHighlighter--drawing-mode';
  if (enableShapeMode) containerClassName += ' PdfHighlighter--shape-mode';
  if (areaSelectionMode) containerClassName += ' PdfHighlighter--area-mode';

  const containerStyle: CSSProperties = {
    ...style,
    backgroundColor: resolvedTheme.containerBackgroundColor,
  };

  return (
    <PdfHighlighterContext.Provider value={pdfHighlighterUtils}>
      <div
        ref={containerNodeRef}
        className={containerClassName}
        onPointerDown={handleMouseDown}
        onPointerUp={handleMouseUp}
        style={containerStyle}
      >
        <div className="pdfViewer" />
        <style>
          {`
          .textLayer ::selection {
            background: ${textSelectionColor};
          }
          .PdfHighlighter::-webkit-scrollbar-thumb {
            background-color: ${resolvedTheme.scrollbarThumbColor};
          }
          .PdfHighlighter::-webkit-scrollbar-track,
          .PdfHighlighter::-webkit-scrollbar-track-piece {
            background-color: ${resolvedTheme.scrollbarTrackColor};
          }
          ${resolvedTheme.mode === 'dark' ? `
          .PdfHighlighter--dark .page {
            filter: invert(${resolvedTheme.darkModeInvertIntensity}) hue-rotate(180deg) brightness(1.05);
          }
          .PdfHighlighter--dark .PdfHighlighter__highlight-layer {
            filter: invert(${resolvedTheme.darkModeInvertIntensity}) hue-rotate(180deg) brightness(0.95);
          }
          ` : ''}
        `}
        </style>
        {isViewerReady && (
          <TipContainer viewer={viewerRef.current!} updateTipPositionRef={updateTipPositionRef} />
        )}
        {isViewerReady && enableAreaSelection && (
          <MouseSelection
            viewer={viewerRef.current!}
            onChange={(isVisible) => (isAreaSelectionInProgressRef.current = isVisible)}
            enableAreaSelection={enableAreaSelection}
            style={mouseSelectionStyle}
            onDragStart={() => disableTextSelection(viewerRef.current!, true)}
            onReset={() => { selectionRef.current = null; disableTextSelection(viewerRef.current!, false); }}
            onSelection={(viewportPosition, scaledPosition, image, resetSelection) => {
              selectionRef.current = {
                content: { image }, type: "area", position: scaledPosition,
                makeGhostHighlight: () => {
                  ghostHighlightRef.current = { position: scaledPosition, type: "area", content: { image } };
                  onCreateGhostHighlight && onCreateGhostHighlight(ghostHighlightRef.current);
                  resetSelection();
                  rendering.renderHighlightLayers();
                  return ghostHighlightRef.current;
                },
              };
              onSelectionFinished && onSelectionFinished(selectionRef.current);
              selectionTip && setTip({ position: viewportPosition, content: selectionTip });
            }}
          />
        )}
        {isViewerReady && enableDrawingMode && (
          <DrawingCanvas
            isActive={enableDrawingMode} strokeColor={drawingStrokeColor}
            strokeWidth={drawingStrokeWidth} viewer={viewerRef.current!}
            onComplete={(dataUrl, position, strokes) => { onDrawingComplete?.(dataUrl, position, strokes); }}
            onCancel={() => { onDrawingCancel?.(); }}
          />
        )}
        {isViewerReady && enableShapeMode && (
          <ShapeCanvas
            isActive={!!enableShapeMode} shapeType={enableShapeMode}
            strokeColor={shapeStrokeColor} strokeWidth={shapeStrokeWidth}
            viewer={viewerRef.current!}
            onComplete={(position, shape) => { onShapeComplete?.(position, shape); }}
            onCancel={() => { onShapeCancel?.(); }}
          />
        )}
      </div>
    </PdfHighlighterContext.Provider>
  );
};
