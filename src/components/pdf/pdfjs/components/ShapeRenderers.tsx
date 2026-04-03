import { useRef, useEffect } from "react";
import type { ShapeType } from "../types";
import type { ShapeStyle } from "./ShapeHighlight";

// Default icons
export const DefaultStyleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
  </svg>
);

export const DefaultDeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

// Default color presets for shapes (matches PDFToolbar STROKE_COLORS)
export const DEFAULT_COLOR_PRESETS = [
  "#000000", // Black
  "#EF4444", // Red
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#A855F7", // Purple
  "#F97316", // Orange
];

// Stroke width options
export const STROKE_WIDTHS = [
  { label: "Thin", value: 1 },
  { label: "Medium", value: 2 },
  { label: "Thick", value: 4 },
];

/**
 * Render the SVG shape for a given shape type.
 */
export const renderShape = (
  shapeType: ShapeType,
  width: number,
  height: number,
  strokeColor: string,
  strokeWidth: number,
  markerId: string,
  startPoint?: { x: number; y: number },
  endPoint?: { x: number; y: number },
) => {
  switch (shapeType) {
    case "rectangle":
      return (
        <svg
          className="ShapeHighlight__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={width - strokeWidth}
            height={height - strokeWidth}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
        </svg>
      );
    case "circle":
      return (
        <svg
          className="ShapeHighlight__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={width / 2 - strokeWidth / 2}
            ry={height / 2 - strokeWidth / 2}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
        </svg>
      );
    case "arrow": {
      // Use stored start/end points if available, otherwise default to left-to-right
      const x1 = startPoint ? startPoint.x * width : strokeWidth;
      const y1 = startPoint ? startPoint.y * height : height / 2;
      const x2 = endPoint ? endPoint.x * width : width - strokeWidth - 10;
      const y2 = endPoint ? endPoint.y * height : height / 2;

      return (
        <svg
          className="ShapeHighlight__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <marker
              id={markerId}
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
            </marker>
          </defs>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            markerEnd={`url(#${markerId})`}
          />
        </svg>
      );
    }
    default:
      return null;
  }
};

interface ShapeStylePanelProps {
  isOpen: boolean;
  onClose: () => void;
  strokeColor: string;
  strokeWidth: number;
  colorPresets: string[];
  onStyleChange: (style: ShapeStyle) => void;
}

export const ShapeStylePanel = ({
  isOpen,
  onClose,
  strokeColor,
  strokeWidth,
  colorPresets,
  onStyleChange,
}: ShapeStylePanelProps) => {
  const stylePanelRef = useRef<HTMLDivElement>(null);

  // Close style panel when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (
        stylePanelRef.current &&
        !stylePanelRef.current.contains(e.target as Node)
      ) {
        onClose();
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="ShapeHighlight__style-panel"
      ref={stylePanelRef}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ShapeHighlight__style-row">
        <label>Color</label>
        <div className="ShapeHighlight__color-options">
          <div className="ShapeHighlight__color-presets">
            {colorPresets.map((c) => (
              <button
                key={c}
                type="button"
                className={`ShapeHighlight__color-preset ${strokeColor === c ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => onStyleChange({ strokeColor: c })}
                title={c}
              />
            ))}
          </div>
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => {
              onStyleChange({ strokeColor: e.target.value });
            }}
          />
        </div>
      </div>
      <div className="ShapeHighlight__style-row">
        <label>Width</label>
        <div className="ShapeHighlight__width-options">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w.value}
              type="button"
              className={`ShapeHighlight__width-button ${strokeWidth === w.value ? "active" : ""}`}
              onClick={() => onStyleChange({ strokeWidth: w.value })}
              title={w.label}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
