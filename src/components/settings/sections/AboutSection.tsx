import { AppLogo } from "@/components/ui/AppLogo";
import { save, open } from "@tauri-apps/plugin-dialog";
import { exportLibraryArchive, importLibraryArchive, importEntriesArchive } from "@/services/tauri";
import { toast } from "@/stores/toastStore";
import { useLibraryStore } from "@/stores/libraryStore";

export function AboutSection() {
  const refreshLibrary = useLibraryStore((s) => s.refreshLibrary);

  const handleExportBackup = async () => {
    try {
      const filePath = await save({
        defaultPath: "library-backup.wren",
        filters: [{ name: "Wren Library Backup", extensions: ["wren"] }],
      });
      if (filePath) {
        const loadingId = toast.loading("Exporting library backup...");
        try {
          const result = await exportLibraryArchive(filePath);
          toast.dismiss(loadingId);
          toast.success(`Backup exported (${result.entriesExported} entries, ${result.filesExported} files)`);
        } catch (err) {
          toast.dismiss(loadingId);
          throw err;
        }
      }
    } catch (err) {
      console.error("Backup export error:", err);
      toast.error("Failed to export backup");
    }
  };

  const handleImportBackup = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Wren Archive", extensions: ["wrenitem", "wren"] }],
      });
      if (selected && typeof selected === "string") {
        const isLibrary = selected.endsWith(".wren");
        const loadingId = toast.loading("Importing archive...");
        try {
          const result = isLibrary
            ? await importLibraryArchive(selected, "merge")
            : await importEntriesArchive(selected);
          toast.dismiss(loadingId);
          if (result.entriesImported > 0) {
            toast.success(`Imported ${result.entriesImported} entries (${result.filesImported} files)`);
            await refreshLibrary();
          } else {
            toast.info("No new entries to import");
          }
        } catch (err) {
          toast.dismiss(loadingId);
          throw err;
        }
      }
    } catch (err) {
      console.error("Backup import error:", err);
      toast.error("Failed to import archive");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <AppLogo size={56} />
        <div>
          <h3 className="text-base font-semibold">Wren</h3>
          <p className="text-sm text-muted-foreground">
            Reference Manager for the Modern Researcher
          </p>
          <p className="text-sm text-muted-foreground">Version 0.1.0</p>
        </div>
      </div>

      <hr className="border-border" />

      <p className="text-sm text-muted-foreground">
        A local-first reference manager. Your library, your data.
      </p>

      <hr className="border-border" />

      <div>
        <h4 className="text-sm font-medium mb-3">Backup & Restore</h4>
        <div className="flex gap-3">
          <button
            onClick={handleExportBackup}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Export Library Backup
          </button>
          <button
            onClick={handleImportBackup}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
          >
            Import Library Backup
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Export your entire library as a .wren file, or import from a .wren/.wrenitem archive.
        </p>
      </div>
    </div>
  );
}
