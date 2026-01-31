import { useState, useEffect } from "react";
import {
  Info,
  FileText,
  Paperclip,
  FolderOpen,
  Tags,
  Link2,
  Globe,
  ExternalLink,
  File,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { InfoSection } from "./InfoSection";
import { useLibraryStore, type EntrySummary } from "@/stores/libraryStore";
import { formatDate } from "@/lib/utils";
import { getEntry, type Entry as TauriEntry } from "@/services/tauri";

interface EntryInfoPanelProps {
  entry: EntrySummary;
}

export function EntryInfoPanel({ entry }: EntryInfoPanelProps) {
  const { collections } = useLibraryStore();
  const [fullEntry, setFullEntry] = useState<TauriEntry | null>(null);

  // Fetch full entry details
  useEffect(() => {
    console.log("Fetching entry details for ID:", entry.id);
    getEntry(Number(entry.id))
      .then((data) => {
        console.log("Fetched entry data:", data);
        console.log("Attachments:", data.attachments);
        setFullEntry(data);
      })
      .catch(console.error);
  }, [entry.id]);

  // Get collections this entry belongs to (placeholder - would need real data)
  const entryCollections = collections.filter(() => false);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-3 py-2 border-b">
        <h3 className="text-sm font-semibold line-clamp-2">{entry.title}</h3>
        {entry.creatorsDisplay && (
          <p className="text-xs text-muted-foreground mt-1">{entry.creatorsDisplay}</p>
        )}
      </div>

      <ScrollArea className="flex-1">
        {/* Info Section */}
        <InfoSection
          title="Info"
          icon={<Info className="h-4 w-4" />}
          defaultOpen={true}
        >
          <div className="space-y-2">
            <MetadataField label="Item Type" value={formatEntryType(entry.entryType)} />
            <MetadataField label="Title" value={entry.title} />
            {entry.creatorsDisplay && (
              <MetadataField label="Author" value={entry.creatorsDisplay} />
            )}
            {entry.year && <MetadataField label="Year" value={entry.year} />}
            {fullEntry?.doi && <MetadataField label="DOI" value={fullEntry.doi} copyable />}
            {fullEntry?.isbn && <MetadataField label="ISBN" value={fullEntry.isbn} />}
            {fullEntry?.url && (
              <MetadataField label="URL" value={fullEntry.url} link />
            )}
            {fullEntry?.journal && (
              <MetadataField label="Journal" value={fullEntry.journal} />
            )}
            {fullEntry?.publisher && (
              <MetadataField label="Publisher" value={fullEntry.publisher} />
            )}
            {fullEntry?.volume && (
              <MetadataField label="Volume" value={fullEntry.volume} />
            )}
            {fullEntry?.issue && (
              <MetadataField label="Issue" value={fullEntry.issue} />
            )}
            {fullEntry?.pages && (
              <MetadataField label="Pages" value={fullEntry.pages} />
            )}
            {fullEntry?.repository && (
              <MetadataField label="Repository" value={fullEntry.repository} />
            )}
            {fullEntry?.archiveId && (
              <MetadataField label="Archive ID" value={fullEntry.archiveId} />
            )}
            <MetadataField label="Date Added" value={formatDate(entry.dateAdded)} />
          </div>
        </InfoSection>

        {/* Abstract Section */}
        {fullEntry?.abstract && (
          <InfoSection title="Abstract" icon={<FileText className="h-4 w-4" />}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {fullEntry.abstract}
            </p>
          </InfoSection>
        )}

        {/* Attachments Section */}
        <InfoSection
          title="Attachments"
          icon={<Paperclip className="h-4 w-4" />}
          count={entry.attachmentCount}
          onAdd={() => {
            // TODO: Add attachment
          }}
        >
          {fullEntry?.attachments && fullEntry.attachments.length > 0 ? (
            <div className="space-y-1">
              {fullEntry.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <AttachmentIcon type={attachment.attachmentType} />
                  <span className="text-sm flex-1 truncate">
                    {attachment.title || getAttachmentTitle(attachment)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No attachments</p>
          )}
        </InfoSection>

        {/* Collections Section */}
        <InfoSection
          title="Collections"
          icon={<FolderOpen className="h-4 w-4" />}
          count={entryCollections.length}
          onAdd={() => {
            // TODO: Add to collection
          }}
        >
          {entryCollections.length > 0 ? (
            <div className="space-y-1">
              {entryCollections.map((collection) => (
                <div
                  key={collection.id}
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{collection.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not in any collections</p>
          )}
        </InfoSection>

        {/* Tags Section */}
        <InfoSection
          title="Tags"
          icon={<Tags className="h-4 w-4" />}
          count={entry.tags.length}
          onAdd={() => {
            // TODO: Add tag
          }}
        >
          {entry.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 text-xs bg-muted rounded-full"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tags</p>
          )}
        </InfoSection>

        {/* Related Section */}
        <InfoSection
          title="Related"
          icon={<Link2 className="h-4 w-4" />}
          count={0}
          onAdd={() => {
            // TODO: Add related entry
          }}
        >
          <p className="text-sm text-muted-foreground">No related items</p>
        </InfoSection>

        {/* Actions */}
        <div className="p-3 space-y-2">
          <Button variant="outline" size="sm" className="w-full justify-start">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open in External App
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}

// Helper components

interface MetadataFieldProps {
  label: string;
  value: string;
  copyable?: boolean;
  link?: boolean;
}

function MetadataField({ label, value, copyable, link }: MetadataFieldProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="flex items-start">
      <span className="text-xs text-muted-foreground w-24 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        {link ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline truncate block"
          >
            {value}
          </a>
        ) : (
          <span
            className={`text-sm ${copyable ? "cursor-pointer hover:text-primary" : ""}`}
            onClick={copyable ? handleCopy : undefined}
            title={copyable ? "Click to copy" : undefined}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

function AttachmentIcon({ type }: { type: string }) {
  switch (type) {
    case "pdf":
      return <File className="h-4 w-4 text-red-500" />;
    case "note":
      return <FileText className="h-4 w-4 text-blue-500" />;
    case "weblink":
      return <Globe className="h-4 w-4 text-green-500" />;
    default:
      return <Paperclip className="h-4 w-4 text-muted-foreground" />;
  }
}

function getAttachmentTitle(attachment: { filePath?: string; url?: string; attachmentType: string }): string {
  if (attachment.filePath) {
    const parts = attachment.filePath.split("/");
    return parts[parts.length - 1];
  }
  if (attachment.url) {
    return attachment.url;
  }
  return `${attachment.attachmentType} attachment`;
}

function formatEntryType(type: string): string {
  const typeMap: Record<string, string> = {
    paper: "Paper",
    journal_article: "Journal Article",
    book: "Book",
    book_chapter: "Book Chapter",
    conference_paper: "Conference Paper",
    thesis: "Thesis",
    report: "Report",
    website: "Website",
    magazine_article: "Magazine Article",
    newspaper_article: "Newspaper Article",
    software: "Software",
    generic: "Generic",
  };
  return typeMap[type] || type.replace(/_/g, " ");
}
