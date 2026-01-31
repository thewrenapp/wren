import { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InfoSectionProps {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  count?: number;
  onAdd?: () => void;
  children: ReactNode;
}

export function InfoSection({
  title,
  icon,
  defaultOpen = false,
  count,
  onAdd,
  children,
}: InfoSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b last:border-b-0">
      {/* Section header */}
      <div
        className={cn(
          "flex items-center w-full px-3 py-2 hover:bg-muted/50 transition-colors",
          "text-left text-sm font-medium"
        )}
      >
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center flex-1 min-w-0"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4 mr-1 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 mr-1 text-muted-foreground shrink-0" />
          )}
          {icon && <span className="mr-2 text-muted-foreground shrink-0">{icon}</span>}
          <span className="flex-1 truncate">{title}</span>
        </button>
        {count !== undefined && (
          <span className="text-xs text-muted-foreground mx-2 shrink-0">{count}</span>
        )}
        {onAdd && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={onAdd}
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Section content */}
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
