import {
  useRef,
  useEffect,
  useCallback,
  useState,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import { DrawingStroke, ScaledPosition } from "../types";
import type { PDFViewer as TPDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { findPageFromPoint, redrawAllStrokes, computeDrawingResult } from "./drawingCanvasUtils";

/**
 * The props type for {@link DrawingCanvas}.
 *
 * @category Component Properties
 */
export interface DrawingCanvasProps {
  isActive: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  viewer: InstanceType<typeof TPDFViewer>;
  onComplete: (dataUrl: string, position: ScaledPosition, strokes: DrawingStroke[]) => void;
  onCancel: () => void;
}

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
 * A transparent overlay canvas for freehand drawing on PDF pages.
 * Supports mouse and touch input.
 *
 * @category Component
 */
export const DrawingCanvas = ({
  isActive,
  strokeColor = "#000000",
  strokeWidth = 3,
  viewer,
  onComplete,
  onCancel,
}: DrawingCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [pageElement, setPageElement] = useState<HTMLElement | null>(null);
  const pageRectRef = useRef<DOMRect | null>(null);

  // Redraw when strokes change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      redrawAllStrokes(canvas, strokes, currentStroke);
    }
  }, [strokes, currentStroke]);

  // Handle mouse/touch down
  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      const pageInfo = findPageFromPoint(viewer, clientX, clientY);
      if (!pageInfo) return;

      // Set page context if not already set
      if (pageNumber === null) {
        setPageNumber(pageInfo.pageNumber);
        setPageElement(pageInfo.element);
        pageRectRef.current = pageInfo.rect;

        // Resize canvas to match page and align within the PDF viewer container
        const canvas = canvasRef.current;
        if (canvas) {
          const node = pageInfo.element;
          canvas.width = node.clientWidth;
          canvas.height = node.clientHeight;
          const container = viewer.container as HTMLElement | undefined;
          const containerRect = container ? container.getBoundingClientRect() : null;
          const scrollTop = container?.scrollTop || 0;
          const scrollLeft = container?.scrollLeft || 0;
          const left = containerRect ? pageInfo.rect.left - containerRect.left + scrollLeft : 0;
          const top = containerRect ? pageInfo.rect.top - containerRect.top + scrollTop : 0;
          canvas.style.left = `${left}px`;
          canvas.style.top = `${top}px`;

          void 0;
        }
      } else if (pageInfo.pageNumber !== pageNumber) {
        return;
      }

      isDrawingRef.current = true;
      const baseRect = pageRectRef.current;
      if (!baseRect) return;
      const pos = {
        x: clientX - baseRect.left,
        y: clientY - baseRect.top,
      };
      setCurrentStroke({ points: [pos], color: strokeColor, width: strokeWidth });
    },
    [pageNumber, viewer, strokeColor, strokeWidth]
  );

  // Handle mouse/touch move
  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDrawingRef.current) return;
      const rect = pageRectRef.current;
      if (!rect) return;
      const pos = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };

      setCurrentStroke((prev) => {
        if (!prev) return null;
        return { ...prev, points: [...prev.points, pos] };
      });
    },
    [pageElement]
  );

  // Handle mouse/touch end
  const handleEnd = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (currentStroke && currentStroke.points.length >= 2) {
      setStrokes((prev) => [...prev, currentStroke]);
    }
    setCurrentStroke(null);
  }, [currentStroke]);

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      handleStart(e.clientX, e.clientY);
    },
    [handleStart]
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      handleMove(e.clientX, e.clientY);
    },
    [handleMove]
  );

  const handleMouseUp = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  // Touch event handlers
  const handleTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      e.preventDefault();
      if (e.touches.length > 0) {
        handleStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    [handleStart]
  );

  const handleTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      e.preventDefault();
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    [handleMove]
  );

  const handleTouchEnd = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  // Handle keyboard events
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActive, onCancel]);

  // Clear drawing
  const handleClear = () => {
    setStrokes([]);
    setCurrentStroke(null);
    setPageNumber(null);
    setPageElement(null);
    pageRectRef.current = null;
  };

  // Complete drawing
  const handleDone = () => {
    if (strokes.length === 0 || pageNumber === null || !viewer) {
      onCancel();
      return;
    }

    const result = computeDrawingResult(strokes, pageNumber, viewer);
    if (!result) {
      onCancel();
      return;
    }

    onComplete(result.dataUrl, result.scaledPosition, result.normalizedStrokes);

    // Reset state
    setStrokes([]);
    setCurrentStroke(null);
    setPageNumber(null);
    setPageElement(null);
  };

  if (!isActive) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="DrawingCanvas"
        style={{
          width: pageElement ? pageElement.getBoundingClientRect().width : "100%",
          height: pageElement ? pageElement.getBoundingClientRect().height : "100%",
          position: "absolute",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      <div className="DrawingCanvas__hint">
        Free draw active. Press Escape to cancel.
      </div>
      <div className="DrawingCanvas__controls">
        <button
          type="button"
          className="DrawingCanvas__clearButton"
          onClick={handleClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="DrawingCanvas__cancelButton"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="DrawingCanvas__doneButton"
          onClick={handleDone}
        >
          Done
        </button>
      </div>
    </>
  );
};
