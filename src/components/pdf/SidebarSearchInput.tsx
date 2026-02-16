import { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isInActiveView } from "@/lib/isInActiveView";

interface SidebarSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SidebarSearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className,
}: SidebarSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on Cmd/Ctrl+F when the component is visible
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        if (inputRef.current) {
          if (!isInActiveView(inputRef.current)) return;
          const panel = inputRef.current.closest("[data-sidebar-panel]");
          if (panel) {
            e.preventDefault();
            inputRef.current.focus();
            inputRef.current.select();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="absolute left-1.5 h-3 w-3 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-6 w-full pl-5 pr-5 text-xs",
          "border rounded bg-background",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          "placeholder:text-muted-foreground/60"
        )}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-1 p-0.5 rounded hover:bg-muted"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
