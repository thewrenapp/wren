import { useState, useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settingsStore";
import { checkOllamaStatus, reindexLibrary } from "@/services/tauri/commands";
import { Loader2 } from "lucide-react";

export function AISearchSection() {
  const {
    embeddingModel,
    setEmbeddingModel,
    skipOcr,
    setSkipOcr,
    ollamaEnabled,
    ollamaEndpoint,
    ollamaVisionModel,
    setOllamaEnabled,
    setOllamaEndpoint,
    setOllamaVisionModel,
  } = useSettingsStore();

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
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

  // Fetch available models when Ollama is enabled or endpoint changes
  useEffect(() => {
    if (ollamaEnabled && ollamaEndpoint) {
      fetchAvailableModels();
    }
  }, [ollamaEnabled, ollamaEndpoint]);

  const fetchAvailableModels = async () => {
    setIsLoadingModels(true);
    try {
      const status = await checkOllamaStatus(ollamaEndpoint);
      if (status.connected) {
        setAvailableModels(status.models);
        // If current model is not in the list and there are models available, select the first one
        if (status.models.length > 0 && !status.models.includes(ollamaVisionModel)) {
          setOllamaVisionModel(status.models[0]);
        }
      } else {
        setAvailableModels([]);
      }
    } catch {
      setAvailableModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleRebuildIndex = async () => {
    setIsReindexing(true);
    setReindexStatus(null);
    setReindexProgress(null);
    try {
      await reindexLibrary({
        skipOcr,
        ollamaEnabled: skipOcr ? false : ollamaEnabled,
        ollamaEndpoint,
        ollamaModel: ollamaVisionModel,
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

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus(null);
    try {
      const status = await checkOllamaStatus(ollamaEndpoint);
      if (status.connected) {
        setAvailableModels(status.models);
        // Auto-select first model if current is not available
        if (status.models.length > 0 && !status.models.includes(ollamaVisionModel)) {
          setOllamaVisionModel(status.models[0]);
        }
        setConnectionStatus({
          success: true,
          message: status.models.length > 0
            ? `Connected! ${status.models.length} model(s) available.`
            : "Connected, but no multimodal models found.",
        });
      } else {
        setAvailableModels([]);
        setConnectionStatus({
          success: false,
          message: "Could not connect to Ollama",
        });
      }
    } catch (err) {
      setAvailableModels([]);
      setConnectionStatus({
        success: false,
        message: `Connection failed: ${err}`,
      });
    } finally {
      setIsTestingConnection(false);
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

      {/* Document OCR */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Document OCR
        </h3>
        <p className="text-xs text-muted-foreground">
          Extract text from scanned PDFs using OCR. Disable to skip scanned PDFs entirely (faster indexing).
        </p>

        <label className="flex items-center gap-3 cursor-pointer">
          <Checkbox
            checked={skipOcr}
            onCheckedChange={(checked) => setSkipOcr(checked === true)}
          />
          <div>
            <span className="text-sm">Skip OCR for scanned PDFs</span>
            <p className="text-xs text-muted-foreground">
              Only index text-based PDFs. Scanned documents will be skipped.
            </p>
          </div>
        </label>

        {!skipOcr && (
          <>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={ollamaEnabled}
                onCheckedChange={(checked) => setOllamaEnabled(checked === true)}
              />
              <div>
                <span className="text-sm">Use Ollama for better OCR</span>
                <p className="text-xs text-muted-foreground">
                  Uses Ollama vision models. Falls back to traditional OCR if disabled.
                </p>
              </div>
            </label>
          </>
        )}

        {!skipOcr && ollamaEnabled && (
          <div className="space-y-4 pl-7">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ollama Endpoint</label>
              <Input
                value={ollamaEndpoint}
                onChange={(e) => setOllamaEndpoint(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Vision Model</label>
              {isLoadingModels ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading models...
                </div>
              ) : availableModels.length > 0 ? (
                <Select
                  value={ollamaVisionModel}
                  onValueChange={setOllamaVisionModel}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No multimodal models found. Install a vision model in Ollama (e.g., <code className="bg-muted px-1 rounded">ollama pull llava</code>)
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
              >
                {isTestingConnection && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Test Connection
              </Button>
              {connectionStatus && (
                <span
                  className={`text-xs ${connectionStatus.success ? "text-green-600" : "text-destructive"}`}
                >
                  {connectionStatus.message}
                </span>
              )}
            </div>
          </div>
        )}
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
            <span className="text-sm">Index document content for full-text search (PDF, Markdown, HTML, Text)</span>
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
              Recreates the full-text search index from scratch. Use this if search results seem incorrect.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
