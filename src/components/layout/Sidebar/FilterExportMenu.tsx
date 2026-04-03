import {
  Download,
  FileJson,
  FileCode,
  Copy,
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
} from '@/services/tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

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
