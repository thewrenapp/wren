import {
  Settings,
  Sun,
  Moon,
  Monitor,
  PanelLeft,
  PanelLeftClose,
  ListTodo,
  Loader2,
} from "lucide-react";
import { AppLogo } from "@/components/ui/AppLogo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettingsStore, type Theme } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useJobStore } from "@/stores/jobStore";
import { JobListPanel } from "@/components/jobs/JobListPanel";
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
  const { setSettingsOpen, sidebarCollapsed, toggleSidebar } = useUIStore();
  const activeCount = useJobStore((s) => s.activeCount());
  const hasActive = activeCount > 0;

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
      <div className="relative flex flex-col items-center w-[52px] profilebar-gradient profilebar-border-r">
        {/* Draggable region for macOS traffic lights */}
        <div
          onMouseDown={startDrag}
          className="w-full h-14 flex-shrink-0 cursor-default"
        />

        {/* Content below traffic lights */}
        <div className="flex flex-col items-center flex-1 w-full py-2">
          {/* App logo */}
          <div className="pb-3">
            <AppLogo size={40} className="cursor-pointer drop-shadow-[0_2px_6px_rgba(0,0,0,0.2)] dark:drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] hover:drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)] dark:hover:drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)] hover:scale-105 transition-all duration-200" />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Bottom actions */}
          <div className="flex flex-col items-center gap-1 pb-2">
          <IconButton
            icon={sidebarCollapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            label={sidebarCollapsed ? "Show Sidebar (⌘B)" : "Hide Sidebar (⌘B)"}
            onClick={toggleSidebar}
          />

          <IconButton
            icon={themeIcons[theme]}
            label={`Theme: ${theme}`}
            onClick={cycleTheme}
          />

          {/* Job tracker */}
          <Popover>
            <PopoverTrigger asChild>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "w-9 h-9 rounded-lg",
                    hasActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  {hasActive ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ListTodo className="h-5 w-5" />
                  )}
                </Button>
                {activeCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
                    {activeCount}
                  </span>
                )}
              </div>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="end"
              className="w-80 p-0"
              sideOffset={8}
            >
              <JobListPanel />
            </PopoverContent>
          </Popover>

          <IconButton
            icon={<Settings className="h-5 w-5" />}
            label="Settings"
            onClick={openSettings}
          />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
