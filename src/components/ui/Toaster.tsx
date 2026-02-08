import { useToastStore, type Toast, type ToastType } from "@/stores/toastStore";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const toastIcons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4 text-green-500" />,
  error: <AlertCircle className="h-4 w-4 text-red-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  loading: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
};

const toastStyles: Record<ToastType, string> = {
  success: "border-green-500/20 bg-green-500/10",
  error: "border-red-500/20 bg-red-500/10",
  info: "border-blue-500/20 bg-blue-500/10",
  warning: "border-amber-500/20 bg-amber-500/10",
  loading: "border-blue-500/20 bg-blue-500/10",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 pr-8 rounded-lg border shadow-lg backdrop-blur-sm",
        "animate-in slide-in-from-top-2 fade-in duration-200",
        "bg-background/95",
        toastStyles[toast.type]
      )}
    >
      <span className="flex-shrink-0 mt-0.5">{toastIcons[toast.type]}</span>
      <p className="text-sm text-foreground leading-snug">{toast.message}</p>
      <button
        onClick={onDismiss}
        className="absolute right-2 top-2 p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
