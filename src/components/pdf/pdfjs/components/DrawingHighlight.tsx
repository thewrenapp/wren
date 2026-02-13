import { CSSProperties, MouseEvent, ReactNode, useState, useCallback, useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import { getPageFromElement } from "../lib/pdfjs-dom";
import type { DrawingStroke, LTWHP, ViewportHighlight } from "../types";

// Drawing style presets (matches PDFToolbar STROKE_COLORS)
const DRAWING_COLORS = ["#000000", "#EF4444", "#3B82F6", "#22C55E", "#A855F7", "#F97316"];
const STROKE_WIDTHS = [
  { label: "Thin", value: 1 },
  { label: "Medium", value: 3 },
  { label: "Thick", value: 5 },
];

/**
 * The props type for {@link DrawingHighlight}.
 *
 * @category Component Properties
 */
export interface DrawingHighlightProps {
  /**
   * The highlight to be rendered as a {@link DrawingHighlight}.
   * The highlight.content.image should contain the drawing as a PNG data URL.
   */
  highlight: ViewportHighlight;

  /**
   * A callback triggered whenever the highlight position or size changes.
   *
   * @param rect - The updated highlight area.
   */
  onChange?(rect: LTWHP): void;

  /**
   * Has the highlight been auto-scrolled into view?
   */
  isScrolledTo?: boolean;

  /**
   * react-rnd bounds on the highlight area.
   */
  bounds?: string | Element;

  /**
   * A callback triggered on context menu.
   */
  onContextMenu?(event: MouseEvent<HTMLDivElement>): void;

  /**
   * Event called when editing begins (drag or resize).
   */
  onEditStart?(): void;

  /**
   * Event called when editing ends.
   */
  onEditEnd?(): void;

  /**
   * Custom styling for the container.
   */
  style?: CSSProperties;

  /**
   * Custom drag icon. Replaces the default 6-dot grid icon.
   */
  dragIcon?: ReactNode;

  /**
   * Callback when drawing style changes (color or stroke width).
   * The newImage is the re-rendered PNG data URL with updated styles.
   * The newStrokes contain the updated stroke data.
   */
  onStyleChange?(newImage: string, newStrokes: DrawingStroke[]): void;

  /**
   * Callback triggered when the delete button is clicked.
   */
  onDelete?(): void;

  /**
   * Custom delete icon. Replaces the default trash icon.
   */
  deleteIcon?: ReactNode;
}

/**
 * Default drag icon - 6 dot grid pattern.
 */
const DefaultDragIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="8" cy="6" r="2" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="16" cy="12" r="2" />
    <circle cx="8" cy="18" r="2" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);

const DefaultDeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

/**
 * Re-render strokes to a canvas and return as PNG data URL.
 * Strokes are stored as normalized percentages (0-1) relative to bounding box.
 * Backward compatibility: old strokes stored as pixel offsets (values > 1.0)
 * are auto-detected and scaled to fit the current container.
 */
const renderStrokesToImage = (
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

/**
 * Renders a draggable, resizable freehand drawing annotation.
 * Drawings are stored as PNG images with transparent backgrounds.
 *
 * @category Component
 */
export const DrawingHighlight = ({
  highlight,
  onChange,
  isScrolledTo,
  bounds,
  onContextMenu,
  onEditStart,
  onEditEnd,
  style,
  dragIcon,
  onStyleChange,
  onDelete,
  deleteIcon,
}: DrawingHighlightProps) => {
  const highlightClass = isScrolledTo ? "DrawingHighlight--scrolledTo" : "";
  const [showStyleControls, setShowStyleControls] = useState(false);
  const styleControlsRef = useRef<HTMLDivElement>(null);

  // Close style controls when clicking outside
  useEffect(() => {
    if (!showStyleControls) return;

    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (styleControlsRef.current && !styleControlsRef.current.contains(e.target as Node)) {
        setShowStyleControls(false);
      }
    };

    // Delay adding listener to avoid immediate close
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showStyleControls]);

  const { left, top, width: bWidth, height: bHeight } = highlight.position.boundingRect;

  // Generate key based on position for Rnd remount on position changes
  const key = `${bWidth}-${bHeight}-${left}-${top}`;

  const imageUrl = highlight.content?.image;
  const strokes = highlight.content?.strokes;

  // Apply new color to all strokes
  const handleColorChange = useCallback((newColor: string) => {
    if (!strokes || !onStyleChange) return;

    const newStrokes = strokes.map((stroke) => ({
      ...stroke,
      color: newColor,
    }));

    const newImage = renderStrokesToImage(
      newStrokes,
      highlight.position.boundingRect.width,
      highlight.position.boundingRect.height
    );

    onStyleChange(newImage, newStrokes);
  }, [strokes, onStyleChange, highlight.position.boundingRect.width, highlight.position.boundingRect.height]);

  // Apply new width to all strokes
  const handleWidthChange = useCallback((newWidth: number) => {
    if (!strokes || !onStyleChange) return;

    const newStrokes = strokes.map((stroke) => ({
      ...stroke,
      width: newWidth,
    }));

    const newImage = renderStrokesToImage(
      newStrokes,
      highlight.position.boundingRect.width,
      highlight.position.boundingRect.height
    );

    onStyleChange(newImage, newStrokes);
  }, [strokes, onStyleChange, highlight.position.boundingRect.width, highlight.position.boundingRect.height]);

  // Get current color from first stroke (for showing active state)
  const currentColor = strokes?.[0]?.color || "#000000";
  const currentWidth = strokes?.[0]?.width || 3;

  return (
    <div
      className={`DrawingHighlight ${highlightClass}`}
      onContextMenu={onContextMenu}
      style={{ left, top, width: bWidth || 150, height: bHeight || 100 }}
    >
      <Rnd
        className="DrawingHighlight__rnd"
        onDragStop={(_, data) => {
          const boundingRect: LTWHP = {
            ...highlight.position.boundingRect,
            top: top + data.y,
            left: left + data.x,
          };
          onChange?.(boundingRect);
          onEditEnd?.();
        }}
        onDragStart={onEditStart}
        onResizeStop={(_e, _direction, ref, _delta, position) => {
          const boundingRect: LTWHP = {
            top: top + position.y,
            left: left + position.x,
            width: ref.offsetWidth,
            height: ref.offsetHeight,
            pageNumber:
              getPageFromElement(ref)?.number ||
              highlight.position.boundingRect.pageNumber,
          };
          onChange?.(boundingRect);
          onEditEnd?.();
        }}
        onResizeStart={onEditStart}
        default={{
          x: 0,
          y: 0,
          width: bWidth || 150,
          height: bHeight || 100,
        }}
        minWidth={30}
        minHeight={30}
        key={key}
        bounds={bounds}
        // No aspect ratio lock for drawings - allow free resizing
        lockAspectRatio={false}
        dragHandleClassName="DrawingHighlight__drag-handle"
        onClick={(event: Event) => {
          event.stopPropagation();
          event.preventDefault();
        }}
        style={style}
      >
        <div className="DrawingHighlight__container">
          <div className="DrawingHighlight__toolbar">
            <div className="DrawingHighlight__drag-handle" title="Drag to move">
              {dragIcon || <DefaultDragIcon />}
            </div>
            {/* Style edit button - only show if strokes are available */}
            {strokes && strokes.length > 0 && onStyleChange && (
              <button
                type="button"
                className="DrawingHighlight__style-button"
                title="Edit style"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowStyleControls(!showStyleControls);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                className="DrawingHighlight__delete-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="Delete"
                type="button"
              >
                {deleteIcon || <DefaultDeleteIcon />}
              </button>
            )}
          </div>
          {/* Style controls dropdown */}
          {showStyleControls && strokes && strokes.length > 0 && onStyleChange && (
            <div className="DrawingHighlight__style-controls" ref={styleControlsRef}>
              <div className="DrawingHighlight__color-picker">
                {DRAWING_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`DrawingHighlight__color-button ${currentColor === color ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleColorChange(color);
                    }}
                    title={`Color: ${color}`}
                  />
                ))}
              </div>
              <div className="DrawingHighlight__width-picker">
                {STROKE_WIDTHS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    className={`DrawingHighlight__width-button ${currentWidth === w.value ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleWidthChange(w.value);
                    }}
                    title={w.label}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="DrawingHighlight__content">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Drawing"
                className="DrawingHighlight__image"
                draggable={false}
              />
            ) : (
              <div className="DrawingHighlight__placeholder">No drawing</div>
            )}
          </div>
        </div>
      </Rnd>
    </div>
  );
};
