import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  File,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Tag,
} from 'lucide-react';
import type { BiblatexPreviewEntry, BiblatexPreviewResult } from '@/services/tauri/commands';
import { cn } from '@/lib/utils';

interface ImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewData: BiblatexPreviewResult | null;
  onImport: (selectedKeys: string[], importTags: boolean) => void;
  isImporting?: boolean;
}

export function ImportPreviewDialog({
  open,
  onOpenChange,
  previewData,
  onImport,
  isImporting = false,
}: ImportPreviewDialogProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [importTags, setImportTags] = useState(true);
  const [showDuplicates, setShowDuplicates] = useState(true);

  // Initialize selection when preview data changes
  useMemo(() => {
    if (previewData) {
      // Select all non-duplicate entries by default
      const nonDuplicateKeys = previewData.entries
        .filter((e) => !e.isDuplicate)
        .map((e) => e.bibtexKey);
      setSelectedKeys(new Set(nonDuplicateKeys));
    }
  }, [previewData]);

  const filteredEntries = useMemo(() => {
    if (!previewData) return [];
    return showDuplicates
      ? previewData.entries
      : previewData.entries.filter((e) => !e.isDuplicate);
  }, [previewData, showDuplicates]);

  const selectedCount = selectedKeys.size;
  const selectedFilesCount = useMemo(() => {
    if (!previewData) return 0;
    return previewData.entries
      .filter((e) => selectedKeys.has(e.bibtexKey))
      .reduce((acc, e) => acc + e.files.filter((f) => f.exists).length, 0);
  }, [previewData, selectedKeys]);

  const toggleEntry = (key: string) => {
    const newSelected = new Set(selectedKeys);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedKeys(newSelected);
  };

  const toggleExpanded = (key: string) => {
    const newExpanded = new Set(expandedKeys);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedKeys(newExpanded);
  };

  const selectAll = () => {
    setSelectedKeys(new Set(filteredEntries.map((e) => e.bibtexKey)));
  };

  const selectNone = () => {
    setSelectedKeys(new Set());
  };

  const selectNonDuplicates = () => {
    const nonDuplicateKeys = filteredEntries
      .filter((e) => !e.isDuplicate)
      .map((e) => e.bibtexKey);
    setSelectedKeys(new Set(nonDuplicateKeys));
  };

  const handleImport = () => {
    onImport(Array.from(selectedKeys), importTags);
  };

  if (!previewData) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Preview</DialogTitle>
          <DialogDescription>
            Review entries before importing. {previewData.totalEntries} entries found
            {previewData.duplicateCount > 0 && (
              <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                ({previewData.duplicateCount} duplicates)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Summary bar */}
        <div className="flex items-center gap-4 text-sm border-b pb-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Selected:</span>
            <Badge variant="secondary">{selectedCount} entries</Badge>
            <Badge variant="outline">{selectedFilesCount} files</Badge>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selectAll}>
              All
            </Button>
            <Button variant="ghost" size="sm" onClick={selectNone}>
              None
            </Button>
            {previewData.duplicateCount > 0 && (
              <Button variant="ghost" size="sm" onClick={selectNonDuplicates}>
                Non-duplicates
              </Button>
            )}
          </div>
        </div>

        {/* Options bar */}
        <div className="flex items-center gap-4 text-sm py-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={showDuplicates}
              onCheckedChange={(checked) => setShowDuplicates(checked === true)}
            />
            <span>Show duplicates</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={importTags}
              onCheckedChange={(checked) => setImportTags(checked === true)}
            />
            <span>Import tags ({previewData.uniqueTags.length})</span>
          </label>
        </div>

        {/* Entries list */}
        <ScrollArea className="flex-1 min-h-0 border rounded-md">
          <div className="p-2 space-y-1">
            {filteredEntries.map((entry) => (
              <EntryRow
                key={entry.bibtexKey}
                entry={entry}
                isSelected={selectedKeys.has(entry.bibtexKey)}
                isExpanded={expandedKeys.has(entry.bibtexKey)}
                onToggleSelect={() => toggleEntry(entry.bibtexKey)}
                onToggleExpand={() => toggleExpanded(entry.bibtexKey)}
              />
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={selectedCount === 0 || isImporting}>
            {isImporting ? 'Importing...' : `Import ${selectedCount} Entries`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EntryRowProps {
  entry: BiblatexPreviewEntry;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}

function EntryRow({
  entry,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: EntryRowProps) {
  const hasFiles = entry.files.length > 0;
  const existingFilesCount = entry.files.filter((f) => f.exists).length;
  const missingFilesCount = entry.files.length - existingFilesCount;

  return (
    <div
      className={cn(
        'rounded-md border',
        entry.isDuplicate && 'border-yellow-500/50 bg-yellow-500/5',
        isSelected && !entry.isDuplicate && 'border-primary/50 bg-primary/5'
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 p-2">
        <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} />

        {hasFiles && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onToggleExpand}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="font-medium truncate"
              title={entry.title}
            >
              {entry.title}
            </span>
            {entry.isDuplicate && (
              <Badge variant="outline" className="text-yellow-600 border-yellow-500 text-xs">
                Duplicate
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-xs">
              {entry.itemType}
            </Badge>
            {entry.creators.length > 0 && (
              <span>{entry.creators.slice(0, 2).join(', ')}{entry.creators.length > 2 ? ' et al.' : ''}</span>
            )}
            {entry.year && <span>({entry.year})</span>}
          </div>
        </div>

        {/* Files indicator */}
        {hasFiles && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>{existingFilesCount}</span>
            {missingFilesCount > 0 && (
              <span className="text-yellow-600" title={`${missingFilesCount} files not found`}>
                <AlertTriangle className="h-3 w-3" />
              </span>
            )}
          </div>
        )}

        {/* Tags indicator */}
        {entry.tags.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Tag className="h-3.5 w-3.5" />
            <span>{entry.tags.length}</span>
          </div>
        )}
      </div>

      {/* Expanded files list */}
      {isExpanded && hasFiles && (
        <div className="px-10 pb-2 space-y-1">
          {entry.files.map((file, idx) => (
            <div
              key={idx}
              className={cn(
                'flex items-center gap-2 text-xs py-1 px-2 rounded',
                file.exists ? 'bg-muted/50' : 'bg-yellow-500/10'
              )}
            >
              <File className="h-3.5 w-3.5" />
              <span className="flex-1 truncate" title={file.path}>
                {file.title || file.path}
              </span>
              <Badge variant="outline" className="text-xs">
                {file.attachmentType}
              </Badge>
              {file.exists ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <span title="File not found">
                  <XCircle className="h-3.5 w-3.5 text-yellow-600" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
