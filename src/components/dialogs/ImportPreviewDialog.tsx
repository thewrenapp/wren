import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  File,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Tag,
  FolderOpen,
  Plus,
} from 'lucide-react';
import type { BiblatexPreviewEntry, BiblatexPreviewResult } from '@/services/tauri/commands';
import { createCollection, getCollections } from '@/services/tauri';
import { cn } from '@/lib/utils';
import { useLibraryStore } from '@/stores/libraryStore';
import { toast } from '@/stores/toastStore';

export interface ImportOptions {
  selectedKeys: string[];
  importTags: boolean;
  excludedFiles: Record<string, number[]>; // bibtexKey -> array of excluded file indices
  collectionId?: number;
}

interface ImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewData: BiblatexPreviewResult | null;
  onImport: (options: ImportOptions) => void;
  isImporting?: boolean;
}

type BiblatexImportProgress = {
  current: number;
  total: number;
  currentKey: string;
  currentTitle: string;
};

type ImportDetailProgress = {
  fileName: string;
  step: string;
  method: string | null;
  status: string;
  message: string | null;
};

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
  const [excludedFiles, setExcludedFiles] = useState<Map<string, Set<number>>>(new Map());
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | undefined>(undefined);
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [progress, setProgress] = useState<BiblatexImportProgress | null>(null);
  const [detailProgress, setDetailProgress] = useState<ImportDetailProgress | null>(null);

  const { collections, setCollections } = useLibraryStore();

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      const newCollection = await createCollection({ name: newCollectionName.trim() });
      const allCollections = await getCollections();
      setCollections(allCollections);
      setSelectedCollectionId(newCollection.id);
      setNewCollectionName('');
      setShowNewCollection(false);
      toast.success(`Collection "${newCollectionName.trim()}" created`);
    } catch (err) {
      console.error('Failed to create collection:', err);
      toast.error('Failed to create collection');
    }
  };

  // Initialize selection when preview data changes
  useEffect(() => {
    if (previewData) {
      // Select all non-duplicate entries by default
      const nonDuplicateKeys = previewData.entries
        .filter((e) => !e.isDuplicate)
        .map((e) => e.bibtexKey);
      setSelectedKeys(new Set(nonDuplicateKeys));
      setExcludedFiles(new Map());
    }
  }, [previewData]);

  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | null = null;
    let unlistenDetail: (() => void) | null = null;

    const setup = async () => {
      const un = await listen<BiblatexImportProgress>('import:biblatex:progress', (event) => {
        if (!isImporting) return;
        setProgress(event.payload);
      });
      unlisten = un;

      // Listen for file-level extraction details
      const unDetail = await listen<ImportDetailProgress>('import:detail', (event) => {
        if (!isImporting) return;
        setDetailProgress(event.payload);
      });
      unlistenDetail = unDetail;
    };

    setup();

    return () => {
      if (unlisten) {
        unlisten();
      }
      if (unlistenDetail) {
        unlistenDetail();
      }
    };
  }, [open, isImporting]);

  useEffect(() => {
    if (!isImporting) {
      setProgress(null);
      setDetailProgress(null);
    }
  }, [isImporting]);

  const filteredEntries = useMemo(() => {
    if (!previewData) return [];
    return showDuplicates
      ? previewData.entries
      : previewData.entries.filter((e) => !e.isDuplicate);
  }, [previewData, showDuplicates]);

  const selectedCount = selectedKeys.size;
  const progressTotal = progress?.total || selectedCount;
  const progressPercent =
    progressTotal > 0 ? Math.min(100, Math.round(((progress?.current || 0) / progressTotal) * 100)) : 0;

  // Calculate file counts considering exclusions
  const { totalFilesCount, existingFilesCount, includedFilesCount } = useMemo(() => {
    if (!previewData) return { totalFilesCount: 0, existingFilesCount: 0, includedFilesCount: 0 };
    const selectedEntries = previewData.entries.filter((e) => selectedKeys.has(e.bibtexKey));
    let total = 0;
    let existing = 0;
    let included = 0;

    for (const entry of selectedEntries) {
      const excluded = excludedFiles.get(entry.bibtexKey) || new Set();
      for (let i = 0; i < entry.files.length; i++) {
        const file = entry.files[i];
        total++;
        if (file.exists) existing++;
        if (!excluded.has(i) && file.exists) included++;
      }
    }
    return { totalFilesCount: total, existingFilesCount: existing, includedFilesCount: included };
  }, [previewData, selectedKeys, excludedFiles]);

  // Total files in all entries (for header display)
  const allFilesCount = useMemo(() => {
    if (!previewData) return 0;
    return previewData.entries.reduce((acc, e) => acc + e.files.length, 0);
  }, [previewData]);

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

  const toggleFileExclusion = (bibtexKey: string, fileIndex: number) => {
    const newExcludedFiles = new Map(excludedFiles);
    const entryExclusions = new Set(newExcludedFiles.get(bibtexKey) || []);

    if (entryExclusions.has(fileIndex)) {
      entryExclusions.delete(fileIndex);
    } else {
      entryExclusions.add(fileIndex);
    }

    if (entryExclusions.size === 0) {
      newExcludedFiles.delete(bibtexKey);
    } else {
      newExcludedFiles.set(bibtexKey, entryExclusions);
    }
    setExcludedFiles(newExcludedFiles);
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
    // Convert excludedFiles Map to Record
    const excludedFilesRecord: Record<string, number[]> = {};
    excludedFiles.forEach((indices, key) => {
      if (selectedKeys.has(key)) {
        excludedFilesRecord[key] = Array.from(indices);
      }
    });

    onImport({
      selectedKeys: Array.from(selectedKeys),
      importTags,
      excludedFiles: excludedFilesRecord,
      collectionId: selectedCollectionId,
    });
  };

  if (!previewData) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import Preview</DialogTitle>
          <DialogDescription>
            Review entries before importing. {previewData.totalEntries} entries, {allFilesCount} files found
            {previewData.duplicateCount > 0 && (
              <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                ({previewData.duplicateCount} already in library)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Summary bar */}
        <div className="flex items-center gap-4 text-sm border-b pb-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Selected:</span>
            <Badge variant="secondary">{selectedCount} entries</Badge>
            <Badge variant="outline">
              {includedFilesCount} files
              {totalFilesCount > 0 && existingFilesCount < totalFilesCount && (
                <span className="text-yellow-600 ml-1">({totalFilesCount - existingFilesCount} missing)</span>
              )}
            </Badge>
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
                New only
              </Button>
            )}
          </div>
        </div>

        {isImporting && (
          <div className="border-b pb-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Importing {progress?.current || 0} of {progressTotal}</span>
              {progress?.currentTitle && (
                <span className="truncate">• {progress.currentTitle}</span>
              )}
            </div>
            <div className="mt-2 h-2 rounded bg-muted">
              <div
                className="h-2 rounded bg-primary transition-[width] duration-150"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* File-level extraction detail */}
            {detailProgress && (
              <div className="mt-2 text-xs space-y-1 bg-muted/50 rounded p-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">File:</span>
                  <span className="truncate font-mono">{detailProgress.fileName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Step:</span>
                  <span>{detailProgress.step}</span>
                  {detailProgress.method && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-blue-500">{detailProgress.method}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={cn(
                    detailProgress.status === 'success' && 'text-green-500',
                    detailProgress.status === 'failed' && 'text-red-500',
                    detailProgress.status === 'skipped' && 'text-yellow-500',
                    detailProgress.status === 'processing' && 'text-blue-500'
                  )}>
                    {detailProgress.status}
                  </span>
                  {detailProgress.message && (
                    <span className="text-muted-foreground truncate">({detailProgress.message})</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Options bar */}
        <div className="flex flex-wrap items-center gap-4 text-sm py-2">
          <label className="flex items-center gap-2 cursor-pointer" title="Show entries that already exist in your library">
            <Checkbox
              checked={showDuplicates}
              onCheckedChange={(checked) => setShowDuplicates(checked === true)}
            />
            <span>Show existing entries</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={importTags}
              onCheckedChange={(checked) => setImportTags(checked === true)}
            />
            <span>Import tags ({previewData.uniqueTags.length})</span>
          </label>

          <div className="flex items-center gap-2 ml-auto">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <Select
              value={selectedCollectionId?.toString() || 'none'}
              onValueChange={(value: string) => {
                if (value === 'new') {
                  setShowNewCollection(true);
                } else {
                  setSelectedCollectionId(value === 'none' ? undefined : parseInt(value));
                }
              }}
            >
              <SelectTrigger className="w-[180px] h-8">
                <SelectValue placeholder="Add to collection..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No collection</SelectItem>
                {collections.map((collection) => (
                  <SelectItem key={collection.id} value={collection.id.toString()}>
                    <div className="flex items-center gap-2">
                      {collection.color && (
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: collection.color }}
                        />
                      )}
                      {collection.name}
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="new" className="text-primary">
                  <div className="flex items-center gap-2">
                    <Plus className="h-3 w-3" />
                    New collection...
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* New Collection Popover */}
            <Popover open={showNewCollection} onOpenChange={setShowNewCollection}>
              <PopoverTrigger asChild>
                <span />
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="end">
                <div className="space-y-3">
                  <div className="text-sm font-medium">New Collection</div>
                  <Input
                    placeholder="Collection name"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleCreateCollection();
                      }
                    }}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowNewCollection(false);
                        setNewCollectionName('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCreateCollection}
                      disabled={!newCollectionName.trim()}
                    >
                      Create
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Entries list */}
        <div className="min-h-[200px] max-h-[50vh] overflow-y-auto border rounded-md p-2 space-y-1">
          {filteredEntries.map((entry) => (
            <EntryRow
              key={entry.bibtexKey}
              entry={entry}
              isSelected={selectedKeys.has(entry.bibtexKey)}
              isExpanded={expandedKeys.has(entry.bibtexKey)}
              excludedFileIndices={excludedFiles.get(entry.bibtexKey) || new Set()}
              onToggleSelect={() => toggleEntry(entry.bibtexKey)}
              onToggleExpand={() => toggleExpanded(entry.bibtexKey)}
              onToggleFile={(index) => toggleFileExclusion(entry.bibtexKey, index)}
            />
          ))}
        </div>

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
  excludedFileIndices: Set<number>;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onToggleFile: (index: number) => void;
}

function EntryRow({
  entry,
  isSelected,
  isExpanded,
  excludedFileIndices,
  onToggleSelect,
  onToggleExpand,
  onToggleFile,
}: EntryRowProps) {
  const hasFiles = entry.files.length > 0;
  const existingFilesCount = entry.files.filter((f) => f.exists).length;
  const includedFilesCount = entry.files.filter((f, i) => f.exists && !excludedFileIndices.has(i)).length;
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
                Exists
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
            <span>{includedFilesCount}/{existingFilesCount}</span>
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
          {entry.files.map((file, idx) => {
            const isFileIncluded = !excludedFileIndices.has(idx);
            const canInclude = file.exists;

            return (
              <div
                key={idx}
                className={cn(
                  'flex items-center gap-2 text-xs py-1 px-2 rounded',
                  !canInclude && 'bg-yellow-500/10 opacity-60',
                  canInclude && isFileIncluded && 'bg-muted/50',
                  canInclude && !isFileIncluded && 'bg-muted/20 opacity-60'
                )}
              >
                <Checkbox
                  checked={canInclude && isFileIncluded}
                  disabled={!canInclude}
                  onCheckedChange={() => onToggleFile(idx)}
                  className="h-3.5 w-3.5"
                />
                <File className="h-3.5 w-3.5" />
                <span className={cn('flex-1 truncate', !isFileIncluded && 'line-through')} title={file.path}>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
