import { useState, useEffect, useCallback, useRef } from "react";
import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  AreaHighlight,
  useHighlightContainerContext,
} from "react-pdf-highlighter-extended";
import type {
  Highlight,
  GhostHighlight,
  Content,
  PdfSelection,
  ViewportHighlight,
  PdfHighlighterUtils,
} from "react-pdf-highlighter-extended";
import { convertFileSrc } from "@tauri-apps/api/core";

// PDF.js worker source - must match the version used by react-pdf-highlighter-extended
const PDFJS_WORKER_SRC = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
import { Trash2, Highlighter, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// Extend Highlight with our custom fields
export interface Annotation extends Highlight {
  itemId: string;
  color: string;
  comment?: {
    text: string;
    emoji: string;
  };
  content?: Content;
}

interface PDFViewerProps {
  filePath: string;
  itemId: string;
  annotations: Annotation[];
  onAddAnnotation: (annotation: GhostHighlight & { color: string }) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
}

// Highlight colors
const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#FFEB3B" },
  { name: "Green", value: "#81C784" },
  { name: "Blue", value: "#64B5F6" },
  { name: "Pink", value: "#F48FB1" },
  { name: "Orange", value: "#FFB74D" },
];

export function PDFViewer({
  filePath,
  itemId,
  annotations,
  onAddAnnotation,
  onUpdateAnnotation: _onUpdateAnnotation,
  onDeleteAnnotation,
}: PDFViewerProps) {
  // TODO: Use onUpdateAnnotation for comment editing
  void _onUpdateAnnotation;
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState(HIGHLIGHT_COLORS[0].value);
  const [currentSelection, setCurrentSelection] = useState<PdfSelection | null>(
    null
  );
  const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Suppress unused itemId warning - kept for future use
  void itemId;

  // Convert file path to Tauri asset URL
  useEffect(() => {
    if (filePath) {
      const url = convertFileSrc(filePath);
      setPdfUrl(url);
    }
  }, [filePath]);

  const scrollToHighlight = useCallback((highlight: Highlight) => {
    if (highlighterUtilsRef.current) {
      highlighterUtilsRef.current.scrollToHighlight(highlight);
    }
  }, []);

  const handleSelectionFinished = useCallback((selection: PdfSelection) => {
    setCurrentSelection(selection);
  }, []);

  const handleConfirmSelection = useCallback(() => {
    if (currentSelection) {
      const ghost = currentSelection.makeGhostHighlight();
      onAddAnnotation({
        ...ghost,
        color: selectedColor,
      });
      setCurrentSelection(null);
    }
  }, [currentSelection, onAddAnnotation, selectedColor]);

  const handleCancelSelection = useCallback(() => {
    setCurrentSelection(null);
  }, []);

  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading PDF...
      </div>
    );
  }

  return (
    <div className="flex h-full" ref={containerRef}>
      {/* Main PDF area */}
      <div className="flex-1 relative overflow-hidden">
        <PdfLoader
          document={pdfUrl}
          workerSrc={PDFJS_WORKER_SRC}
          beforeLoad={() => <LoadingSpinner />}
        >
          {(pdfDocument) => (
            <PdfHighlighter
              pdfDocument={pdfDocument}
              highlights={annotations}
              enableAreaSelection={(event: MouseEvent) => event.altKey}
              onSelection={handleSelectionFinished}
              selectionTip={
                currentSelection && (
                  <SelectionTip
                    onConfirm={handleConfirmSelection}
                    onCancel={handleCancelSelection}
                    color={selectedColor}
                  />
                )
              }
              utilsRef={(utils) => {
                highlighterUtilsRef.current = utils;
              }}
              style={{
                height: "100%",
              }}
            >
              <HighlightContainer
                annotations={annotations}
                onDeleteAnnotation={onDeleteAnnotation}
              />
            </PdfHighlighter>
          )}
        </PdfLoader>

        {/* Color picker toolbar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 bg-background/95 backdrop-blur border rounded-lg shadow-lg z-10">
          <Highlighter className="h-4 w-4 text-muted-foreground" />
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.value}
              onClick={() => setSelectedColor(color.value)}
              className={cn(
                "w-6 h-6 rounded-full border-2 transition-transform",
                selectedColor === color.value
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: color.value }}
              title={color.name}
            />
          ))}
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Area selection (Alt+drag)"
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Annotations sidebar */}
      <div className="w-64 border-l bg-background flex flex-col">
        <div className="p-3 border-b">
          <h3 className="font-semibold text-sm">Annotations</h3>
          <p className="text-xs text-muted-foreground">
            {annotations.length} highlight{annotations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            {annotations.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2 text-center">
                Select text to highlight or Alt+drag for area selection
              </p>
            ) : (
              annotations.map((annotation) => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onClick={() => scrollToHighlight(annotation)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

interface SelectionTipProps {
  onConfirm: () => void;
  onCancel: () => void;
  color: string;
}

function SelectionTip({ onConfirm, onCancel, color }: SelectionTipProps) {
  return (
    <div className="bg-popover border rounded-lg shadow-lg p-2 flex items-center gap-2">
      <div
        className="w-4 h-4 rounded-full"
        style={{ backgroundColor: color }}
      />
      <Button size="sm" onClick={onConfirm}>
        Highlight
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface HighlightContainerProps {
  annotations: Annotation[];
  onDeleteAnnotation: (id: string) => void;
}

function HighlightContainer({
  annotations,
  onDeleteAnnotation,
}: HighlightContainerProps) {
  const { highlight, isScrolledTo } =
    useHighlightContainerContext<Annotation>();

  if (!highlight) return null;

  const annotation = annotations.find((a) => a.id === highlight.id);
  const color = annotation?.color || HIGHLIGHT_COLORS[0].value;
  const isArea = highlight.type === "area";

  // The highlight from context already has viewport position
  const viewportHighlight: ViewportHighlight<Annotation> = {
    ...highlight,
    itemId: annotation?.itemId || "",
    color,
    comment: annotation?.comment,
    content: annotation?.content,
  };

  return isArea ? (
    <AreaHighlight
      highlight={viewportHighlight}
      onChange={() => {}}
      isScrolledTo={isScrolledTo}
      style={{
        border: `2px solid ${color}`,
        background: `${color}33`,
      }}
    />
  ) : (
    <TextHighlight
      highlight={viewportHighlight}
      isScrolledTo={isScrolledTo}
      style={{
        backgroundColor: `${color}66`,
      }}
      onClick={() => {
        // Show delete option on click - simple implementation
        if (window.confirm("Delete this highlight?")) {
          onDeleteAnnotation(highlight.id);
        }
      }}
    />
  );
}

interface AnnotationCardProps {
  annotation: Annotation;
  onClick: () => void;
  onDelete: () => void;
}

function AnnotationCard({
  annotation,
  onClick,
  onDelete,
}: AnnotationCardProps) {
  return (
    <div
      onClick={onClick}
      className="p-2 rounded border cursor-pointer hover:bg-accent transition-colors group"
    >
      <div className="flex items-start gap-2">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
          style={{ backgroundColor: annotation.color }}
        />
        <div className="flex-1 min-w-0">
          {annotation.content?.text && (
            <p className="text-xs line-clamp-2 text-muted-foreground">
              &quot;{annotation.content.text}&quot;
            </p>
          )}
          {annotation.comment?.text && (
            <p className="text-sm mt-1 line-clamp-2">
              {annotation.comment.text}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Page {annotation.position.boundingRect.pageNumber}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
