import { useEffect, useState } from "react";
import {
  Cloud,
  CloudOff,
  FolderOpen,
  FolderSync,
  Check,
  Loader2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { getLibraryPath } from "@/services/tauri";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/stores/toastStore";

export function SyncSection() {
  const [libraryPath, setLibraryPath] = useState("");
  const [syncFolder, setSyncFolder] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  useEffect(() => {
    getLibraryPath().then(setLibraryPath).catch(console.error);
    invoke<string | null>("get_setting_value_cmd", { key: "sync_folder" })
      .then((val) => {
        if (val) {
          setSyncFolder(val);
          setSyncEnabled(true);
        }
      })
      .catch(() => {});
  }, []);

  const doSetup = async (folder: string) => {
    setSettingUp(true);
    try {
      await invoke("setup_sync_folder", { syncFolder: folder });
      setSyncFolder(folder);
      setSyncEnabled(true);
      toast.success("Sync enabled");
    } catch (err) {
      toast.error(`Failed to set up sync: ${err}`);
    } finally {
      setSettingUp(false);
    }
  };

  const handleChooseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Sync Folder",
      });
      if (selected && typeof selected === "string") {
        await doSetup(selected);
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  };

  const handleEnableICloud = async () => {
    const home = libraryPath.replace(/\/\.wren$/, "");
    const icloudPath = `${home}/Library/Mobile Documents/com~apple~CloudDocs/Wren`;
    await doSetup(icloudPath);
  };

  const handleDisableSync = async () => {
    setSettingUp(true);
    try {
      await invoke("disable_sync");
      setSyncFolder("");
      setSyncEnabled(false);
      toast.success("Sync disabled");
    } catch (err) {
      toast.error(`Failed to disable sync: ${err}`);
    } finally {
      setSettingUp(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Multi-Device Sync */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Multi-Device Sync
        </h3>

        {!syncEnabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
              <CloudOff className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Sync not configured</p>
                <p className="text-xs text-muted-foreground">
                  Choose a cloud-synced folder to keep your library in sync
                  across devices.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleEnableICloud}
                disabled={settingUp}
              >
                {settingUp ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4 mr-2" />
                )}
                Use iCloud Drive
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleChooseFolder}
                disabled={settingUp}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Choose Folder
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Works with iCloud Drive, Dropbox, Google Drive, OneDrive, or any
              folder-syncing service.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-md border bg-green-500/5 border-green-500/20">
              <FolderSync className="h-5 w-5 text-green-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Sync active</p>
                <p className="text-xs text-muted-foreground truncate">
                  {syncFolder}
                </p>
              </div>
              <Check className="h-4 w-4 text-green-500 shrink-0" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleChooseFolder}
                disabled={settingUp}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Change Folder
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisableSync}
                disabled={settingUp}
              >
                {settingUp && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Disable Sync
              </Button>
            </div>
            <div className="p-3 rounded-md bg-muted/30 border">
              <p className="text-xs text-muted-foreground">
                Your library folder is symlinked to the sync folder. Entry
                metadata, PDFs, and notes sync automatically via your cloud
                service.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* What Syncs */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          What Syncs
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2 rounded-md bg-green-500/5 border border-green-500/10">
            <p className="font-medium text-green-700 dark:text-green-400 mb-1">
              Synced
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>Entry metadata</li>
              <li>PDFs & attachments</li>
              <li>Annotations & notes</li>
              <li>Tags & collections</li>
            </ul>
          </div>
          <div className="p-2 rounded-md bg-muted/30 border">
            <p className="font-medium text-muted-foreground mb-1">
              Per-device
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>Search index</li>
              <li>Vector embeddings</li>
              <li>Database cache</li>
              <li>API keys</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
