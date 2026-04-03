import { MutableRefObject } from "react";
import {
  PdfHighlighterUtils,
} from "../contexts/PdfHighlighterContext";
import { scaledToViewport } from "../lib/coordinates";
import { getWindow } from "../lib/pdfjs-dom";
import {
  GhostHighlight,
  Highlight,
  PdfSelection,
  Tip,
} from "../types";
import { SCROLL_MARGIN } from "./PdfHighlighterTypes";

import type { EventBus as TEventBus, PDFLinkService as TPDFLinkService, PDFViewer as TPDFViewer, PDFFindController as TPDFFindController } from "pdfjs-dist/web/pdf_viewer.mjs";

interface PdfHighlighterUtilsArgs {
  containerNodeRef: MutableRefObject<HTMLDivElement | null>;
  viewerRef: MutableRefObject<InstanceType<typeof TPDFViewer> | null>;
  ghostHighlightRef: MutableRefObject<GhostHighlight | null>;
  selectionRef: MutableRefObject<PdfSelection | null>;
  scrolledToHighlightIdRef: MutableRefObject<string | null>;
  isAreaSelectionInProgressRef: MutableRefObject<boolean>;
  isEditInProgressRef: MutableRefObject<boolean>;
  updateTipPositionRef: MutableRefObject<() => void>;
  eventBusRef: MutableRefObject<InstanceType<typeof TEventBus>>;
  linkServiceRef: MutableRefObject<InstanceType<typeof TPDFLinkService>>;
  findControllerRef: MutableRefObject<InstanceType<typeof TPDFFindController> | null>;
  tip: Tip | null;
  setTip: (tip: Tip | null) => void;
  onRemoveGhostHighlight?: (ghost: GhostHighlight) => void;
  renderHighlightLayers: () => void;
  handleScroll: () => void;
}

export function createPdfHighlighterUtils({
  containerNodeRef,
  viewerRef,
  ghostHighlightRef,
  selectionRef,
  scrolledToHighlightIdRef,
  isAreaSelectionInProgressRef,
  isEditInProgressRef,
  updateTipPositionRef,
  eventBusRef,
  linkServiceRef,
  findControllerRef,
  tip,
  setTip,
  onRemoveGhostHighlight,
  renderHighlightLayers,
  handleScroll,
}: PdfHighlighterUtilsArgs) {
  const isEditingOrHighlighting = () => {
    return (
      Boolean(selectionRef.current) ||
      Boolean(ghostHighlightRef.current) ||
      isAreaSelectionInProgressRef.current ||
      isEditInProgressRef.current
    );
  };

  const toggleEditInProgress = (flag?: boolean) => {
    if (flag !== undefined) {
      isEditInProgressRef.current = flag;
    } else {
      isEditInProgressRef.current = !isEditInProgressRef.current;
    }
    if (viewerRef.current)
      viewerRef.current.viewer?.classList.toggle(
        "PdfHighlighter--disable-selection",
        isEditInProgressRef.current,
      );
  };

  const clearTextSelection = () => {
    selectionRef.current = null;
    const container = containerNodeRef.current;
    const selection = getWindow(container).getSelection();
    if (!container || !selection) return;
    selection.removeAllRanges();
  };

  const removeGhostHighlight = () => {
    if (onRemoveGhostHighlight && ghostHighlightRef.current)
      onRemoveGhostHighlight(ghostHighlightRef.current);
    ghostHighlightRef.current = null;
    renderHighlightLayers();
  };

  const scrollToHighlight = (highlight: Highlight) => {
    const { boundingRect, usePdfCoordinates } = highlight.position;
    const pageNumber = boundingRect.pageNumber;
    viewerRef.current!.container.removeEventListener("scroll", handleScroll);
    const pageViewport = viewerRef.current!.getPageView(pageNumber - 1).viewport;
    viewerRef.current!.scrollPageIntoView({
      pageNumber,
      destArray: [
        null,
        { name: "XYZ" },
        ...pageViewport.convertToPdfPoint(
          0,
          scaledToViewport(boundingRect, pageViewport, usePdfCoordinates).top - SCROLL_MARGIN,
        ),
        0,
      ],
    });
    scrolledToHighlightIdRef.current = highlight.id;
    renderHighlightLayers();
    setTimeout(() => {
      viewerRef.current!.container.addEventListener("scroll", handleScroll, { once: true });
    }, 100);
  };

  const goToPage = (pageNumber: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const container = viewer.container;
    if (container && container.offsetParent) {
      try {
        viewer.scrollPageIntoView({ pageNumber });
        return;
      } catch {
        // Fall through to DOM-based scrolling
      }
    }
    const pageElement = container?.querySelector(`.page[data-page-number="${pageNumber}"]`) as HTMLElement | null;
    if (pageElement && container) {
      const styleTop = pageElement.style.top;
      const scrollTarget = styleTop ? parseInt(styleTop, 10) : 0;
      if (scrollTarget > 0) {
        container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      } else {
        const containerRect = container.getBoundingClientRect();
        const pageRect = pageElement.getBoundingClientRect();
        const scrollTop = container.scrollTop + (pageRect.top - containerRect.top);
        container.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    } else {
      const docPageElement = document.querySelector(`.page[data-page-number="${pageNumber}"]`) as HTMLElement | null;
      if (docPageElement) {
        const styleTop = docPageElement.style.top;
        const scrollTarget = styleTop ? parseInt(styleTop, 10) : 0;
        const scrollContainer = docPageElement.closest('.pdfViewer')?.parentElement as HTMLElement | null;
        if (scrollContainer && scrollTarget > 0) {
          scrollContainer.scrollTo({ top: scrollTarget, behavior: 'smooth' });
        } else {
          docPageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  };

  const pdfHighlighterUtils: PdfHighlighterUtils = {
    isEditingOrHighlighting,
    getCurrentSelection: () => selectionRef.current,
    getGhostHighlight: () => ghostHighlightRef.current,
    removeGhostHighlight,
    toggleEditInProgress,
    isEditInProgress: () => isEditInProgressRef.current,
    isSelectionInProgress: () =>
      Boolean(selectionRef.current) || isAreaSelectionInProgressRef.current,
    scrollToHighlight,
    getViewer: () => viewerRef.current,
    getTip: () => tip,
    setTip,
    updateTipPosition: updateTipPositionRef.current,
    getLinkService: () => linkServiceRef.current,
    getEventBus: () => eventBusRef.current,
    getFindController: () => findControllerRef.current,
    goToPage,
  };

  return {
    pdfHighlighterUtils,
    clearTextSelection,
    removeGhostHighlight,
    toggleEditInProgress,
  };
}
