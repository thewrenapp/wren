import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { LTWHP, ViewportPosition, Scaled, ScaledPosition } from "../types";
import { PageViewport } from "pdfjs-dist";

interface WIDTH_HEIGHT {
  width: number;
  height: number;
}

/** @category Utilities */
export const viewportToScaled = (
  rect: LTWHP,
  { width, height }: WIDTH_HEIGHT,
): Scaled => {
  return {
    x1: rect.left,
    y1: rect.top,

    x2: rect.left + rect.width,
    y2: rect.top + rect.height,

    width,
    height,

    pageNumber: rect.pageNumber,
  };
};

/** @category Utilities */
export const viewportPositionToScaled = (
  { boundingRect, rects }: ViewportPosition,
  viewer: PDFViewer,
): ScaledPosition => {
  const pageNumber = boundingRect.pageNumber;
  const viewport = viewer.getPageView(pageNumber - 1).viewport; // Account for 1 indexing of PDF documents
  const scale = (obj: LTWHP) => viewportToScaled(obj, viewport);

  return {
    boundingRect: scale(boundingRect),
    rects: (rects || []).map(scale),
  };
};

/** @category Utilities */
export const viewportToPdf = (
  rect: LTWHP,
  viewport: PageViewport,
): Scaled => {
  const [pdfX1, pdfY1] = viewport.convertToPdfPoint(rect.left, rect.top);
  const [pdfX2, pdfY2] = viewport.convertToPdfPoint(
    rect.left + rect.width,
    rect.top + rect.height,
  );
  return {
    x1: Math.min(pdfX1, pdfX2),
    y1: Math.min(pdfY1, pdfY2),
    x2: Math.max(pdfX1, pdfX2),
    y2: Math.max(pdfY1, pdfY2),
    width: viewport.width,
    height: viewport.height,
    pageNumber: rect.pageNumber,
  };
};

/** @category Utilities */
export const viewportPositionToPdfScaled = (
  { boundingRect, rects }: ViewportPosition,
  viewer: PDFViewer,
): ScaledPosition => {
  const pageNumber = boundingRect.pageNumber;
  const viewport = viewer.getPageView(pageNumber - 1).viewport;
  const scale = (obj: LTWHP) => viewportToPdf(obj, viewport);
  return {
    boundingRect: scale(boundingRect),
    rects: (rects || []).map(scale),
    usePdfCoordinates: true,
  };
};

const pdfToViewport = (pdf: Scaled, viewport: PageViewport): LTWHP => {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
    pdf.x1,
    pdf.y1,
    pdf.x2,
    pdf.y2,
  ]);

  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),

    width: Math.abs(x2 - x1),
    height: Math.abs(y1 - y2),

    pageNumber: pdf.pageNumber,
  };
};

/** @category Utilities */
export const scaledToViewport = (
  scaled: Scaled,
  viewport: PageViewport,
  usePdfCoordinates: boolean = false,
): LTWHP => {
  const { width, height } = viewport;

  if (usePdfCoordinates) {
    return pdfToViewport(scaled, viewport);
  }

  if (scaled.x1 === undefined) {
    throw new Error("You are using old position format, please update");
  }

  const x1 = (width * scaled.x1) / scaled.width;
  const y1 = (height * scaled.y1) / scaled.height;

  const x2 = (width * scaled.x2) / scaled.width;
  const y2 = (height * scaled.y2) / scaled.height;

  return {
    left: x1,
    top: y1,
    width: x2 - x1,
    height: y2 - y1,
    pageNumber: scaled.pageNumber,
  };
};

/** @category Utilities */
export const scaledPositionToViewport = (
  { boundingRect, rects, usePdfCoordinates }: ScaledPosition,
  viewer: PDFViewer,
): ViewportPosition => {
  const pageNumber = boundingRect.pageNumber;
  const viewport = viewer.getPageView(pageNumber - 1).viewport; // Account for 1 indexing of PDF documents
  const scale = (obj: Scaled) =>
    scaledToViewport(obj, viewport, usePdfCoordinates);

  return {
    boundingRect: scale(boundingRect),
    rects: (rects || []).map(scale),
  };
};
