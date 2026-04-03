import { useState, useRef, useEffect, type MutableRefObject } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "@/stores/toastStore";
import type { AppHighlight } from "./usePDFAnnotations";

interface UsePDFTextSelectionOptions {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  isTextSelectionMode: boolean;
  highlights: AppHighlight[];
}

export function usePDFTextSelection({
  containerRef,
  isTextSelectionMode,
  highlights,
}: UsePDFTextSelectionOptions) {
  const [selectionRects, setSelectionRects] = useState<DOMRect[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectingActiveRef = useRef(false);
  const savedSelectionRef = useRef<string>("");

  // Save selection for Cmd+C copy
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection?.toString().trim();
        if (selectedText) {
          savedSelectionRef.current = selectedText;
        }
      }, 10);
    };

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText) {
        const anchorNode = selection?.anchorNode;
        if (anchorNode && container.contains(anchorNode)) {
          savedSelectionRef.current = selectedText;
        }
      }
    };

    const handleClick = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          savedSelectionRef.current = "";
        }
      }, 100);
    };

    container.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("click", handleClick);
    };
  }, [containerRef]);

  // Track active text selection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerDown = () => {
      if (!isTextSelectionMode) return;
      selectingActiveRef.current = true;
    };

    const handlePointerMove = () => {
      if (!isTextSelectionMode || !selectingActiveRef.current) return;
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (!range || !container.contains(range.commonAncestorContainer)) {
        setSelectionRects([]);
        return;
      }
      if (selection!.isCollapsed || selection!.toString().trim().length === 0) {
        setSelectionRects([]);
        return;
      }
      const rects = Array.from(range.getClientRects());
      setSelectionRects(rects.length > 0 ? rects : [new DOMRect(0, 0, 1, 1)]);
    };

    const handlePointerUp = () => {
      if (!isTextSelectionMode) return;
      selectingActiveRef.current = false;
    };

    const handleSelectionChange = () => {
      if (!isTextSelectionMode) return;
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (
        !range ||
        !selection ||
        selection.isCollapsed ||
        selection.toString().trim().length === 0 ||
        !container.contains(range.commonAncestorContainer)
      ) {
        setSelectionRects([]);
        setIsSelecting(false);
        return;
      }
      const rects = Array.from(range.getClientRects());
      setSelectionRects(rects.length > 0 ? rects : [new DOMRect(0, 0, 1, 1)]);
      setIsSelecting(true);
    };

    container.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
      setSelectionRects([]);
      setIsSelecting(false);
    };
  }, [isTextSelectionMode, highlights, containerRef]);

  // Copy selected text handler
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return;

      const selection = window.getSelection();
      let selectedText = selection?.toString().trim();

      if (!selectedText && savedSelectionRef.current) {
        selectedText = savedSelectionRef.current;
      }
      if (!selectedText) return;

      const container = containerRef.current;
      const anchorNode = selection?.anchorNode;
      const inContainer = container && (
        (anchorNode && container.contains(anchorNode)) ||
        savedSelectionRef.current
      );
      if (!inContainer) return;

      e.preventDefault();
      e.stopPropagation();
      try {
        await writeText(selectedText);
        savedSelectionRef.current = "";
        toast.success("Copied to clipboard");
      } catch (err) {
        console.error("Failed to copy text:", err);
        toast.error(`Failed to copy: ${err}`);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [containerRef]);

  return { selectionRects, isSelecting };
}
