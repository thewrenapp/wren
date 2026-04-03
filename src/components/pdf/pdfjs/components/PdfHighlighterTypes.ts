import {
  CSSProperties,
  ReactNode,
} from "react";
import {
  PdfHighlighterUtils,
} from "../contexts/PdfHighlighterContext";
import {
  DrawingStroke,
  GhostHighlight,
  Highlight,
  PdfScaleValue,
  PdfSelection,
  ScaledPosition,
  ShapeData,
  ShapeType,
} from "../types";

export interface PdfHighlighterTheme {
  mode?: "light" | "dark";
  containerBackgroundColor?: string;
  scrollbarThumbColor?: string;
  scrollbarTrackColor?: string;
  darkModeInvertIntensity?: number;
}

export const defaultLightTheme: Required<PdfHighlighterTheme> = {
  mode: "light",
  containerBackgroundColor: "hsl(var(--muted))",
  scrollbarThumbColor: "hsl(var(--muted-foreground) / 0.3)",
  scrollbarTrackColor: "hsl(var(--border))",
  darkModeInvertIntensity: 0.9,
};

export const defaultDarkTheme: Required<PdfHighlighterTheme> = {
  mode: "dark",
  containerBackgroundColor: "hsl(var(--muted))",
  scrollbarThumbColor: "hsl(var(--muted-foreground) / 0.3)",
  scrollbarTrackColor: "hsl(var(--border))",
  darkModeInvertIntensity: 0.9,
};

export const SCROLL_MARGIN = 10;
export const DEFAULT_SCALE_VALUE = "auto";
export const DEFAULT_TEXT_SELECTION_COLOR = "rgba(153,193,218,255)";

export interface PdfHighlighterProps {
  highlights: Array<Highlight>;
  onScrollAway?(): void;
  pdfScaleValue?: PdfScaleValue;
  onSelection?(PdfSelection: PdfSelection): void;
  onCreateGhostHighlight?(ghostHighlight: GhostHighlight): void;
  onRemoveGhostHighlight?(ghostHighlight: GhostHighlight): void;
  selectionTip?: ReactNode;
  enableAreaSelection?(event: MouseEvent): boolean;
  areaSelectionMode?: boolean;
  mouseSelectionStyle?: CSSProperties;
  pdfDocument: import("pdfjs-dist").PDFDocumentProxy;
  children: ReactNode;
  textSelectionColor?: string;
  utilsRef(pdfHighlighterUtils: PdfHighlighterUtils): void;
  style?: CSSProperties;
  enableFreetextCreation?(event: MouseEvent): boolean;
  onFreetextClick?(position: ScaledPosition): void;
  enableImageCreation?(event: MouseEvent): boolean;
  onImageClick?(position: ScaledPosition): void;
  enableDrawingMode?: boolean;
  onDrawingComplete?(dataUrl: string, position: ScaledPosition, strokes: DrawingStroke[]): void;
  onDrawingCancel?(): void;
  drawingStrokeColor?: string;
  drawingStrokeWidth?: number;
  enableShapeMode?: ShapeType | null;
  onShapeComplete?(position: ScaledPosition, shape: ShapeData): void;
  onShapeCancel?(): void;
  shapeStrokeColor?: string;
  shapeStrokeWidth?: number;
  theme?: PdfHighlighterTheme;
}
