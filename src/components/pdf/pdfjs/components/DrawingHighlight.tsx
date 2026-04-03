import { CSSProperties, MouseEvent, ReactNode, useState, useCallback, useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import { getPageFromElement } from "../lib/pdfjs-dom";
import type { DrawingStroke, LTWHP, ViewportHighlight } from "../types";
import { DRAWING_COLORS, STROKE_WIDTHS, renderStrokesToImage } from "./DrawingHighlightUtils";

/**
 * The props type for {@link DrawingHighlight}.
 *
 * @category Component Properties
 */
export interface DrawingHighlightProps {
  highlight: ViewportHighlight;
  onChange?(rect: LTWHP): void;
  isScrolledTo?: boolean;
  bounds?: string | Element;
  onContextMenu?(event: MouseEvent<HTMLDivElement>): void;
  onEditStart?(): void;
  onEditEnd?(): void;
  style?: CSSProperties;
  dragIcon?: ReactNode;
  onStyleChange?(newImage: string, newStrokes: DrawingStroke[]): void;
  onDelete?(): void;
  deleteIcon?: ReactNode;
}

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

    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showStyleControls]);

  const { left, top, width: bWidth, height: bHeight } = highlight.position.boundingRect;
  const key = `${bWidth}-${bHeight}-${left}-${top}`;
  const imageUrl = highlight.content?.image;
  const strokes = highlight.content?.strokes;

  const handleColorChange = useCallback((newColor: string) => {
    if (!strokes || !onStyleChange) return;
    const newStrokes = strokes.map((stroke) => ({ ...stroke, color: newColor }));
    const newImage = renderStrokesToImage(newStrokes, highlight.position.boundingRect.width, highlight.position.boundingRect.height);
    onStyleChange(newImage, newStrokes);
  }, [strokes, onStyleChange, highlight.position.boundingRect.width, highlight.position.boundingRect.height]);

  const handleWidthChange = useCallback((newWidth: number) => {
    if (!strokes || !onStyleChange) return;
    const newStrokes = strokes.map((stroke) => ({ ...stroke, width: newWidth }));
    const newImage = renderStrokesToImage(newStrokes, highlight.position.boundingRect.width, highlight.position.boundingRect.height);
    onStyleChange(newImage, newStrokes);
  }, [strokes, onStyleChange, highlight.position.boundingRect.width, highlight.position.boundingRect.height]);

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
        default={{ x: 0, y: 0, width: bWidth || 150, height: bHeight || 100 }}
        minWidth={30}
        minHeight={30}
        key={key}
        bounds={bounds}
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
          {showStyleControls && strokes && strokes.length > 0 && onStyleChange && (
            <div className="DrawingHighlight__style-controls" ref={styleControlsRef}>
              <div className="DrawingHighlight__color-picker">
                {DRAWING_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`DrawingHighlight__color-button ${currentColor === c ? 'active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={(e) => { e.stopPropagation(); handleColorChange(c); }}
                    title={`Color: ${c}`}
                  />
                ))}
              </div>
              <div className="DrawingHighlight__width-picker">
                {STROKE_WIDTHS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    className={`DrawingHighlight__width-button ${currentWidth === w.value ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleWidthChange(w.value); }}
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
