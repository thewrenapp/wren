import { ChevronLeft } from "lucide-react";
import { LeftPanel, type PdfHighlighterUtils } from "@/components/pdf/pdfjs";
import { AnnotationPanel } from "./AnnotationPanel";
import { OutlinePanel } from "./OutlinePanel";
import type { AppHighlight } from "./usePDFAnnotations";
import type { PDFDocumentProxy } from "pdfjs-dist";

type LeftPanelTab = "thumbnails" | "outline" | "annotations";

interface PDFLeftPanelProps {
  leftPanelTab: LeftPanelTab;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  annotations: AppHighlight[];
  onAnnotationClick: (id: string, page: number) => void;
  onDelete: (id: string) => void;
  pdfDocument: PDFDocumentProxy;
  goToPage: (page: number) => void;
  currentPage: number;
  pdfHighlighterUtils: PdfHighlighterUtils | null;
  togglePdfLeftPanel: () => void;
}

export function PDFLeftPanel({
  leftPanelTab,
  setLeftPanelTab,
  annotations,
  onAnnotationClick,
  onDelete,
  pdfDocument,
  goToPage,
  currentPage,
  pdfHighlighterUtils,
  togglePdfLeftPanel,
}: PDFLeftPanelProps) {
  return (
    <div className="relative flex flex-col h-full w-[220px] border-r bg-background overflow-visible">
      <div className="flex border-b px-1 py-1 gap-1">
        <button
          onClick={() => setLeftPanelTab("thumbnails")}
          className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
            leftPanelTab === "thumbnails"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          Pages
        </button>
        <button
          onClick={() => setLeftPanelTab("outline")}
          className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
            leftPanelTab === "outline"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          Outline
        </button>
        <button
          onClick={() => setLeftPanelTab("annotations")}
          className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
            leftPanelTab === "annotations"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          Notes
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {leftPanelTab === "annotations" ? (
          <AnnotationPanel
            annotations={annotations}
            onAnnotationClick={onAnnotationClick}
            onDelete={onDelete}
          />
        ) : leftPanelTab === "outline" ? (
          <OutlinePanel
            pdfDocument={pdfDocument}
            goToPage={goToPage}
            currentPage={currentPage}
          />
        ) : (
          <LeftPanel
            pdfDocument={pdfDocument}
            viewer={pdfHighlighterUtils?.getViewer()}
            linkService={pdfHighlighterUtils?.getLinkService()}
            eventBus={pdfHighlighterUtils?.getEventBus()}
            goToPage={pdfHighlighterUtils?.goToPage}
            isOpen={true}
            onOpenChange={(open) => { if (!open) togglePdfLeftPanel(); }}
            width={220}
            defaultTab={leftPanelTab}
          />
        )}
      </div>

      {(leftPanelTab === "annotations" || leftPanelTab === "outline") && (
        <button
          onClick={togglePdfLeftPanel}
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            left: 219,
            zIndex: 20,
            width: 24,
            height: 48,
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderLeft: "none",
            borderRadius: "0 6px 6px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "2px 0 8px hsl(var(--foreground) / 0.08)",
          }}
          aria-label="Close panel"
        >
          <ChevronLeft style={{ width: 14, height: 14, color: "hsl(var(--muted-foreground))" }} />
        </button>
      )}
    </div>
  );
}
