import { useState, useCallback, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useSettingsStore, LLM_PROVIDER_DEFAULTS } from "@/stores/settingsStore";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "@/stores/toastStore";
import { listLlmModels, validateLlmConfig, graphStatus, graphIndexAll, graphAutoRelate, graphRebuild, graphReembed, type LlmModelInfo, type GraphStatus } from "@/services/tauri/commands";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, Network, AlertTriangle } from "lucide-react";

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "ollama_cloud", label: "Ollama Cloud" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "lmstudio", label: "LM Studio (local)" },
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
  if ((provider === "ollama" || provider === "ollama_cloud" || provider === "lmstudio") && (m.includes("qwen3") || m.includes("qwen-3") || m.includes("deepseek-r1") || m.includes("deepseek-v3.1") || m.includes("qwq") || m.includes("glm-4") || m.includes("gpt-oss") || m.includes("magistral") || m.includes("nemotron"))) return true;
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
  lmstudio: [
    { id: "nomic-embed-text-v1.5-GGUF", name: "nomic-embed-text v1.5 (768d)" },
    { id: "text-embedding-bge-m3-GGUF", name: "BGE-M3 (1024d)" },
  ],
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
  lmstudio: [],
};

export function AISearchSection() {
  const {
    embeddingModel,
    setEmbeddingModel,
    embeddingSource,
    setEmbeddingSource,
    cloudEmbeddingModel,
    setCloudEmbeddingModel,
    enableOcr,
    setEnableOcr,
    forceOcr,
    setForceOcr,
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
    llmTokenBudget,
    setLlmTokenBudget,
    llmContextWindow,
    setLlmContextWindow,
    graphAutoIndex,
    setGraphAutoIndex,
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

  // Knowledge graph status
  const [graphStat, setGraphStat] = useState<GraphStatus | null>(null);

  const hasActiveGraphJob = useJobStore((s) =>
    s.jobs.some(
      (j) =>
        (j.jobType === "graph_index_all" || j.jobType === "graph_relate") &&
        (j.status === "pending" || j.status === "running")
    )
  );

  const loadGraphStatus = useCallback(async () => {
    try {
      const status = await graphStatus();
      setGraphStat(status);
    } catch (err) {
      console.error("Failed to load graph status:", err);
    }
  }, []);

  useEffect(() => {
    loadGraphStatus();
  }, [loadGraphStatus]);

  // Refresh graph status when graph jobs finish
  useEffect(() => {
    if (!hasActiveGraphJob) {
      loadGraphStatus();
    }
  }, [hasActiveGraphJob, loadGraphStatus]);

  const handleBuildGraph = async () => {
    try {
      await graphIndexAll();
      toast.info("Knowledge graph build started in background");
    } catch (err) {
      toast.error(`Failed to start graph build: ${err}`);
    }
  };

  const handleRebuildGraph = async () => {
    if (!window.confirm(
      "This will delete all existing knowledge graph data (entities, claims, vectors) and rebuild from scratch.\n\nThis is needed when the embedding model changes. Continue?"
    )) return;
    try {
      await graphRebuild();
      toast.info("Knowledge graph cleared — rebuilding in background");
      loadGraphStatus();
    } catch (err) {
      toast.error(`Failed to rebuild graph: ${err}`);
    }
  };

  const handleFindRelated = async () => {
    try {
      await graphAutoRelate();
      toast.info("Finding related papers in background");
    } catch (err) {
      toast.error(`Failed to start auto-relate: ${err}`);
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
        await graphReembed();
        toast.info("Re-embedding knowledge graph with new model...");
        loadGraphStatus();
      } catch (err) {
        toast.error(`Failed to re-embed: ${err}`);
      }
    } else {
      toast.warning("Semantic search won't work until vectors are re-embedded.");
    }
  };

  const handleEmbeddingModelChange = (newModel: string) => {
    const hasExistingGraph = graphStat && graphStat.chunkCount > 0;
    setEmbeddingModel(newModel);
    if (hasExistingGraph) {
      triggerEmbeddingRebuild();
    }
  };

  const handleCloudEmbeddingModelChange = (newModel: string) => {
    const hasExistingGraph = graphStat && graphStat.chunkCount > 0;
    setCloudEmbeddingModel(newModel);
    if (hasExistingGraph) {
      triggerEmbeddingRebuild();
    }
  };

  const handleEmbeddingSourceChange = (newSource: "local" | "cloud") => {
    const hasExistingGraph = graphStat && graphStat.chunkCount > 0;
    setEmbeddingSource(newSource);
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
          Configure your LLM provider. This connection is used for document parsing, knowledge extraction, and cloud embeddings.
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
                  Make sure {llmProvider === "lmstudio" ? "LM Studio" : "Ollama"} is running
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

      {/* ── Section 3: Knowledge Graph ─────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Knowledge Graph
        </h3>
        <p className="text-xs text-muted-foreground">
          Extract entities, claims, and relationships from parsed documents using
          {" "}<strong>{providerLabel} / {llmModel || "—"}</strong>.
          {" "}Enables concept-based search and automatic paper linking.
        </p>

        {!isConfigured && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            Configure an AI provider above to enable knowledge graph features.
          </div>
        )}

        {/* Status */}
        {graphStat && isConfigured && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {graphStat.papersIndexed} of {graphStat.totalParseable} documents indexed
              </span>
            </div>
            {graphStat.totalParseable > 0 && (
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{
                    width: `${Math.round((graphStat.papersIndexed / graphStat.totalParseable) * 100)}%`,
                  }}
                />
              </div>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>{graphStat.entityCount} entities</span>
              <span>{graphStat.claimCount} claims</span>
              <span>{graphStat.chunkCount} chunks</span>
            </div>
          </div>
        )}

        {/* Actions */}
        {isConfigured && (
          <>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBuildGraph}
                disabled={hasActiveGraphJob}
              >
                {hasActiveGraphJob && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Build Knowledge Graph
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFindRelated}
                disabled={hasActiveGraphJob || !graphStat?.papersIndexed}
              >
                Find Related Papers
              </Button>
              {graphStat && graphStat.papersIndexed > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRebuildGraph}
                  disabled={hasActiveGraphJob}
                  className="text-destructive hover:text-destructive"
                >
                  Rebuild
                </Button>
              )}
            </div>
            {hasActiveGraphJob && (
              <p className="text-xs text-muted-foreground">
                Running in background — check the task tracker for progress
              </p>
            )}

            {/* Auto-index toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={graphAutoIndex}
                onCheckedChange={(checked) => setGraphAutoIndex(checked === true)}
              />
              <div>
                <span className="text-sm">Auto-index after AI parsing</span>
                <p className="text-xs text-muted-foreground">
                  Automatically add documents to the knowledge graph after AI structuring completes.
                </p>
              </div>
            </label>
          </>
        )}
      </section>

      {/* ── Section 4: Semantic Search / Embeddings ────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Semantic Search
        </h3>
        <p className="text-xs text-muted-foreground">
          Embedding model used for vector search across entities and document chunks.
        </p>

        <div className="space-y-3">
          {/* Embedding source toggle */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Embedding Source</label>
            <select
              value={embeddingSource}
              onChange={(e) => handleEmbeddingSourceChange(e.target.value as "local" | "cloud")}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="local">Local (fastembed, runs on your machine)</option>
              <option value="cloud">Cloud (use {providerLabel}&apos;s embedding API)</option>
            </select>
          </div>

          {/* Local embedding model selector */}
          {embeddingSource === "local" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Local Embedding Model</label>
              <select
                value={embeddingModel}
                onChange={(e) => handleEmbeddingModelChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <optgroup label="English — Fast">
                  <option value="all-MiniLM-L6-v2">all-MiniLM-L6-v2 (384d, fastest)</option>
                  <option value="all-MiniLM-L12-v2">all-MiniLM-L12-v2 (384d, balanced)</option>
                  <option value="snowflake-arctic-embed-xs">Snowflake Arctic Embed XS (384d, fast)</option>
                </optgroup>
                <optgroup label="English — Quality">
                  <option value="bge-small-en-v1.5">BGE Small EN v1.5 (384d)</option>
                  <option value="bge-base-en-v1.5">BGE Base EN v1.5 (768d)</option>
                  <option value="bge-large-en-v1.5">BGE Large EN v1.5 (1024d)</option>
                  <option value="gte-base-en-v1.5">GTE Base EN v1.5 (768d)</option>
                  <option value="gte-large-en-v1.5">GTE Large EN v1.5 (1024d)</option>
                  <option value="snowflake-arctic-embed-m">Snowflake Arctic Embed M (768d)</option>
                  <option value="snowflake-arctic-embed-l">Snowflake Arctic Embed L (1024d, best)</option>
                  <option value="mxbai-embed-large-v1">Mxbai Embed Large v1 (1024d)</option>
                </optgroup>
                <optgroup label="English — Long Context">
                  <option value="nomic-embed-text-v1.5">Nomic Embed Text v1.5 (768d, 8K ctx)</option>
                  <option value="jina-embeddings-v2-base-en">Jina Embeddings v2 Base EN (768d, 8K ctx)</option>
                  <option value="snowflake-arctic-embed-m-long">Snowflake Arctic Embed M Long (768d, 2K ctx)</option>
                </optgroup>
                <optgroup label="Multilingual">
                  <option value="bge-m3">BGE-M3 (1024d, 100+ languages, 8K ctx)</option>
                  <option value="multilingual-e5-small">Multilingual E5 Small (384d)</option>
                  <option value="multilingual-e5-base">Multilingual E5 Base (768d)</option>
                  <option value="multilingual-e5-large">Multilingual E5 Large (1024d)</option>
                  <option value="paraphrase-ml-minilm-l12-v2">Paraphrase ML MiniLM L12 v2 (384d)</option>
                </optgroup>
                <optgroup label="Code">
                  <option value="jina-embeddings-v2-base-code">Jina Embeddings v2 Base Code (768d)</option>
                </optgroup>
              </select>
              <p className="text-xs text-muted-foreground">
                Downloads the model on first use (~25-90 MB). Changing models requires rebuilding the knowledge graph.
              </p>
            </div>
          )}

          {/* Cloud embedding model selector */}
          {embeddingSource === "cloud" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Cloud Embedding Model</label>
              {llmProvider === "anthropic" ? (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                  Anthropic does not offer embedding models. Switch to a different provider above,
                  or use local embeddings instead.
                </p>
              ) : (
                <>
                  <select
                    value={cloudEmbeddingModel}
                    onChange={(e) => handleCloudEmbeddingModelChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {(CLOUD_EMBEDDING_MODELS[llmProvider] ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                    {/* Show saved model if not in the preset list */}
                    {cloudEmbeddingModel &&
                      !(CLOUD_EMBEDDING_MODELS[llmProvider] ?? []).some((m) => m.id === cloudEmbeddingModel) && (
                      <option value={cloudEmbeddingModel}>{cloudEmbeddingModel}</option>
                    )}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Uses the API key and endpoint from {providerLabel} above.
                    {(llmProvider === "ollama" || llmProvider === "lmstudio") &&
                      " Make sure the embedding model is pulled/downloaded in your local server."}
                    {" "}Changing models requires rebuilding the knowledge graph.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 5: Document Extraction ─────────────────────────── */}
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
              scanned PDFs with incomplete or low-quality embedded text.
            </p>
          </div>
        </label>
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
