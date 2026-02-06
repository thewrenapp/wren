import { useState, useCallback, useRef, useEffect } from "react";
import {
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  type Annotation,
} from "@/services/tauri/commands";
import { toast } from "@/stores/toastStore";
import type { Rendition, Book } from "epubjs";

export type EPUBAnnotationType = "text" | "area" | "freetext" | "drawing" | "shape";

export interface EPUBTextPosition {
  type: "text";
  cfiRange: string;
  sectionHref: string;
  selectedText: string;
  prefix: string;
  suffix: string;
  pageNumber: number;
  sectionHeading?: string;
}

export interface EPUBSpatialPosition {
  type: "spatial";
  sectionHref: string;
  anchorOffsetX: number;
  anchorOffsetY: number;
  width: number;
  height: number;
  pageNumber: number;
  sectionHeading?: string;
}

export type EPUBPosition = EPUBTextPosition | EPUBSpatialPosition;

export interface EPUBHighlight {
  id: string;
  dbId: number;
  type: EPUBAnnotationType;
  position: EPUBPosition;
  selectedText?: string;
  comment?: string;
  color: string;
  sectionHeading?: string;
}

interface UseEPUBAnnotationsReturn {
  highlights: EPUBHighlight[];
  addTextHighlight: (cfiRange: string, selectedText: string, color: string, sectionHref: string, pageNumber: number) => void;
  addAreaHighlight: (x: number, y: number, width: number, height: number, color: string, sectionHref: string, pageNumber: number) => void;
  addFreetextNote: (x: number, y: number, text: string, sectionHref: string, pageNumber: number) => void;
  addShapeHighlight: (x: number, y: number, width: number, height: number, color: string, shapeData: unknown, sectionHref: string, pageNumber: number) => void;
  addDrawingHighlight: (x: number, y: number, width: number, height: number, color: string, strokeData: unknown, sectionHref: string, pageNumber: number) => void;
  deleteHighlight: (id: string) => void;
  updateHighlightColor: (id: string, color: string) => void;
  renderHighlightsForSection: (sectionHref: string) => void;
  loading: boolean;
}

export function useEPUBAnnotations(
  renditionRef: React.RefObject<Rendition | null>,
  bookRef: React.RefObject<Book | null>,
  attachmentId: string
): UseEPUBAnnotationsReturn {
  const [highlights, setHighlights] = useState<EPUBHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const highlightsRef = useRef<EPUBHighlight[]>([]);

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  // Load annotations from database
  useEffect(() => {
    async function loadAnnotations() {
      setLoading(true);
      try {
        const annotations = await getAnnotations(Number(attachmentId));
        const loaded: EPUBHighlight[] = annotations.map((ann: Annotation) => {
          let position: EPUBPosition;
          try {
            position = JSON.parse(ann.positionJson) as EPUBPosition;
          } catch {
            position = {
              type: "text",
              cfiRange: "",
              sectionHref: "",
              selectedText: ann.selectedText || "",
              prefix: "",
              suffix: "",
              pageNumber: 1,
            };
          }

          return {
            id: String(ann.id),
            dbId: ann.id,
            type: ann.annotationType as EPUBAnnotationType,
            position,
            selectedText: ann.selectedText,
            comment: ann.comment,
            color: ann.color,
            sectionHeading: position.sectionHeading,
          };
        });

        setHighlights(loaded);
      } catch (err) {
        console.error("Failed to load EPUB annotations:", err);
      } finally {
        setLoading(false);
      }
    }

    if (attachmentId) {
      loadAnnotations();
    }
  }, [attachmentId]);

  // Render text highlights for a specific section using epub.js annotations API
  const renderHighlightsForSection = useCallback(
    (sectionHref: string) => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      // Remove all existing epub.js annotations first
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const annotations = rendition.annotations as any;
      if (annotations._annotations) {
        const keys = Object.keys(annotations._annotations);
        for (const key of keys) {
          try {
            rendition.annotations.remove(key, "highlight");
          } catch {
            // ignore
          }
        }
      }

      // Also clean up spatial annotation elements from iframe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
      for (const content of contents) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (content as any).document as Document | undefined;
        if (doc) {
          doc.querySelectorAll("[data-epub-highlight-id]").forEach((el) => el.remove());
        }
      }

      // Re-render all highlights for this section
      const currentHighlights = highlightsRef.current;
      for (const highlight of currentHighlights) {
        if (highlight.position.type === "text") {
          const textPos = highlight.position;
          // Only render if this highlight is in the current section or if section matching is not strict
          if (!sectionHref || textPos.sectionHref === sectionHref || !textPos.sectionHref) {
            try {
              rendition.annotations.highlight(
                textPos.cfiRange,
                { id: highlight.id },
                undefined,
                "epub-hl",
                { fill: highlight.color, "fill-opacity": "0.3" }
              );
            } catch {
              // CFI may not be valid for current section
            }
          }
        } else if (highlight.position.type === "spatial") {
          const spatialPos = highlight.position;
          if (!sectionHref || spatialPos.sectionHref === sectionHref || !spatialPos.sectionHref) {
            renderSpatialInIframe(highlight);
          }
        }
      }
    },
    [renditionRef]
  );

  // Render a spatial highlight in the epub.js iframe
  const renderSpatialInIframe = useCallback(
    (highlight: EPUBHighlight) => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
      if (contents.length === 0) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (contents[0] as any).document as Document | undefined;
      if (!doc) return;

      const pos = highlight.position as EPUBSpatialPosition;

      // Ensure body is positioned
      const bodyStyle = doc.defaultView?.getComputedStyle(doc.body);
      if (bodyStyle?.position === "static") {
        doc.body.style.position = "relative";
      }

      if (highlight.type === "area") {
        const div = doc.createElement("div");
        div.className = "epub-area-highlight";
        div.dataset.epubHighlightId = highlight.id;
        div.style.cssText = `position:absolute;left:${pos.anchorOffsetX}px;top:${pos.anchorOffsetY}px;width:${pos.width}px;height:${pos.height}px;background-color:${highlight.color};opacity:0.3;pointer-events:auto;cursor:pointer;z-index:10;`;
        doc.body.appendChild(div);
      } else if (highlight.type === "freetext") {
        const div = doc.createElement("div");
        div.className = "epub-freetext-note";
        div.dataset.epubHighlightId = highlight.id;
        div.style.cssText = `position:absolute;left:${pos.anchorOffsetX}px;top:${pos.anchorOffsetY}px;background-color:${highlight.color};border:1px solid ${highlight.color};padding:6px 8px;border-radius:3px;font-size:12px;min-width:80px;max-width:200px;box-shadow:2px 2px 6px rgba(0,0,0,0.2);pointer-events:auto;cursor:pointer;z-index:10;`;
        div.textContent = highlight.comment || "";
        doc.body.appendChild(div);
      } else if (highlight.type === "shape") {
        const div = doc.createElement("div");
        div.className = "epub-shape-rect";
        div.dataset.epubHighlightId = highlight.id;
        div.style.cssText = `position:absolute;left:${pos.anchorOffsetX}px;top:${pos.anchorOffsetY}px;width:${pos.width}px;height:${pos.height}px;border:2px solid ${highlight.color};pointer-events:auto;cursor:pointer;z-index:10;`;
        doc.body.appendChild(div);
      } else if (highlight.type === "drawing") {
        let strokeData: { strokes?: Array<{ points: Array<{ x: number; y: number }>; color: string; width: number }> } = {};
        try {
          strokeData = JSON.parse(highlight.comment || "{}");
        } catch { /* empty */ }

        if (strokeData.strokes && strokeData.strokes.length > 0) {
          const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("class", "epub-drawing-svg");
          svg.dataset.epubHighlightId = highlight.id;
          svg.style.cssText = `position:absolute;left:${pos.anchorOffsetX}px;top:${pos.anchorOffsetY}px;width:${pos.width}px;height:${pos.height}px;pointer-events:auto;cursor:pointer;z-index:10;overflow:visible;`;
          svg.setAttribute("viewBox", `0 0 ${pos.width} ${pos.height}`);
          svg.setAttribute("preserveAspectRatio", "none");

          for (const stroke of strokeData.strokes) {
            if (stroke.points.length < 2) continue;
            const pathParts = [
              `M ${stroke.points[0].x * pos.width} ${stroke.points[0].y * pos.height}`,
            ];
            for (let i = 1; i < stroke.points.length; i++) {
              pathParts.push(
                `L ${stroke.points[i].x * pos.width} ${stroke.points[i].y * pos.height}`
              );
            }
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", pathParts.join(" "));
            path.setAttribute("stroke", stroke.color);
            path.setAttribute("stroke-width", String(stroke.width));
            path.setAttribute("fill", "none");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            path.setAttribute("vector-effect", "non-scaling-stroke");
            svg.appendChild(path);
          }

          doc.body.appendChild(svg);
        }
      }
    },
    [renditionRef]
  );

  // Add text highlight
  const addTextHighlight = useCallback(
    async (cfiRange: string, selectedText: string, color: string, sectionHref: string, pageNumber: number) => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      // Get context for fuzzy matching
      const book = bookRef.current;
      let prefix = "";
      let suffix = "";
      try {
        const range = rendition.getRange(cfiRange);
        if (range) {
          const text = range.startContainer.textContent || "";
          const startIdx = range.startOffset;
          prefix = text.slice(Math.max(0, startIdx - 30), startIdx);
          const endText = range.endContainer.textContent || "";
          const endIdx = range.endOffset;
          suffix = endText.slice(endIdx, endIdx + 30);
        }
      } catch { /* ignore */ }

      // Find nearest heading
      let sectionHeading: string | undefined;
      try {
        const toc = book?.navigation?.toc;
        if (toc) {
          for (const item of toc) {
            if (sectionHref.includes(item.href)) {
              sectionHeading = item.label;
              break;
            }
          }
        }
      } catch { /* ignore */ }

      const position: EPUBTextPosition = {
        type: "text",
        cfiRange,
        sectionHref,
        selectedText,
        prefix,
        suffix,
        pageNumber,
        sectionHeading,
      };

      try {
        // Render immediately via epub.js
        rendition.annotations.highlight(
          cfiRange,
          {},
          undefined,
          "epub-hl",
          { fill: color, "fill-opacity": "0.3" }
        );

        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "text",
          pageNumber,
          positionJson: JSON.stringify(position),
          selectedText,
          color,
        });

        const highlight: EPUBHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "text",
          position,
          selectedText,
          color,
          sectionHeading,
        };

        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create EPUB highlight:", err);
        toast.error("Failed to create highlight");
      }
    },
    [renditionRef, bookRef, attachmentId]
  );

  // Add area highlight
  const addAreaHighlight = useCallback(
    async (x: number, y: number, width: number, height: number, color: string, sectionHref: string, pageNumber: number) => {
      const position: EPUBSpatialPosition = {
        type: "spatial",
        sectionHref,
        anchorOffsetX: x,
        anchorOffsetY: y,
        width,
        height,
        pageNumber,
      };

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "area",
          pageNumber,
          positionJson: JSON.stringify(position),
          color,
        });

        const highlight: EPUBHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "area",
          position,
          color,
        };

        renderSpatialInIframe(highlight);
        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create area highlight:", err);
        toast.error("Failed to create highlight");
      }
    },
    [attachmentId, renderSpatialInIframe]
  );

  // Add freetext note
  const addFreetextNote = useCallback(
    async (x: number, y: number, text: string, sectionHref: string, pageNumber: number) => {
      const position: EPUBSpatialPosition = {
        type: "spatial",
        sectionHref,
        anchorOffsetX: x,
        anchorOffsetY: y,
        width: 150,
        height: 80,
        pageNumber,
      };

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "freetext",
          pageNumber,
          positionJson: JSON.stringify(position),
          comment: text,
          color: "#FFE28F",
        });

        const highlight: EPUBHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "freetext",
          position,
          comment: text,
          color: "#FFE28F",
        };

        renderSpatialInIframe(highlight);
        setHighlights((prev) => [...prev, highlight]);
        toast.success("Note added");
      } catch (err) {
        console.error("Failed to create note:", err);
        toast.error("Failed to create note");
      }
    },
    [attachmentId, renderSpatialInIframe]
  );

  // Add shape highlight
  const addShapeHighlight = useCallback(
    async (x: number, y: number, width: number, height: number, color: string, shapeData: unknown, sectionHref: string, pageNumber: number) => {
      const position: EPUBSpatialPosition = {
        type: "spatial",
        sectionHref,
        anchorOffsetX: x,
        anchorOffsetY: y,
        width,
        height,
        pageNumber,
      };

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "shape",
          pageNumber,
          positionJson: JSON.stringify(position),
          comment: JSON.stringify(shapeData),
          color,
        });

        const highlight: EPUBHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "shape",
          position,
          comment: JSON.stringify(shapeData),
          color,
        };

        renderSpatialInIframe(highlight);
        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create shape:", err);
        toast.error("Failed to create shape");
      }
    },
    [attachmentId, renderSpatialInIframe]
  );

  // Add drawing highlight
  const addDrawingHighlight = useCallback(
    async (x: number, y: number, width: number, height: number, color: string, strokeData: unknown, sectionHref: string, pageNumber: number) => {
      const position: EPUBSpatialPosition = {
        type: "spatial",
        sectionHref,
        anchorOffsetX: x,
        anchorOffsetY: y,
        width,
        height,
        pageNumber,
      };

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "drawing",
          pageNumber,
          positionJson: JSON.stringify(position),
          comment: JSON.stringify(strokeData),
          color,
        });

        const highlight: EPUBHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "drawing",
          position,
          comment: JSON.stringify(strokeData),
          color,
        };

        renderSpatialInIframe(highlight);
        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create drawing:", err);
        toast.error("Failed to create drawing");
      }
    },
    [attachmentId, renderSpatialInIframe]
  );

  // Delete a highlight
  const deleteHighlight = useCallback(
    async (id: string) => {
      const highlight = highlightsRef.current.find((h) => h.id === id);
      if (!highlight) return;

      try {
        await deleteAnnotation(highlight.dbId);

        // Remove from epub.js if text highlight
        if (highlight.position.type === "text") {
          try {
            renditionRef.current?.annotations.remove(
              (highlight.position as EPUBTextPosition).cfiRange,
              "highlight"
            );
          } catch { /* ignore */ }
        }

        // Remove spatial elements from iframe
        const rendition = renditionRef.current;
        if (rendition) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
          for (const content of contents) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc = (content as any).document as Document | undefined;
            if (doc) {
              doc.querySelectorAll(`[data-epub-highlight-id="${id}"]`).forEach((el) => el.remove());
            }
          }
        }

        setHighlights((prev) => prev.filter((h) => h.id !== id));
      } catch (err) {
        console.error("Failed to delete annotation:", err);
        toast.error("Failed to delete annotation");
      }
    },
    [renditionRef]
  );

  // Update highlight color
  const updateHighlightColor = useCallback(
    async (id: string, color: string) => {
      const highlight = highlightsRef.current.find((h) => h.id === id);
      if (!highlight) return;

      try {
        let updatedComment = highlight.comment;
        if (highlight.type === "drawing" && highlight.comment) {
          try {
            const data = JSON.parse(highlight.comment) as {
              strokes?: Array<{ points: Array<{ x: number; y: number }>; color: string; width: number }>;
            };
            if (data.strokes) {
              data.strokes = data.strokes.map((stroke) => ({ ...stroke, color }));
              updatedComment = JSON.stringify(data);
            }
          } catch { /* ignore */ }
        }

        await updateAnnotation(highlight.dbId, { color, comment: updatedComment });

        setHighlights((prev) =>
          prev.map((h) => (h.id === id ? { ...h, color, comment: updatedComment } : h))
        );

        // Re-render to apply new color
        const rendition = renditionRef.current;
        if (rendition && highlight.position.type === "text") {
          const cfiRange = (highlight.position as EPUBTextPosition).cfiRange;
          try {
            rendition.annotations.remove(cfiRange, "highlight");
            rendition.annotations.highlight(
              cfiRange,
              { id },
              undefined,
              "epub-hl",
              { fill: color, "fill-opacity": "0.3" }
            );
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("Failed to update annotation:", err);
        toast.error("Failed to update annotation");
      }
    },
    [renditionRef]
  );

  return {
    highlights,
    addTextHighlight,
    addAreaHighlight,
    addFreetextNote,
    addShapeHighlight,
    addDrawingHighlight,
    deleteHighlight,
    updateHighlightColor,
    renderHighlightsForSection,
    loading,
  };
}
