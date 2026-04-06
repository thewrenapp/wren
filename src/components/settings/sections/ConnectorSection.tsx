import { useState, useEffect, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getConnectorStatus,
  startConnectorServer,
  stopConnectorServer,
  updateSetting,
  type ConnectorStatus,
} from "@/services/tauri/commands";
import { toast } from "@/stores/toastStore";

export function ConnectorSection() {
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [port, setPort] = useState("1289");
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getConnectorStatus();
      setStatus(s);
      if (s.port) setPort(String(s.port));
    } catch (e) {
      console.error("Failed to get connector status:", e);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleToggle = async (checked: boolean | "indeterminate") => {
    if (checked === "indeterminate") return;
    setLoading(true);
    try {
      if (checked) {
        await updateSetting("connector_port", port);
        await startConnectorServer();
        toast.success(`Connector server started on port ${port}`);
      } else {
        await stopConnectorServer();
        toast.success("Connector server stopped");
      }
      await refreshStatus();
    } catch (e) {
      toast.error(`${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          The Wren Connector allows you to save references directly from your browser using the Wren Connector Chrome extension.
        </p>
      </div>

      {/* Enable/Disable */}
      <div className="flex items-center gap-3">
        <Checkbox
          id="connector-enabled"
          checked={status?.running ?? false}
          onCheckedChange={handleToggle}
          disabled={loading}
        />
        <div className="space-y-0.5">
          <Label htmlFor="connector-enabled">Enable Connector Server</Label>
          <p className="text-xs text-muted-foreground">
            Runs a local HTTP server that the browser extension connects to
          </p>
        </div>
      </div>

      {/* Port */}
      <div className="space-y-2">
        <Label>Port</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={status?.running ?? false}
            className="w-32"
          />
          {status?.running && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Listening on port {status.port}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Change requires restarting the server
        </p>
      </div>
    </div>
  );
}
