import { useState, useEffect, useCallback } from "react";
import { type Item } from "@/stores/libraryStore";
import { PDFViewer, type Annotation } from "@/components/pdf/PDFViewer";
import type { GhostHighlight, Content } from "react-pdf-highlighter-extended";
import {
  getPdfDetails,
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  type Annotation as ApiAnnotation,
} from "@/services/tauri/commands";

interface ItemTabProps {
  item: Item;
}

// Convert API annotation to PDFViewer annotation format
function toViewerAnnotation(ann: ApiAnnotation): Annotation {
  const position = JSON.parse(ann.positionJson);
  return {
    id: ann.id.toString(),
    itemId: ann.itemId.toString(),
    position,
    type: ann.annotationType === "area" ? "area" : "text",
    content: {
      text: ann.selectedText || "",
    },
    comment: {
      text: ann.comment || "",
      emoji: "",
    },
    color: ann.color,
  };
}

export function ItemTab({ item }: ItemTabProps) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load PDF details and annotations
  useEffect(() => {
    async function loadData() {
      if (item.type !== "pdf") return;

      setLoading(true);
      setError(null);

      try {
        const [pdfDetails, apiAnnotations] = await Promise.all([
          getPdfDetails(parseInt(item.id)),
          getAnnotations(parseInt(item.id)),
        ]);

        setFilePath(pdfDetails.filePath);
        setAnnotations(apiAnnotations.map(toViewerAnnotation));
      } catch (err) {
        console.error("Failed to load PDF data:", err);
        setError(err instanceof Error ? err.message : "Failed to load PDF");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [item.id, item.type]);

  // Add annotation handler
  const handleAddAnnotation = useCallback(
    async (highlight: GhostHighlight & { color: string }) => {
      try {
        const content = highlight.content as Content;
        const created = await createAnnotation({
          itemId: parseInt(item.id),
          annotationType: highlight.type === "area" ? "area" : "highlight",
          pageNumber: highlight.position.boundingRect.pageNumber,
          positionJson: JSON.stringify(highlight.position),
          selectedText: content?.text,
          comment: "",
          color: highlight.color,
        });

        setAnnotations((prev) => [...prev, toViewerAnnotation(created)]);
      } catch (err) {
        console.error("Failed to create annotation:", err);
      }
    },
    [item.id]
  );

  // Update annotation handler
  const handleUpdateAnnotation = useCallback(
    async (id: string, updates: Partial<Annotation>) => {
      try {
        await updateAnnotation(parseInt(id), {
          positionJson: updates.position
            ? JSON.stringify(updates.position)
            : undefined,
          comment: updates.comment?.text,
          color: updates.color,
        });

        setAnnotations((prev) =>
          prev.map((ann) => (ann.id === id ? { ...ann, ...updates } : ann))
        );
      } catch (err) {
        console.error("Failed to update annotation:", err);
      }
    },
    []
  );

  // Delete annotation handler
  const handleDeleteAnnotation = useCallback(async (id: string) => {
    try {
      await deleteAnnotation(parseInt(id));
      setAnnotations((prev) => prev.filter((ann) => ann.id !== id));
    } catch (err) {
      console.error("Failed to delete annotation:", err);
    }
  }, []);

  if (item.type !== "pdf") {
    // TODO: Render Markdown editor for markdown items
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Markdown Editor - {item.title}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-destructive">
        {error || "Failed to load PDF"}
      </div>
    );
  }

  return (
    <PDFViewer
      filePath={filePath}
      itemId={item.id}
      annotations={annotations}
      onAddAnnotation={handleAddAnnotation}
      onUpdateAnnotation={handleUpdateAnnotation}
      onDeleteAnnotation={handleDeleteAnnotation}
    />
  );
}
