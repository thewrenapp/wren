import { useState, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "@/stores/toastStore";
import { listLlmModels, validateLlmConfig, type LlmModelInfo } from "@/services/tauri/commands";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";

export function AISearchSection() {
  const {
    embeddingModel,
    setEmbeddingModel,
    enableOcr,
    setEnableOcr,
    forceOcr,
    setForceOcr,
    llmProvider,
    llmApiKey,
    setLlmApiKey,
    llmModel,
    setLlmModel,
    llmBaseUrl,
    setLlmBaseUrl,
    llmAutoParseOnImport,
    setLlmAutoParseOnImport,
    llmTokenBudget,
    setLlmTokenBudget,
  } = useSettingsStore();

  const hasActiveReindex = useJobStore((s) =>
    s.jobs.some(
      (j) =>
        j.jobType === "reindex_library" &&
        (j.status === "pending" || j.status === "running")
    )
  );

  // LLM settings state
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

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

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const valid = await validateLlmConfig();
      setTestResult(valid ? "success" : "error");
      if (valid) {
        toast.success("Connection successful");
      } else {
        toast.error("Connection failed — check your API key");
      }
    } catch (err) {
      setTestResult("error");
      toast.error(`Connection test failed: ${err}`);
    } finally {
      setTesting(false);
    }
  }, []);

  const handleLoadModels = useCallback(async () => {
    if (!llmApiKey) return;
    setLoadingModels(true);
    try {
      const result = await listLlmModels();
      setModels(result);
    } catch (err) {
      console.error("Failed to load models:", err);
    } finally {
      setLoadingModels(false);
    }
  }, [llmApiKey]);

  const hasApiKey = llmApiKey.length > 0;

  return (
    <div className="space-y-8">
      {/* LLM Document Parsing */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          LLM Document Parsing
        </h3>
        <p className="text-xs text-muted-foreground">
          Use an LLM to parse extracted text into structured sections. Requires an API key.
        </p>

        <div className="space-y-4">
          {/* Provider */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Provider</label>
            <select
              value={llmProvider}
              disabled
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-60"
            >
              <option value="openai">OpenAI</option>
            </select>
            <p className="text-xs text-muted-foreground">
              More providers coming soon (Anthropic, Gemini, Ollama).
            </p>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={llmApiKey}
                  onChange={(e) => {
                    setLlmApiKey(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 pr-9 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={!hasApiKey || testing}
                className="shrink-0"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : testResult === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : testResult === "error" ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : null}
                <span className="ml-1.5">Test</span>
              </Button>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            <div className="flex gap-2">
              <select
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                onFocus={handleLoadModels}
                className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                {models
                  .filter((m) => m.id !== "gpt-4o-mini" && m.id !== "gpt-4o")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              {loadingModels && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground self-center" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              gpt-4o-mini is fast and low cost. Click the dropdown to load available models from your provider.
            </p>
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Base URL</label>
            <input
              type="url"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Default: OpenAI API. Change for OpenAI-compatible endpoints.
            </p>
          </div>

          {/* Token Budget */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Token Budget per Document
              <span className="ml-2 text-xs text-muted-foreground font-normal tabular-nums">
                {(llmTokenBudget / 1000).toFixed(0)}K tokens
              </span>
            </label>
            <input
              type="range"
              min={50000}
              max={500000}
              step={10000}
              value={llmTokenBudget}
              onChange={(e) => setLlmTokenBudget(parseInt(e.target.value, 10))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50K</span>
              <span>500K</span>
            </div>
          </div>

          {/* Auto-parse */}
          <label className={`flex items-center gap-3 cursor-pointer ${!hasApiKey ? "opacity-50 pointer-events-none" : ""}`}>
            <Checkbox
              checked={llmAutoParseOnImport}
              disabled={!hasApiKey}
              onCheckedChange={(checked) => setLlmAutoParseOnImport(checked === true)}
            />
            <div>
              <span className="text-sm">Auto-parse documents on import</span>
              <p className="text-xs text-muted-foreground">
                Automatically structure extracted text after import. Uses API credits.
              </p>
            </div>
          </label>
        </div>
      </section>

      {/* Semantic Search */}
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
