import { useState } from "react";
import {
  Highlighter,
  BoxSelect,
  MessageSquareText,
  Pencil,
  Square,
  Download,
  Copy,
  FileJson,
  FileText,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "@/stores/toastStore";

interface AnnotationHighlight {
  id: string;
  type?: string;
  position: {
    boundingRect: {
      pageNumber: number;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
    };
  };
  content?: {
    text?: string;
    image?: string;
  };
  highlightColor?: string;
  selectedText?: string;
}

interface AnnotationPanelProps {
  annotations: AnnotationHighlight[];
  onAnnotationClick?: (annotationId: string, pageNumber: number) => void;
  pdfTitle?: string;
}

function getAnnotationIcon(type?: string) {
  switch (type) {
    case "text":
      return <Highlighter className="h-3.5 w-3.5" />;
    case "area":
      return <BoxSelect className="h-3.5 w-3.5" />;
    case "freetext":
      return <MessageSquareText className="h-3.5 w-3.5" />;
    case "drawing":
      return <Pencil className="h-3.5 w-3.5" />;
    case "shape":
      return <Square className="h-3.5 w-3.5" />;
    default:
      return <Highlighter className="h-3.5 w-3.5" />;
  }
}

function getAnnotationLabel(type?: string) {
  switch (type) {
    case "text":
      return "Highlight";
    case "area":
      return "Area";
    case "freetext":
      return "Note";
    case "drawing":
      return "Drawing";
    case "shape":
      return "Shape";
    default:
      return "Annotation";
  }
}

export function AnnotationPanel({ annotations, onAnnotationClick, pdfTitle }: AnnotationPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Group annotations by page
  const annotationsByPage = annotations.reduce((acc, ann) => {
    const page = ann.position.boundingRect.pageNumber;
    if (!acc[page]) acc[page] = [];
    acc[page].push(ann);
    return acc;
  }, {} as Record<number, AnnotationHighlight[]>);

  const sortedPages = Object.keys(annotationsByPage)
    .map(Number)
    .sort((a, b) => a - b);

  const handleAnnotationClick = (annotation: AnnotationHighlight) => {
    setSelectedId(annotation.id);
    onAnnotationClick?.(annotation.id, annotation.position.boundingRect.pageNumber);
  };

  // Export annotations as JSON
  const exportAsJson = async () => {
    const exportData = annotations.map((ann) => ({
      id: ann.id,
      type: ann.type,
      page: ann.position.boundingRect.pageNumber,
      text: ann.selectedText || ann.content?.text || "",
      color: ann.highlightColor,
      position: ann.position.boundingRect,
    }));

    const json = JSON.stringify(exportData, null, 2);

    try {
      const filePath = await save({
        defaultPath: `${pdfTitle || "annotations"}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, json);
        toast.success("Annotations exported");
      }
    } catch (err) {
      console.error("Failed to export:", err);
      toast.error("Export failed");
    }
  };

  // Export annotations as Markdown
  const exportAsMarkdown = async () => {
    let markdown = `# Annotations${pdfTitle ? ` - ${pdfTitle}` : ""}\n\n`;

    for (const page of sortedPages) {
      markdown += `## Page ${page}\n\n`;
      for (const ann of annotationsByPage[page]) {
        const text = ann.selectedText || ann.content?.text || "";
        const label = getAnnotationLabel(ann.type);

        if (ann.type === "text" && text) {
          markdown += `> ${text}\n\n`;
        } else if (ann.type === "freetext" && text) {
          markdown += `**Note:** ${text}\n\n`;
        } else {
          markdown += `- ${label}${text ? `: ${text}` : ""}\n\n`;
        }
      }
    }

    try {
      const filePath = await save({
        defaultPath: `${pdfTitle || "annotations"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, markdown);
        toast.success("Annotations exported");
      }
    } catch (err) {
      console.error("Failed to export:", err);
      toast.error("Export failed");
    }
  };

  // Copy all annotations as text
  const copyAsText = async () => {
    let text = "";

    for (const page of sortedPages) {
      text += `Page ${page}\n`;
      text += "─".repeat(20) + "\n";
      for (const ann of annotationsByPage[page]) {
        const content = ann.selectedText || ann.content?.text || "";
        if (content) {
          text += `${content}\n\n`;
        }
      }
    }

    try {
      await writeText(text.trim());
      toast.success("Copied to clipboard");
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Copy failed");
    }
  };

  if (annotations.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold">Annotations</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            No annotations yet.
            <br />
            Use the edit mode to add highlights and notes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Annotations ({annotations.length})
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <Download className="h-3.5 w-3.5 mr-1" />
              Export
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportAsJson}>
              <FileJson className="h-4 w-4 mr-2" />
              Export as JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportAsMarkdown}>
              <FileText className="h-4 w-4 mr-2" />
              Export as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyAsText}>
              <Copy className="h-4 w-4 mr-2" />
              Copy all text
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Annotation list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-3">
          {sortedPages.map((page) => (
            <div key={page}>
              <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                Page {page}
              </div>
              <div className="space-y-1">
                {annotationsByPage[page].map((annotation) => {
                  const text = annotation.selectedText || annotation.content?.text || "";
                  const preview = text.length > 100 ? text.slice(0, 100) + "..." : text;

                  return (
                    <button
                      key={annotation.id}
                      onClick={() => handleAnnotationClick(annotation)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded-md transition-colors",
                        "hover:bg-muted/50",
                        selectedId === annotation.id && "bg-muted"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-0.5 flex-shrink-0"
                          style={{ color: annotation.highlightColor }}
                        >
                          {getAnnotationIcon(annotation.type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-muted-foreground">
                            {getAnnotationLabel(annotation.type)}
                          </div>
                          {preview && (
                            <p className="text-sm text-foreground/90 line-clamp-2">
                              {preview}
                            </p>
                          )}
                          {!preview && annotation.type === "area" && (
                            <p className="text-xs text-muted-foreground italic">
                              Area selection
                            </p>
                          )}
                          {!preview && annotation.type === "drawing" && (
                            <p className="text-xs text-muted-foreground italic">
                              Freehand drawing
                            </p>
                          )}
                          {!preview && annotation.type === "shape" && (
                            <p className="text-xs text-muted-foreground italic">
                              Rectangle shape
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
