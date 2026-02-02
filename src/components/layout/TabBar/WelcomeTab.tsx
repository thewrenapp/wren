import { FileText, File, FolderOpen, Command, ArrowRight } from "lucide-react";
import { AppLogo } from "@/components/ui/AppLogo";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useImport } from "@/hooks/useLibrarySync";

export function WelcomeTab() {
  const { toggleCommandPalette } = useUIStore();
  const { importFiles, importFolder } = useImport();

  const handleImportFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        await importFiles(selected);
      }
    } catch (err) {
      console.error("Import error:", err);
    }
  };

  const handleImportFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        await importFolder(selected);
      }
    } catch (err) {
      console.error("Import folder error:", err);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-6">
        {/* Logo */}
        <div className="flex justify-center">
          <AppLogo size={64} className="shadow-md" />
        </div>

        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold mb-2">Welcome to Wren</h1>
          <p className="text-muted-foreground">
            Your personal reference manager for PDFs and notes
          </p>
        </div>

        {/* Quick actions */}
        <div className="grid gap-3">
          <QuickAction
            icon={<File className="h-5 w-5" />}
            title="Import PDFs"
            description="Add PDF documents to your library"
            onClick={handleImportFiles}
          />

          <QuickAction
            icon={<FileText className="h-5 w-5" />}
            title="Create Note"
            description="Start a new markdown note"
            onClick={() => {
              // TODO: Create note
            }}
          />

          <QuickAction
            icon={<FolderOpen className="h-5 w-5" />}
            title="Import Folder"
            description="Import all PDFs from a folder"
            onClick={handleImportFolder}
          />
        </div>

        {/* Keyboard shortcut hint */}
        <div className="pt-4 border-t">
          <p className="text-sm text-muted-foreground mb-2">
            Quick tip: Press{" "}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘K</kbd>{" "}
            to open the command palette
          </p>
          <Button variant="outline" size="sm" onClick={toggleCommandPalette}>
            <Command className="h-4 w-4 mr-2" />
            Open Command Palette
          </Button>
        </div>
      </div>
    </div>
  );
}

interface QuickActionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function QuickAction({ icon, title, description, onClick }: QuickActionProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors text-left group"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
