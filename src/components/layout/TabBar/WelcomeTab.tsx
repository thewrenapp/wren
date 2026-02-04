import { useState } from "react";
import { FileText, File, FolderOpen, Command, ArrowRight, Library } from "lucide-react";
import { AppLogo } from "@/components/ui/AppLogo";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useImport, useLibrarySync } from "@/hooks/useLibrarySync";
import {
  previewBiblatexImport,
  importBiblatexWithFiles,
  type BiblatexPreviewResult,
} from "@/services/tauri/commands";
import { ImportPreviewDialog } from "@/components/dialogs/ImportPreviewDialog";
import { toast } from "@/stores/toastStore";

export function WelcomeTab() {
  const { toggleCommandPalette } = useUIStore();
  const { invalidateAttachments } = useLibraryStore();
  const { importFiles, importFolder } = useImport();
  const { refresh } = useLibrarySync();

  // BibLaTeX import preview state
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<BiblatexPreviewResult | null>(null);
  const [importFolderPath, setImportFolderPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

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

  const handleImportBiblatex = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Zotero BibLaTeX Export Folder",
      });

      if (selected && typeof selected === "string") {
        // Get preview data first
        const preview = await previewBiblatexImport(selected);
        setImportPreviewData(preview);
        setImportFolderPath(selected);
        setShowImportPreview(true);
      }
    } catch (err) {
      console.error("Import BibLaTeX error:", err);
      toast.error("Failed to preview BibLaTeX folder");
    }
  };

  const handleConfirmImport = async (options: import('@/components/dialogs/ImportPreviewDialog').ImportOptions) => {
    if (!importFolderPath) return;

    const { selectedKeys, importTags, excludedFiles, collectionId } = options;

    setIsImporting(true);
    try {
      const result = await importBiblatexWithFiles(
        importFolderPath,
        importFolderPath,
        selectedKeys,
        importTags,
        excludedFiles,
        collectionId
      );

      let message = `Imported ${result.imported} ${result.imported !== 1 ? "entries" : "entry"}`;
      if (result.filesImported > 0) {
        message += ` with ${result.filesImported} file${result.filesImported !== 1 ? "s" : ""}`;
      }
      if (result.tagsCreated > 0) {
        message += ` and ${result.tagsCreated} tag${result.tagsCreated !== 1 ? "s" : ""}`;
      }
      toast.success(message);

      if (result.skipped > 0) {
        toast.info(`${result.skipped} entries skipped`);
      }

      // Invalidate attachment cache so expanded rows refetch attachment names
      invalidateAttachments();
      // Refresh library
      await refresh();

      // Close dialog
      setShowImportPreview(false);
      setImportPreviewData(null);
      setImportFolderPath(null);
    } catch (err) {
      console.error("Failed to import BibLaTeX:", err);
      toast.error("Failed to import BibLaTeX entries");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
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

            <QuickAction
              icon={<Library className="h-5 w-5" />}
              title="Import from Zotero"
              description="Import BibLaTeX export with files"
              onClick={handleImportBiblatex}
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

      {/* BibLaTeX Import Preview Dialog */}
      <ImportPreviewDialog
        open={showImportPreview}
        onOpenChange={setShowImportPreview}
        previewData={importPreviewData}
        onImport={handleConfirmImport}
        isImporting={isImporting}
      />
    </>
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
