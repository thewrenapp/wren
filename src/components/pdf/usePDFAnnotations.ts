import { useState, useCallback, useRef, useEffect } from "react";
import {
  type GhostHighlight,
  type ScaledPosition,
  type DrawingStroke,
  type ShapeData,
} from "@/components/pdf/pdfjs";
import {
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from "@/services/tauri/commands";
import {
  type AppHighlight,
  type ToolMode,
  DEFAULT_TEXT_HIGHLIGHT_COLOR,
  DEFAULT_AREA_HIGHLIGHT_COLOR,
  convertAnnotationToHighlight,
} from "./pdfAnnotationUtils";

export type { AppHighlight, ToolMode };
export { DEFAULT_TEXT_HIGHLIGHT_COLOR, DEFAULT_AREA_HIGHLIGHT_COLOR };

interface UsePDFAnnotationsOptions {
  attachmentId: string;
  toolMode: ToolMode;
}

export function usePDFAnnotations({ attachmentId, toolMode }: UsePDFAnnotationsOptions) {
  const [highlights, setHighlights] = useState<AppHighlight[]>([]);
  const [highlightColor, setHighlightColor] = useState(DEFAULT_TEXT_HIGHLIGHT_COLOR);
  const [areaHighlightColor, setAreaHighlightColor] = useState(DEFAULT_AREA_HIGHLIGHT_COLOR);
  const [drawingColor, setDrawingColor] = useState("#000000");
  const [shapeColor, setShapeColor] = useState("#000000");

  const tempIdCounter = useRef(0);
  const getNextId = () => `temp-${Date.now()}-${++tempIdCounter.current}`;

  const loadAnnotations = useCallback(async () => {
    try {
      const annotations = await getAnnotations(parseInt(attachmentId, 10));
      const appHighlights = annotations.map(convertAnnotationToHighlight);
      setHighlights(appHighlights);
    } catch {
      // Failed to load annotations
    }
  }, [attachmentId]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { attachmentId: changedId } = (e as CustomEvent).detail;
      if (changedId === parseInt(attachmentId, 10)) {
        loadAnnotations();
      }
    };
    window.addEventListener("wren:annotations-changed", handler);
    return () => window.removeEventListener("wren:annotations-changed", handler);
  }, [attachmentId, loadAnnotations]);

  const handleSelection = useCallback(
    (selection: GhostHighlight & { makeGhostHighlight: () => GhostHighlight }) => {
      const { position, content, type } = selection;
      const tempId = getNextId();

      const isArea = type === "area" || toolMode === "area";
      const highlightType = isArea ? "area" : "text";
      const nextColor = isArea ? areaHighlightColor : highlightColor;

      const optimisticHighlight: AppHighlight = {
        id: tempId,
        type: highlightType,
        position,
        content,
        highlightColor: nextColor,
        selectedText: content?.text,
      };

      setHighlights((prev) => [...prev, optimisticHighlight]);

      (async () => {
        try {
          const annotation = await createAnnotation({
            attachmentId: parseInt(attachmentId, 10),
            annotationType: highlightType,
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: content?.text,
            color: nextColor,
          });

          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [attachmentId, areaHighlightColor, highlightColor, toolMode]
  );

  const handleFreetextClick = useCallback(
    (position: ScaledPosition) => {
      const tempId = getNextId();
      const newHighlight: AppHighlight = {
        id: tempId,
        type: "freetext",
        position,
        content: { text: "" },
        color: "#000000",
        backgroundColor: "#FFFFA5",
        fontSize: "14px",
      };
      setHighlights((prev) => [...prev, newHighlight]);

      (async () => {
        try {
          const annotation = await createAnnotation({
            attachmentId: parseInt(attachmentId, 10),
            annotationType: "freetext",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: "",
            color: JSON.stringify({ bg: "#FFFFA5", fg: "#000000", fs: "14px" }),
          });
          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [attachmentId]
  );

  const handleDrawingComplete = useCallback(
    (dataUrl: string, position: ScaledPosition, strokes: DrawingStroke[]) => {
      const tempId = getNextId();
      const newHighlight: AppHighlight = {
        id: tempId,
        type: "drawing",
        position,
        content: { image: dataUrl, strokes },
      };
      setHighlights((prev) => [...prev, newHighlight]);

      (async () => {
        try {
          const annotation = await createAnnotation({
            attachmentId: parseInt(attachmentId, 10),
            annotationType: "drawing",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: undefined,
            color: drawingColor,
            comment: JSON.stringify({ image: dataUrl, strokes }),
          });
          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [attachmentId, drawingColor]
  );

  const handleShapeComplete = useCallback(
    (position: ScaledPosition, shape: ShapeData) => {
      const tempId = getNextId();
      const newHighlight: AppHighlight = {
        id: tempId,
        type: "shape",
        position,
        content: { shape },
        shapeType: shape.shapeType,
        strokeColor: shape.strokeColor,
        strokeWidth: shape.strokeWidth,
      };
      setHighlights((prev) => [...prev, newHighlight]);

      (async () => {
        try {
          const annotation = await createAnnotation({
            attachmentId: parseInt(attachmentId, 10),
            annotationType: "shape",
            pageNumber: position.boundingRect.pageNumber,
            positionJson: JSON.stringify(position),
            selectedText: undefined,
            color: shape.strokeColor,
            comment: JSON.stringify(shape),
          });
          setHighlights((prev) =>
            prev.map((h) =>
              h.id === tempId ? { ...h, id: String(annotation.id) } : h
            )
          );
        } catch {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        }
      })();
    },
    [attachmentId]
  );

  const handleColorChange = useCallback(
    async (highlightId: string, newColor: string) => {
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === highlightId ? { ...h, highlightColor: newColor } : h
        )
      );

      if (highlightId.startsWith("temp-")) {
        return;
      }

      try {
        await updateAnnotation(parseInt(highlightId, 10), { color: newColor }, parseInt(attachmentId, 10));
      } catch {
        // Failed to update in DB
      }
    },
    [attachmentId]
  );

  const handleEdit = useCallback(
    async (highlightId: string, edit: Partial<AppHighlight>) => {
      setHighlights((prev) =>
        prev.map((h) => (h.id === highlightId ? { ...h, ...edit } : h))
      );

      if (highlightId.startsWith("temp-")) {
        return;
      }

      try {
        const updates: { positionJson?: string; comment?: string; color?: string } = {};
        if (edit.position) {
          updates.positionJson = JSON.stringify(edit.position);
        }
        if (edit.content?.text !== undefined) {
          updates.comment = edit.content.text;
        }
        if (edit.content?.image !== undefined || edit.content?.strokes !== undefined) {
          const current = highlights.find((h) => h.id === highlightId);
          if (current?.type === "drawing") {
            updates.comment = JSON.stringify({
              image: edit.content?.image ?? current.content?.image,
              strokes: edit.content?.strokes ?? current.content?.strokes,
            });
          }
        }
        if (edit.strokeColor !== undefined || edit.strokeWidth !== undefined) {
          const current = highlights.find((h) => h.id === highlightId);
          if (current?.type === "shape" && current.content?.shape) {
            const updatedShape = {
              ...current.content.shape,
              strokeColor: edit.strokeColor ?? current.strokeColor,
              strokeWidth: edit.strokeWidth ?? current.strokeWidth,
            };
            updates.comment = JSON.stringify(updatedShape);
            updates.color = updatedShape.strokeColor;
          }
        }
        if (edit.color !== undefined || edit.backgroundColor !== undefined || edit.fontSize !== undefined || edit.fontFamily !== undefined) {
          const current = highlights.find((h) => h.id === highlightId);
          if (current?.type === "freetext") {
            updates.color = JSON.stringify({
              bg: edit.backgroundColor ?? current.backgroundColor ?? "#FFFFA5",
              fg: edit.color ?? current.color ?? "#000000",
              fs: edit.fontSize ?? current.fontSize ?? "14px",
              ff: edit.fontFamily ?? current.fontFamily,
            });
          }
        }
        if (Object.keys(updates).length > 0) {
          await updateAnnotation(parseInt(highlightId, 10), updates, parseInt(attachmentId, 10));
        }
      } catch {
        // Failed to update
      }
    },
    [highlights, attachmentId]
  );

  const handleDelete = useCallback(async (highlightId: string) => {
    if (highlightId.startsWith("temp-")) {
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
      return;
    }

    try {
      await deleteAnnotation(parseInt(highlightId, 10), parseInt(attachmentId, 10));
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    } catch {
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    }
  }, [attachmentId]);

  return {
    highlights,
    highlightColor,
    setHighlightColor,
    areaHighlightColor,
    setAreaHighlightColor,
    drawingColor,
    setDrawingColor,
    shapeColor,
    setShapeColor,
    handleSelection,
    handleFreetextClick,
    handleDrawingComplete,
    handleShapeComplete,
    handleColorChange,
    handleEdit,
    handleDelete,
  };
}
