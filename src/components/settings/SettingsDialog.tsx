import { useState } from "react";
import {
  Settings,
  FolderOpen,
  Sparkles,
  Keyboard,
  Info,
  Globe,
  Cloud,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { GeneralSection } from "./sections/GeneralSection";
import { StorageSection } from "./sections/StorageSection";
import { AISearchSection } from "./sections/AISearchSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { AboutSection } from "./sections/AboutSection";
import { ConnectorSection } from "./sections/ConnectorSection";
import { SyncSection } from "./sections/SyncSection";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsSection = "general" | "storage" | "sync" | "ai-search" | "connector" | "shortcuts" | "about";

const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings className="h-4 w-4" /> },
  { id: "storage", label: "Storage", icon: <FolderOpen className="h-4 w-4" /> },
  { id: "sync", label: "Sync", icon: <Cloud className="h-4 w-4" /> },
  { id: "ai-search", label: "AI & Search", icon: <Sparkles className="h-4 w-4" /> },
  { id: "connector", label: "Connector", icon: <Globe className="h-4 w-4" /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard className="h-4 w-4" /> },
  { id: "about", label: "About", icon: <Info className="h-4 w-4" /> },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[600px] p-0 gap-0 overflow-hidden">
        <div className="flex h-full">
          {/* Sidebar */}
          <div className="w-48 bg-muted/30 border-r flex flex-col">
            <DialogHeader className="px-4 py-3 border-b">
              <DialogTitle className="text-base">Settings</DialogTitle>
            </DialogHeader>
            <nav className="flex-1 p-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    activeSection === section.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  {section.icon}
                  {section.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="px-6 py-3 border-b shrink-0">
              <h2 className="text-lg font-semibold">
                {sections.find((s) => s.id === activeSection)?.label}
              </h2>
            </div>
            <ScrollArea className="flex-1 h-0">
              <div className="p-6">
                {activeSection === "general" && <GeneralSection />}
                {activeSection === "storage" && <StorageSection />}
                {activeSection === "sync" && <SyncSection />}
                {activeSection === "ai-search" && <AISearchSection />}
                {activeSection === "connector" && <ConnectorSection />}
                {activeSection === "shortcuts" && <ShortcutsSection />}
                {activeSection === "about" && <AboutSection />}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
