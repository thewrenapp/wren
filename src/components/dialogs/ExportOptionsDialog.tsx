import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Download, FileText, StickyNote, Link, MessageSquare } from 'lucide-react';
import type { ExportOptions } from '@/services/tauri/commands';

export interface ExportOptionsDialogProps {
  open: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  entryCount: number;
  isExporting?: boolean;
}

export function ExportOptionsDialog({
  open,
  onClose,
  onExport,
  entryCount,
  isExporting = false,
}: ExportOptionsDialogProps) {
  const [includePdfs, setIncludePdfs] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeWeblinks, setIncludeWeblinks] = useState(true);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);

  const handleExport = () => {
    onExport({
      includePdfs,
      includeNotes,
      includeWeblinks,
      includeAnnotations,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30'>
              <Download className='h-5 w-5 text-blue-600 dark:text-blue-400' />
            </div>
            <div>
              <DialogTitle>Export to BibLaTeX</DialogTitle>
              <DialogDescription className='mt-1'>
                Export {entryCount} {entryCount === 1 ? 'entry' : 'entries'} with associated files
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          <p className='text-sm text-muted-foreground'>
            Select what to include in the export:
          </p>

          <div className='space-y-3'>
            <div className='flex items-center space-x-3'>
              <Checkbox
                id='includePdfs'
                checked={includePdfs}
                onCheckedChange={(checked) => setIncludePdfs(checked === true)}
              />
              <Label
                htmlFor='includePdfs'
                className='flex items-center gap-2 cursor-pointer font-normal'
              >
                <FileText className='h-4 w-4 text-red-500' />
                PDF Files
              </Label>
            </div>

            <div className='flex items-center space-x-3'>
              <Checkbox
                id='includeNotes'
                checked={includeNotes}
                onCheckedChange={(checked) => setIncludeNotes(checked === true)}
              />
              <Label
                htmlFor='includeNotes'
                className='flex items-center gap-2 cursor-pointer font-normal'
              >
                <StickyNote className='h-4 w-4 text-yellow-500' />
                Notes (as Markdown)
              </Label>
            </div>

            <div className='flex items-center space-x-3'>
              <Checkbox
                id='includeWeblinks'
                checked={includeWeblinks}
                onCheckedChange={(checked) => setIncludeWeblinks(checked === true)}
              />
              <Label
                htmlFor='includeWeblinks'
                className='flex items-center gap-2 cursor-pointer font-normal'
              >
                <Link className='h-4 w-4 text-blue-500' />
                Web Links
              </Label>
            </div>

            <div className='flex items-center space-x-3'>
              <Checkbox
                id='includeAnnotations'
                checked={includeAnnotations}
                onCheckedChange={(checked) => setIncludeAnnotations(checked === true)}
              />
              <Label
                htmlFor='includeAnnotations'
                className='flex items-center gap-2 cursor-pointer font-normal'
              >
                <MessageSquare className='h-4 w-4 text-purple-500' />
                Annotations (as JSON)
              </Label>
            </div>
          </div>

          <p className='text-xs text-muted-foreground mt-4'>
            Files will be exported to a folder containing export.bib and a files/ directory.
          </p>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
