import { Monitor, Sun, Moon, PanelRight, PanelBottom } from "lucide-react";
import { useSettingsStore, type Theme } from "@/stores/settingsStore";
import { useUIStore, type LibraryLayout } from "@/stores/uiStore";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// All Shiki bundled themes — available for both light and dark mode selection
const ALL_THEMES = [
  { value: "andromeeda", label: "Andromeeda" },
  { value: "aurora-x", label: "Aurora X" },
  { value: "ayu-dark", label: "Ayu Dark" },
  { value: "ayu-light", label: "Ayu Light" },
  { value: "ayu-mirage", label: "Ayu Mirage" },
  { value: "catppuccin-frappe", label: "Catppuccin Frappe" },
  { value: "catppuccin-latte", label: "Catppuccin Latte" },
  { value: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { value: "dark-plus", label: "Dark+ (VS Code)" },
  { value: "dracula", label: "Dracula" },
  { value: "dracula-soft", label: "Dracula Soft" },
  { value: "everforest-dark", label: "Everforest Dark" },
  { value: "everforest-light", label: "Everforest Light" },
  { value: "github-dark", label: "GitHub Dark" },
  { value: "github-dark-default", label: "GitHub Dark Default" },
  { value: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
  { value: "github-dark-high-contrast", label: "GitHub Dark High Contrast" },
  { value: "github-light", label: "GitHub Light" },
  { value: "github-light-default", label: "GitHub Light Default" },
  { value: "github-light-high-contrast", label: "GitHub Light High Contrast" },
  { value: "gruvbox-dark-hard", label: "Gruvbox Dark Hard" },
  { value: "gruvbox-dark-medium", label: "Gruvbox Dark Medium" },
  { value: "gruvbox-dark-soft", label: "Gruvbox Dark Soft" },
  { value: "gruvbox-light-hard", label: "Gruvbox Light Hard" },
  { value: "gruvbox-light-medium", label: "Gruvbox Light Medium" },
  { value: "gruvbox-light-soft", label: "Gruvbox Light Soft" },
  { value: "horizon", label: "Horizon" },
  { value: "houston", label: "Houston" },
  { value: "kanagawa-dragon", label: "Kanagawa Dragon" },
  { value: "kanagawa-lotus", label: "Kanagawa Lotus" },
  { value: "kanagawa-wave", label: "Kanagawa Wave" },
  { value: "laserwave", label: "Laserwave" },
  { value: "light-plus", label: "Light+ (VS Code)" },
  { value: "material-theme", label: "Material" },
  { value: "material-theme-darker", label: "Material Darker" },
  { value: "material-theme-lighter", label: "Material Lighter" },
  { value: "material-theme-ocean", label: "Material Ocean" },
  { value: "material-theme-palenight", label: "Material Palenight" },
  { value: "min-dark", label: "Min Dark" },
  { value: "min-light", label: "Min Light" },
  { value: "monokai", label: "Monokai" },
  { value: "night-owl", label: "Night Owl" },
  { value: "night-owl-light", label: "Night Owl Light" },
  { value: "nord", label: "Nord" },
  { value: "one-dark-pro", label: "One Dark Pro" },
  { value: "one-light", label: "One Light" },
  { value: "plastic", label: "Plastic" },
  { value: "poimandres", label: "Poimandres" },
  { value: "red", label: "Red" },
  { value: "rose-pine", label: "Rose Pine" },
  { value: "rose-pine-dawn", label: "Rose Pine Dawn" },
  { value: "rose-pine-moon", label: "Rose Pine Moon" },
  { value: "slack-dark", label: "Slack Dark" },
  { value: "slack-ochin", label: "Slack Ochin" },
  { value: "snazzy-light", label: "Snazzy Light" },
  { value: "solarized-dark", label: "Solarized Dark" },
  { value: "solarized-light", label: "Solarized Light" },
  { value: "synthwave-84", label: "Synthwave '84" },
  { value: "tokyo-night", label: "Tokyo Night" },
  { value: "vesper", label: "Vesper" },
  { value: "vitesse-black", label: "Vitesse Black" },
  { value: "vitesse-dark", label: "Vitesse Dark" },
  { value: "vitesse-light", label: "Vitesse Light" },
];

export function GeneralSection() {
  const { theme, setTheme, codeTheme, setCodeTheme, showCodeLineNumbers, setShowCodeLineNumbers, showWelcomeOnStartup, setShowWelcomeOnStartup } =
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

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Code Theme (Light)</label>
            <Select
              value={codeTheme.light}
              onValueChange={(value) => setCodeTheme({ ...codeTheme, light: value })}
            >
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>All Themes</SelectLabel>
                  {ALL_THEMES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-xs">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Code Theme (Dark)</label>
            <Select
              value={codeTheme.dark}
              onValueChange={(value) => setCodeTheme({ ...codeTheme, dark: value })}
            >
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>All Themes</SelectLabel>
                  {ALL_THEMES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-xs">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={showCodeLineNumbers}
              onCheckedChange={(checked) => setShowCodeLineNumbers(checked === true)}
            />
            <span className="text-sm">Show line numbers in code blocks</span>
          </label>
        </div>
      </section>

      {/* Startup */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Startup
        </h3>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={showWelcomeOnStartup}
              onCheckedChange={(checked) => setShowWelcomeOnStartup(checked === true)}
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
