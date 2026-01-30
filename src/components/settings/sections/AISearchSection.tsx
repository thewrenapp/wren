import { useSettingsStore } from "@/stores/settingsStore";

export function AISearchSection() {
  const { embeddingModel, setEmbeddingModel } = useSettingsStore();

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
              className="w-full px-3 py-2 text-sm border rounded-md bg-background"
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

      {/* Indexing */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Indexing
        </h3>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={true}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Automatically index new items</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={true}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Index PDF content for full-text search</span>
          </label>
        </div>
      </section>
    </div>
  );
}
