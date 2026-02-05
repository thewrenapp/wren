import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function PDFPrintView() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const filePath = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("file");
    return raw ? decodeURIComponent(raw) : "";
  }, []);

  useEffect(() => {
    if (!filePath) return;
    setPdfUrl(convertFileSrc(filePath));
  }, [filePath]);

  useEffect(() => {
    const handleAfterPrint = () => {
      getCurrentWindow().close().catch(() => {
        // Ignore close errors
      });
    };

    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  const handleLoad = () => {
    const attemptPrint = () => {
      const iframeWin = iframeRef.current?.contentWindow;
      if (iframeWin) {
        try {
          iframeWin.focus();
          iframeWin.print();
          return;
        } catch {
          // Fall back to printing the container window
        }
      }
      window.focus();
      window.print();
    };

    setTimeout(attemptPrint, 200);
  };

  if (!filePath) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-sm text-muted-foreground">
        Missing file path for printing.
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-white">
      {pdfUrl && (
        <iframe
          ref={iframeRef}
          src={pdfUrl}
          onLoad={handleLoad}
          title="Print PDF"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      )}
    </div>
  );
}

export default PDFPrintView;
