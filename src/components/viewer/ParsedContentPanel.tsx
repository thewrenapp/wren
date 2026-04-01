import { useState, useEffect, useCallback, useRef } from "react";
import {
  getParsedContent,
  parseDocument,
  deleteParsedContent,
  type ParsedContentFull,
} from "@/services/tauri/commands";
import { useJobStore } from "@/stores/jobStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { toast } from "@/stores/toastStore";
import { RichMarkdownEditor } from "@/components/editor/RichMarkdownEditor";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  Clock,
  Cpu,
  Layers,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

interface ParsedContentPanelProps {
  attachmentId: number;
  entryId: number;
  title?: string;
  infoPaneOpen?: boolean;
  onToggleInfoPane?: () => void;
}

type ParseStatus = "loading" | "not_parsed" | "in_progress" | "parsed" | "partial" | "failed" | "error";

export function ParsedContentPanel({
  attachmentId,
  entryId,
  infoPaneOpen,
  onToggleInfoPane,
}: ParsedContentPanelProps) {
  const [parsed, setParsed] = useState<ParsedContentFull | null>(null);
  const [status, setStatus] = useState<ParseStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enqueueing, setEnqueueing] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const libraryLayout = useUIStore((s) => s.libraryLayout);

  const llmApiKey = useSettingsStore((s) => s.llmApiKey);
  const llmProvider = useSettingsStore((s) => s.llmProvider);
  const isLocalProvider = llmProvider === "ollama";
  const hasApiKey = isLocalProvider || llmApiKey.length > 0;

  // Watch for job completion to auto-refresh
  const jobs = useJobStore((s) => s.jobs);
  const hasActiveParseJob = jobs.some((j) => {
    if (j.jobType !== "llm_parse") return false;
    if (j.status !== "pending" && j.status !== "running") return false;
    try {
      const payload = JSON.parse(j.payloadJson);
      return payload.attachmentId === attachmentId;
    } catch {
      return false;
    }
  });

  const loadParsedContent = useCallback(async () => {
    try {
      const result = await getParsedContent(attachmentId);
      setParsed(result);
      if (!result) {
        setStatus("not_parsed");
      } else if (result.status === "success") {
        setStatus("parsed");
      } else if (result.status === "partial") {
        setStatus("partial");
      } else if (result.status === "in_progress" || result.status === "pending") {
        setStatus("in_progress");
      } else if (result.status === "failed") {
        setStatus("failed");
      } else {
        setStatus("parsed");
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load parsed content");
      setStatus("error");
    }
  }, [attachmentId]);

  // Initial load
  useEffect(() => {
    setStatus("loading");
    loadParsedContent();
  }, [loadParsedContent]);

  // Auto-refresh when parse job completes
  const { entryVersion } = useLibraryStore();
  useEffect(() => {
    if (status !== "loading") {
      loadParsedContent();
    }
  }, [entryVersion, loadParsedContent]);

  // Track previous hasActiveParseJob to detect completion transition
  const prevHasActiveRef = useRef(false);

  // Poll when there's an active job, refresh when job completes
  useEffect(() => {
    const jobJustFinished = prevHasActiveRef.current && !hasActiveParseJob;
    prevHasActiveRef.current = hasActiveParseJob;

    if (hasActiveParseJob) {
      const interval = setInterval(loadParsedContent, 3000);
      return () => clearInterval(interval);
    }

    // Job just completed OR stale in_progress status — do a final refresh
    if (jobJustFinished || (!hasActiveParseJob && status === "in_progress")) {
      const timer = setTimeout(loadParsedContent, 1000);
      return () => clearTimeout(timer);
    }
  }, [hasActiveParseJob, status, loadParsedContent]);

  const handleParse = async () => {
    setEnqueueing(true);
    try {
      await parseDocument(attachmentId, entryId);
      toast.info("Document parsing started");
      setStatus("in_progress");
    } catch (err) {
      toast.error(`Failed to start parsing: ${err}`);
    } finally {
      setEnqueueing(false);
    }
  };

  const handleReparse = async () => {
    setEnqueueing(true);
    try {
      await deleteParsedContent(attachmentId);
      await parseDocument(attachmentId, entryId);
      toast.info("Re-parsing started");
      setStatus("in_progress");
      setParsed(null);
    } catch (err) {
      toast.error(`Failed to start re-parsing: ${err}`);
    } finally {
      setEnqueueing(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteParsedContent(attachmentId);
      setParsed(null);
      setStatus("not_parsed");
      toast.success("Parsed content deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${err}`);
    }
  };

  // Loading state
  if (status === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Error loading
  if (status === "error") {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-destructive">
        <div className="text-center space-y-2">
          <p className="text-sm">{loadError || "Failed to load parsed content"}</p>
          <Button variant="outline" size="sm" onClick={loadParsedContent}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Not yet parsed — CTA
  if (status === "not_parsed" || status === "failed") {
    return (
      <div className="flex-1 flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background shrink-0">
          <span className="text-sm font-medium text-muted-foreground">Structured View</span>
          {onToggleInfoPane && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleInfoPane} title="Toggle info pane">
              {infoPaneOpen ? (
                <PanelRightClose className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              ) : (
                <PanelRight className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              )}
            </Button>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-sm px-4">
            <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {status === "failed" ? "Parsing failed" : "No structured content yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {status === "failed"
                  ? "The previous parse attempt failed. You can try again."
                  : "Use AI to parse the extracted text into clean, structured sections with proper headings."}
              </p>
              {parsed?.status === "failed" && parsed.pipelineStagesJson && (
                <p className="text-xs text-destructive mt-2">
                  {(() => {
                    try {
                      const stages = JSON.parse(parsed.pipelineStagesJson);
                      const failed = stages.find((s: { status: string }) => s.status === "failed");
                      return failed?.error || "Unknown error";
                    } catch {
                      return null;
                    }
                  })()}
                </p>
              )}
            </div>
            <Button
              onClick={handleParse}
              disabled={!hasApiKey || enqueueing}
              className="gap-2"
            >
              {enqueueing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {status === "failed" ? "Retry Parse" : "Parse with AI"}
            </Button>
            {!hasApiKey && !isLocalProvider && (
              <p className="text-xs text-muted-foreground">
                Configure an LLM API key in Settings to enable parsing.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // In progress — distinguish active job vs paused (no active job but DB says in_progress)
  if (status === "in_progress") {
    if (!hasActiveParseJob) {
      // Paused/cancelled — checkpoint saved, show resume option
      return (
        <div className="flex-1 flex flex-col h-full">
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background shrink-0">
            <span className="text-sm font-medium text-muted-foreground">Structured View</span>
            {onToggleInfoPane && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleInfoPane} title="Toggle info pane">
                {infoPaneOpen ? (
                <PanelRightClose className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              ) : (
                <PanelRight className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              )}
              </Button>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4 max-w-sm px-4">
              <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/40" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Parsing paused</p>
                <p className="text-xs text-muted-foreground">
                  Progress has been saved. Resume to continue from where it left off.
                </p>
              </div>
              <Button
                onClick={handleParse}
                disabled={!hasApiKey || enqueueing}
                className="gap-2"
              >
                {enqueueing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Resume Parsing
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Active job running — show spinner
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background shrink-0">
          <span className="text-sm font-medium text-muted-foreground">Structured View</span>
          {onToggleInfoPane && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleInfoPane} title="Toggle info pane">
              {infoPaneOpen ? (
                <PanelRightClose className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              ) : (
                <PanelRight className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              )}
            </Button>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Parsing in progress...</p>
              <p className="text-xs text-muted-foreground">
                Check the background tasks panel for progress details.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Parsed (success or partial) — show structured content
  const structuredMarkdown = parsed?.structuredMarkdown;

  if (!structuredMarkdown) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <FileText className="h-10 w-10 mx-auto opacity-40" />
          <p className="text-sm">No structured content available</p>
          <Button variant="outline" size="sm" onClick={handleReparse} disabled={enqueueing}>
            Re-parse
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Structured View</span>
          {status === "partial" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              Partial
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setShowMetadata(!showMetadata)}
          >
            {showMetadata ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Info
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleReparse}
            disabled={enqueueing}
            title="Re-parse document"
          >
            {enqueueing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={handleDelete}
            title="Delete parsed content"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {onToggleInfoPane && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleInfoPane} title="Toggle info pane">
              {infoPaneOpen ? (
                <PanelRightClose className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              ) : (
                <PanelRight className={cn("h-4 w-4", libraryLayout === "stacked" && "rotate-90")} />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Metadata bar (collapsible) */}
      {showMetadata && parsed && (
        <div className="px-3 py-2 border-b bg-muted/30 text-xs text-muted-foreground shrink-0">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {parsed.documentType && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {parsed.documentType}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {parsed.sectionsCount} section{parsed.sectionsCount !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {parsed.modelUsed} ({parsed.provider})
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              {(parsed.totalTokensUsed / 1000).toFixed(1)}K tokens
            </span>
            {parsed.dateCompleted && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatRelativeDate(parsed.dateCompleted)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <RichMarkdownEditor
          content={structuredMarkdown}
          attachmentId={attachmentId}
          showToolbar={false}
          showReindex={false}
          reindexOnUnmount={false}
        />
      </div>
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
