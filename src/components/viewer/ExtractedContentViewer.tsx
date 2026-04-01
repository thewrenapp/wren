import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMarkdownContent,
  getParsedContent,
  parseDocument,
  deleteParsedContent,
  updateParsedContent,
  type ParsedContentFull,
} from "@/services/tauri/commands";
import { useJobStore } from "@/stores/jobStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useUIStore } from "@/stores/uiStore";
import { toast } from "@/stores/toastStore";
import { RichMarkdownEditor, type RichMarkdownEditorRef } from "@/components/editor/RichMarkdownEditor";
import { EditorSearchBar } from "@/components/editor/EditorSearchBar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  ScrollText,
  Search,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isInActiveView } from "@/lib/isInActiveView";

interface ExtractedContentViewerProps {
  attachmentId: number;
  entryId: number;
  infoPaneOpen?: boolean;
  onToggleInfoPane?: () => void;
}

type ViewMode = "structured" | "raw";

export function ExtractedContentViewer({
  attachmentId,
  entryId,
  infoPaneOpen,
  onToggleInfoPane,
}: ExtractedContentViewerProps) {
  // Raw extracted text
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(true);
  const [rawError, setRawError] = useState<string | null>(null);

  // Parsed/structured content
  const [parsed, setParsed] = useState<ParsedContentFull | null>(null);
  const [parsedLoading, setParsedLoading] = useState(true);
  const [enqueueing, setEnqueueing] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  // Search state
  const editorRef = useRef<RichMarkdownEditorRef>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrentMatch, setSearchCurrentMatch] = useState(0);
  const libraryLayout = useUIStore((s) => s.libraryLayout);

  const handleSearchStateChange = useCallback((matchCount: number, currentMatch: number) => {
    setSearchMatchCount(matchCount);
    setSearchCurrentMatch(currentMatch);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    editorRef.current?.clearSearch();
  }, []);

  // Ctrl+F handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isInActiveView(toolbarRef.current)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Which view is active
  const [viewMode, setViewMode] = useState<ViewMode>("raw"); // will switch to structured once loaded
  // Track whether user has manually toggled the view mode
  const userToggledRef = useRef(false);
  const setViewModeByUser = useCallback((mode: ViewMode) => {
    userToggledRef.current = true;
    setViewMode(mode);
  }, []);

  // Save handler for structured content (saves to parsed_content DB table)
  const handleSaveStructured = useCallback(
    async (attachmentId: number, content: string) => {
      await updateParsedContent(attachmentId, content);
    },
    [],
  );

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

  const parseStatus = !parsed
    ? "not_parsed"
    : parsed.status === "success" || parsed.status === "partial"
      ? "parsed"
      : parsed.status === "in_progress" || parsed.status === "pending"
        ? "in_progress"
        : parsed.status === "failed"
          ? "failed"
          : "parsed";

  // Load raw content
  const loadRaw = useCallback(async () => {
    setRawLoading(true);
    setRawError(null);
    try {
      const md = await getMarkdownContent(attachmentId);
      setRawContent(md);
    } catch (err) {
      setRawError(err instanceof Error ? err.message : "Failed to load content");
    } finally {
      setRawLoading(false);
    }
  }, [attachmentId]);

  useEffect(() => {
    loadRaw();
  }, [loadRaw]);

  // Load parsed content
  const loadParsedContent = useCallback(async () => {
    try {
      const result = await getParsedContent(attachmentId);
      setParsed(result);
      return result;
    } catch {
      // Silently fail — parsed content is optional
      return null;
    }
  }, [attachmentId]);

  // Initial load of parsed content + decide default view
  useEffect(() => {
    setParsedLoading(true);
    userToggledRef.current = false; // reset on attachment change
    loadParsedContent().then((result) => {
      setParsedLoading(false);
      // Default to structured view if parsed content is available
      if (result?.structuredMarkdown && (result.status === "success" || result.status === "partial")) {
        setViewMode("structured");
      }
    });
  }, [loadParsedContent]);

  // Auto-refresh when parse job completes
  const { entryVersion } = useLibraryStore();
  useEffect(() => {
    if (!parsedLoading) {
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

    // Job just completed OR stale in_progress status — do a final refresh.
    // Refresh immediately (no delay) so the UI doesn't briefly show stale
    // "Resume Parsing" after a force-cancel before the updated status is fetched.
    if (jobJustFinished || (!hasActiveParseJob && parseStatus === "in_progress")) {
      let cancelled = false;
      loadParsedContent().then((result) => {
        if (cancelled) return;
        // Auto-switch to structured only if user hasn't manually toggled
        if (!userToggledRef.current && result?.structuredMarkdown && (result.status === "success" || result.status === "partial")) {
          setViewMode("structured");
        }
      });
      return () => { cancelled = true; };
    }
  }, [hasActiveParseJob, parseStatus, loadParsedContent]);

  const handleParse = async () => {
    setEnqueueing(true);
    try {
      await parseDocument(attachmentId, entryId);
      toast.info("Document parsing started");
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
      setParsed(null);
    } catch (err) {
      toast.error(`Failed to start re-parsing: ${err}`);
    } finally {
      setEnqueueing(false);
    }
  };

  const handleDeleteParsed = async () => {
    try {
      await deleteParsedContent(attachmentId);
      setParsed(null);
      setViewMode("raw");
      toast.success("Structured content deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${err}`);
    }
  };

  // Loading state (both raw and parsed loading)
  if (rawLoading && parsedLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Raw content failed to load
  if (rawError && !parsed?.structuredMarkdown) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-destructive">
        {rawError}
      </div>
    );
  }

  // No content at all
  if (!rawContent && !parsed?.structuredMarkdown) {
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

  const hasStructured = !!(parsed?.structuredMarkdown && (parsed.status === "success" || parsed.status === "partial"));
  // Only show "Parsing..." when there's actually a running job.
  // DB status 'in_progress' without an active job means paused/cancelled (checkpoint saved).
  const isInProgress = hasActiveParseJob;
  // Paused = DB says in_progress but no active job (checkpoint saved, can resume)
  const isPaused = !hasActiveParseJob && parseStatus === "in_progress";

  // Structured view
  if (viewMode === "structured" && hasStructured) {
    return (
      <div ref={toolbarRef} className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Structured</span>
            {parsed?.status === "partial" && (
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
              onClick={() => setViewModeByUser("raw")}
              title="Switch to raw extracted text"
            >
              <ScrollText className="h-3 w-3" />
              Raw
            </Button>
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
              onClick={handleDeleteParsed}
              title="Delete structured content"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("h-7 w-7", searchOpen && "bg-accent")} title="Find in document">
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3">
                <EditorSearchBar
                  onSearch={(q, opts) => editorRef.current?.search(q, opts)}
                  onSearchNext={() => editorRef.current?.searchNext()}
                  onSearchPrev={() => editorRef.current?.searchPrev()}
                  onSearchClear={() => editorRef.current?.clearSearch()}
                  searchMatchCount={searchMatchCount}
                  searchCurrentMatch={searchCurrentMatch}
                  onClose={handleCloseSearch}
                />
              </PopoverContent>
            </Popover>
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
            key={`structured-${attachmentId}`}
            ref={editorRef}
            content={parsed!.structuredMarkdown!}
            attachmentId={attachmentId}
            showToolbar={false}
            showReindex={false}
            reindexOnUnmount={false}
            onSave={handleSaveStructured}
            onSearchStateChange={handleSearchStateChange}
          />
        </div>
      </div>
    );
  }

  // Raw view (default when no structured content, or user toggled to raw)
  return (
    <div ref={toolbarRef} className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Only show custom toolbar if there's something to toggle to or parse */}
      {(hasStructured || rawContent) && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background shrink-0">
          <span className="text-sm font-medium text-muted-foreground">Extracted Text</span>
          <div className="flex items-center gap-1">
            {hasStructured && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => setViewModeByUser("structured")}
                title="Switch to AI-structured view"
              >
                <Sparkles className="h-3 w-3" />
                Structured
              </Button>
            )}
            {isPaused && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleParse}
                disabled={!hasApiKey || enqueueing}
                title="Resume parsing from checkpoint"
              >
                {enqueueing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Resume Parsing
              </Button>
            )}
            {!hasStructured && !isInProgress && !isPaused && rawContent && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleParse}
                disabled={!hasApiKey || enqueueing}
                title={hasApiKey ? "Parse with AI into structured sections" : "Configure an LLM API key in Settings first"}
              >
                {enqueueing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Parse with AI
              </Button>
            )}
            {isInProgress && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Parsing...
              </span>
            )}
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("h-7 w-7", searchOpen && "bg-accent")} title="Find in document">
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3">
                <EditorSearchBar
                  onSearch={(q, opts) => editorRef.current?.search(q, opts)}
                  onSearchNext={() => editorRef.current?.searchNext()}
                  onSearchPrev={() => editorRef.current?.searchPrev()}
                  onSearchClear={() => editorRef.current?.clearSearch()}
                  searchMatchCount={searchMatchCount}
                  searchCurrentMatch={searchCurrentMatch}
                  onClose={handleCloseSearch}
                />
              </PopoverContent>
            </Popover>
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
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {rawContent ? (
          <RichMarkdownEditor
            key={`raw-${attachmentId}`}
            ref={editorRef}
            content={rawContent}
            attachmentId={attachmentId}
            showToolbar={false}
            showReindex={false}
            reindexOnUnmount={false}
            onSearchStateChange={handleSearchStateChange}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-2">
              <FileText className="h-10 w-10 mx-auto opacity-40" />
              <p className="text-sm">No extracted text available</p>
            </div>
          </div>
        )}
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
