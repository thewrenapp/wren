import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUIStore } from "@/stores/uiStore";
import { ragGetSummaries, ragGetCollectionSummaries, type RagSummary } from "@/services/tauri/commands";
import { Loader2, TreePine, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

type Tab = "document" | "collection";

export function RaptorSummariesDialog() {
  const { raptorDialog, hideRaptorDialog } = useUIStore();
  const [tab, setTab] = useState<Tab>("document");
  const [docSummaries, setDocSummaries] = useState<RagSummary[]>([]);
  const [colSummaries, setColSummaries] = useState<RagSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const open = raptorDialog !== null;
  const entryId = raptorDialog?.entryId ?? 0;
  const entryTitle = raptorDialog?.entryTitle ?? "";
  const collectionIds = raptorDialog?.collectionIds ?? [];

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setDocSummaries([]);
    setColSummaries([]);
    setTab("document");

    (async () => {
      try {
        const docs = await ragGetSummaries(entryId);
        setDocSummaries(docs);

        if (collectionIds.length > 0) {
          const cols = await ragGetCollectionSummaries(collectionIds[0]);
          setColSummaries(cols);
        }
      } catch (err) {
        console.error("Failed to load RAPTOR summaries:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, entryId]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) hideRaptorDialog(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">
            RAPTOR Summaries — {entryTitle}
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          <button
            onClick={() => setTab("document")}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
              tab === "document"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <TreePine className="h-3.5 w-3.5 inline mr-1.5" />
            Document ({docSummaries.length})
          </button>
          {collectionIds.length > 0 && (
            <button
              onClick={() => setTab("collection")}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
                tab === "collection"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <FolderOpen className="h-3.5 w-3.5 inline mr-1.5" />
              Collection ({colSummaries.length})
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading summaries...</span>
            </div>
          ) : tab === "document" ? (
            <SummaryList summaries={docSummaries} emptyMessage="No document-level RAPTOR summaries. Enable RAPTOR in Settings and rebuild the semantic index." />
          ) : (
            <SummaryList summaries={colSummaries} emptyMessage="No cross-document summaries. Right-click the collection → Rebuild Cross-doc Summaries." />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryList({ summaries, emptyMessage }: { summaries: RagSummary[]; emptyMessage: string }) {
  if (summaries.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const levels = Array.from(new Set(summaries.map((s) => s.level))).sort();

  return (
    <div className="space-y-4 py-2">
      {levels.map((level) => (
        <div key={level}>
          <div className="sticky top-0 bg-popover/95 backdrop-blur-sm z-10 py-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Level {level} — {summaries.filter((s) => s.level === level).length} summaries
            </h3>
          </div>
          <div className="space-y-2 mt-1">
            {summaries
              .filter((s) => s.level === level)
              .map((s, i) => (
                <div
                  key={i}
                  className="text-sm text-foreground/90 bg-muted/30 rounded-lg p-3 leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                >
                  <ReactMarkdown>{s.content}</ReactMarkdown>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
