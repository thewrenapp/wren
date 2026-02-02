import { ReactNode } from 'react';
import { toast } from '@/stores/toastStore';
import { RotateCcw, Trash2 } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { useLibraryStore, type EntrySummary } from '@/stores/libraryStore';
import {
  restoreEntry,
  permanentDeleteEntry,
  getTrashedEntries,
  getTrashCount,
} from '@/services/tauri';

interface TrashContextMenuProps {
  entry: EntrySummary;
  children: ReactNode;
}

interface TrashContextMenuContentProps {
  entry: EntrySummary;
  onClose?: () => void;
}

// Standalone content component for simple positioned menu (used in EntryTable for trash)
export function TrashContextMenuContent({ entry, onClose }: TrashContextMenuContentProps) {
  const { selectedEntryIds, setTrashedEntries, setTrashCount, refreshLibrary } = useLibraryStore();

  // Use all selected entries when multiple are selected
  const entriesToAct =
    selectedEntryIds.length > 1 && selectedEntryIds.includes(entry.id)
      ? selectedEntryIds
      : [entry.id];
  const isMultiSelect = entriesToAct.length > 1;

  const handleRestore = async () => {
    try {
      for (const id of entriesToAct) {
        await restoreEntry(id);
      }
      // Refresh trash view
      const trashed = await getTrashedEntries();
      setTrashedEntries(trashed);
      const count = await getTrashCount();
      setTrashCount(count);
      await refreshLibrary();
      toast.success(isMultiSelect ? `Restored ${entriesToAct.length} items` : 'Entry restored');
    } catch (err) {
      console.error('Failed to restore entry:', err);
      toast.error('Failed to restore entry');
    }
    onClose?.();
  };

  const handlePermanentDelete = async () => {
    try {
      for (const id of entriesToAct) {
        await permanentDeleteEntry(id);
      }
      // Refresh trash view
      const trashed = await getTrashedEntries();
      setTrashedEntries(trashed);
      const count = await getTrashCount();
      setTrashCount(count);
      toast.success(
        isMultiSelect
          ? `Permanently deleted ${entriesToAct.length} items`
          : 'Entry permanently deleted',
      );
    } catch (err) {
      console.error('Failed to permanently delete entry:', err);
      toast.error('Failed to delete entry');
    }
    onClose?.();
  };

  return (
    <>
      <DropdownMenuItem onClick={handleRestore}>
        <RotateCcw className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Restore ${entriesToAct.length} Items` : 'Restore'}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={handlePermanentDelete}
        className='text-destructive focus:text-destructive'
      >
        <Trash2 className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Permanently Delete ${entriesToAct.length}` : 'Permanently Delete'}
        <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

// Original wrapper component for ContextMenu trigger
export function TrashContextMenu({ entry, children }: TrashContextMenuProps) {
  const { selectedEntryIds, setTrashedEntries, setTrashCount, refreshLibrary } = useLibraryStore();

  // Use all selected entries when multiple are selected
  const entriesToAct =
    selectedEntryIds.length > 1 && selectedEntryIds.includes(entry.id)
      ? selectedEntryIds
      : [entry.id];
  const isMultiSelect = entriesToAct.length > 1;

  const handleRestore = async () => {
    try {
      for (const id of entriesToAct) {
        await restoreEntry(id);
      }
      // Refresh trash view
      const trashed = await getTrashedEntries();
      setTrashedEntries(trashed);
      const count = await getTrashCount();
      setTrashCount(count);
      await refreshLibrary();
      toast.success(isMultiSelect ? `Restored ${entriesToAct.length} items` : 'Entry restored');
    } catch (err) {
      console.error('Failed to restore entry:', err);
      toast.error('Failed to restore entry');
    }
  };

  const handlePermanentDelete = async () => {
    try {
      for (const id of entriesToAct) {
        await permanentDeleteEntry(id);
      }
      // Refresh trash view
      const trashed = await getTrashedEntries();
      setTrashedEntries(trashed);
      const count = await getTrashCount();
      setTrashCount(count);
      toast.success(
        isMultiSelect
          ? `Permanently deleted ${entriesToAct.length} items`
          : 'Entry permanently deleted',
      );
    } catch (err) {
      console.error('Failed to permanently delete entry:', err);
      toast.error('Failed to delete entry');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-56'>
        <ContextMenuItem onClick={handleRestore}>
          <RotateCcw className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Restore ${entriesToAct.length} Items` : 'Restore'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={handlePermanentDelete}
          className='text-destructive focus:text-destructive'
        >
          <Trash2 className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Permanently Delete ${entriesToAct.length}` : 'Permanently Delete'}
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
