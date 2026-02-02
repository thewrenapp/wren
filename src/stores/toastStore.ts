import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
  // Convenience methods
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (message, type = "info", duration = 4000) => {
    const id = `toast-${++toastId}`;
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration }],
    }));

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  // Convenience methods
  success: (message, duration) => {
    useToastStore.getState().addToast(message, "success", duration);
  },
  error: (message, duration) => {
    useToastStore.getState().addToast(message, "error", duration ?? 6000);
  },
  info: (message, duration) => {
    useToastStore.getState().addToast(message, "info", duration);
  },
  warning: (message, duration) => {
    useToastStore.getState().addToast(message, "warning", duration ?? 5000);
  },
}));

// Export a simple toast function for easy use
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().success(message, duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().error(message, duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().info(message, duration),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().warning(message, duration),
};
