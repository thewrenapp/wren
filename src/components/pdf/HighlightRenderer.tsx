import {
  TextHighlight,
  AreaHighlight,
  FreetextHighlight,
  DrawingHighlight,
  ShapeHighlight,
  MonitoredHighlightContainer,
  useHighlightContainerContext,
  usePdfHighlighterContext,
  type Tip,
} from "@/components/pdf/pdfjs";

import { HighlightPopup } from "./HighlightPopup";
import {
  type AppHighlight,
  DEFAULT_TEXT_HIGHLIGHT_COLOR,
  DEFAULT_AREA_HIGHLIGHT_COLOR,
} from "./usePDFAnnotations";

export interface HighlightRendererProps {
  onColorChange: (highlightId: string, color: string) => void;
  onDelete: (highlightId: string) => void;
  onEdit: (highlightId: string, edit: Partial<AppHighlight>) => void;
  isEditable: boolean;
  showTipEnabled: boolean;
  selectionRects: DOMRect[];
}

export function HighlightRenderer({
  onColorChange,
  onDelete,
  onEdit,
  isEditable,
  showTipEnabled: _showTipEnabled,
  selectionRects: _selectionRects,
}: HighlightRendererProps) {
  const { highlight, viewportToPdfScaled, screenshot, isScrolledTo, highlightBindings, zoomScale } =
    useHighlightContainerContext<AppHighlight>();
  const { toggleEditInProgress } = usePdfHighlighterContext();
  let component;

  if (highlight.type === "text") {
    component = (
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.highlightColor || DEFAULT_TEXT_HIGHLIGHT_COLOR}
        highlightStyle={"highlight"}
      />
    );
  } else if (highlight.type === "freetext") {
    const baseFontSize = parseFloat(highlight.fontSize || "14");
    const scaledFontSize = `${Math.round(baseFontSize * zoomScale)}px`;
    component = (
      <FreetextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={highlightBindings.textLayer}
        color={highlight.color}
        backgroundColor={highlight.backgroundColor}
        fontSize={scaledFontSize}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
          });
          toggleEditInProgress(false);
        }}
        onTextChange={(newText) => {
          onEdit(highlight.id, { content: { text: newText } });
        }}
        onStyleChange={isEditable ? (style) => {
          onEdit(highlight.id, {
            ...(style.color !== undefined && { color: style.color }),
            ...(style.backgroundColor !== undefined && { backgroundColor: style.backgroundColor }),
            ...(style.fontSize !== undefined && { fontSize: style.fontSize }),
            ...(style.fontFamily !== undefined && { fontFamily: style.fontFamily }),
          });
        } : undefined}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onEditEnd={isEditable ? () => toggleEditInProgress(false) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
      />
    );
  } else if (highlight.type === "drawing") {
    component = (
      <DrawingHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={highlightBindings.textLayer}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
          });
        }}
        onStyleChange={(newImage, newStrokes) => {
          onEdit(highlight.id, {
            content: { image: newImage, strokes: newStrokes },
          });
        }}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onEditEnd={isEditable ? () => toggleEditInProgress(false) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
      />
    );
  } else if (highlight.type === "shape") {
    component = (
      <ShapeHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        bounds={highlightBindings.textLayer}
        shapeType={highlight.shapeType || "rectangle"}
        strokeColor={highlight.strokeColor || "#000000"}
        strokeWidth={highlight.strokeWidth || 2}
        startPoint={highlight.content?.shape?.startPoint}
        endPoint={highlight.content?.shape?.endPoint}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
          });
        }}
        onStyleChange={isEditable ? (style) => {
          onEdit(highlight.id, {
            ...(style.strokeColor !== undefined && { strokeColor: style.strokeColor }),
            ...(style.strokeWidth !== undefined && { strokeWidth: style.strokeWidth }),
          });
        } : undefined}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onEditEnd={isEditable ? () => toggleEditInProgress(false) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
      />
    );
  } else {
    component = (
      <AreaHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        highlightColor={highlight.highlightColor || DEFAULT_AREA_HIGHLIGHT_COLOR}
        bounds={highlightBindings.textLayer}
        onChange={(boundingRect) => {
          onEdit(highlight.id, {
            position: {
              boundingRect: viewportToPdfScaled(boundingRect),
              rects: [],
              usePdfCoordinates: true,
            },
            content: { image: screenshot(boundingRect) },
          });
          toggleEditInProgress(false);
        }}
        onEditStart={isEditable ? () => toggleEditInProgress(true) : undefined}
        onDelete={isEditable ? () => onDelete(highlight.id) : undefined}
      />
    );
  }

  const showTip = highlight.type === "text" || highlight.type === "area" || highlight.type === "shape";

  const SHAPE_COLORS = [
    { name: "Black", value: "#000000" },
    { name: "Red", value: "#EF4444" },
    { name: "Blue", value: "#3B82F6" },
    { name: "Green", value: "#22C55E" },
    { name: "Purple", value: "#A855F7" },
    { name: "Orange", value: "#F97316" },
  ];

  const highlightTip: Tip = {
    position: highlight.position,
    content: showTip ? (
      <HighlightPopup
        currentColor={
          highlight.type === "shape"
            ? highlight.strokeColor || "#000000"
            : highlight.highlightColor ||
              (highlight.type === "area"
                ? DEFAULT_AREA_HIGHLIGHT_COLOR
                : DEFAULT_TEXT_HIGHLIGHT_COLOR)
        }
        colors={highlight.type === "shape" ? SHAPE_COLORS : undefined}
        onColorChange={(newColor) => {
          if (highlight.type === "shape") {
            onEdit(highlight.id, { strokeColor: newColor });
          } else {
            onColorChange(highlight.id, newColor);
          }
        }}
        onDelete={() => onDelete(highlight.id)}
      />
    ) : null,
  };

  return (
    <MonitoredHighlightContainer
      highlightTip={showTip ? highlightTip : undefined}
      key={highlight.id}
    >
      {component}
    </MonitoredHighlightContainer>
  );
}
