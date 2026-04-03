import { MutableRefObject, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { PDFDocumentProxy } from "pdfjs-dist";
import {
  PdfHighlighterContext,
  PdfHighlighterUtils,
} from "../contexts/PdfHighlighterContext";
import groupHighlightsByPage from "../lib/group-highlights-by-page";
import { findOrCreateContainerLayer } from "../lib/pdfjs-dom";
import {
  GhostHighlight,
  Highlight,
  HighlightBindings,
} from "../types";
import { HighlightLayer } from "./HighlightLayer";

import type { PDFViewer as TPDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";

const findOrCreateHighlightLayer = (textLayer: HTMLElement) => {
  return findOrCreateContainerLayer(
    textLayer,
    "PdfHighlighter__highlight-layer",
  );
};

interface UseHighlightRenderingArgs {
  viewerRef: MutableRefObject<InstanceType<typeof TPDFViewer> | null>;
  highlightBindingsRef: MutableRefObject<{ [page: number]: HighlightBindings }>;
  ghostHighlightRef: MutableRefObject<GhostHighlight | null>;
  scrolledToHighlightIdRef: MutableRefObject<string | null>;
  highlights: Array<Highlight>;
  pdfDocument: PDFDocumentProxy;
  pdfHighlighterUtils: PdfHighlighterUtils;
  children: ReactNode;
}

export function createHighlightRendering({
  viewerRef,
  highlightBindingsRef,
  ghostHighlightRef,
  scrolledToHighlightIdRef,
  highlights,
  pdfDocument,
  pdfHighlighterUtils,
  children,
}: UseHighlightRenderingArgs) {
  const renderHighlightLayer = (
    highlightBindings: HighlightBindings,
    pageNumber: number,
  ) => {
    if (!viewerRef.current) return;

    highlightBindings.reactRoot.render(
      createElement(
        PdfHighlighterContext.Provider,
        { value: pdfHighlighterUtils },
        createElement(HighlightLayer, {
          highlightsByPage: groupHighlightsByPage([
            ...highlights,
            ghostHighlightRef.current,
          ]),
          pageNumber,
          scrolledToHighlightId: scrolledToHighlightIdRef.current,
          viewer: viewerRef.current,
          highlightBindings,
          children,
        }),
      ),
    );
  };

  const renderHighlightLayers = () => {
    if (!viewerRef.current) return;

    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber++
    ) {
      const highlightBindings = highlightBindingsRef.current[pageNumber];
      const pageView = viewerRef.current!.getPageView(pageNumber - 1);
      const currentTextLayerDiv = pageView?.textLayer?.div;

      if (highlightBindings?.container?.isConnected) {
        const inCurrentTextLayer =
          currentTextLayerDiv &&
          currentTextLayerDiv.contains(highlightBindings.container);

        if (!inCurrentTextLayer && currentTextLayerDiv) {
          const highlightLayer =
            findOrCreateHighlightLayer(currentTextLayerDiv);
          if (highlightLayer) {
            const reactRoot = createRoot(highlightLayer);
            highlightBindingsRef.current[pageNumber] = {
              reactRoot,
              container: highlightLayer,
              textLayer: currentTextLayerDiv,
            };
            renderHighlightLayer(
              highlightBindingsRef.current[pageNumber],
              pageNumber,
            );
            continue;
          }
        }

        renderHighlightLayer(highlightBindings, pageNumber);
      } else {
        const { textLayer } = pageView || {};
        if (!textLayer) {
          continue;
        }

        const highlightLayer = findOrCreateHighlightLayer(textLayer.div);

        if (highlightLayer) {
          const reactRoot = createRoot(highlightLayer);
          highlightBindingsRef.current[pageNumber] = {
            reactRoot,
            container: highlightLayer,
            textLayer: textLayer.div,
          };

          renderHighlightLayer(
            highlightBindingsRef.current[pageNumber],
            pageNumber,
          );
        }
      }
    }
  };

  return { renderHighlightLayer, renderHighlightLayers };
}
