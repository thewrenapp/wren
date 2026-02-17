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

  // OCR Settings
  enableOcr: boolean;
  forceOcr: boolean;

  // LLM Settings
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  llmAutoParseOnImport: boolean;
  llmTokenBudget: number;
  llmContextWindow: number; // 0 = auto-detect from provider defaults

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
  setEnableOcr: (enabled: boolean) => void;
  setForceOcr: (enabled: boolean) => void;
  setLlmProvider: (provider: string) => void;
  setLlmApiKey: (key: string) => void;
  setLlmModel: (model: string) => void;
  setLlmBaseUrl: (url: string) => void;
  setLlmAutoParseOnImport: (enabled: boolean) => void;
  setLlmTokenBudget: (budget: number) => void;
  setLlmContextWindow: (size: number) => void;
  setShowWelcomeOnStartup: (show: boolean) => void;
  loadFromBackend: () => Promise<void>;
}

export const LLM_PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string; requiresApiKey: boolean }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", requiresApiKey: true },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-20250514", requiresApiKey: true },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", requiresApiKey: true },
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "llama3.2", requiresApiKey: false },
  lmstudio: { baseUrl: "http://localhost:1234/v1", defaultModel: "", requiresApiKey: false },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "system",
      codeTheme: { light: "github-light", dark: "github-dark" },
      libraryPath: "~/Wren",
      autoRenameFiles: true,
      embeddingModel: "all-MiniLM-L6-v2",
      enableOcr: true,
      forceOcr: false,
      llmProvider: "openai",
      llmApiKey: "",
      llmModel: "gpt-4o-mini",
      llmBaseUrl: "https://api.openai.com/v1",
      llmAutoParseOnImport: false,
      llmTokenBudget: 200000,
      llmContextWindow: 0,
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
      setEmbeddingModel: (model) => set({ embeddingModel: model }),
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
        set({
          llmProvider: provider,
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
        set({ llmApiKey: key });
        try {
          await updateSetting("llm_api_key", key);
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
      setShowWelcomeOnStartup: (show) => set({ showWelcomeOnStartup: show }),
      loadFromBackend: async () => {
        try {
          const settings = await getSettings();
          const autoRename = settings.find(s => s.key === "auto_rename_files");
          if (autoRename) {
            set({ autoRenameFiles: autoRename.value === "true" });
          }
          const enableOcr = settings.find(s => s.key === "enable_ocr");
          if (enableOcr) {
            set({ enableOcr: enableOcr.value === "true" });
          }
          const forceOcr = settings.find(s => s.key === "force_ocr");
          if (forceOcr) {
            set({ forceOcr: forceOcr.value === "true" });
          }
          // LLM settings
          const llmProvider = settings.find(s => s.key === "llm_provider");
          if (llmProvider) set({ llmProvider: llmProvider.value });
          const llmApiKey = settings.find(s => s.key === "llm_api_key");
          if (llmApiKey) set({ llmApiKey: llmApiKey.value });
          const llmModel = settings.find(s => s.key === "llm_model");
          if (llmModel) set({ llmModel: llmModel.value });
          const llmBaseUrl = settings.find(s => s.key === "llm_base_url");
          if (llmBaseUrl) set({ llmBaseUrl: llmBaseUrl.value });
          const llmAutoParse = settings.find(s => s.key === "llm_auto_parse");
          if (llmAutoParse) set({ llmAutoParseOnImport: llmAutoParse.value === "true" });
          const llmTokenBudget = settings.find(s => s.key === "llm_token_budget");
          if (llmTokenBudget) set({ llmTokenBudget: parseInt(llmTokenBudget.value, 10) || 200000 });
          const llmContextWindow = settings.find(s => s.key === "llm_context_window");
          if (llmContextWindow) set({ llmContextWindow: parseInt(llmContextWindow.value, 10) || 0 });
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
