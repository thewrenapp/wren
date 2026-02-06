import { useState, useCallback, useRef, useEffect } from "react";
import {
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  type Annotation,
} from "@/services/tauri/commands";
import {
  serializeRange,
  deserializeRange,
  serializeSpatialPosition,
  deserializeSpatialPosition,
  type HTMLTextPosition,
  type HTMLSpatialPosition,
  type HTMLPosition,
} from "./html-range-serializer";
import { toast } from "@/stores/toastStore";
import highlightCss from "./HTMLViewer.css?raw";

export type HTMLAnnotationType = "text" | "area" | "freetext" | "drawing" | "shape";

export interface HTMLHighlight {
  id: string;
  dbId: number;
  type: HTMLAnnotationType;
  position: HTMLPosition;
  selectedText?: string;
  comment?: string;
  color: string;
  sectionHeading?: string;
  runtimeElements?: HTMLElement[];
}

interface UseHTMLAnnotationsReturn {
  highlights: HTMLHighlight[];
  addTextHighlight: (color: string) => void;
  addAreaHighlight: (x: number, y: number, width: number, height: number, color: string) => void;
  addFreetextNote: (x: number, y: number, text: string) => void;
  addShapeHighlight: (x: number, y: number, width: number, height: number, color: string, shapeData: unknown) => void;
  addDrawingHighlight: (x: number, y: number, width: number, height: number, color: string, strokeData: unknown) => void;
  deleteHighlight: (id: string) => void;
  updateHighlightColor: (id: string, color: string) => void;
  renderAllHighlights: () => void;
  loading: boolean;
}

export function useHTMLAnnotations(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  attachmentId: string
): UseHTMLAnnotationsReturn {
  const [highlights, setHighlights] = useState<HTMLHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const highlightsRef = useRef<HTMLHighlight[]>([]);

  // Keep ref in sync
  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  // Inject CSS into iframe
  const injectCSS = useCallback(() => {
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeDoc) return;

    // Check if already injected
    if (iframeDoc.getElementById("html-viewer-annotation-styles")) return;

    const style = iframeDoc.createElement("style");
    style.id = "html-viewer-annotation-styles";
    style.textContent = highlightCss;
    iframeDoc.head.appendChild(style);
  }, [iframeRef]);

  // Render a text highlight by wrapping text nodes in <mark> elements
  const renderTextHighlight = useCallback(
    (highlight: HTMLHighlight): HTMLElement[] => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc || highlight.position.type !== "text") return [];

      const range = deserializeRange(highlight.position, iframeDoc);
      if (!range) return [];

      const elements: HTMLElement[] = [];

      // Use TreeWalker to handle cross-element ranges
      const walker = iframeDoc.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        null
      );

      const textNodes: Text[] = [];
      let node: Text | null;

      // Collect text nodes within the range
      while ((node = walker.nextNode() as Text | null)) {
        if (range.intersectsNode(node)) {
          textNodes.push(node);
        }
      }

      // If range is within a single text node
      if (textNodes.length === 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
        textNodes.push(range.startContainer as Text);
      }

      for (const textNode of textNodes) {
        try {
          const nodeRange = iframeDoc.createRange();

          if (textNode === range.startContainer && textNode === range.endContainer) {
            nodeRange.setStart(textNode, range.startOffset);
            nodeRange.setEnd(textNode, range.endOffset);
          } else if (textNode === range.startContainer) {
            nodeRange.setStart(textNode, range.startOffset);
            nodeRange.setEnd(textNode, textNode.textContent?.length || 0);
          } else if (textNode === range.endContainer) {
            nodeRange.setStart(textNode, 0);
            nodeRange.setEnd(textNode, range.endOffset);
          } else {
            nodeRange.selectNodeContents(textNode);
          }

          if (nodeRange.toString().length === 0) continue;

          const mark = iframeDoc.createElement("mark");
          mark.className = "html-annotation-highlight";
          mark.style.backgroundColor = highlight.color;
          mark.dataset.highlightId = highlight.id;

          try {
            nodeRange.surroundContents(mark);
            elements.push(mark);
          } catch {
            // surroundContents may fail on complex DOM; fall back to splitting text
            try {
              const startOffset = nodeRange.startOffset;
              const endOffset = nodeRange.endOffset;
              if (endOffset <= startOffset) continue;

              const parent = textNode.parentNode;
              if (!parent) continue;

              const highlightNode = textNode.splitText(startOffset);
              const afterNode = highlightNode.splitText(endOffset - startOffset);

              const fallbackMark = iframeDoc.createElement("mark");
              fallbackMark.className = "html-annotation-highlight";
              fallbackMark.style.backgroundColor = highlight.color;
              fallbackMark.dataset.highlightId = highlight.id;
              fallbackMark.appendChild(highlightNode);
              parent.insertBefore(fallbackMark, afterNode);
              elements.push(fallbackMark);
            } catch {
              // If even fallback fails, skip this node
            }
          }
        } catch {
          continue;
        }
      }

      return elements;
    },
    [iframeRef]
  );

  // Render a spatial highlight (area, shape, drawing, freetext)
  const renderSpatialHighlight = useCallback(
    (highlight: HTMLHighlight): HTMLElement[] => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc || highlight.position.type !== "spatial") return [];

      const pos = deserializeSpatialPosition(highlight.position, iframeDoc);
      if (!pos) return [];

      const left = pos.x;
      const top = pos.y;

      const elements: HTMLElement[] = [];

      // Make body position:relative if not already
      const bodyStyle = iframeDoc.defaultView?.getComputedStyle(iframeDoc.body);
      if (bodyStyle?.position === "static") {
        iframeDoc.body.style.position = "relative";
      }

      if (highlight.type === "area") {
        const div = iframeDoc.createElement("div");
        div.className = "html-area-highlight";
        div.dataset.highlightId = highlight.id;
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${pos.width}px`;
        div.style.height = `${pos.height}px`;
        div.style.backgroundColor = highlight.color;
        iframeDoc.body.appendChild(div);
        elements.push(div);
      } else if (highlight.type === "freetext") {
        const div = iframeDoc.createElement("div");
        div.className = "html-freetext-note";
        div.dataset.highlightId = highlight.id;
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.backgroundColor = highlight.color;
        div.style.borderColor = highlight.color;
        div.textContent = highlight.comment || "";
        iframeDoc.body.appendChild(div);
        elements.push(div);
      } else if (highlight.type === "shape") {
        const div = iframeDoc.createElement("div");
        div.className = "html-shape-rect";
        div.dataset.highlightId = highlight.id;
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${pos.width}px`;
        div.style.height = `${pos.height}px`;
        div.style.borderColor = highlight.color;
        iframeDoc.body.appendChild(div);
        elements.push(div);
      } else if (highlight.type === "drawing") {
        // Parse stroke data from comment
        let strokeData: { strokes?: Array<{ points: Array<{ x: number; y: number }>; color: string; width: number }> } = {};
        try {
          strokeData = JSON.parse(highlight.comment || "{}");
        } catch { /* empty */ }

        if (strokeData.strokes && strokeData.strokes.length > 0) {
          const svg = iframeDoc.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("class", "html-drawing-svg");
          svg.dataset.highlightId = highlight.id;
          svg.style.left = `${left}px`;
          svg.style.top = `${top}px`;
          svg.style.width = `${pos.width}px`;
          svg.style.height = `${pos.height}px`;
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

            const path = iframeDoc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", pathParts.join(" "));
            path.setAttribute("stroke", stroke.color);
            path.setAttribute("stroke-width", String(stroke.width));
            path.setAttribute("fill", "none");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            path.setAttribute("vector-effect", "non-scaling-stroke");
            svg.appendChild(path);
          }

          iframeDoc.body.appendChild(svg);
          elements.push(svg as unknown as HTMLElement);
        }
      }

      return elements;
    },
    [iframeRef]
  );

  // Remove rendered elements for a highlight
  const removeRenderedElements = useCallback((highlight: HTMLHighlight) => {
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeDoc) return;

    if (highlight.runtimeElements) {
      for (const el of highlight.runtimeElements) {
        if (el.tagName === "MARK") {
          // Replace mark with its text content
          const parent = el.parentNode;
          if (parent) {
            const text = iframeDoc.createTextNode(el.textContent || "");
            parent.replaceChild(text, el);
            parent.normalize();
          }
        } else {
          el.remove();
        }
      }
    }

    // Also clean by data attribute as fallback
    const elements = iframeDoc.querySelectorAll(
      `[data-highlight-id="${highlight.id}"]`
    );
    elements.forEach((el) => {
      if (el.tagName === "MARK") {
        const parent = el.parentNode;
        if (parent) {
          const text = iframeDoc.createTextNode(el.textContent || "");
          parent.replaceChild(text, el);
          parent.normalize();
        }
      } else {
        el.remove();
      }
    });
  }, [iframeRef]);

  // Render all highlights
  const renderAllHighlights = useCallback(() => {
    injectCSS();

    const currentHighlights = highlightsRef.current;
    const updated = currentHighlights.map((h) => {
      // Remove old elements first
      removeRenderedElements(h);

      // Render new elements
      let elements: HTMLElement[] = [];
      if (h.position.type === "text") {
        elements = renderTextHighlight(h);
      } else {
        elements = renderSpatialHighlight(h);
      }

      return { ...h, runtimeElements: elements };
    });

    setHighlights(updated);
  }, [injectCSS, removeRenderedElements, renderTextHighlight, renderSpatialHighlight]);

  // Load annotations from database
  useEffect(() => {
    async function loadAnnotations() {
      setLoading(true);
      try {
        const annotations = await getAnnotations(Number(attachmentId));
        const loaded: HTMLHighlight[] = annotations.map((ann: Annotation) => {
          let position: HTMLPosition;
          try {
            position = JSON.parse(ann.positionJson) as HTMLPosition;
          } catch {
            // Fallback position
            position = {
              type: "text",
              startContainerXPath: "",
              startOffset: 0,
              endContainerXPath: "",
              endOffset: 0,
              selectedText: ann.selectedText || "",
              prefix: "",
              suffix: "",
              pageNumber: 1,
            };
          }

          return {
            id: String(ann.id),
            dbId: ann.id,
            type: ann.annotationType as HTMLAnnotationType,
            position,
            selectedText: ann.selectedText,
            comment: ann.comment,
            color: ann.color,
            sectionHeading: (position as HTMLTextPosition).sectionHeading ||
              (position as HTMLSpatialPosition).sectionHeading,
          };
        });

        setHighlights(loaded);
      } catch (err) {
        console.error("Failed to load annotations:", err);
      } finally {
        setLoading(false);
      }
    }

    if (attachmentId) {
      loadAnnotations();
    }
  }, [attachmentId]);

  // Add text highlight from current selection
  const addTextHighlight = useCallback(
    async (color: string) => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      const selection = iframeDoc.getSelection();
      if (!selection || selection.isCollapsed) return;

      const range = selection.getRangeAt(0);
      const position = serializeRange(range, iframeDoc);
      if (!position) return;

      selection.removeAllRanges();

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "text",
          pageNumber: 1,
          positionJson: JSON.stringify(position),
          selectedText: position.selectedText,
          color,
        });

        const highlight: HTMLHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "text",
          position,
          selectedText: position.selectedText,
          color,
          sectionHeading: position.sectionHeading,
        };

        // Render immediately
        injectCSS();
        const elements = renderTextHighlight(highlight);
        highlight.runtimeElements = elements;

        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create annotation:", err);
        toast.error("Failed to create highlight");
      }
    },
    [iframeRef, attachmentId, injectCSS, renderTextHighlight]
  );

  // Add area highlight
  const addAreaHighlight = useCallback(
    async (x: number, y: number, width: number, height: number, color: string) => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      const position = serializeSpatialPosition(x, y, width, height, iframeDoc);

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "area",
          pageNumber: 1,
          positionJson: JSON.stringify(position),
          color,
        });

        const highlight: HTMLHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "area",
          position,
          color,
          sectionHeading: position.sectionHeading,
        };

        injectCSS();
        const elements = renderSpatialHighlight(highlight);
        highlight.runtimeElements = elements;

        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create area highlight:", err);
        toast.error("Failed to create highlight");
      }
    },
    [iframeRef, attachmentId, injectCSS, renderSpatialHighlight]
  );

  // Add freetext note
  const addFreetextNote = useCallback(
    async (x: number, y: number, text: string) => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      const position = serializeSpatialPosition(x, y, 150, 80, iframeDoc);

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "freetext",
          pageNumber: 1,
          positionJson: JSON.stringify(position),
          comment: text,
          color: "#FFE28F",
        });

        const highlight: HTMLHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "freetext",
          position,
          comment: text,
          color: "#FFE28F",
          sectionHeading: position.sectionHeading,
        };

        injectCSS();
        const elements = renderSpatialHighlight(highlight);
        highlight.runtimeElements = elements;

        setHighlights((prev) => [...prev, highlight]);
        toast.success("Note added");
      } catch (err) {
        console.error("Failed to create note:", err);
        toast.error("Failed to create note");
      }
    },
    [iframeRef, attachmentId, injectCSS, renderSpatialHighlight]
  );

  // Add shape highlight
  const addShapeHighlight = useCallback(
    async (x: number, y: number, width: number, height: number, color: string, shapeData: unknown) => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      const position = serializeSpatialPosition(x, y, width, height, iframeDoc);

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "shape",
          pageNumber: 1,
          positionJson: JSON.stringify(position),
          comment: JSON.stringify(shapeData),
          color,
        });

        const highlight: HTMLHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "shape",
          position,
          comment: JSON.stringify(shapeData),
          color,
          sectionHeading: position.sectionHeading,
        };

        injectCSS();
        const elements = renderSpatialHighlight(highlight);
        highlight.runtimeElements = elements;

        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create shape:", err);
        toast.error("Failed to create shape");
      }
    },
    [iframeRef, attachmentId, injectCSS, renderSpatialHighlight]
  );

  // Add drawing highlight
  const addDrawingHighlight = useCallback(
    async (x: number, y: number, width: number, height: number, color: string, strokeData: unknown) => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;

      const position = serializeSpatialPosition(x, y, width, height, iframeDoc);

      try {
        const annotation = await createAnnotation({
          attachmentId: Number(attachmentId),
          annotationType: "drawing",
          pageNumber: 1,
          positionJson: JSON.stringify(position),
          comment: JSON.stringify(strokeData),
          color,
        });

        const highlight: HTMLHighlight = {
          id: String(annotation.id),
          dbId: annotation.id,
          type: "drawing",
          position,
          comment: JSON.stringify(strokeData),
          color,
          sectionHeading: position.sectionHeading,
        };

        injectCSS();
        const elements = renderSpatialHighlight(highlight);
        highlight.runtimeElements = elements;

        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to create drawing:", err);
        toast.error("Failed to create drawing");
      }
    },
    [iframeRef, attachmentId, injectCSS, renderSpatialHighlight]
  );

  // Delete a highlight
  const deleteHighlight = useCallback(
    async (id: string) => {
      const highlight = highlightsRef.current.find((h) => h.id === id);
      if (!highlight) return;

      try {
        await deleteAnnotation(highlight.dbId);
        removeRenderedElements(highlight);
        setHighlights((prev) => prev.filter((h) => h.id !== id));
      } catch (err) {
        console.error("Failed to delete annotation:", err);
        toast.error("Failed to delete annotation");
      }
    },
    [removeRenderedElements]
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
              data.strokes = data.strokes.map((stroke) => ({
                ...stroke,
                color,
              }));
              updatedComment = JSON.stringify(data);
            }
          } catch {
            // ignore malformed comment json
          }
        }

        await updateAnnotation(highlight.dbId, {
          color,
          comment: updatedComment,
        });

        // Update runtime elements
        if (highlight.runtimeElements) {
          for (const el of highlight.runtimeElements) {
            if (el.tagName === "MARK") {
              el.style.backgroundColor = color;
            } else if (highlight.type === "area") {
              el.style.backgroundColor = color;
            } else if (highlight.type === "freetext") {
              el.style.backgroundColor = color;
              el.style.borderColor = color;
            } else if (highlight.type === "shape") {
              el.style.borderColor = color;
            } else if (highlight.type === "drawing") {
              const paths = el.querySelectorAll("path");
              paths.forEach((path) => {
                path.setAttribute("stroke", color);
              });
            }
          }
        }

        setHighlights((prev) =>
          prev.map((h) =>
            h.id === id ? { ...h, color, comment: updatedComment } : h
          )
        );
      } catch (err) {
        console.error("Failed to update annotation:", err);
        toast.error("Failed to update annotation");
      }
    },
    []
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
    renderAllHighlights,
    loading,
  };
}

function getDocumentScale(iframeDoc: Document): { scaleX: number; scaleY: number } {
  const view = iframeDoc.defaultView;
  const body = iframeDoc.body;
  if (!view || !body) {
    return { scaleX: 1, scaleY: 1 };
  }

  const transform = view.getComputedStyle(body).transform;
  if (!transform || transform === "none") {
    return { scaleX: 1, scaleY: 1 };
  }

  const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);
  if (matrixMatch) {
    const parts = matrixMatch[1].split(",").map((v) => parseFloat(v.trim()));
    const scaleX = parts[0] || 1;
    const scaleY = parts[3] || 1;
    return { scaleX, scaleY };
  }

  const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/);
  if (matrix3dMatch) {
    const parts = matrix3dMatch[1].split(",").map((v) => parseFloat(v.trim()));
    const scaleX = parts[0] || 1;
    const scaleY = parts[5] || 1;
    return { scaleX, scaleY };
  }

  return { scaleX: 1, scaleY: 1 };
}
