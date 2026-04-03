import type { ScaledPosition } from "@/components/pdf/pdfjs";
import type { Annotation } from "@/services/tauri/commands";
import type { AppHighlight } from "./usePDFAnnotations";

export const DEFAULT_TEXT_HIGHLIGHT_COLOR = "#FFE28F";
export const DEFAULT_AREA_HIGHLIGHT_COLOR = "#FFE28F";

export function convertAnnotationToHighlight(annotation: Annotation): AppHighlight {
  const position = JSON.parse(annotation.positionJson) as ScaledPosition;

  if (position.boundingRect && !position.boundingRect.width) {
    position.boundingRect.width = position.boundingRect.x2 - position.boundingRect.x1;
    position.boundingRect.height = position.boundingRect.y2 - position.boundingRect.y1;
  }
  if (position.rects) {
    position.rects = position.rects.map(rect => ({
      ...rect,
      width: rect.width || (rect.x2 - rect.x1),
      height: rect.height || (rect.y2 - rect.y1),
    }));
  }

  let highlightType = annotation.annotationType;
  if (highlightType === "highlight") {
    highlightType = "text";
  }

  if (highlightType === "drawing" && annotation.comment) {
    try {
      const drawingContent = JSON.parse(annotation.comment);
      return {
        id: String(annotation.id),
        type: "drawing" as AppHighlight["type"],
        position,
        content: { image: drawingContent.image, strokes: drawingContent.strokes },
        highlightColor: annotation.color,
      };
    } catch {
      // Fall through to default handling
    }
  }

  if (highlightType === "shape" && annotation.comment) {
    try {
      const shapeData = JSON.parse(annotation.comment);
      return {
        id: String(annotation.id),
        type: "shape" as AppHighlight["type"],
        position,
        content: { shape: shapeData },
        shapeType: shapeData.shapeType,
        strokeColor: shapeData.strokeColor,
        strokeWidth: shapeData.strokeWidth,
        highlightColor: annotation.color,
      };
    } catch {
      // Fall through to default handling
    }
  }

  const textContent = annotation.selectedText || annotation.comment || "";
  const fallbackColor =
    highlightType === "area" ? DEFAULT_AREA_HIGHLIGHT_COLOR : DEFAULT_TEXT_HIGHLIGHT_COLOR;

  if (highlightType === "freetext" && annotation.color?.startsWith("{")) {
    try {
      const style = JSON.parse(annotation.color);
      return {
        id: String(annotation.id),
        type: "freetext" as AppHighlight["type"],
        position,
        content: { text: textContent },
        backgroundColor: style.bg || "#FFFFA5",
        color: style.fg || "#000000",
        fontSize: style.fs || "14px",
        fontFamily: style.ff,
      };
    } catch {
      // Fall through to default
    }
  }

  return {
    id: String(annotation.id),
    type: highlightType as AppHighlight["type"],
    position,
    content: { text: textContent },
    highlightColor: annotation.color || fallbackColor,
    selectedText: textContent,
  };
}
