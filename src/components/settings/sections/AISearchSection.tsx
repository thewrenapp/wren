import { useState, useCallback, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useSettingsStore, LLM_PROVIDER_DEFAULTS } from "@/stores/settingsStore";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "@/stores/toastStore";
import { listLlmModels, validateLlmConfig, ragStatus, ragIndexAll, ragRebuild, type LlmModelInfo, type RagStatus } from "@/services/tauri/commands";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, Network, AlertTriangle } from "lucide-react";

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "ollama_cloud", label: "Ollama Cloud" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "omlx", label: "oMLX" },
] as const;

const API_KEY_PLACEHOLDERS: Record<string, string> = {
  openai: "sk-...",
  anthropic: "sk-ant-...",
  gemini: "AIza...",
  ollama_cloud: "Bearer token...",
};

/** Reasoning-only models where we cannot disable chain-of-thought.
 *  These will work but are slower, more expensive, and may hit token limits. */
function isReasoningOnlyModel(provider: string, modelId: string): boolean {
  const m = modelId.toLowerCase();
  if (provider === "openai") {
    if (m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return true;
    if (m.startsWith("gpt-5") && !m.startsWith("gpt-5.1")) return true;
  }
  if (provider === "gemini") {
    // Gemini 3 Pro cannot disable thinking at all
    if (m.includes("gemini-3") && !m.includes("flash")) return true;
  }
  return false;
}

/** Models where reasoning is on by default but we auto-disable/minimize it. */
function isAutoDisabledReasoning(provider: string, modelId: string): boolean {
  const m = modelId.toLowerCase();
  if (provider === "openai" && m.startsWith("gpt-5.1")) return true;
  if (provider === "gemini" && m.includes("gemini-2.5")) return true;
  // Gemini 3 Flash: thinking set to "minimal" (mostly suppressed)
  if (provider === "gemini" && m.includes("gemini-3") && m.includes("flash")) return true;
  if ((provider === "ollama" || provider === "ollama_cloud" || provider === "omlx") && (m.includes("qwen3") || m.includes("qwen-3") || m.includes("deepseek-r1") || m.includes("deepseek-v3.1") || m.includes("qwq") || m.includes("glm-4") || m.includes("gpt-oss") || m.includes("magistral") || m.includes("nemotron"))) return true;
  return false;
}

/** Cloud embedding models available per LLM provider. */
const CLOUD_EMBEDDING_MODELS: Record<string, { id: string; name: string }[]> = {
  openai: [
    { id: "text-embedding-3-small", name: "text-embedding-3-small (1536d, recommended)" },
    { id: "text-embedding-3-large", name: "text-embedding-3-large (3072d, highest quality)" },
  ],
  anthropic: [],
  gemini: [
    { id: "text-embedding-004", name: "text-embedding-004 (768d)" },
  ],
  ollama: [
    { id: "nomic-embed-text", name: "nomic-embed-text (768d)" },
    { id: "mxbai-embed-large", name: "mxbai-embed-large (1024d)" },
    { id: "all-minilm", name: "all-minilm (384d)" },
    { id: "snowflake-arctic-embed", name: "snowflake-arctic-embed (1024d)" },
  ],
  ollama_cloud: [
    { id: "nomic-embed-text", name: "nomic-embed-text (768d)" },
    { id: "mxbai-embed-large", name: "mxbai-embed-large (1024d)" },
    { id: "all-minilm", name: "all-minilm (384d)" },
    { id: "snowflake-arctic-embed", name: "snowflake-arctic-embed (1024d)" },
  ],
  omlx: [], // oMLX embedding models fetched dynamically from API (filter by modelType === "embedding")
};

/** Fallback defaults shown before the API model list loads. */
const DEFAULT_MODELS: Record<string, { id: string; name: string }[]> = {
  openai: [
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
  ollama: [],
  ollama_cloud: [],
  omlx: [],
};

export function AISearchSection() {
  const {
    cloudEmbeddingModel,
    setCloudEmbeddingModel,
    llmProvider,
    setLlmProvider,
    llmApiKey,
    setLlmApiKey,
    llmModel,
    setLlmModel,
    llmBaseUrl,
    setLlmBaseUrl,
    llmAutoParseOnImport,
    setLlmAutoParseOnImport,
    aiAutoMetadata,
    setAiAutoMetadata,
    llmTokenBudget,
    setLlmTokenBudget,
    llmContextWindow,
    setLlmContextWindow,
    ragAutoIndex,
    setRagAutoIndex,
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

  // Auto-load models for oMLX (embedding/reranker dropdowns need them).
  // Retriggers when provider changes, API key changes, or test succeeds.
  useEffect(() => {
    if (llmProvider === "omlx") {
      listLlmModels().then(setModels).catch(() => {});
    }
  }, [llmProvider, llmApiKey, testResult]);

  // RAG index status
  const [ragStat, setGraphStat] = useState<RagStatus | null>(null);

  const hasActiveGraphJob = useJobStore((s) =>
    s.jobs.some(
      (j) =>
        (j.jobType === "rag_index_all" || j.jobType === "rag_index") &&
        (j.status === "pending" || j.status === "running")
    )
  );

  const loadRagStatus = useCallback(async () => {
    try {
      const status = await ragStatus();
      setGraphStat(status);
    } catch (err) {
      console.error("Failed to load RAG status:", err);
    }
  }, []);

  useEffect(() => {
    loadRagStatus();
  }, [loadRagStatus]);

  // Refresh RAG status when RAG jobs finish
  useEffect(() => {
    if (!hasActiveGraphJob) {
      loadRagStatus();
    }
  }, [hasActiveGraphJob, loadRagStatus]);

  const handleBuildGraph = async () => {
    try {
      await ragIndexAll();
      toast.info("RAG index build started in background");
    } catch (err) {
      toast.error(`Failed to start RAG build: ${err}`);
    }
  };

  const handleRebuildGraph = async () => {
    if (!window.confirm(
      "This will delete all existing RAG index data (chunks, vectors) and rebuild from scratch.\n\nThis is needed when the embedding model changes. Continue?"
    )) return;
    try {
      await ragRebuild();
      toast.info("RAG index cleared — rebuilding in background");
      loadRagStatus();
    } catch (err) {
      toast.error(`Failed to rebuild RAG index: ${err}`);
    }
  };

  const providerConfig = LLM_PROVIDER_DEFAULTS[llmProvider] ?? LLM_PROVIDER_DEFAULTS.openai;
  const requiresApiKey = providerConfig.requiresApiKey;
  const isLocal = !requiresApiKey;
  const hasApiKey = llmApiKey.length > 0;
  const isConfigured = isLocal || hasApiKey;

  const providerLabel = PROVIDER_OPTIONS.find(p => p.value === llmProvider)?.label ?? llmProvider;

  const defaultModels = DEFAULT_MODELS[llmProvider] ?? [];
  const defaultModelIds = defaultModels.map((m) => m.id);

  const handleRebuildIndex = async () => {
    try {
      await useJobStore.getState().enqueueJob(
        "reindex_library",
        {},
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
        toast.error(
          isLocal
            ? "Connection failed — is the server running?"
            : "Connection failed — check your API key"
        );
      }
    } catch (err) {
      setTestResult("error");
      toast.error(`Connection test failed: ${err}`);
    } finally {
      setTesting(false);
    }
  }, [isLocal]);

  const handleLoadModels = useCallback(async () => {
    if (requiresApiKey && !llmApiKey) return;
    setLoadingModels(true);
    try {
      const result = await listLlmModels();
      setModels(result);
    } catch (err) {
      console.error("Failed to load models:", err);
    } finally {
      setLoadingModels(false);
    }
  }, [llmApiKey, requiresApiKey]);

  const handleProviderChange = (newProvider: string) => {
    setLlmProvider(newProvider);
    setModels([]);
    setTestResult(null);
  };

  const triggerEmbeddingRebuild = async () => {
    const rebuild = window.confirm(
      "The embedding model has changed. Vectors need to be regenerated for semantic search to work.\n\nThis will NOT re-run LLM extraction — your entities and claims are safe.\n\nRe-embed now?"
    );
    if (rebuild) {
      try {
        await ragRebuild();
        toast.info("Re-embedding RAG index with new model...");
        loadRagStatus();
      } catch (err) {
        toast.error(`Failed to re-embed: ${err}`);
      }
    } else {
      toast.warning("Semantic search won't work until vectors are re-embedded.");
    }
  };

  const handleCloudEmbeddingModelChange = (newModel: string) => {
    const hasExistingGraph = ragStat && ragStat.totalChunks > 0;
    setCloudEmbeddingModel(newModel);
    if (hasExistingGraph) {
      triggerEmbeddingRebuild();
    }
  };

  return (
    <div className="space-y-8">
      {/* ── Section 1: AI Provider (shared config) ─────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          AI Provider
        </h3>
        <p className="text-xs text-muted-foreground">
          Configure your LLM provider. Used for document parsing, RAG generation, and embeddings.
        </p>

        <div className="space-y-4">
          {/* Provider */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key (only for cloud providers) */}
          {requiresApiKey && (
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
                    placeholder={API_KEY_PLACEHOLDERS[llmProvider] ?? "API key..."}
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
          )}

          {/* Test button for local providers */}
          {isLocal && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : testResult === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : testResult === "error" ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : null}
                <span className="ml-1.5">Test Connection</span>
              </Button>
              {testResult === "error" && (
                <span className="text-xs text-muted-foreground">
                  Make sure {llmProvider === "omlx" ? "oMLX" : "Ollama"} is running
                </span>
              )}
            </div>
          )}

          {/* Base URL */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {isLocal ? "Server URL" : "Base URL"}
            </label>
            <input
              type="url"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder={providerConfig.baseUrl}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {isLocal
                ? `Default: ${providerConfig.baseUrl}`
                : "Change only for custom or proxy endpoints."}
            </p>
          </div>
        </div>
      </section>

      {/* ── Section 2: AI Document Parsing ─────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          AI Document Parsing
        </h3>
        <p className="text-xs text-muted-foreground">
          Parse extracted text into structured sections using {providerLabel}.
        </p>

        <div className="space-y-4">
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
                {defaultModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                {/* Always show saved model so the value is never unmatched */}
                {llmModel && !defaultModelIds.includes(llmModel) &&
                  !models.some((m) => m.id === llmModel) && (
                  <option value={llmModel}>{llmModel}</option>
                )}
                {models
                  .filter((m) => !defaultModelIds.includes(m.id))
                  .filter((m) => !m.modelType || m.modelType === "llm" || m.modelType === "vlm")
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
            {isReasoningOnlyModel(llmProvider, llmModel) && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                This is a reasoning model — it spends tokens on internal chain-of-thought
                which makes it slower and more expensive for document parsing. Reasoning
                cannot be disabled for this model. Consider using a non-reasoning variant
                (e.g. gpt-5.1, gpt-4o).
              </p>
            )}
            {isAutoDisabledReasoning(llmProvider, llmModel) && (
              <p className="text-xs text-muted-foreground">
                Reasoning is automatically disabled for this model to optimize for document parsing.
              </p>
            )}
            {!isReasoningOnlyModel(llmProvider, llmModel) && !isAutoDisabledReasoning(llmProvider, llmModel) && (
              <p className="text-xs text-muted-foreground">
                {isLocal
                  ? "Click the dropdown to load models from your local server."
                  : "Click the dropdown to load available models from your provider."}
              </p>
            )}
          </div>

          {/* Context Window (shown for local providers) */}
          {isLocal && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Context Window</label>
              <select
                value={llmContextWindow}
                onChange={(e) => setLlmContextWindow(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value={0}>Auto (provider default)</option>
                <option value={4096}>4K tokens</option>
                <option value={8192}>8K tokens</option>
                <option value={16384}>16K tokens</option>
                <option value={32768}>32K tokens</option>
                <option value={65536}>64K tokens</option>
                <option value={131072}>128K tokens</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Context window of your local model. Larger windows mean fewer chunks and better structure discovery.
              </p>
            </div>
          )}

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

          {/* Auto-extract metadata */}
          <label className={`flex items-center gap-3 cursor-pointer ${!isConfigured ? "opacity-50 pointer-events-none" : ""}`}>
            <Checkbox
              checked={aiAutoMetadata}
              disabled={!isConfigured}
              onCheckedChange={(checked) => setAiAutoMetadata(checked === true)}
            />
            <div>
              <span className="text-sm">Extract metadata with AI after PDF import</span>
              <p className="text-xs text-muted-foreground">
                Uses AI to extract title, authors, year, abstract from imported PDFs.
                Not needed for BibTeX imports which already have metadata.
              </p>
            </div>
          </label>

          {/* Auto-parse */}
          <label className={`flex items-center gap-3 cursor-pointer ${!isConfigured ? "opacity-50 pointer-events-none" : ""}`}>
            <Checkbox
              checked={llmAutoParseOnImport}
              disabled={!isConfigured}
              onCheckedChange={(checked) => setLlmAutoParseOnImport(checked === true)}
            />
            <div>
              <span className="text-sm">Auto-parse documents on import</span>
              <p className="text-xs text-muted-foreground">
                Automatically run AI structuring after text extraction.
                {requiresApiKey ? " Uses API credits." : ""}
              </p>
            </div>
          </label>
        </div>
      </section>


      {/* ── Section 3: Documents & RAG ─────────────────────────────── */}
      <section className="space-y-5">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Documents & RAG
        </h3>
        <p className="text-xs text-muted-foreground">
          Configure embedding, retrieval strategies, reranking, and hierarchical indexing for document search.
        </p>

        {!isConfigured && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Configure an AI provider above to enable RAG features.
          </div>
        )}

        {isConfigured && (<>

        {/* Embedding Model */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Embedding Model <span className="text-destructive">*</span></label>
          <p className="text-xs text-muted-foreground">
            Required. Vectorizes document chunks and search queries for similarity search.
          </p>
          {llmProvider === "anthropic" ? (
            <p className="text-xs text-yellow-600 dark:text-yellow-400 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/20">
              Anthropic does not offer embedding models. Use oMLX or another provider for embeddings.
            </p>
          ) : (
            <select
              value={cloudEmbeddingModel}
              onChange={(e) => handleCloudEmbeddingModelChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {llmProvider === "omlx" ? (
                <>
                  {models.filter(m => m.modelType === "embedding").map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  {models.filter(m => m.modelType === "embedding").length === 0 && (
                    <option value="" disabled>No embedding models loaded in oMLX</option>
                  )}
                </>
              ) : (
                (CLOUD_EMBEDDING_MODELS[llmProvider] ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))
              )}
              {cloudEmbeddingModel &&
                !(llmProvider === "omlx"
                  ? models.some(m => m.id === cloudEmbeddingModel)
                  : (CLOUD_EMBEDDING_MODELS[llmProvider] ?? []).some(m => m.id === cloudEmbeddingModel)
                ) && (
                <option value={cloudEmbeddingModel}>{cloudEmbeddingModel}</option>
              )}
            </select>
          )}
        </div>


        {/* Reranker Model */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Reranker Model <span className="text-xs text-muted-foreground font-normal">(optional)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Cross-encoder for relevance scoring. Without this, results ranked by vector similarity only.
          </p>
          {llmProvider === "omlx" ? (
            <select
              defaultValue=""
              onChange={async (e) => {
                const model = e.target.value;
                const { updateSetting } = await import("@/services/tauri/commands");
                await updateSetting("reranker_provider", model ? "omlx" : "");
                await updateSetting("reranker_model", model);
              }}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="">None (vector similarity only)</option>
              {models.filter(m => m.modelType === "reranker").map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Reranker models available with oMLX. Local Jina/Cohere reranker models can be loaded in oMLX.
            </p>
          )}
        </div>

        {/* Index Status & Actions */}
        {ragStat && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {ragStat.entriesIndexed} of {ragStat.totalParseable} documents indexed
              </span>
            </div>
            {ragStat.totalParseable > 0 && (
              <div className="w-full bg-muted rounded-full h-1.5">
                <div className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round((ragStat.entriesIndexed / ragStat.totalParseable) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleBuildGraph} disabled={hasActiveGraphJob}>
            {hasActiveGraphJob && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Build Semantic Index
          </Button>
          {ragStat && ragStat.entriesIndexed > 0 && (
            <Button variant="outline" size="sm" onClick={handleRebuildGraph} disabled={hasActiveGraphJob}
              className="text-destructive hover:text-destructive">
              Rebuild Semantic Index
            </Button>
          )}
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <Checkbox checked={ragAutoIndex} onCheckedChange={(checked) => setRagAutoIndex(checked === true)} />
          <div>
            <span className="text-sm">Auto-index after text extraction</span>
            <p className="text-xs text-muted-foreground">
              Automatically chunk and embed documents into the RAG index after import.
            </p>
          </div>
        </label>

        </>)}
      </section>
      {/* ── Section 5: Document Extraction ─────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Document Extraction
        </h3>
        <p className="text-xs text-muted-foreground">
          PDFs are parsed with ferrules (deep learning layout analysis + automatic OCR + table detection).
          OCR runs automatically when scanned pages are detected. Other formats (EPUB, HTML, DOCX) use format-specific parsers.
        </p>
      </section>

      {/* ── Section 6: Full-text Search Index ──────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Search Index
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
              Re-extract & Index Library
            </Button>
            {hasActiveReindex && (
              <span className="text-xs text-muted-foreground">
                Running in background — check the task tracker for progress
              </span>
            )}
          </div>
          {!hasActiveReindex && (
            <p className="text-xs text-muted-foreground">
              Re-runs text extraction (ferrules) on all documents, rebuilds full-text search,
              and rebuilds semantic index. Use when documents or extraction settings change.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
