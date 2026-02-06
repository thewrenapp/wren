import { useState, useMemo } from "react";
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
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "@/stores/toastStore";
import { SidebarSearchInput } from "@/components/pdf/SidebarSearchInput";
import type { HTMLHighlight } from "./useHTMLAnnotations";

interface HTMLAnnotationPanelProps {
  annotations: HTMLHighlight[];
  onAnnotationClick?: (annotationId: string) => void;
  onDelete?: (annotationId: string) => void;
  title?: string;
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

export function HTMLAnnotationPanel({
  annotations,
  onAnnotationClick,
  onDelete,
  title,
}: HTMLAnnotationPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter annotations by search query
  const filteredAnnotations = useMemo(() => {
    if (!searchQuery.trim()) return annotations;
    const query = searchQuery.toLowerCase();
    return annotations.filter((ann) => {
      const text = ann.selectedText || ann.comment || "";
      return text.toLowerCase().includes(query);
    });
  }, [annotations, searchQuery]);

  // Group by section heading
  const annotationsBySection = filteredAnnotations.reduce(
    (acc, ann) => {
      const section = ann.sectionHeading || "Document";
      if (!acc[section]) acc[section] = [];
      acc[section].push(ann);
      return acc;
    },
    {} as Record<string, HTMLHighlight[]>
  );

  const sortedSections = Object.keys(annotationsBySection);

  const handleAnnotationClick = (annotation: HTMLHighlight) => {
    setSelectedId(annotation.id);
    onAnnotationClick?.(annotation.id);
  };

  // Export as JSON
  const exportAsJson = async () => {
    const exportData = annotations.map((ann) => ({
      id: ann.id,
      type: ann.type,
      section: ann.sectionHeading || "Document",
      text: ann.selectedText || ann.comment || "",
      color: ann.color,
    }));

    const json = JSON.stringify(exportData, null, 2);

    try {
      const filePath = await save({
        defaultPath: `${title || "annotations"}.json`,
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

  // Export as Markdown
  const exportAsMarkdown = async () => {
    let markdown = `# Annotations${title ? ` - ${title}` : ""}\n\n`;

    for (const section of sortedSections) {
      markdown += `## ${section}\n\n`;
      for (const ann of annotationsBySection[section]) {
        const text = ann.selectedText || ann.comment || "";
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
        defaultPath: `${title || "annotations"}.md`,
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

  // Copy all as text
  const copyAsText = async () => {
    let text = "";

    for (const section of sortedSections) {
      text += `${section}\n`;
      text += "\u2500".repeat(20) + "\n";
      for (const ann of annotationsBySection[section]) {
        const content = ann.selectedText || ann.comment || "";
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "92px 20px 48px 20px",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            backgroundColor: "#f1f5f9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <Highlighter style={{ width: 28, height: 28, color: "#94a3b8" }} />
        </div>
        <p style={{ fontSize: 14, fontWeight: 500, color: "#475569", marginBottom: 4 }}>
          No annotations yet
        </p>
        <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
          Use the toolbar to add highlights and notes
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-sidebar-panel>
      <div className="px-2 py-1.5 border-b space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium">
            Annotations ({annotations.length})
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Download className="h-3.5 w-3.5" />
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
        <SidebarSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search annotations..."
        />
      </div>

      {searchQuery && filteredAnnotations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 px-4">
          <p className="text-xs text-muted-foreground text-center">
            No annotations matching &quot;{searchQuery}&quot;
          </p>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-2">
          {sortedSections.map((section) => (
            <div key={section}>
              <div className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5">
                {section}
              </div>
              <div className="space-y-0.5">
                {annotationsBySection[section].map((annotation) => {
                  const text =
                    annotation.type === "text" || annotation.type === "freetext"
                      ? annotation.selectedText || annotation.comment || ""
                      : "";
                  const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;

                  return (
                    <ContextMenu key={annotation.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleAnnotationClick(annotation)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleAnnotationClick(annotation);
                            }
                          }}
                          className={cn(
                            "group w-full text-left px-1.5 py-1 rounded transition-colors",
                            "hover:bg-muted/50",
                            selectedId === annotation.id && "bg-muted"
                          )}
                        >
                          <div className="flex items-start gap-1.5">
                            <span
                              className="mt-px flex-shrink-0"
                              style={{ color: annotation.color }}
                            >
                              {getAnnotationIcon(annotation.type)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] font-medium text-muted-foreground">
                                {getAnnotationLabel(annotation.type)}
                              </div>
                              {preview && (
                                <p className="text-xs text-foreground/90 line-clamp-2 leading-tight">
                                  {preview}
                                </p>
                              )}
                              {!preview && annotation.type === "area" && (
                                <p className="text-[10px] text-muted-foreground italic">
                                  Area selection
                                </p>
                              )}
                              {!preview && annotation.type === "drawing" && (
                                <p className="text-[10px] text-muted-foreground italic">
                                  Freehand drawing
                                </p>
                              )}
                              {!preview && annotation.type === "shape" && (
                                <p className="text-[10px] text-muted-foreground italic">
                                  Rectangle shape
                                </p>
                              )}
                            </div>
                            {onDelete && (
                              <button
                                type="button"
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(annotation.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onClick={() => onDelete?.(annotation.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
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
