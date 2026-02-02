import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "system" | "light" | "dark";

interface SettingsState {
  // Appearance
  theme: Theme;

  // Library
  libraryPath: string;

  // Embedding
  embeddingModel: string;

  // Startup
  showWelcomeOnStartup: boolean;

  // Actions
  setTheme: (theme: Theme) => void;
  setLibraryPath: (path: string) => void;
  setEmbeddingModel: (model: string) => void;
  setShowWelcomeOnStartup: (show: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      libraryPath: "~/Wren",
      embeddingModel: "all-MiniLM-L6-v2",
      showWelcomeOnStartup: true,

      setTheme: (theme) => set({ theme }),
      setLibraryPath: (path) => set({ libraryPath: path }),
      setEmbeddingModel: (model) => set({ embeddingModel: model }),
      setShowWelcomeOnStartup: (show) => set({ showWelcomeOnStartup: show }),
    }),
    {
      name: "wren-settings",
    }
  )
);
