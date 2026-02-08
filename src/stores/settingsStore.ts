import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getSettings, updateSetting } from "@/services/tauri/commands";

export type Theme = "system" | "light" | "dark";

interface SettingsState {
  // Appearance
  theme: Theme;

  // Library
  libraryPath: string;

  // File Handling
  autoRenameFiles: boolean;

  // Embedding
  embeddingModel: string;

  // OCR Settings
  enableOcr: boolean;
  forceOcr: boolean;

  // Startup
  showWelcomeOnStartup: boolean;

  // Actions
  setTheme: (theme: Theme) => void;
  setLibraryPath: (path: string) => void;
  setAutoRenameFiles: (enabled: boolean) => void;
  setEmbeddingModel: (model: string) => void;
  setEnableOcr: (enabled: boolean) => void;
  setForceOcr: (enabled: boolean) => void;
  setShowWelcomeOnStartup: (show: boolean) => void;
  loadFromBackend: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      libraryPath: "~/Wren",
      autoRenameFiles: true,
      embeddingModel: "all-MiniLM-L6-v2",
      enableOcr: true,
      forceOcr: false,
      showWelcomeOnStartup: true,

      setTheme: (theme) => set({ theme }),
      setLibraryPath: (path) => set({ libraryPath: path }),
      setAutoRenameFiles: async (enabled) => {
        set({ autoRenameFiles: enabled });
        // Sync to backend database
        try {
          await updateSetting("auto_rename_files", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update auto_rename_files setting:", err);
        }
      },
      setEmbeddingModel: (model) => set({ embeddingModel: model }),
      setEnableOcr: async (enabled) => {
        set({ enableOcr: enabled });
        try {
          await updateSetting("enable_ocr", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update enable_ocr setting:", err);
        }
      },
      setForceOcr: async (enabled) => {
        set({ forceOcr: enabled });
        try {
          await updateSetting("force_ocr", enabled ? "true" : "false");
        } catch (err) {
          console.error("Failed to update force_ocr setting:", err);
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
