import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";

export function StorageSection() {
  const { libraryPath, setLibraryPath } = useSettingsStore();

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
              value={libraryPath}
              onChange={(e) => setLibraryPath(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border rounded-md bg-background"
              placeholder="~/Etal"
            />
            <Button variant="outline" size="default">
              <FolderOpen className="h-4 w-4 mr-2" />
              Browse
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            PDFs and notes will be stored in this location. Changing this will
            not move existing files.
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
            <input
              type="checkbox"
              defaultChecked={true}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Copy imported PDFs to library folder</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={true}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Automatically extract metadata from PDFs</span>
          </label>
        </div>
      </section>
    </div>
  );
}
