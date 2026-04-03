import { useRef, useEffect } from "react";
import type { FreetextStyle } from "./FreetextHighlight";

interface FreetextStylePanelProps {
  isOpen: boolean;
  onClose: () => void;
  backgroundColor: string;
  color: string;
  fontSize: string;
  fontFamily: string;
  backgroundColorPresets: string[];
  textColorPresets: string[];
  onStyleChange?: (style: FreetextStyle) => void;
}

export const FreetextStylePanel = ({
  isOpen,
  onClose,
  backgroundColor,
  color,
  fontSize,
  fontFamily,
  backgroundColorPresets,
  textColorPresets,
  onStyleChange,
}: FreetextStylePanelProps) => {
  const stylePanelRef = useRef<HTMLDivElement>(null);

  // Close style panel when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (stylePanelRef.current && !stylePanelRef.current.contains(e.target as Node)) {
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
      className="FreetextHighlight__style-panel"
      ref={stylePanelRef}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="FreetextHighlight__style-row">
        <label>Background</label>
        <div className="FreetextHighlight__color-options">
          <div className="FreetextHighlight__color-presets">
            {backgroundColorPresets.map((c) => (
              <button
                key={c}
                type="button"
                className={`FreetextHighlight__color-preset ${c === "transparent" ? "FreetextHighlight__color-preset--transparent" : ""} ${backgroundColor === c ? "active" : ""}`}
                style={c !== "transparent" ? { backgroundColor: c } : undefined}
                onClick={() => onStyleChange?.({ backgroundColor: c })}
                title={c === "transparent" ? "No background" : c}
              />
            ))}
          </div>
          <input
            type="color"
            value={backgroundColor === "transparent" ? "#ffffff" : backgroundColor}
            onChange={(e) => {
              onStyleChange?.({ backgroundColor: e.target.value });
            }}
          />
        </div>
      </div>
      <div className="FreetextHighlight__style-row">
        <label>Text Color</label>
        <div className="FreetextHighlight__color-options">
          <div className="FreetextHighlight__color-presets">
            {textColorPresets.map((c) => (
              <button
                key={c}
                type="button"
                className={`FreetextHighlight__color-preset ${color === c ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => onStyleChange?.({ color: c })}
                title={c}
              />
            ))}
          </div>
          <input
            type="color"
            value={color}
            onChange={(e) => {
              onStyleChange?.({ color: e.target.value });
            }}
          />
        </div>
      </div>
      <div className="FreetextHighlight__style-row">
        <label>Font Size</label>
        <select
          value={fontSize}
          onChange={(e) => {
            onStyleChange?.({ fontSize: e.target.value });
          }}
        >
          <option value="10px">10px</option>
          <option value="12px">12px</option>
          <option value="14px">14px</option>
          <option value="16px">16px</option>
          <option value="18px">18px</option>
          <option value="20px">20px</option>
          <option value="24px">24px</option>
        </select>
      </div>
      <div className="FreetextHighlight__style-row">
        <label>Font</label>
        <select
          value={fontFamily}
          onChange={(e) => {
            onStyleChange?.({ fontFamily: e.target.value });
          }}
        >
          <option value="inherit">Default</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Courier New', monospace">Courier</option>
          <option value="'Times New Roman', serif">Times</option>
        </select>
      </div>
    </div>
  );
};
