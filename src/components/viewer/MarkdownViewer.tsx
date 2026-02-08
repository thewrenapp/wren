import { useState, useEffect } from "react";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { getMarkdownContent } from "@/services/tauri/commands";
import { FileText } from "lucide-react";

interface MarkdownViewerProps {
  attachmentId: number;
  title?: string;
}

export function MarkdownViewer({ attachmentId, title }: MarkdownViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadContent() {
      setLoading(true);
      setError(null);
      try {
        const md = await getMarkdownContent(attachmentId);
        setContent(md);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load content");
      } finally {
        setLoading(false);
      }
    }

    loadContent();
  }, [attachmentId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-destructive">
        {error}
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <FileText className="h-10 w-10 mx-auto opacity-40" />
          <p className="text-sm">No extracted text available</p>
          <p className="text-xs opacity-60">
            Rebuild the search index to extract text from this document
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {title && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{title}</span>
          <span className="text-xs text-muted-foreground ml-auto">
            Extracted Text
          </span>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <MarkdownEditor content={content} readOnly={true} />
      </div>
    </div>
  );
}
