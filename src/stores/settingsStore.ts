import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getSettings, updateSetting } from "@/services/tauri/commands";
import { toast } from "@/stores/toastStore";

export type Theme = "system" | "light" | "dark";

export interface CodeTheme {
  light: string;
  dark: string;
}

interface SettingsState {
  // Appearance
  theme: Theme;
  codeTheme: CodeTheme;

  // Library
  libraryPath: string;

  // File Handling
  autoRenameFiles: boolean;

  // Embedding
  embeddingModel: string;
  embeddingSource: "local" | "cloud";
  cloudEmbeddingModel: string;

  // OCR Settings
  enableOcr: boolean;
  forceOcr: boolean;

  // LLM Settings
  llmProvider: string;
  llmApiKey: string; // active key for current provider (derived from llmApiKeys)
  llmApiKeys: Record<string, string>; // per-provider API keys
  llmModel: string;
  llmBaseUrl: string;
  llmAutoParseOnImport: boolean;
  aiAutoMetadata: boolean;
  llmTokenBudget: number;
  llmContextWindow: number; // 0 = auto-detect from provider defaults

  // RAG (Document Search)
  ragAutoIndex: boolean;
  ragGenModel: string;         // LLM model for HyDE/step-back/CRAG (defaults to llmModel)
  cragEnabled: boolean;
  cragUpperThreshold: number;  // 1-100, default 60
  cragLowerThreshold: number;  // 1-100, default 25
  raptorEnabled: boolean;
  raptorTokenBudget: number;   // default 2000
  raptorRetrievalMode: string; // "collapsed" | "tree_traversal"

  // Code Editor
  showCodeLineNumbers: boolean;

  // Startup
  showWelcomeOnStartup: boolean;

  // Actions
  setTheme: (theme: Theme) => void;
  setCodeTheme: (codeTheme: CodeTheme) => void;
  setShowCodeLineNumbers: (show: boolean) => void;
  setLibraryPath: (path: string) => void;
  setAutoRenameFiles: (enabled: boolean) => void;
  setEmbeddingModel: (model: string) => void;
  setEmbeddingSource: (source: "local" | "cloud") => void;
  setCloudEmbeddingModel: (model: string) => void;
  setEnableOcr: (enabled: boolean) => void;
  setForceOcr: (enabled: boolean) => void;
  setLlmProvider: (provider: string) => void;
  setLlmApiKey: (key: string) => void;
  setLlmModel: (model: string) => void;
  setLlmBaseUrl: (url: string) => void;
  setLlmAutoParseOnImport: (enabled: boolean) => void;
  setAiAutoMetadata: (enabled: boolean) => void;
  setLlmTokenBudget: (budget: number) => void;
  setLlmContextWindow: (size: number) => void;
  setRagAutoIndex: (enabled: boolean) => void;
  setRagGenModel: (model: string) => void;
  setCragEnabled: (enabled: boolean) => void;
  setCragUpperThreshold: (value: number) => void;
  setCragLowerThreshold: (value: number) => void;
  setRaptorEnabled: (enabled: boolean) => void;
  setRaptorTokenBudget: (value: number) => void;
  setRaptorRetrievalMode: (mode: string) => void;
  setShowWelcomeOnStartup: (show: boolean) => void;
  loadFromBackend: () => Promise<void>;
}

export const LLM_PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string; requiresApiKey: boolean }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", requiresApiKey: true },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-20250514", requiresApiKey: true },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", requiresApiKey: true },
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "llama3.2", requiresApiKey: false },
  ollama_cloud: { baseUrl: "https://ollama.com", defaultModel: "", requiresApiKey: true },
  omlx: { baseUrl: "http://localhost:1234/v1", defaultModel: "", requiresApiKey: true },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "system",
      codeTheme: { light: "github-light", dark: "github-dark" },
      libraryPath: "~/Wren",
      autoRenameFiles: true,
      embeddingModel: "all-MiniLM-L6-v2",
      embeddingSource: "local",
      cloudEmbeddingModel: "text-embedding-3-small",
      enableOcr: true,
      forceOcr: false,
      llmProvider: "openai",
      llmApiKey: "",
      llmApiKeys: {},
      llmModel: "gpt-4o-mini",
      llmBaseUrl: "https://api.openai.com/v1",
      llmAutoParseOnImport: false,
      aiAutoMetadata: false,
      llmTokenBudget: 200000,
      llmContextWindow: 0,
      ragAutoIndex: true,
      ragGenModel: "",
      cragEnabled: false,
      cragUpperThreshold: 60,
      cragLowerThreshold: 25,
      raptorEnabled: false,
      raptorTokenBudget: 2000,
      raptorRetrievalMode: "tree_traversal",
      showCodeLineNumbers: false,
      showWelcomeOnStartup: true,

      setTheme: (theme) => set({ theme }),
      setCodeTheme: (codeTheme) => set({ codeTheme }),
      setShowCodeLineNumbers: (show) => set({ showCodeLineNumbers: show }),
      setLibraryPath: (path) => set({ libraryPath: path }),
      setAutoRenameFiles: async (enabled) => {
        const prev = get().autoRenameFiles;
        set({ autoRenameFiles: enabled });
        try {
          await updateSetting("auto_rename_files", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update auto_rename_files setting:", err);
          set({ autoRenameFiles: prev });
          toast.error("Failed to update setting");
        }
      },
      setEmbeddingModel: async (model) => {
        const prev = get().embeddingModel;
        set({ embeddingModel: model });
        try {
          await updateSetting("embedding_model", model);
        } catch (err) {
          console.error("Failed to update embedding_model setting:", err);
          set({ embeddingModel: prev });
          toast.error("Failed to update setting");
        }
      },
      setEmbeddingSource: async (source) => {
        const prev = get().embeddingSource;
        set({ embeddingSource: source });
        try {
          await updateSetting("embedding_source", source);
        } catch (err) {
          console.error("Failed to update embedding_source setting:", err);
          set({ embeddingSource: prev });
          toast.error("Failed to update setting");
        }
      },
      setCloudEmbeddingModel: async (model) => {
        const prev = get().cloudEmbeddingModel;
        set({ cloudEmbeddingModel: model });
        try {
          await updateSetting("cloud_embedding_model", model);
        } catch (err) {
          console.error("Failed to update cloud_embedding_model setting:", err);
          set({ cloudEmbeddingModel: prev });
          toast.error("Failed to update setting");
        }
      },
      setEnableOcr: async (enabled) => {
        const prev = get().enableOcr;
        set({ enableOcr: enabled });
        try {
          await updateSetting("enable_ocr", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update enable_ocr setting:", err);
          set({ enableOcr: prev });
          toast.error("Failed to update setting");
        }
      },
      setForceOcr: async (enabled) => {
        const prev = get().forceOcr;
        set({ forceOcr: enabled });
        try {
          await updateSetting("force_ocr", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update force_ocr setting:", err);
          set({ forceOcr: prev });
          toast.error("Failed to update setting");
        }
      },
      setLlmProvider: async (provider) => {
        const prev = get().llmProvider;
        const defaults = LLM_PROVIDER_DEFAULTS[provider] ?? LLM_PROVIDER_DEFAULTS.openai;
        const keys = get().llmApiKeys;
        set({
          llmProvider: provider,
          llmApiKey: keys[provider] || "",
          llmBaseUrl: defaults.baseUrl,
          llmModel: defaults.defaultModel,
        });
        try {
          await Promise.all([
            updateSetting("llm_provider", provider),
            updateSetting("llm_base_url", defaults.baseUrl),
            updateSetting("llm_model", defaults.defaultModel),
          ]);
        } catch (err) {
          console.error("Failed to update llm_provider setting:", err);
          set({ llmProvider: prev });
          toast.error("Failed to update setting");
        }
      },
      setLlmApiKey: async (key) => {
        const prev = get().llmApiKey;
        const provider = get().llmProvider;
        set({
          llmApiKey: key,
          llmApiKeys: { ...get().llmApiKeys, [provider]: key },
        });
        try {
          // Save as per-provider key in backend
          await updateSetting(`llm_api_key_${provider}`, key);
        } catch (err) {
          console.error("Failed to update llm_api_key setting:", err);
          set({ llmApiKey: prev });
          toast.error("Failed to update setting");
        }
      },
      setLlmModel: async (model) => {
        const prev = get().llmModel;
        set({ llmModel: model });
        try {
          await updateSetting("llm_model", model);
        } catch (err) {
          console.error("Failed to update llm_model setting:", err);
          set({ llmModel: prev });
          toast.error("Failed to update setting");
        }
      },
      setLlmBaseUrl: async (url) => {
        const prev = get().llmBaseUrl;
        set({ llmBaseUrl: url });
        try {
          await updateSetting("llm_base_url", url);
        } catch (err) {
          console.error("Failed to update llm_base_url setting:", err);
          set({ llmBaseUrl: prev });
          toast.error("Failed to update setting");
        }
      },
      setLlmAutoParseOnImport: async (enabled) => {
        const prev = get().llmAutoParseOnImport;
        set({ llmAutoParseOnImport: enabled });
        try {
          await updateSetting("llm_auto_parse", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update llm_auto_parse setting:", err);
          set({ llmAutoParseOnImport: prev });
          toast.error("Failed to update setting");
        }
      },
      setAiAutoMetadata: async (enabled) => {
        set({ aiAutoMetadata: enabled });
        await updateSetting("ai_auto_metadata", enabled ? "true" : "false").catch(() => {});
      },
      setLlmTokenBudget: async (budget) => {
        const prev = get().llmTokenBudget;
        set({ llmTokenBudget: budget });
        try {
          await updateSetting("llm_token_budget", String(budget));
        } catch (err) {
          console.error("Failed to update llm_token_budget setting:", err);
          set({ llmTokenBudget: prev });
          toast.error("Failed to update setting");
        }
      },
      setLlmContextWindow: async (size) => {
        const prev = get().llmContextWindow;
        set({ llmContextWindow: size });
        try {
          await updateSetting("llm_context_window", String(size));
        } catch (err) {
          console.error("Failed to update llm_context_window setting:", err);
          set({ llmContextWindow: prev });
          toast.error("Failed to update setting");
        }
      },
      setRagAutoIndex: async (enabled) => {
        const prev = get().ragAutoIndex;
        set({ ragAutoIndex: enabled });
        try {
          await updateSetting("rag_auto_index", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update rag_auto_index setting:", err);
          set({ ragAutoIndex: prev });
          toast.error("Failed to update setting");
        }
      },
      setRagGenModel: async (model) => {
        set({ ragGenModel: model });
        await updateSetting("rag_gen_model", model).catch(() => {});
      },
      setCragEnabled: async (enabled) => {
        set({ cragEnabled: enabled });
        await updateSetting("crag_enabled", enabled ? "true" : "false").catch(() => {});
      },
      setCragUpperThreshold: async (value) => {
        set({ cragUpperThreshold: value });
        await updateSetting("crag_upper_threshold", String(value)).catch(() => {});
      },
      setCragLowerThreshold: async (value) => {
        set({ cragLowerThreshold: value });
        await updateSetting("crag_lower_threshold", String(value)).catch(() => {});
      },
      setRaptorEnabled: async (enabled) => {
        set({ raptorEnabled: enabled });
        await updateSetting("raptor_enabled", enabled ? "true" : "false").catch(() => {});
      },
      setRaptorTokenBudget: async (value) => {
        set({ raptorTokenBudget: value });
        await updateSetting("raptor_token_budget", String(value)).catch(() => {});
      },
      setRaptorRetrievalMode: async (mode) => {
        set({ raptorRetrievalMode: mode });
        await updateSetting("raptor_retrieval_mode", mode).catch(() => {});
      },
      setShowWelcomeOnStartup: (show) => set({ showWelcomeOnStartup: show }),
      loadFromBackend: async () => {
        try {
          const settings = await getSettings();
          const settingsMap = new Map(settings.map(s => [s.key, s.value]));

          const autoRename = settingsMap.get("auto_rename_files");
          if (autoRename !== undefined) {
            set({ autoRenameFiles: autoRename === "true" });
          }
          const embeddingModel = settingsMap.get("embedding_model");
          if (embeddingModel !== undefined) set({ embeddingModel });
          const embeddingSource = settingsMap.get("embedding_source");
          if (embeddingSource !== undefined && (embeddingSource === "local" || embeddingSource === "cloud")) {
            set({ embeddingSource });
          }
          const cloudEmbeddingModel = settingsMap.get("cloud_embedding_model");
          if (cloudEmbeddingModel !== undefined) set({ cloudEmbeddingModel });
          const enableOcr = settingsMap.get("enable_ocr");
          if (enableOcr !== undefined) {
            set({ enableOcr: enableOcr === "true" });
          }
          const forceOcr = settingsMap.get("force_ocr");
          if (forceOcr !== undefined) {
            set({ forceOcr: forceOcr === "true" });
          }
          // LLM settings
          const llmProviderVal = settingsMap.get("llm_provider");
          let resolvedProvider = get().llmProvider;
          if (llmProviderVal !== undefined) {
            // Migrate legacy "lmstudio" → "omlx" (persist to backend so Rust sees it too)
            if (llmProviderVal === "lmstudio") {
              resolvedProvider = "omlx";
              set({ llmProvider: "omlx" });
              // Persist migration to backend DB
              updateSetting("llm_provider", "omlx").catch(() => {});
            } else {
              resolvedProvider = llmProviderVal;
              set({ llmProvider: llmProviderVal });
            }
          }

          // Load per-provider API keys
          const providerNames = ["openai", "anthropic", "gemini", "ollama", "ollama_cloud", "omlx"];
          const keys: Record<string, string> = { ...get().llmApiKeys };
          for (const p of providerNames) {
            const k = settingsMap.get(`llm_api_key_${p}`);
            if (k !== undefined) keys[p] = k;
          }
          set({ llmApiKeys: keys, llmApiKey: keys[resolvedProvider] || "" });

          const llmModel = settingsMap.get("llm_model");
          if (llmModel !== undefined) set({ llmModel });
          const llmBaseUrl = settingsMap.get("llm_base_url");
          if (llmBaseUrl !== undefined) set({ llmBaseUrl });
          const llmAutoParse = settingsMap.get("llm_auto_parse");
          if (llmAutoParse !== undefined) set({ llmAutoParseOnImport: llmAutoParse === "true" });
          const llmTokenBudget = settingsMap.get("llm_token_budget");
          if (llmTokenBudget !== undefined) set({ llmTokenBudget: parseInt(llmTokenBudget, 10) || 200000 });
          const llmContextWindow = settingsMap.get("llm_context_window");
          if (llmContextWindow !== undefined) set({ llmContextWindow: parseInt(llmContextWindow, 10) || 0 });
          const aiAutoMeta = settingsMap.get("ai_auto_metadata");
          if (aiAutoMeta !== undefined) set({ aiAutoMetadata: aiAutoMeta === "true" });
          const ragAutoIndex = settingsMap.get("rag_auto_index");
          if (ragAutoIndex !== undefined) set({ ragAutoIndex: ragAutoIndex !== "false" });

          // RAG advanced settings
          const ragGenModel = settingsMap.get("rag_gen_model");
          if (ragGenModel !== undefined) set({ ragGenModel });
          const cragEnabled = settingsMap.get("crag_enabled");
          if (cragEnabled !== undefined) set({ cragEnabled: cragEnabled === "true" });
          const cragUpper = settingsMap.get("crag_upper_threshold");
          if (cragUpper !== undefined) set({ cragUpperThreshold: parseInt(cragUpper, 10) || 60 });
          const cragLower = settingsMap.get("crag_lower_threshold");
          if (cragLower !== undefined) set({ cragLowerThreshold: parseInt(cragLower, 10) || 25 });
          const raptorEnabled = settingsMap.get("raptor_enabled");
          if (raptorEnabled !== undefined) set({ raptorEnabled: raptorEnabled === "true" });
          const raptorBudget = settingsMap.get("raptor_token_budget");
          if (raptorBudget !== undefined) set({ raptorTokenBudget: parseInt(raptorBudget, 10) || 2000 });
          const raptorMode = settingsMap.get("raptor_retrieval_mode");
          if (raptorMode !== undefined) set({ raptorRetrievalMode: raptorMode });
        } catch (err) {
          console.error("Failed to load settings from backend:", err);
        }
      },
    }),
    {
      name: "wren-settings",
    }
  )
);
