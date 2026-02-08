import { useState, useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSettingsStore } from "@/stores/settingsStore";
import { reindexLibrary } from "@/services/tauri/commands";
import { Loader2 } from "lucide-react";

export function AISearchSection() {
  const {
    embeddingModel,
    setEmbeddingModel,
    enableOcr,
    setEnableOcr,
    forceOcr,
    setForceOcr,
  } = useSettingsStore();

  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [reindexDetail, setReindexDetail] = useState<{
    entryTitle: string | null;
    fileName: string | null;
    step: string;
    method: string | null;
    status: string;
    message: string | null;
  } | null>(null);
  const [reindexStatus, setReindexStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Listen for reindex progress events
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setupListeners = async () => {
      unlisteners.push(
        await listen<number>("reindex:start", (event) => {
          setReindexProgress({ current: 0, total: event.payload });
          setReindexStatus(null);
        })
      );

      unlisteners.push(
        await listen<[number, number]>("reindex:progress", (event) => {
          const [current, total] = event.payload;
          setReindexProgress({ current, total });
        })
      );

      unlisteners.push(
        await listen<number>("reindex:complete", (event) => {
          setReindexProgress(null);
          setReindexDetail(null);
          setReindexStatus({
            success: true,
            message: `Indexed ${event.payload} entries successfully!`,
          });
          setIsReindexing(false);
        })
      );

      // Listen for detailed progress events
      unlisteners.push(
        await listen<{
          current: number;
          total: number;
          entry_title: string | null;
          file_name: string | null;
          step: string;
          method: string | null;
          status: string;
          message: string | null;
        }>("reindex:detail", (event) => {
          const p = event.payload;
          setReindexDetail({
            entryTitle: p.entry_title,
            fileName: p.file_name,
            step: p.step,
            method: p.method,
            status: p.status,
            message: p.message,
          });
        })
      );
    };

    setupListeners();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const handleRebuildIndex = async () => {
    setIsReindexing(true);
    setReindexStatus(null);
    setReindexProgress(null);
    try {
      await reindexLibrary({
        enableOcr,
        forceOcr,
      });
      // Success is handled by the reindex:complete event listener
    } catch (err) {
      setReindexProgress(null);
      setReindexStatus({
        success: false,
        message: `Failed to rebuild index: ${err}`,
      });
      setIsReindexing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Embedding Model */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Semantic Search
        </h3>

        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Embedding Model</label>
            <select
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="all-MiniLM-L6-v2">
                all-MiniLM-L6-v2 (Fast, 384 dims)
              </option>
              <option value="all-MiniLM-L12-v2">
                all-MiniLM-L12-v2 (Balanced, 384 dims)
              </option>
              <option value="bge-small-en-v1.5">
                BGE Small EN v1.5 (Quality, 384 dims)
              </option>
              <option value="bge-base-en-v1.5">
                BGE Base EN v1.5 (Best, 768 dims)
              </option>
            </select>
            <p className="text-xs text-muted-foreground">
              Used for semantic search. Changing this will require re-indexing
              your library.
            </p>
          </div>
        </div>
      </section>

      {/* Document Extraction */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Document Extraction
        </h3>
        <p className="text-xs text-muted-foreground">
          Text is extracted from PDFs, EPUB, HTML, images, and other document formats using kreuzberg.
        </p>

        <label className="flex items-center gap-3 cursor-pointer">
          <Checkbox
            checked={enableOcr}
            onCheckedChange={(checked) => setEnableOcr(checked === true)}
          />
          <div>
            <span className="text-sm">Enable OCR for scanned documents</span>
            <p className="text-xs text-muted-foreground">
              Uses Tesseract OCR (bundled) to extract text from scanned PDFs and images.
              Disable for faster indexing if you only have text-based documents.
            </p>
          </div>
        </label>

        <label className={`flex items-center gap-3 cursor-pointer ${!enableOcr ? 'opacity-50 pointer-events-none' : ''}`}>
          <Checkbox
            checked={forceOcr}
            disabled={!enableOcr}
            onCheckedChange={(checked) => setForceOcr(checked === true)}
          />
          <div>
            <span className="text-sm">Force OCR for all documents</span>
            <p className="text-xs text-muted-foreground">
              Always run OCR, even for PDFs that have a text layer. Use this if you have
              scanned PDFs with incomplete or low-quality embedded text. Slower but more thorough.
              Applies to imports and index rebuilds.
            </p>
          </div>
        </label>
      </section>

      {/* Indexing */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Indexing
        </h3>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox defaultChecked />
            <span className="text-sm">Automatically index new items</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox defaultChecked />
            <span className="text-sm">Index document content for full-text search</span>
          </label>
        </div>

        <div className="pt-2 space-y-3">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRebuildIndex}
              disabled={isReindexing}
            >
              {isReindexing && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Rebuild Search Index
            </Button>
            {reindexStatus && !isReindexing && (
              <span
                className={`text-xs ${reindexStatus.success ? "text-green-600" : "text-destructive"}`}
              >
                {reindexStatus.message}
              </span>
            )}
          </div>
          {reindexProgress && (
            <div className="space-y-2">
              <Progress
                value={(reindexProgress.current / reindexProgress.total) * 100}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                Entry {reindexProgress.current + 1} of {reindexProgress.total}
              </p>
              {reindexDetail && (
                <div className="text-xs font-mono space-y-1 p-2 bg-muted/50 rounded border">
                  {reindexDetail.entryTitle && (
                    <p className="truncate">
                      <span className="text-muted-foreground">Entry: </span>
                      <span className="text-foreground font-medium">{reindexDetail.entryTitle}</span>
                    </p>
                  )}
                  {reindexDetail.fileName && (
                    <p className="truncate">
                      <span className="text-muted-foreground">File: </span>
                      <span className="text-blue-500">{reindexDetail.fileName}</span>
                    </p>
                  )}
                  <p>
                    <span className="text-muted-foreground">Step: </span>
                    <span className="text-purple-500">{reindexDetail.step}</span>
                    {reindexDetail.method && (
                      <>
                        <span className="text-muted-foreground"> via </span>
                        <span className="text-cyan-500">{reindexDetail.method}</span>
                      </>
                    )}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Status: </span>
                    <span
                      className={
                        reindexDetail.status === "success"
                          ? "text-green-500"
                          : reindexDetail.status === "failed"
                          ? "text-red-500"
                          : reindexDetail.status === "skipped"
                          ? "text-yellow-500"
                          : "text-blue-500"
                      }
                    >
                      {reindexDetail.status}
                    </span>
                    {reindexDetail.message && (
                      <span className="text-muted-foreground"> - {reindexDetail.message}</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}
          {!isReindexing && (
            <p className="text-xs text-muted-foreground">
              Recreates the full-text search index from scratch. Also extracts and saves
              markdown versions of all documents. Use this if search results seem incorrect.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
