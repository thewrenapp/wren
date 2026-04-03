import { viewportPositionToPdfScaled } from "../lib/coordinates";
import { DrawingStroke, ScaledPosition, ViewportPosition } from "../types";
import type { PDFViewer as TPDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

/**
 * Draw a single stroke on a canvas context.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, offsetX = 0, offsetY = 0) {
  if (stroke.points.length < 2) return;

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x - offsetX, stroke.points[0].y - offsetY);
  stroke.points.slice(1).forEach((point) => {
    ctx.lineTo(point.x - offsetX, point.y - offsetY);
  });
  ctx.stroke();
}

/**
 * Redraw all strokes (completed + current) on the given canvas.
 */
export function redrawAllStrokes(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  currentStroke: Stroke | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw all completed strokes with their own color/width
  strokes.forEach((stroke) => drawStroke(ctx, stroke));

  // Draw current stroke with current color/width
  if (currentStroke) {
    drawStroke(ctx, currentStroke);
  }
}

/**
 * Find which PDF page contains the given client coordinates.
 */
export function findPageFromPoint(
  viewer: InstanceType<typeof TPDFViewer>,
  clientX: number,
  clientY: number,
): { pageNumber: number; element: HTMLElement; rect: DOMRect } | null {
  if (!viewer) return null;

  for (let i = 0; i < viewer.pagesCount; i++) {
    const pageView = viewer.getPageView(i);
    if (!pageView?.div) continue;

    const pageNode = pageView.div as HTMLElement;
    const pageRect = pageNode.getBoundingClientRect();
    const textLayerNode = pageView.textLayer?.div as HTMLElement | undefined;
    const baseRect = textLayerNode
      ? textLayerNode.getBoundingClientRect()
      : pageRect;
    if (
      clientX >= pageRect.left &&
      clientX <= pageRect.right &&
      clientY >= pageRect.top &&
      clientY <= pageRect.bottom
    ) {
      return {
        pageNumber: i + 1,
        element: textLayerNode ?? pageNode,
        rect: baseRect,
      };
    }
  }
  return null;
}

/**
 * Compute the final drawing output: data URL, scaled position, and normalized strokes.
 * Returns null if there are no strokes to process.
 */
export function computeDrawingResult(
  strokes: Stroke[],
  pageNumber: number,
  viewer: InstanceType<typeof TPDFViewer>,
): { dataUrl: string; scaledPosition: ScaledPosition; normalizedStrokes: DrawingStroke[] } | null {
  if (strokes.length === 0) return null;

  // Calculate bounding box of all strokes
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  strokes.forEach((stroke) => {
    stroke.points.forEach((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });
  });

  // Find max stroke width for padding
  const maxStrokeWidth = Math.max(...strokes.map(s => s.width));
  const padding = maxStrokeWidth * 2;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = maxX + padding;
  maxY = maxY + padding;

  const width = maxX - minX;
  const height = maxY - minY;

  // Create a new canvas with just the drawing (cropped to bounding box)
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext("2d");

  if (!outputCtx) {
    console.error("DrawingCanvas: Could not get output canvas context");
    return null;
  }

  // Draw all strokes offset by bounding box origin, using per-stroke color/width
  strokes.forEach((stroke) => drawStroke(outputCtx, stroke, minX, minY));

  const dataUrl = outputCanvas.toDataURL("image/png");

  // Create viewport position
  const viewportPosition: ViewportPosition = {
    boundingRect: {
      left: minX,
      top: minY,
      width: width,
      height: height,
      pageNumber: pageNumber,
    },
    rects: [],
  };

  const scaledPosition = viewportPositionToPdfScaled(viewportPosition, viewer);

  // Normalize strokes as percentages (0-1) relative to bounding box for storage
  // This ensures strokes scale correctly when viewed at different zoom levels
  const normalizedStrokes: DrawingStroke[] = strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({
      x: (point.x - minX) / width,
      y: (point.y - minY) / height,
    })),
  }));

  return { dataUrl, scaledPosition, normalizedStrokes };
}
