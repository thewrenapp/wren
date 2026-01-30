import { Monitor, Sun, Moon, PanelRight, PanelBottom } from "lucide-react";
import { useSettingsStore, type Theme } from "@/stores/settingsStore";
import { useUIStore, type LibraryLayout } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

export function GeneralSection() {
  const { theme, setTheme, showWelcomeOnStartup, setShowWelcomeOnStartup } =
    useSettingsStore();
  const { libraryLayout, setLibraryLayout } = useUIStore();

  return (
    <div className="space-y-8">
      {/* Appearance */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Appearance
        </h3>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Color Scheme</label>
            <div className="flex items-center gap-2">
              <ThemeOption
                theme="system"
                currentTheme={theme}
                icon={<Monitor className="h-4 w-4" />}
                label="Automatic"
                onClick={() => setTheme("system")}
              />
              <ThemeOption
                theme="light"
                currentTheme={theme}
                icon={<Sun className="h-4 w-4" />}
                label="Light"
                onClick={() => setTheme("light")}
              />
              <ThemeOption
                theme="dark"
                currentTheme={theme}
                icon={<Moon className="h-4 w-4" />}
                label="Dark"
                onClick={() => setTheme("dark")}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Library Layout</label>
            <div className="flex items-center gap-2">
              <LayoutOption
                layout="normal"
                currentLayout={libraryLayout}
                icon={<PanelRight className="h-4 w-4" />}
                label="Normal"
                onClick={() => setLibraryLayout("normal")}
              />
              <LayoutOption
                layout="stacked"
                currentLayout={libraryLayout}
                icon={<PanelBottom className="h-4 w-4" />}
                label="Stacked"
                onClick={() => setLibraryLayout("stacked")}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Startup */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Startup
        </h3>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showWelcomeOnStartup}
              onChange={(e) => setShowWelcomeOnStartup(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Show Welcome tab on startup</span>
          </label>
        </div>
      </section>
    </div>
  );
}

interface ThemeOptionProps {
  theme: Theme;
  currentTheme: Theme;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ThemeOption({ theme, currentTheme, icon, label, onClick }: ThemeOptionProps) {
  const isActive = theme === currentTheme;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "bg-muted hover:bg-muted/80"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

interface LayoutOptionProps {
  layout: LibraryLayout;
  currentLayout: LibraryLayout;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function LayoutOption({ layout, currentLayout, icon, label, onClick }: LayoutOptionProps) {
  const isActive = layout === currentLayout;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "bg-muted hover:bg-muted/80"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
