import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ScaledPosition, ShapeData } from "../types";
import { groupByPage } from "./export-pdf-utils";
import {
  renderTextHighlight,
  renderAreaHighlight,
  renderFreetextHighlight,
  renderImageHighlight,
  renderShapeHighlight,
} from "./export-pdf-renderers";

/**
 * Options for the PDF export function.
 *
 * @category Type
 */
export interface ExportPdfOptions {
  /** Default color for text highlights. Default: "rgba(255, 226, 143, 0.5)" */
  textHighlightColor?: string;
  /** Default color for area highlights. Default: "rgba(255, 226, 143, 0.5)" */
  areaHighlightColor?: string;
  /** Default text color for freetext. Default: "#333333" */
  defaultFreetextColor?: string;
  /** Default background for freetext. Default: "#ffffc8" */
  defaultFreetextBgColor?: string;
  /** Default font size for freetext. Default: 14 */
  defaultFreetextFontSize?: number;
  /** Progress callback for large PDFs */
  onProgress?: (current: number, total: number) => void;
}

/**
 * A highlight that can be exported to PDF.
 *
 * @category Type
 */
export interface ExportableHighlight {
  id: string;
  type?: "text" | "area" | "freetext" | "image" | "drawing" | "shape";
  content?: {
    text?: string;
    image?: string; // Base64 data URL
    shape?: ShapeData; // Shape data for shape highlights
  };
  position: ScaledPosition;
  /** Per-highlight color override (for text/area highlights) */
  highlightColor?: string;
  /** Style mode for text highlights: "highlight" (default), "underline", or "strikethrough" */
  highlightStyle?: "highlight" | "underline" | "strikethrough";
  /** Text color for freetext highlights */
  color?: string;
  /** Background color for freetext highlights */
  backgroundColor?: string;
  /** Font size for freetext highlights */
  fontSize?: string;
  /** Font family for freetext highlights (not used in export, Helvetica is always used) */
  fontFamily?: string;
  /** Shape type for shape highlights */
  shapeType?: "rectangle" | "circle" | "arrow";
  /** Stroke color for shape highlights */
  strokeColor?: string;
  /** Stroke width for shape highlights */
  strokeWidth?: number;
}

/**
 * Export a PDF with annotations embedded.
 *
 * @param pdfSource - The source PDF as a URL string, Uint8Array, or ArrayBuffer
 * @param highlights - Array of highlights to embed in the PDF
 * @param options - Export options for customizing colors and behavior
 * @returns Promise<Uint8Array> - The modified PDF as bytes
 *
 * @example
 * ```typescript
 * const pdfBytes = await exportPdf(pdfUrl, highlights, {
 *   textHighlightColor: "rgba(255, 255, 0, 0.4)",
 *   onProgress: (current, total) => console.log(`${current}/${total} pages`)
 * });
 *
 * // Download the file
 * const blob = new Blob([pdfBytes], { type: "application/pdf" });
 * const url = URL.createObjectURL(blob);
 * const a = document.createElement("a");
 * a.href = url;
 * a.download = "annotated.pdf";
 * a.click();
 * URL.revokeObjectURL(url);
 * ```
 *
 * @category Function
 */
export async function exportPdf(
  pdfSource: string | Uint8Array | ArrayBuffer,
  highlights: ExportableHighlight[],
  options: ExportPdfOptions = {}
): Promise<Uint8Array> {
  // Load PDF
  let pdfBytes: ArrayBuffer;
  if (typeof pdfSource === "string") {
    const response = await fetch(pdfSource);
    pdfBytes = await response.arrayBuffer();
  } else {
    pdfBytes =
      pdfSource instanceof Uint8Array
        ? (pdfSource.buffer.slice(
            pdfSource.byteOffset,
            pdfSource.byteOffset + pdfSource.byteLength
          ) as ArrayBuffer)
        : pdfSource;
  }

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Group by page and render
  const byPage = groupByPage(highlights);
  const totalPages = byPage.size;
  let currentPage = 0;

  for (const [pageNum, pageHighlights] of byPage) {
    const page = pages[pageNum - 1]; // 1-indexed to 0-indexed
    if (!page) continue;

    for (const highlight of pageHighlights) {
      switch (highlight.type) {
        case "text":
          await renderTextHighlight(page, highlight, options);
          break;
        case "area":
          await renderAreaHighlight(page, highlight, options);
          break;
        case "freetext":
          await renderFreetextHighlight(page, highlight, options, font);
          break;
        case "image":
          await renderImageHighlight(pdfDoc, page, highlight);
          break;
        case "drawing":
          // Drawings are stored as PNG images, reuse image highlight rendering
          await renderImageHighlight(pdfDoc, page, highlight);
          break;
        case "shape":
          await renderShapeHighlight(page, highlight);
          break;
        default:
          // Default to area highlight for backwards compatibility
          await renderAreaHighlight(page, highlight, options);
      }
    }

    currentPage++;
    options.onProgress?.(currentPage, totalPages);
  }

  return pdfDoc.save();
}
