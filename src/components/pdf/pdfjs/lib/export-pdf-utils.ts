import type { PDFPage, PDFFont } from "pdf-lib";
import type { Scaled } from "../types";

/**
 * Parse a color string to RGB values (0-1 range).
 */
export function parseColor(color: string): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  // Handle rgba(r, g, b, a) and rgb(r, g, b)
  const rgbaMatch = color.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/
  );
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]) / 255,
      g: parseInt(rgbaMatch[2]) / 255,
      b: parseInt(rgbaMatch[3]) / 255,
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Handle hex (#RRGGBB or #RGB)
  const hex = color.replace("#", "");
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16) / 255,
      g: parseInt(hex[1] + hex[1], 16) / 255,
      b: parseInt(hex[2] + hex[2], 16) / 255,
      a: 1,
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: 1,
    };
  }

  // Default yellow
  return { r: 1, g: 0.89, b: 0.56, a: 0.5 };
}

/**
 * Convert ScaledPosition coordinates to PDF points.
 * PDF coordinate system has origin at bottom-left.
 */
export function scaledToPdfPoints(
  scaled: Scaled,
  page: PDFPage
): { x: number; y: number; width: number; height: number } {
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();

  // Calculate position ratios
  const xRatio = pdfWidth / scaled.width;
  const yRatio = pdfHeight / scaled.height;

  const x = scaled.x1 * xRatio;
  const width = (scaled.x2 - scaled.x1) * xRatio;
  const height = (scaled.y2 - scaled.y1) * yRatio;

  // Flip Y (PDF origin is bottom-left, screen origin is top-left)
  const y = pdfHeight - scaled.y1 * yRatio - height;

  return { x, y, width, height };
}

/**
 * Convert base64 data URL to bytes.
 */
export function dataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  type: "png" | "jpg";
} {
  const base64 = dataUrl.split(",")[1];
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  const type = dataUrl.includes("image/png") ? "png" : "jpg";
  return { bytes, type };
}

/**
 * Wrap text into multiple lines that fit within maxWidth.
 * Long words are broken character by character (like CSS word-wrap: break-word).
 */
export function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  if (!text || maxWidth <= 0) return [];

  const lines: string[] = [];

  // Split by newlines first to preserve intentional line breaks
  const paragraphs = text.split(/\n/);

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        // Push current line if exists
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }

        // Check if word itself is too wide - break it character by character
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          let remaining = word;
          while (remaining.length > 0) {
            let charCount = 1;
            // Find how many characters fit in maxWidth
            while (
              charCount < remaining.length &&
              font.widthOfTextAtSize(remaining.substring(0, charCount + 1), fontSize) <= maxWidth
            ) {
              charCount++;
            }
            const chunk = remaining.substring(0, charCount);
            remaining = remaining.substring(charCount);

            if (remaining.length > 0) {
              // More characters remaining, push this chunk as a complete line
              lines.push(chunk);
            } else {
              // Last chunk, keep it as current line (may combine with next word)
              currentLine = chunk;
            }
          }
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines;
}

/**
 * Transform visual coordinates to raw MediaBox coordinates.
 * pdf-lib's drawImage uses raw MediaBox space, but our coordinates are in visual space.
 */
export function transformToRawCoordinates(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const rotation = page.getRotation().angle;
  const pageWidth = page.getWidth(); // Visual width
  const pageHeight = page.getHeight(); // Visual height

  if (rotation === 90) {
    // Visual (x, y) -> Raw MediaBox coordinates
    // When rotated 90 degrees CCW, visual top-left maps to raw bottom-left
    return {
      x: y,
      y: pageWidth - x - width,
      width: height,
      height: width,
    };
  } else if (rotation === 180) {
    // Rotated 180 degrees, origin flips to opposite corner
    return {
      x: pageWidth - x - width,
      y: pageHeight - y - height,
      width,
      height,
    };
  } else if (rotation === 270) {
    // When rotated 90 degrees CW (270 degrees CCW)
    return {
      x: pageHeight - y - height,
      y: x,
      width: height,
      height: width,
    };
  }

  // No rotation - coordinates are already correct
  return { x, y, width, height };
}

/**
 * Group highlights by page number.
 */
export function groupByPage<T extends { position: { boundingRect: { pageNumber: number } } }>(
  highlights: T[]
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const h of highlights) {
    const pageNum = h.position.boundingRect.pageNumber;
    if (!map.has(pageNum)) map.set(pageNum, []);
    map.get(pageNum)!.push(h);
  }
  return map;
}
