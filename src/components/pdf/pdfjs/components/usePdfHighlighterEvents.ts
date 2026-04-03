import { PointerEventHandler, MutableRefObject } from "react";
import {
  viewportPositionToScaled,
  viewportPositionToPdfScaled,
} from "../lib/coordinates";
import getBoundingRect from "../lib/get-bounding-rect";
import getClientRects from "../lib/get-client-rects";
import {
  asElement,
  getPageFromElement,
  getPagesFromRange,
  getWindow,
  isHTMLElement,
} from "../lib/pdfjs-dom";
import {
  Content,
  GhostHighlight,
  PdfSelection,
  ViewportPosition,
  Tip,
} from "../types";

import type { PDFViewer as TPDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";

interface UsePdfHighlighterEventsArgs {
  containerNodeRef: MutableRefObject<HTMLDivElement | null>;
  viewerRef: MutableRefObject<InstanceType<typeof TPDFViewer> | null>;
  ghostHighlightRef: MutableRefObject<GhostHighlight | null>;
  selectionRef: MutableRefObject<PdfSelection | null>;
  scrolledToHighlightIdRef: MutableRefObject<string | null>;
  isEditInProgressRef: MutableRefObject<boolean>;
  onScrollAway?: () => void;
  onSelectionFinished?: (selection: PdfSelection) => void;
  onCreateGhostHighlight?: (ghost: GhostHighlight) => void;
  selectionTip?: React.ReactNode;
  setTip: (tip: Tip | null) => void;
  enableFreetextCreation?: (event: MouseEvent) => boolean;
  onFreetextClick?: (position: any) => void;
  enableImageCreation?: (event: MouseEvent) => boolean;
  onImageClick?: (position: any) => void;
  clearTextSelection: () => void;
  removeGhostHighlight: () => void;
  toggleEditInProgress: (flag?: boolean) => void;
  renderHighlightLayers: () => void;
  pdfScaleValue: string | number;
}

export function createPdfHighlighterEvents({
  containerNodeRef,
  viewerRef,
  ghostHighlightRef,
  selectionRef,
  scrolledToHighlightIdRef,
  isEditInProgressRef,
  onScrollAway,
  onSelectionFinished,
  onCreateGhostHighlight,
  selectionTip,
  setTip,
  enableFreetextCreation,
  onFreetextClick,
  enableImageCreation,
  onImageClick,
  clearTextSelection,
  removeGhostHighlight,
  toggleEditInProgress,
  renderHighlightLayers,
  pdfScaleValue,
}: UsePdfHighlighterEventsArgs) {
  const handleScroll = () => {
    onScrollAway && onScrollAway();
    scrolledToHighlightIdRef.current = null;
    renderHighlightLayers();
  };

  const handleMouseUp: PointerEventHandler = () => {
    const container = containerNodeRef.current;
    const selection = getWindow(container).getSelection();

    if (!container || !selection || selection.isCollapsed || !viewerRef.current)
      return;

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    if (!range || !container.contains(range.commonAncestorContainer)) return;

    const pages = getPagesFromRange(range);
    if (!pages || pages.length === 0) return;

    const rects = getClientRects(range, pages);
    if (rects.length === 0) return;

    const viewportPosition: ViewportPosition = {
      boundingRect: getBoundingRect(rects),
      rects,
    };

    const scaledPosition = viewportPositionToScaled(
      viewportPosition,
      viewerRef.current,
    );

    const content: Content = {
      text: selection.toString().split("\n").join(" "),
    };

    selectionRef.current = {
      content,
      type: "text",
      position: scaledPosition,
      makeGhostHighlight: () => {
        ghostHighlightRef.current = {
          content: content,
          type: "text",
          position: scaledPosition,
        };

        onCreateGhostHighlight &&
          onCreateGhostHighlight(ghostHighlightRef.current);
        clearTextSelection();
        renderHighlightLayers();
        return ghostHighlightRef.current;
      },
    };

    onSelectionFinished && onSelectionFinished(selectionRef.current);

    selectionTip &&
      setTip({ position: viewportPosition, content: selectionTip });
  };

  const handleMouseDown: PointerEventHandler = (event) => {
    if (
      !isHTMLElement(event.target) ||
      asElement(event.target).closest(".PdfHighlighter__tip-container")
    ) {
      return;
    }

    if (
      enableFreetextCreation?.(event.nativeEvent) &&
      onFreetextClick &&
      !isEditInProgressRef.current
    ) {
      const target = asElement(event.target);
      const page = getPageFromElement(target);

      if (page && viewerRef.current) {
        const pageRect = page.node.getBoundingClientRect();
        const clickX = event.clientX - pageRect.left;
        const clickY = event.clientY - pageRect.top;

        const defaultWidth = 150;
        const defaultHeight = 80;

        const viewportPosition: ViewportPosition = {
          boundingRect: {
            left: clickX,
            top: clickY,
            width: defaultWidth,
            height: defaultHeight,
            pageNumber: page.number,
          },
          rects: [],
        };

        const scaledPosition = viewportPositionToPdfScaled(
          viewportPosition,
          viewerRef.current,
        );

        onFreetextClick(scaledPosition);
        return;
      }
    }

    if (
      enableImageCreation?.(event.nativeEvent) &&
      onImageClick &&
      !isEditInProgressRef.current
    ) {
      const target = asElement(event.target);
      const page = getPageFromElement(target);

      if (page && viewerRef.current) {
        const pageRect = page.node.getBoundingClientRect();
        const clickX = event.clientX - pageRect.left;
        const clickY = event.clientY - pageRect.top;

        const defaultWidth = 150;
        const defaultHeight = 100;

        const viewportPosition: ViewportPosition = {
          boundingRect: {
            left: clickX,
            top: clickY,
            width: defaultWidth,
            height: defaultHeight,
            pageNumber: page.number,
          },
          rects: [],
        };

        const scaledPosition = viewportPositionToPdfScaled(
          viewportPosition,
          viewerRef.current,
        );

        onImageClick(scaledPosition);
        return;
      }
    }

    setTip(null);
    clearTextSelection();
    removeGhostHighlight();
    toggleEditInProgress(false);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      clearTextSelection();
      removeGhostHighlight();
      setTip(null);
    }
  };

  const handleScaleValue = () => {
    if (viewerRef.current) {
      viewerRef.current.currentScaleValue = pdfScaleValue.toString();
    }
    setTimeout(renderHighlightLayers, 100);
  };

  return {
    handleScroll,
    handleMouseUp,
    handleMouseDown,
    handleKeyDown,
    handleScaleValue,
  };
}
