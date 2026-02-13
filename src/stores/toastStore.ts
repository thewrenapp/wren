import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning" | "loading";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, duration?: number) => string;
  removeToast: (id: string) => void;
}

let toastId = 0;
const timeoutMap = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (message, type = "info", duration = 4000) => {
    const id = `toast-${++toastId}`;
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration }],
    }));

    // Auto-remove after duration (0 = persistent)
    if (duration > 0) {
      const timer = setTimeout(() => {
        timeoutMap.delete(id);
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
      timeoutMap.set(id, timer);
    }

    return id;
  },

  removeToast: (id) => {
    const timer = timeoutMap.get(id);
    if (timer) {
      clearTimeout(timer);
      timeoutMap.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

// Export a simple toast function for easy use
export const toast = {
  success: (message: string, duration?: number): string =>
    useToastStore.getState().addToast(message, "success", duration),
  error: (message: string, duration?: number): string =>
    useToastStore.getState().addToast(message, "error", duration ?? 6000),
  info: (message: string, duration?: number): string =>
    useToastStore.getState().addToast(message, "info", duration),
  warning: (message: string, duration?: number): string =>
    useToastStore.getState().addToast(message, "warning", duration ?? 5000),
  loading: (message: string): string =>
    useToastStore.getState().addToast(message, "loading", 0),
  dismiss: (id: string): void => {
    useToastStore.getState().removeToast(id);
  },
};
