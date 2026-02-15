import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "@/stores/toastStore";
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

  const hasActiveReindex = useJobStore((s) =>
    s.jobs.some(
      (j) =>
        j.jobType === "reindex_library" &&
        (j.status === "pending" || j.status === "running")
    )
  );

  const handleRebuildIndex = async () => {
    try {
      await useJobStore.getState().enqueueJob(
        "reindex_library",
        { enableOcr, forceOcr },
        { title: "Reindex Library" }
      );
      toast.info("Library reindex started in background");
    } catch (err) {
      toast.error(`Failed to start reindex: ${err}`);
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
              disabled={hasActiveReindex}
            >
              {hasActiveReindex && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Rebuild Search Index
            </Button>
            {hasActiveReindex && (
              <span className="text-xs text-muted-foreground">
                Running in background — check the task tracker for progress
              </span>
            )}
          </div>
          {!hasActiveReindex && (
            <p className="text-xs text-muted-foreground">
              Recreates the full-text search index from scratch. Also extracts and saves
              markdown versions of all documents. Runs as a background task.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
