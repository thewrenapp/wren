import { useEffect, useState } from "react";
import { FolderOpen, AlertCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSettingsStore } from "@/stores/settingsStore";
import { getLibraryPath } from "@/services/tauri";

export function StorageSection() {
  const { libraryPath, setLibraryPath } = useSettingsStore();
  const [actualPath, setActualPath] = useState<string>("");

  // Load actual library path from backend on mount
  useEffect(() => {
    getLibraryPath().then(setActualPath).catch(console.error);
  }, []);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Library Location",
      });

      if (selected && typeof selected === "string") {
        setLibraryPath(selected);
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  };

  const pathChanged = libraryPath !== actualPath && libraryPath !== "";

  return (
    <div className="space-y-8">
      {/* Library Location */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Library Location
        </h3>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={libraryPath || actualPath}
              onChange={(e) => setLibraryPath(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              placeholder="~/Wren"
            />
            <Button variant="outline" size="default" onClick={handleBrowse}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Browse
            </Button>
          </div>
          {pathChanged && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Changing the library path requires a restart. Existing files will remain in their current location.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            PDFs and notes will be stored in this location. Current: {actualPath || "Loading..."}
          </p>
        </div>
      </section>

      {/* File Handling */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          File Handling
        </h3>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox defaultChecked />
            <span className="text-sm">Copy imported PDFs to library folder</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox defaultChecked />
            <span className="text-sm">Automatically extract metadata from PDFs</span>
          </label>
        </div>
      </section>
    </div>
  );
}
