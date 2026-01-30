import { useState, useEffect } from "react";
import { Link2, Tag, Calendar, ExternalLink, User, BookOpen, FileText, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useLibraryStore } from "@/stores/libraryStore";
import { formatDate } from "@/lib/utils";
import { getPdfDetails, type PdfItemDetails } from "@/services/tauri";

export function RightPane() {
  const { items, selectedItemIds } = useLibraryStore();
  const [pdfDetails, setPdfDetails] = useState<PdfItemDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Get the first selected item for display
  const selectedItem = selectedItemIds.length === 1
    ? items.find((i) => i.id === selectedItemIds[0])
    : null;

  // Fetch PDF details when a PDF item is selected
  useEffect(() => {
    if (selectedItem?.type === "pdf") {
      setLoadingDetails(true);
      getPdfDetails(Number(selectedItem.id))
        .then(setPdfDetails)
        .catch(console.error)
        .finally(() => setLoadingDetails(false));
    } else {
      setPdfDetails(null);
    }
  }, [selectedItem?.id, selectedItem?.type]);

  // Multiple items selected
  if (!selectedItem && selectedItemIds.length > 1) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center px-3 py-2 border-b">
          <h3 className="text-sm font-semibold">Details</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
          {selectedItemIds.length} items selected
        </div>
      </div>
    );
  }

  if (!selectedItem) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b">
        <h3 className="text-sm font-semibold truncate">{selectedItem.title}</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Type badge */}
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 text-xs rounded ${
                selectedItem.type === "pdf"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              }`}
            >
              {selectedItem.type === "pdf" ? "PDF Document" : "Markdown Note"}
            </span>
          </div>

          <Separator />

          {/* Metadata section */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Metadata
            </h4>

            <MetadataRow
              icon={<Calendar className="h-4 w-4" />}
              label="Added"
              value={formatDate(selectedItem.dateAdded)}
            />

            <MetadataRow
              icon={<Calendar className="h-4 w-4" />}
              label="Modified"
              value={formatDate(selectedItem.dateModified)}
            />

            {/* PDF-specific metadata */}
            {selectedItem.type === "pdf" && pdfDetails && (
              <>
                {pdfDetails.author && (
                  <MetadataRow
                    icon={<User className="h-4 w-4" />}
                    label="Author"
                    value={pdfDetails.author}
                  />
                )}
                {pdfDetails.pageCount && (
                  <MetadataRow
                    icon={<FileText className="h-4 w-4" />}
                    label="Pages"
                    value={String(pdfDetails.pageCount)}
                  />
                )}
                {pdfDetails.journal && (
                  <MetadataRow
                    icon={<BookOpen className="h-4 w-4" />}
                    label="Journal"
                    value={pdfDetails.journal}
                  />
                )}
                {pdfDetails.doi && (
                  <MetadataRow
                    icon={<Hash className="h-4 w-4" />}
                    label="DOI"
                    value={pdfDetails.doi}
                  />
                )}
              </>
            )}

            {loadingDetails && (
              <p className="text-xs text-muted-foreground">Loading details...</p>
            )}
          </div>

          <Separator />

          {/* Tags section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                Tags
              </h4>
              <Button variant="ghost" size="icon-xs">
                <Tag className="h-3 w-3" />
              </Button>
            </div>

            {selectedItem.tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tags</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {selectedItem.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-2 py-0.5 text-xs bg-muted rounded-full"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Linked Items section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                Linked Items
              </h4>
              <Button variant="ghost" size="icon-xs">
                <Link2 className="h-3 w-3" />
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">No linked items</p>

            {/* Linked items would be listed here */}
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full justify-start">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in External App
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

interface MetadataRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function MetadataRow({ icon, label, value }: MetadataRowProps) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm truncate">{value}</p>
      </div>
    </div>
  );
}
