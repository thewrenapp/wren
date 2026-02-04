import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileText, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { open } from "@tauri-apps/plugin-shell";

interface HTMLViewerProps {
  filePath: string;
  title?: string;
}

export function HTMLViewer({ filePath, title }: HTMLViewerProps) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (filePath) {
      try {
        const url = convertFileSrc(filePath);
        setAssetUrl(url);
        setError(null);
      } catch (err) {
        console.error("Failed to convert file path:", err);
        setError("Failed to load HTML file");
      }
    }
  }, [filePath]);

  const handleOpenExternal = async () => {
    try {
      await open(filePath);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    // Force iframe reload by temporarily clearing URL
    const currentUrl = assetUrl;
    setAssetUrl(null);
    setTimeout(() => setAssetUrl(currentUrl), 50);
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-4">
          <FileText className="h-12 w-12 mx-auto opacity-50" />
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={handleOpenExternal}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Open in Browser
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span className="truncate max-w-[300px]">{title || filePath.split("/").pop()}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleRefresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleOpenExternal} title="Open in browser">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}
        {assetUrl && (
          <iframe
            src={assetUrl}
            className="w-full h-full border-0"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError("Failed to load HTML content");
            }}
            title={title || "HTML Viewer"}
            sandbox="allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}
