import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Set up PDF.js worker (same as PDFViewer)
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type PrintType = "pdf" | "html" | "image";

export function PDFPrintView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "rendering" | "ready" | "error">("loading");
  const [progress, setProgress] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const printTriggered = useRef(false);

  const { filePath, printType } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("file");
    const type = (params.get("type") || "pdf") as PrintType;
    return {
      filePath: raw ? decodeURIComponent(raw) : "",
      printType: type,
    };
  }, []);

  // Close window after printing
  useEffect(() => {
    const handleAfterPrint = () => {
      getCurrentWindow().close().catch(() => {});
    };

    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  // Load content and prepare for printing
  useEffect(() => {
    if (!filePath) return;

    let cancelled = false;

    async function loadAndRender() {
      try {
        if (printType === "pdf") {
          await loadPdf(cancelled);
        } else if (printType === "html") {
          await loadHtml(cancelled);
        } else if (printType === "image") {
          await loadImage(cancelled);
        }
      } catch (err) {
        console.error(`Failed to load ${printType} for printing:`, err);
        if (!cancelled) {
          setStatus("error");
        }
      }
    }

    async function loadPdf(isCancelled: boolean) {
      const pdfUrl = convertFileSrc(filePath);
      const loadingTask = getDocument(pdfUrl);
      const pdf: PDFDocumentProxy = await loadingTask.promise;

      if (isCancelled) return;

      setTotalPages(pdf.numPages);
      setStatus("rendering");

      const container = containerRef.current;
      if (!container) return;

      container.innerHTML = "";

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (cancelled) return;

        const page = await pdf.getPage(pageNum);
        const scale = 2;
        const viewport = page.getViewport({ scale });

        const pageDiv = document.createElement("div");
        pageDiv.className = "print-page";
        pageDiv.style.pageBreakAfter = "always";
        pageDiv.style.marginBottom = "0";
        pageDiv.style.display = "flex";
        pageDiv.style.justifyContent = "center";

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / scale}px`;
        canvas.style.height = `${viewport.height / scale}px`;

        await page.render({
          canvas,
          viewport,
          intent: "print",
        }).promise;

        pageDiv.appendChild(canvas);
        container.appendChild(pageDiv);

        setProgress(pageNum);
      }

      if (!cancelled) {
        setStatus("ready");
      }
    }

    async function loadHtml(isCancelled: boolean) {
      const htmlUrl = convertFileSrc(filePath);
      const response = await fetch(htmlUrl);
      const htmlContent = await response.text();

      if (isCancelled) return;

      // Parse the HTML to extract styles and body content
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");

      // Resolve base path for relative resources (images, CSS)
      const lastSlash = filePath.lastIndexOf("/");
      const dirPath = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : "";
      const baseUrl = dirPath ? convertFileSrc(dirPath) + "/" : "";

      // Add base tag so relative URLs resolve correctly
      if (baseUrl) {
        const base = document.createElement("base");
        base.href = baseUrl;
        document.head.appendChild(base);
      }

      // Copy stylesheets from the parsed document into the current document
      doc.querySelectorAll("style").forEach((style) => {
        document.head.appendChild(document.importNode(style, true));
      });
      doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        document.head.appendChild(document.importNode(link, true));
      });

      // Inject body content directly into the container (no iframe)
      // This ensures window.print() captures the content in WKWebView
      const container = containerRef.current;
      if (!container) return;

      container.innerHTML = doc.body.innerHTML;
      container.style.padding = "20px";
      container.style.maxWidth = "900px";
      container.style.margin = "0 auto";

      // Wait for external stylesheets and images to load
      const images = container.querySelectorAll("img");
      const imagePromises = Array.from(images).map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
            } else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }
          })
      );
      await Promise.all(imagePromises);

      // Extra delay for stylesheet loading
      await new Promise((resolve) => setTimeout(resolve, 300));

      if (!isCancelled) {
        setStatus("ready");
      }
    }

    async function loadImage(isCancelled: boolean) {
      const imageUrl = convertFileSrc(filePath);

      // Preload the image
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = imageUrl;
      });

      if (isCancelled) return;

      const container = containerRef.current;
      if (!container) return;

      container.innerHTML = "";

      const imgEl = document.createElement("img");
      imgEl.src = imageUrl;
      imgEl.style.maxWidth = "100%";
      imgEl.style.maxHeight = "100vh";
      imgEl.style.objectFit = "contain";
      imgEl.style.display = "block";
      imgEl.style.margin = "0 auto";

      container.appendChild(imgEl);

      if (!isCancelled) {
        setStatus("ready");
      }
    }

    loadAndRender();

    return () => {
      cancelled = true;
    };
  }, [filePath, printType]);

  // Auto-trigger print when content is ready
  useEffect(() => {
    if (status !== "ready" || printTriggered.current) return;
    printTriggered.current = true;

    setTimeout(() => {
      window.print();
    }, 300);
  }, [status]);

  if (!filePath) {
    return (
      <div style={styles.center}>
        Missing file path for printing.
      </div>
    );
  }

  const typeLabel = printType === "pdf" ? "PDF" : printType === "html" ? "page" : "image";

  return (
    <div style={styles.wrapper}>
      {/* Print-specific styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media print {
          body { margin: 0; padding: 0; }
          .print-status { display: none !important; }
          .print-page { page-break-after: always; margin: 0 !important; padding: 0 !important; }
          .print-page:last-child { page-break-after: auto; }
          .print-page canvas { width: 100% !important; height: auto !important; }
          .print-container { padding: 0 !important; }
          .print-container img { max-width: 100% !important; height: auto !important; }
        }
        @media screen {
          .print-page { margin-bottom: 8px; }
          .print-page canvas { box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
        }
      `}</style>

      {/* Status overlay - hidden when printing */}
      {status !== "ready" && (
        <div className="print-status" style={styles.statusOverlay}>
          {status === "loading" && (
            <div style={styles.statusContent}>
              <div style={styles.spinner} />
              <p>Loading {typeLabel}...</p>
            </div>
          )}
          {status === "rendering" && printType === "pdf" && (
            <div style={styles.statusContent}>
              <div style={styles.spinner} />
              <p>Rendering pages... {progress}/{totalPages}</p>
              <div style={styles.progressBar}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${(progress / totalPages) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
          {status === "rendering" && printType !== "pdf" && (
            <div style={styles.statusContent}>
              <div style={styles.spinner} />
              <p>Preparing {typeLabel} for printing...</p>
            </div>
          )}
          {status === "error" && (
            <div style={styles.statusContent}>
              <p style={{ color: "hsl(var(--destructive))" }}>Failed to load {typeLabel} for printing.</p>
            </div>
          )}
        </div>
      )}

      {/* Rendered content container */}
      <div ref={containerRef} className="print-container" style={styles.pagesContainer} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: "100vw",
    minHeight: "100vh",
    backgroundColor: "hsl(var(--muted))",
  },
  center: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
    color: "hsl(var(--muted-foreground))",
  },
  statusOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "hsl(var(--background) / 0.9)",
    zIndex: 100,
  },
  statusContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
    fontSize: "14px",
    color: "hsl(var(--foreground))",
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "3px solid hsl(var(--border))",
    borderTopColor: "hsl(var(--primary))",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  progressBar: {
    width: "200px",
    height: "4px",
    backgroundColor: "hsl(var(--border))",
    borderRadius: "2px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "hsl(var(--primary))",
    borderRadius: "2px",
    transition: "width 0.2s ease",
  },
  pagesContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "8px",
  },
};

export default PDFPrintView;
