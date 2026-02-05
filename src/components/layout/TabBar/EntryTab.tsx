import { useState, useEffect } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PDFViewer } from "@/components/pdf/PDFViewer";
import { HTMLViewer } from "@/components/viewer/HTMLViewer";
import { EntryInfoPanel } from "@/components/layout/RightPane/EntryInfoPanel";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useTabStore } from "@/stores/tabStore";
import { getEntry, type Entry, type Attachment } from "@/services/tauri/commands";
import { toast } from "@/stores/toastStore";

interface EntryTabProps {
  entryId: string;
  attachmentId?: string; // Specific attachment to display
}

export function EntryTab({ entryId, attachmentId }: EntryTabProps) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    rightPaneWidth,
    setRightPaneWidth,
    infoPanelHeight,
    setInfoPanelHeight,
    libraryLayout,
    infoPaneOpen,
  } = useUIStore();
  const { entryVersion } = useLibraryStore();

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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="flex-1 flex items-center justify-center text-destructive">
        {error || "Failed to load entry"}
      </div>
    );
  }

  // Find the attachment to display
  let targetAttachment: Attachment | undefined;

  if (attachmentId) {
    // If a specific attachment is requested, find it
    targetAttachment = entry.attachments?.find(
      (a: Attachment) => String(a.id) === attachmentId
    );
  }

  // If no specific attachment or not found, default to first PDF
  if (!targetAttachment) {
    targetAttachment = entry.attachments?.find(
      (a: Attachment) => a.attachmentType === "pdf"
    );
  }

  // Create entry summary for info panel
  const entrySummary = {
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
    hasNote: entry.attachments?.some(a => a.attachmentType === "note") || false,
    hasWeblink: entry.attachments?.some(a => a.attachmentType === "weblink") || false,
  };

  const totalWidth = typeof window !== "undefined" ? window.innerWidth : 1000;
  const totalHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const rightPanePercent = (rightPaneWidth / totalWidth) * 100;
  const bottomPanePercent = (infoPanelHeight / totalHeight) * 100;

  // Render main content based on attachment type
  const renderMainContent = () => {
    if (targetAttachment?.attachmentType === "pdf" && targetAttachment.filePath) {
      return <PDFViewer filePath={targetAttachment.filePath} attachmentId={String(targetAttachment.id)} />;
    }

    if (targetAttachment?.attachmentType === "snapshot" && targetAttachment.filePath) {
      return <HTMLViewer filePath={targetAttachment.filePath} attachmentId={String(targetAttachment.id)} title={targetAttachment.title} />;
    }

    if (targetAttachment?.attachmentType === "note") {
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="font-medium">{entry.title}</p>
            <p className="text-sm mt-2">Note Editor - Coming Soon</p>
          </div>
        </div>
      );
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

  // Stacked layout: vertical split (content on top, info on bottom)
  if (libraryLayout === "stacked") {
    if (!infoPaneOpen) {
      return <div className="h-full w-full">{mainContent}</div>;
    }

    return (
      <div className="h-full w-full">
        <ResizablePanelGroup direction="vertical">
          {/* Main content */}
          <ResizablePanel
            defaultSize={100 - bottomPanePercent}
            minSize={30}
          >
            {mainContent}
          </ResizablePanel>

          {/* Bottom pane (details) */}
          <ResizableHandle className="h-[1px] bg-border hover:bg-primary/50 transition-colors" />
          <ResizablePanel
            defaultSize={bottomPanePercent}
            minSize={15}
            maxSize={50}
            onResize={(size) => {
              const newHeight = (size / 100) * totalHeight;
              setInfoPanelHeight(newHeight);
            }}
            className="bg-background"
          >
            <EntryInfoPanel entry={entrySummary} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  // Normal layout: horizontal split (content on left, info on right)
  if (!infoPaneOpen) {
    return <div className="h-full w-full">{mainContent}</div>;
  }

  return (
    <div className="h-full w-full">
      <ResizablePanelGroup direction="horizontal">
        {/* Main content */}
        <ResizablePanel
          defaultSize={100 - rightPanePercent}
          minSize={40}
        >
          {mainContent}
        </ResizablePanel>

        {/* Right pane (details) */}
        <ResizableHandle className="w-[1px] bg-border hover:bg-primary/50 transition-colors" />
        <ResizablePanel
          defaultSize={rightPanePercent}
          minSize={15}
          maxSize={35}
          onResize={(size) => {
            const newWidth = (size / 100) * totalWidth;
            setRightPaneWidth(newWidth);
          }}
          className="bg-background"
        >
          <EntryInfoPanel entry={entrySummary} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
