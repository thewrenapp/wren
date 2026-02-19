import { useState, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useSettingsStore, LLM_PROVIDER_DEFAULTS } from "@/stores/settingsStore";
import { useJobStore } from "@/stores/jobStore";
import { toast } from "@/stores/toastStore";
import { listLlmModels, validateLlmConfig, type LlmModelInfo } from "@/services/tauri/commands";
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";

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

  const providerConfig = LLM_PROVIDER_DEFAULTS[llmProvider] ?? LLM_PROVIDER_DEFAULTS.openai;
  const requiresApiKey = providerConfig.requiresApiKey;
  const isLocal = !requiresApiKey;
  const hasApiKey = llmApiKey.length > 0;
  const isConfigured = isLocal || hasApiKey;

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

  return (
    <div className="space-y-8">
      {/* LLM Document Parsing */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          LLM Document Parsing
        </h3>
        <p className="text-xs text-muted-foreground">
          Use an LLM to parse extracted text into structured sections.
          {requiresApiKey ? " Requires an API key." : " Connects to a locally running server."}
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

          {/* Context Window (shown for local providers, or when overridden) */}
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
                Check your model's documentation for the supported context size.
              </p>
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
              <span className="text-sm">Auto-parse documents with AI</span>
              <p className="text-xs text-muted-foreground">
                Automatically run AI structuring after text extraction — applies to imports and new attachments.
                {requiresApiKey ? " Uses API credits." : ""}
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
