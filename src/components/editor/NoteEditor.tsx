import { useState, useEffect } from "react";
import { getMarkdownContent } from "@/services/tauri/commands";
import { RichMarkdownEditor } from "./RichMarkdownEditor";

interface NoteEditorProps {
  attachmentId: number;
}

export function NoteEditor({ attachmentId }: NoteEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadContent() {
      setLoading(true);
      try {
        const md = await getMarkdownContent(attachmentId);
        // Notes start empty if never saved before
        setContent(md ?? "");
      } catch {
        setContent("");
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

  return (
    <RichMarkdownEditor
      content={content ?? ""}
      attachmentId={attachmentId}
      showToolbar={true}
      showReindex={true}
    />
  );
}
