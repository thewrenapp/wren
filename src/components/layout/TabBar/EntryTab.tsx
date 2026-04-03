import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PDFViewer } from "@/components/pdf/PDFViewer";
import { HTMLViewer } from "@/components/viewer/HTMLViewer";
import { EPUBViewer } from "@/components/epub/EPUBViewer";
import { ImageViewer } from "@/components/viewer/ImageViewer";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { ExtractedContentViewer } from "@/components/viewer/ExtractedContentViewer";
import { EntryInfoPanel } from "@/components/layout/RightPane/EntryInfoPanel";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { getEntry, openFileWithDefaultApp, type Entry, type Attachment } from "@/services/tauri/commands";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { toast } from "@/stores/toastStore";

/** Auto-opens a file in the system default app on mount, then closes the tab */
function AutoOpenFile({ filePath, entryId }: { filePath: string; entryId: string }) {
  useEffect(() => {
    openFileWithDefaultApp(filePath)
      .catch((err) => toast.error(`Failed to open file: ${err}`))
      .finally(() => {
        // Close this tab since the file is handled externally
        const { tabs, closeTab } = useTabStore.getState();
        const tab = tabs.find(t => t.type === "entry" && t.entryId === entryId);
        if (tab) closeTab(tab.id);
      });
  }, [filePath, entryId]);

  return null;
}

interface EntryTabProps {
  entryId: string;
  attachmentId?: string; // Specific attachment to display
  viewMode?: "default" | "extracted" | "parsed"; // "extracted" shows markdown viewer, "parsed" shows AI-structured content
  initialPdfPage?: number;
  initialHtmlScale?: number;
  onViewStateChange?: (state: Record<string, unknown>) => void;
}

export function EntryTab({ entryId, attachmentId, viewMode = "default", initialPdfPage, initialHtmlScale, onViewStateChange }: EntryTabProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { libraryLayout } = useUIStore();
  const { entryVersion } = useLibraryStore();

  // Per-instance info pane state (always starts closed)
  const [infoPaneOpen, setInfoPaneOpen] = useState(false);
  const toggleInfoPane = useCallback(() => setInfoPaneOpen(prev => !prev), []);

  // Listen for Cmd+I toggle event from keyboard shortcuts
  useEffect(() => {
    const handler = () => setInfoPaneOpen(prev => !prev);
    window.addEventListener("wren:toggle-info-pane", handler);
    return () => window.removeEventListener("wren:toggle-info-pane", handler);
  }, []);

  // Load entry details with attachments (also refetch when entryVersion changes)
  useEffect(() => {
    async function loadEntry() {
      setLoading(true);
      setError(null);

      try {
        const entryData = await getEntry(Number(entryId));
        setEntry(entryData);
      } catch (err) {
        console.error("Failed to load entry:", err);
        const errorMsg = err instanceof Error ? err.message : "Failed to load entry";
        setError(errorMsg);

        // If entry not found (deleted), automatically close this tab
        if (errorMsg.toLowerCase().includes("not found")) {
          const { tabs, closeTab } = useTabStore.getState();
          const tab = tabs.find(t => t.type === "entry" && t.entryId === entryId);
          if (tab) {
            toast.info("Entry was deleted, closing tab");
            closeTab(tab.id);
          }
        }
      } finally {
        setLoading(false);
      }
    }

    loadEntry();
  }, [entryId, entryVersion]);

  // All hooks must be before early returns (Rules of Hooks)
  const handlePdfViewStateChange = useCallback(
    (s: { page: number; scale: number }) => {
      onViewStateChange?.({ pdfPage: s.page, pdfScale: s.scale });
    },
    [onViewStateChange],
  );

  const handleHtmlViewStateChange = useCallback(
    (s: { scale: number }) => {
      onViewStateChange?.({ htmlScale: s.scale });
    },
    [onViewStateChange],
  );

  const entrySummary = useMemo(() => {
    if (!entry) return null;
    return {
      id: entry.id,
      key: entry.key,
      itemType: entry.itemType,
      itemTypeDisplay: entry.itemTypeDisplay,
      title: entry.title,
      creatorsDisplay: entry.creators?.map(c =>
        c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")
      ).join(", ") || "",
      year: entry.date?.split("-")[0],
      dateAdded: entry.dateAdded,
      tags: entry.tags,
      attachmentCount: entry.attachmentCount,
      hasPdf: entry.attachments?.some(a => a.attachmentType === "pdf") || false,
      hasEpub: entry.attachments?.some(a => a.attachmentType === "epub") || false,
      hasNote: entry.attachments?.some(a => a.attachmentType === "note") || false,
      hasWeblink: entry.attachments?.some(a => a.attachmentType === "weblink") || false,
      hasExtractedText: entry.attachments?.some(a => !!a.markdownPath) || false,
      hasStructuredContent: false,
    };
  }, [entry]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !entry || !entrySummary) {
    return (
      <div className="flex-1 flex items-center justify-center text-destructive">
        {error || "Failed to load entry"}
      </div>
    );
  }

  // Find the attachment to display
  let targetAttachment: Attachment | undefined;

  if (attachmentId) {
    targetAttachment = entry.attachments?.find(
      (a: Attachment) => String(a.id) === attachmentId
    );
  }

  const viewableTypes = ["pdf", "epub", "snapshot", "image"];
  if (!targetAttachment) {
    for (const type of viewableTypes) {
      targetAttachment = entry.attachments?.find(
        (a: Attachment) => a.attachmentType === type
      );
      if (targetAttachment) break;
    }
  }
  if (!targetAttachment) {
    targetAttachment = entry.attachments?.find(
      (a: Attachment) => a.filePath
    );
  }

  const isStacked = libraryLayout === "stacked";

  // Render main content based on attachment type
  const renderMainContent = () => {
    // Extracted/parsed text view: unified viewer handles both raw and structured
    if ((viewMode === "extracted" || viewMode === "parsed") && targetAttachment) {
      return <ExtractedContentViewer attachmentId={targetAttachment.id} entryId={entry.id} infoPaneOpen={infoPaneOpen} onToggleInfoPane={toggleInfoPane} />;
    }

    if (targetAttachment?.attachmentType === "pdf" && targetAttachment.filePath) {
      return <PDFViewer filePath={targetAttachment.filePath} attachmentId={String(targetAttachment.id)} infoPaneOpen={infoPaneOpen} onToggleInfoPane={toggleInfoPane} initialPage={initialPdfPage} onViewStateChange={onViewStateChange ? handlePdfViewStateChange : undefined} />;
    }

    if (targetAttachment?.attachmentType === "snapshot" && targetAttachment.filePath) {
      return <HTMLViewer filePath={targetAttachment.filePath} attachmentId={String(targetAttachment.id)} title={targetAttachment.title} infoPaneOpen={infoPaneOpen} onToggleInfoPane={toggleInfoPane} initialScale={initialHtmlScale} onViewStateChange={onViewStateChange ? handleHtmlViewStateChange : undefined} />;
    }

    if (targetAttachment?.attachmentType === "epub" && targetAttachment.filePath) {
      return <EPUBViewer filePath={targetAttachment.filePath} attachmentId={String(targetAttachment.id)} title={targetAttachment.title} infoPaneOpen={infoPaneOpen} onToggleInfoPane={toggleInfoPane} />;
    }

    if (targetAttachment?.attachmentType === "image" && targetAttachment.filePath) {
      return <ImageViewer filePath={targetAttachment.filePath} title={targetAttachment.title} />;
    }

    if (targetAttachment?.attachmentType === "note") {
      return <NoteEditor attachmentId={targetAttachment.id} infoPaneOpen={infoPaneOpen} onToggleInfoPane={toggleInfoPane} />;
    }

    // Weblink: show link with button to open in browser
    if (targetAttachment?.attachmentType === "weblink" && targetAttachment.filePath) {
      const url = targetAttachment.filePath;
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-3">
            <ExternalLink className="h-10 w-10 mx-auto opacity-40" />
            <p className="font-medium">{targetAttachment.title || entry.title}</p>
            <p className="text-xs opacity-60 max-w-md truncate">{url}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => shellOpen(url).catch(() => toast.error("Failed to open link"))}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Open in Browser
            </Button>
          </div>
        </div>
      );
    }

    // Other file types with a file path: auto-open in system default app
    if (targetAttachment?.filePath) {
      return <AutoOpenFile filePath={targetAttachment.filePath} entryId={entryId} />;
    }

    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="font-medium">{entry.title}</p>
          <p className="text-sm mt-2">
            {entry.attachments?.length === 0
              ? "No attachments"
              : "No viewable attachments"}
          </p>
        </div>
      </div>
    );
  };

  const mainContent = renderMainContent();

  const direction = isStacked ? "vertical" : "horizontal";
  const infoPanelPercent = isStacked ? 30 : 25;
  const handleClass = isStacked
    ? "h-[1px] bg-border hover:bg-primary/50 transition-colors"
    : "w-[1px] bg-border hover:bg-primary/50 transition-colors";

  return (
    <div className="h-full w-full">
      <ResizablePanelGroup direction={direction}>
        <ResizablePanel
          defaultSize={infoPaneOpen ? (100 - infoPanelPercent) : 100}
          minSize={isStacked ? 30 : 40}
          className="overflow-hidden"
        >
          {mainContent}
        </ResizablePanel>

        {infoPaneOpen && (
          <>
            <ResizableHandle className={handleClass} />
            <ResizablePanel
              defaultSize={infoPanelPercent}
              minSize={15}
              maxSize={isStacked ? 50 : 35}
              className="bg-background overflow-hidden"
            >
              <EntryInfoPanel entry={entrySummary} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
