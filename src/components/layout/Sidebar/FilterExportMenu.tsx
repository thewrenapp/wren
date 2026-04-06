import {
  Download,
  FileJson,
  FileCode,
  Copy,
  Archive,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  getEntries,
  exportToBibtex,
  exportToCslJson,
  exportEntriesArchive,
} from '@/services/tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from '@/stores/toastStore';

async function fetchFilteredEntryIds(filterType: string): Promise<number[]> {
  const entries = await getEntries({ filterType });
  return entries.map((e) => e.id);
}

async function handleExportFilteredCslJson(filterType: string, fileName: string) {
  try {
    const entryIds = await fetchFilteredEntryIds(filterType);
    if (entryIds.length === 0) {
      alert('No entries to export');
      return;
    }
    const content = await exportToCslJson(entryIds);
    const filePath = await save({
      defaultPath: `${fileName}.json`,
      filters: [{ name: 'CSL JSON', extensions: ['json'] }],
    });
    if (filePath) {
      await writeTextFile(filePath, content);
    }
  } catch (err) {
    console.error('Failed to export to CSL JSON:', err);
  }
}

async function handleExportFilteredBibtex(filterType: string, fileName: string) {
  try {
    const entryIds = await fetchFilteredEntryIds(filterType);
    if (entryIds.length === 0) {
      alert('No entries to export');
      return;
    }
    const content = await exportToBibtex(entryIds);
    const filePath = await save({
      defaultPath: `${fileName}.bib`,
      filters: [{ name: 'BibTeX', extensions: ['bib'] }],
    });
    if (filePath) {
      await writeTextFile(filePath, content);
    }
  } catch (err) {
    console.error('Failed to export to BibTeX:', err);
  }
}

async function handleCopyFilteredCslJson(filterType: string) {
  try {
    const entryIds = await fetchFilteredEntryIds(filterType);
    if (entryIds.length === 0) {
      alert('No entries to copy');
      return;
    }
    const content = await exportToCslJson(entryIds);
    await writeText(content);
  } catch (err) {
    console.error('Failed to copy CSL JSON:', err);
  }
}

async function handleCopyFilteredBibtex(filterType: string) {
  try {
    const entryIds = await fetchFilteredEntryIds(filterType);
    if (entryIds.length === 0) {
      alert('No entries to copy');
      return;
    }
    const content = await exportToBibtex(entryIds);
    await writeText(content);
  } catch (err) {
    console.error('Failed to copy BibTeX:', err);
  }
}

async function handleExportFilteredArchive(filterType: string, fileName: string) {
  try {
    const entryIds = await fetchFilteredEntryIds(filterType);
    if (entryIds.length === 0) {
      toast.warning('No entries to export');
      return;
    }
    const filePath = await save({
      defaultPath: `${fileName}.wrenitem`,
      filters: [{ name: 'Wren Archive', extensions: ['wrenitem'] }],
    });
    if (filePath) {
      const result = await exportEntriesArchive(entryIds, filePath);
      toast.success(`Exported ${result.entriesExported} entries (${result.filesExported} files)`);
    }
  } catch (err) {
    console.error('Failed to export as archive:', err);
    toast.error('Failed to export archive');
  }
}

interface FilterItemWithExportMenuProps {
  filterType: string;
  fileName: string;
  label: string;
  children: React.ReactNode;
}

export function FilterItemWithExportMenu({
  filterType,
  fileName,
  label,
  children,
}: FilterItemWithExportMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className='w-full overflow-hidden'>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className='w-48'>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Download className='h-4 w-4 mr-2' />
            {label}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className='w-40'>
            <ContextMenuItem
              onClick={() => handleExportFilteredCslJson(filterType, fileName)}
            >
              <FileJson className='h-4 w-4 mr-2' />
              CSL JSON...
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleExportFilteredBibtex(filterType, fileName)}
            >
              <FileCode className='h-4 w-4 mr-2' />
              BibTeX...
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleExportFilteredArchive(filterType, fileName)}
            >
              <Archive className='h-4 w-4 mr-2' />
              Wren Archive...
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleCopyFilteredCslJson(filterType)}>
              <Copy className='h-4 w-4 mr-2' />
              Copy as CSL JSON
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopyFilteredBibtex(filterType)}>
              <Copy className='h-4 w-4 mr-2' />
              Copy as BibTeX
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}
