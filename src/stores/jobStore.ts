import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Job {
  id: string;
  jobType: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  title: string | null;
  payloadJson: string;
  resultJson: string | null;
  errorMessage: string | null;
  progressCurrent: number;
  progressTotal: number;
  progressMessage: string | null;
  priority: number;
  maxRetries: number;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const JOB_TYPE_NAMES: Record<string, string> = {
  reindex_library: "Reindex Library",
  bulk_import_pdfs: "Import PDFs",
  bulk_import_folder: "Import Folder",
  ocr_extract: "OCR Extraction",
  llm_parse: "Parse Document Structure",
  rag_index: "Build Semantic Index",
  metadata_extract: "Extract Metadata with AI",
  rag_cleanup_vectors: "Cleanup Vectors",
};

export function jobDisplayName(job: Job): string {
  return job.title || JOB_TYPE_NAMES[job.jobType] || job.jobType;
}

interface JobState {
  jobs: Job[];

  activeCount: () => number;
  hasActiveJobs: () => boolean;

  loadJobs: () => Promise<void>;
  enqueueJob: (
    jobType: string,
    payload: Record<string, unknown>,
    options?: { priority?: number; title?: string }
  ) => Promise<string>;
  cancelJob: (jobId: string, force?: boolean) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  clearFinished: () => Promise<void>;

  _upsertJob: (job: Job) => void;
  _unlisten: UnlistenFn | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

export const useJobStore = create<JobState>()((set, get) => ({
  jobs: [],
  _unlisten: null,

  activeCount: () =>
    get().jobs.filter((j) => j.status === "pending" || j.status === "running")
      .length,

  hasActiveJobs: () =>
    get().jobs.some((j) => j.status === "pending" || j.status === "running"),

  loadJobs: async () => {
    try {
      const jobs = await invoke<Job[]>("get_jobs", { limit: 100 });
      set({ jobs });
    } catch (e) {
      console.error("Failed to load jobs:", e);
    }
  },

  enqueueJob: async (jobType, payload, options) => {
    const jobId = await invoke<string>("enqueue_job", {
      jobType,
      payload,
      priority: options?.priority ?? 0,
      title: options?.title ?? null,
    });
    await get().loadJobs();
    return jobId;
  },

  cancelJob: async (jobId, force) => {
    await invoke("cancel_job", { jobId, force: force ?? false });
    // Force-cancelling a paused job changes parsed_content status in DB;
    // bump entryVersion so ExtractedContentViewer re-fetches and updates toolbar
    if (force) {
      const { useLibraryStore } = await import("@/stores/libraryStore");
      useLibraryStore.getState().invalidateEntry();
    }
  },

  retryJob: async (jobId) => {
    try {
      await invoke("retry_job", { jobId });
    } catch (e) {
      console.error("Failed to retry job:", e);
      throw e;
    }
  },

  clearFinished: async () => {
    await invoke("clear_finished_jobs");
    await get().loadJobs();
  },

  _upsertJob: (job) => {
    set((state) => {
      const idx = state.jobs.findIndex((j) => j.id === job.id);
      if (idx >= 0) {
        const updated = [...state.jobs];
        updated[idx] = job;
        return { jobs: updated };
      } else {
        return { jobs: [job, ...state.jobs] };
      }
    });
  },

  startListening: async () => {
    await get().loadJobs();
    const unlisten = await listen<Job>("job:updated", (event) => {
      // Check if the store is still listening (not yet stopped)
      if (!get()._unlisten) return;
      get()._upsertJob(event.payload);
      // Refresh library when metadata extraction or OCR extraction completes
      const job = event.payload;
      if (job.status === "completed" && (job.jobType === "metadata_extract" || job.jobType === "ocr_extract" || job.jobType === "rag_index" || job.jobType === "rag_cleanup_vectors")) {
        // Dynamic import to avoid circular dependency
        import("@/stores/libraryStore").then(({ useLibraryStore }) => {
          // Re-check subscription is still active after async import
          if (!get()._unlisten) return;
          useLibraryStore.getState().refreshLibrary();
        }).catch((err) => {
          console.error("Failed to refresh library after job completion:", err);
        });
      }
    });
    set({ _unlisten: unlisten });
  },

  stopListening: () => {
    const fn = get()._unlisten;
    if (fn) fn();
    set({ _unlisten: null });
  },
}));
