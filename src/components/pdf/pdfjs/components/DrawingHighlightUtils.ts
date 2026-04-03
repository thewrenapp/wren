import type { DrawingStroke } from "../types";

// Drawing style presets (matches PDFToolbar STROKE_COLORS)
export const DRAWING_COLORS = ["#000000", "#EF4444", "#3B82F6", "#22C55E", "#A855F7", "#F97316"];
export const STROKE_WIDTHS = [
  { label: "Thin", value: 1 },
  { label: "Medium", value: 3 },
  { label: "Thick", value: 5 },
];

/**
 * Re-render strokes to a canvas and return as PNG data URL.
 * Strokes are stored as normalized percentages (0-1) relative to bounding box.
 * Backward compatibility: old strokes stored as pixel offsets (values > 1.0)
 * are auto-detected and scaled to fit the current container.
 */
export const renderStrokesToImage = (
  strokes: DrawingStroke[],
  width: number,
  height: number
): string => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) return "";

  // Detect old pixel-offset format vs new percentage format (0-1)
  const isOldFormat = strokes.some((s) =>
    s.points.some((p) => p.x > 1.0 || p.y > 1.0)
  );

  // For old format, find the max extent to scale proportionally
  let oldMaxX = 1;
  let oldMaxY = 1;
  if (isOldFormat) {
    strokes.forEach((s) =>
      s.points.forEach((p) => {
        oldMaxX = Math.max(oldMaxX, p.x);
        oldMaxY = Math.max(oldMaxY, p.y);
      })
    );
  }

  strokes.forEach((stroke) => {
    if (stroke.points.length < 2) return;

    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    if (isOldFormat) {
      // Old format: scale pixel offsets to fit current container
      ctx.moveTo(
        (stroke.points[0].x / oldMaxX) * width,
        (stroke.points[0].y / oldMaxY) * height
      );
      stroke.points.slice(1).forEach((point) => {
        ctx.lineTo((point.x / oldMaxX) * width, (point.y / oldMaxY) * height);
      });
    } else {
      // New format: percentages (0-1), multiply by container dimensions
      ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
      stroke.points.slice(1).forEach((point) => {
        ctx.lineTo(point.x * width, point.y * height);
      });
    }
    ctx.stroke();
  });

  return canvas.toDataURL("image/png");
};
