import {
  CSSProperties,
  MouseEvent,
  ReactNode,
  useState,
} from "react";
import { Rnd } from "react-rnd";
import { getPageFromElement } from "../lib/pdfjs-dom";
import type { LTWHP, ShapeType, ViewportHighlight } from "../types";
import {
  DefaultStyleIcon,
  DefaultDeleteIcon,
  DEFAULT_COLOR_PRESETS,
  renderShape,
  ShapeStylePanel,
} from "./ShapeRenderers";

/**
 * Style options for shape highlight appearance.
 */
export interface ShapeStyle {
  strokeColor?: string;
  strokeWidth?: number;
}

/**
 * The props type for {@link ShapeHighlight}.
 *
 * @category Component Properties
 */
export interface ShapeHighlightProps {
  highlight: ViewportHighlight;
  onChange?(rect: LTWHP): void;
  isScrolledTo?: boolean;
  bounds?: string | Element;
  onContextMenu?(event: MouseEvent<HTMLDivElement>): void;
  onEditStart?(): void;
  onEditEnd?(): void;
  style?: CSSProperties;
  shapeType?: ShapeType;
  strokeColor?: string;
  strokeWidth?: number;
  onStyleChange?(style: ShapeStyle): void;
  onDelete?(): void;
  styleIcon?: ReactNode;
  deleteIcon?: ReactNode;
  colorPresets?: string[];
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
}

/**
 * Renders a draggable, resizable shape annotation.
 * Supports rectangle, circle/ellipse, and arrow shapes.
 *
 * @category Component
 */
export const ShapeHighlight = ({
  highlight,
  onChange,
  isScrolledTo,
  bounds,
  onContextMenu,
  onEditStart,
  onEditEnd,
  style,
  shapeType = "rectangle",
  strokeColor = "#000000",
  strokeWidth = 2,
  onStyleChange,
  onDelete,
  styleIcon,
  deleteIcon,
  colorPresets = DEFAULT_COLOR_PRESETS,
  startPoint,
  endPoint,
}: ShapeHighlightProps) => {
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const highlightClass = isScrolledTo ? "ShapeHighlight--scrolledTo" : "";

  const { left, top, width: bWidth, height: bHeight } = highlight.position.boundingRect;

  // Generate key based on position for Rnd remount on position changes
  const key = `${bWidth}-${bHeight}-${left}-${top}`;

  // Generate unique ID for SVG markers
  const markerId = `arrowhead-${highlight.id}`;

  return (
    <div
      className={`ShapeHighlight ${highlightClass}`}
      onContextMenu={onContextMenu}
      style={{ left, top, width: bWidth || 100, height: bHeight || 100 }}
    >
      {/* Toolbar wrapper - extends down to overlap with shape */}
      {(onStyleChange || onDelete) && (
        <div
          className="ShapeHighlight__toolbar-wrapper"
          style={{
            position: "absolute",
            left: 0,
            top: -28,
            paddingBottom: 12,
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div
            className={`ShapeHighlight__toolbar ${isHovered || isStylePanelOpen ? "ShapeHighlight__toolbar--visible" : ""}`}
          >
            {onStyleChange && (
              <button
                className="ShapeHighlight__style-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsStylePanelOpen(!isStylePanelOpen);
                }}
                title="Change style"
                type="button"
              >
                {styleIcon || <DefaultStyleIcon />}
              </button>
            )}
            {onDelete && (
              <button
                className="ShapeHighlight__delete-button"
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

          {/* Style Panel - inside wrapper */}
          {onStyleChange && (
            <ShapeStylePanel
              isOpen={isStylePanelOpen}
              onClose={() => setIsStylePanelOpen(false)}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              colorPresets={colorPresets}
              onStyleChange={onStyleChange}
            />
          )}
        </div>
      )}

      <Rnd
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="ShapeHighlight__rnd"
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
          width: bWidth || 100,
          height: bHeight || 100,
        }}
        minWidth={20}
        minHeight={20}
        key={key}
        bounds={bounds}
        lockAspectRatio={shapeType === "circle"}
        onClick={(event: Event) => {
          event.stopPropagation();
          event.preventDefault();
        }}
        style={style}
      >
        <div className="ShapeHighlight__container">
          {renderShape(
            shapeType,
            bWidth || 100,
            bHeight || 100,
            strokeColor,
            strokeWidth,
            markerId,
            startPoint,
            endPoint,
          )}
        </div>
      </Rnd>
    </div>
  );
};
