import {
  Settings,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { AppLogo } from "@/components/ui/AppLogo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore, type Theme } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { getCurrentWindow } from "@tauri-apps/api/window";

const themeIcons: Record<Theme, React.ReactNode> = {
  system: <Monitor className="h-5 w-5" />,
  light: <Sun className="h-5 w-5" />,
  dark: <Moon className="h-5 w-5" />,
};

const themeOrder: Theme[] = ["system", "light", "dark"];

interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function IconButton({ icon, label, active, onClick }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          className={cn(
            "w-9 h-9 rounded-lg",
            active
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function ProfileBar() {
  const { theme, setTheme } = useSettingsStore();
  const { setSettingsOpen } = useUIStore();

  const cycleTheme = () => {
    const currentIndex = themeOrder.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    setTheme(themeOrder[nextIndex]);
  };

  const openSettings = () => {
    setSettingsOpen(true);
  };

  const startDrag = async (e: React.MouseEvent) => {
    e.preventDefault();
    await getCurrentWindow().startDragging();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col items-center w-[52px] py-2 bg-sidebar-accent/30 border-r border-sidebar-border">
        {/* Draggable region for macOS traffic lights */}
        <div
          onMouseDown={startDrag}
          className="w-full h-14 flex-shrink-0 cursor-default"
        />

        {/* App logo */}
        <div className="pb-3">
          <AppLogo size={40} className="shadow-md cursor-pointer hover:shadow-lg transition-shadow" />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom actions */}
        <div className="flex flex-col items-center gap-1 pb-2">
          <IconButton
            icon={themeIcons[theme]}
            label={`Theme: ${theme}`}
            onClick={cycleTheme}
          />

          <IconButton
            icon={<Settings className="h-5 w-5" />}
            label="Settings"
            onClick={openSettings}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
