import { PDFDocument, rgb, PDFPage, PDFFont } from "pdf-lib";
import type { ExportPdfOptions, ExportableHighlight } from "./export-pdf";
import {
  parseColor,
  scaledToPdfPoints,
  dataUrlToBytes,
  wrapText,
  transformToRawCoordinates,
} from "./export-pdf-utils";

/**
 * Render a text highlight (multiple rectangles for multi-line selections).
 * Supports highlight (background), underline, and strikethrough styles.
 */
export async function renderTextHighlight(
  page: PDFPage,
  highlight: ExportableHighlight,
  options: ExportPdfOptions
): Promise<void> {
  // Per-highlight color override or fallback to default
  const colorStr =
    highlight.highlightColor ||
    options.textHighlightColor ||
    "rgba(255, 226, 143, 0.5)";
  const color = parseColor(colorStr);
  const highlightStyle = highlight.highlightStyle || "highlight";

  // Text highlights use rects array for multi-line selections
  const rects =
    highlight.position.rects.length > 0
      ? highlight.position.rects
      : [highlight.position.boundingRect];

  for (const rect of rects) {
    const { x, y, width, height } = scaledToPdfPoints(rect, page);

    if (highlightStyle === "highlight") {
      // Draw filled rectangle for background highlight
      page.drawRectangle({
        x,
        y,
        width,
        height,
        color: rgb(color.r, color.g, color.b),
        opacity: color.a,
      });
    } else if (highlightStyle === "underline") {
      // Draw line at bottom of rectangle
      const lineThickness = Math.max(1, height * 0.1);
      page.drawRectangle({
        x,
        y,
        width,
        height: lineThickness,
        color: rgb(color.r, color.g, color.b),
        opacity: color.a,
      });
    } else if (highlightStyle === "strikethrough") {
      // Draw line through middle of rectangle
      const lineThickness = Math.max(1, height * 0.1);
      const lineY = y + height / 2 - lineThickness / 2;
      page.drawRectangle({
        x,
        y: lineY,
        width,
        height: lineThickness,
        color: rgb(color.r, color.g, color.b),
        opacity: color.a,
      });
    }
  }
}

/**
 * Render an area highlight (single rectangle).
 */
export async function renderAreaHighlight(
  page: PDFPage,
  highlight: ExportableHighlight,
  options: ExportPdfOptions
): Promise<void> {
  // Per-highlight color override or fallback to default
  const colorStr =
    highlight.highlightColor ||
    options.areaHighlightColor ||
    "rgba(255, 226, 143, 0.5)";
  const color = parseColor(colorStr);
  const { x, y, width, height } = scaledToPdfPoints(
    highlight.position.boundingRect,
    page
  );

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(color.r, color.g, color.b),
    opacity: color.a,
  });
}

/**
 * Render a freetext highlight (background rectangle + text).
 * Text is wrapped to fit within the box.
 */
export async function renderFreetextHighlight(
  page: PDFPage,
  highlight: ExportableHighlight,
  options: ExportPdfOptions,
  font: PDFFont
): Promise<void> {
  const text = highlight.content?.text || "";
  const textColor = parseColor(
    highlight.color || options.defaultFreetextColor || "#333333"
  );

  // Get box dimensions in PDF points
  const { x, y, width, height } = scaledToPdfPoints(
    highlight.position.boundingRect,
    page
  );

  // Scale font size by the same ratio used for the box coordinates
  // This ensures the font scales proportionally with the box
  const pdfHeight = page.getHeight();
  const yRatio = pdfHeight / highlight.position.boundingRect.height;
  const storedFontSize =
    parseInt(highlight.fontSize || "") || options.defaultFreetextFontSize || 14;
  const fontSize = storedFontSize * yRatio;

  // Draw background (skip if transparent)
  const bgColorValue = highlight.backgroundColor || options.defaultFreetextBgColor || "#ffffc8";
  if (bgColorValue !== "transparent") {
    const bgColor = parseColor(bgColorValue);
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(bgColor.r, bgColor.g, bgColor.b),
      opacity: bgColor.a,
    });
  }

  // Draw wrapped text with scaled padding
  const padding = 4 * yRatio;
  const maxWidth = width - padding * 2;
  const lineHeight = fontSize * 1.3;

  if (maxWidth > 0 && text) {
    const lines = wrapText(text, font, fontSize, maxWidth);
    let currentY = y + height - fontSize - padding;

    for (const line of lines) {
      // Stop if we've run out of vertical space
      if (currentY < y + padding) break;

      // Skip empty lines but still move down
      if (line.trim()) {
        page.drawText(line, {
          x: x + padding,
          y: currentY,
          size: fontSize,
          font,
          color: rgb(textColor.r, textColor.g, textColor.b),
        });
      }

      currentY -= lineHeight;
    }
  }
}

/**
 * Render an image highlight (embedded image).
 * Handles page rotation by transforming visual coordinates to raw MediaBox space.
 * Image fills the entire bounding box to match the visual wrapper in preview.
 */
export async function renderImageHighlight(
  pdfDoc: PDFDocument,
  page: PDFPage,
  highlight: ExportableHighlight
): Promise<void> {
  const imageDataUrl = highlight.content?.image;
  if (!imageDataUrl) return;

  try {
    const { bytes, type } = dataUrlToBytes(imageDataUrl);
    const image =
      type === "png"
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

    // Calculate coordinates in visual space - use full bounding box dimensions
    const visualCoords = scaledToPdfPoints(
      highlight.position.boundingRect,
      page
    );

    // Transform to raw MediaBox coordinates based on page rotation
    const rawCoords = transformToRawCoordinates(
      page,
      visualCoords.x,
      visualCoords.y,
      visualCoords.width,
      visualCoords.height
    );

    // Draw image filling the entire bounding box
    page.drawImage(image, {
      x: rawCoords.x,
      y: rawCoords.y,
      width: rawCoords.width,
      height: rawCoords.height,
    });
  } catch (error) {
    console.error("Failed to embed image:", error);
  }
}

/**
 * Render a shape highlight (rectangle, circle, or arrow).
 */
export async function renderShapeHighlight(
  page: PDFPage,
  highlight: ExportableHighlight
): Promise<void> {
  // Get shape data from content or top-level properties
  const shapeType = highlight.content?.shape?.shapeType || highlight.shapeType || "rectangle";
  const strokeColorStr = highlight.content?.shape?.strokeColor || highlight.strokeColor || "#000000";
  const strokeWidth = highlight.content?.shape?.strokeWidth || highlight.strokeWidth || 2;

  const color = parseColor(strokeColorStr);
  const { x, y, width, height } = scaledToPdfPoints(
    highlight.position.boundingRect,
    page
  );

  switch (shapeType) {
    case "rectangle":
      page.drawRectangle({
        x,
        y,
        width,
        height,
        borderColor: rgb(color.r, color.g, color.b),
        borderWidth: strokeWidth,
        opacity: color.a,
      });
      break;

    case "circle":
      page.drawEllipse({
        x: x + width / 2,
        y: y + height / 2,
        xScale: width / 2,
        yScale: height / 2,
        borderColor: rgb(color.r, color.g, color.b),
        borderWidth: strokeWidth,
        opacity: color.a,
      });
      break;

    case "arrow": {
      // Use stored start/end points if available, otherwise default to left-to-right
      const startPt = highlight.content?.shape?.startPoint;
      const endPt = highlight.content?.shape?.endPoint;

      // Calculate actual coordinates
      // Note: PDF coordinates have Y going up, so we need to flip the Y
      const startX = startPt ? x + startPt.x * width : x;
      const startY = startPt ? y + (1 - startPt.y) * height : y + height / 2;
      const endX = endPt ? x + endPt.x * width : x + width;
      const endY = endPt ? y + (1 - endPt.y) * height : y + height / 2;

      // Draw the main line
      page.drawLine({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        color: rgb(color.r, color.g, color.b),
        thickness: strokeWidth,
        opacity: color.a,
      });

      // Calculate arrowhead direction
      const angle = Math.atan2(endY - startY, endX - startX);
      const arrowSize = Math.min(15, width * 0.2, height * 0.4);
      const arrowAngle = Math.PI / 6; // 30 degrees

      // Draw arrowhead (two lines forming a V at the end)
      page.drawLine({
        start: {
          x: endX - arrowSize * Math.cos(angle - arrowAngle),
          y: endY - arrowSize * Math.sin(angle - arrowAngle),
        },
        end: { x: endX, y: endY },
        color: rgb(color.r, color.g, color.b),
        thickness: strokeWidth,
        opacity: color.a,
      });
      page.drawLine({
        start: {
          x: endX - arrowSize * Math.cos(angle + arrowAngle),
          y: endY - arrowSize * Math.sin(angle + arrowAngle),
        },
        end: { x: endX, y: endY },
        color: rgb(color.r, color.g, color.b),
        thickness: strokeWidth,
        opacity: color.a,
      });
      break;
    }
  }
}
