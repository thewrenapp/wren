import { ReactNode, useState } from 'react';
import {
  ExternalLink,
  FolderOpen,
  Plus,
  FileText,
  File,
  Copy,
  Link,
  Trash2,
  FolderPlus,
  FolderMinus,
  Tags,
  Download,
  FileJson,
  FileCode,
  FolderOutput,
  Paperclip,
  RefreshCw,
  StickyNote,
  Sparkles,
  CircleCheck,
  Cpu,
  Share2,
  Archive,
} from 'lucide-react';
import { IconTagOff } from '@tabler/icons-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { type EntrySummary } from '@/stores/libraryStore';
import {
  exportToBiblatexWithFiles,
  type ExportOptions,
} from '@/services/tauri';
import { ExportOptionsDialog } from '@/components/dialogs/ExportOptionsDialog';
import { open } from '@tauri-apps/plugin-dialog';
import { toast } from '@/stores/toastStore';
import { useUIStore } from '@/stores/uiStore';
import { useEntryActions } from './useEntryActions';

interface EntryContextMenuProps {
  entry: EntrySummary;
  children: ReactNode;
}

interface EntryContextMenuContentProps {
  entry: EntrySummary;
  onClose?: () => void;
  onShowExportDialog?: (entryIds: number[]) => void;
}

// Standalone content component for controlled dropdown menus (used in EntryTable)
export function EntryContextMenuContent({ entry, onClose, onShowExportDialog }: EntryContextMenuContentProps) {
  const {
    targetIds,
    isMultiSelect,
    collections,
    tags,
    activeCollectionId,
    activeTagIds,
    activeFilter,
    handleOpen,
    handleShowInFinder,
    handleCopyTitle,
    handleAddToCollection,
    handleRemoveFromCollection,
    handleAddTag,
    handleRemoveActiveTag,
    handleAddPdfAttachment,
    handleAddFileAttachment,
    handleAddMarkdownAttachment,
    handleCreateNote,
    handleDelete,
    handleParseWithAI,
    handleExtractMetadataWithAI,
    handleReextractAttachments,
    handleExportCslJson,
    handleExportBibtex,
    handleCopyCslJson,
    handleCopyBibtex,
    handleExportAsArchive,
    handleCopyWrenLink,
  } = useEntryActions({ entry, onClose });

  return (
    <>
      <DropdownMenuItem onClick={handleOpen}>
        <ExternalLink className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Open ${targetIds.length} Items` : 'Open'}
        <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
      </DropdownMenuItem>

      <DropdownMenuItem onClick={handleShowInFinder}>
        <FolderOpen className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Show ${targetIds.length} in Finder` : 'Show in Finder'}
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      {!isMultiSelect && (
        <>
          <DropdownMenuItem onClick={handleCreateNote}>
            <StickyNote className='h-4 w-4 mr-2' />
            Add Note
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Plus className='h-4 w-4 mr-2' />
              Add Attachment
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='w-48'>
              <DropdownMenuItem onClick={handleAddPdfAttachment}>
                <File className='h-4 w-4 mr-2' />
                PDF...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAddMarkdownAttachment}>
                <FileText className='h-4 w-4 mr-2' />
                Markdown...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAddFileAttachment}>
                <Paperclip className='h-4 w-4 mr-2' />
                File...
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
        </>
      )}

      {collections.length > 0 && (
        <>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderPlus className='h-4 w-4 mr-2' />
              {isMultiSelect ? `Add ${targetIds.length} to Collection` : 'Add to Collection'}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='w-48'>
              {collections.map((collection) => (
                <DropdownMenuItem
                  key={collection.id}
                  onClick={() => handleAddToCollection(collection.id)}
                >
                  <FolderOpen
                    className='h-4 w-4 mr-2'
                    fill={collection.color || 'transparent'}
                    stroke={collection.color || 'currentColor'}
                  />
                  {collection.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {activeCollectionId && (
            <DropdownMenuItem onClick={() => handleRemoveFromCollection(activeCollectionId)}>
              <FolderMinus className='h-4 w-4 mr-2' />
              {isMultiSelect
                ? `Remove ${targetIds.length} from Collection`
                : 'Remove from Collection'}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
        </>
      )}

      {tags.length > 0 ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Tags className='h-4 w-4 mr-2' />
            {isMultiSelect ? `Add Tag to ${targetIds.length} Items` : 'Add Tag'}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='w-48'>
            {tags.map((tag) => (
              <DropdownMenuItem key={tag.id} onClick={() => handleAddTag(tag.name)}>
                {/* Only show color dot if tag has a color or is not imported */}
                {(tag.color || !tag.isImported) && (
                  <span
                    className='w-2 h-2 rounded-full mr-2'
                    style={{ backgroundColor: tag.color || '#6b7280' }}
                  />
                )}
                {tag.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <DropdownMenuItem disabled>
          <Tags className='h-4 w-4 mr-2' />
          Add Tag (no tags exist)
        </DropdownMenuItem>
      )}
      {activeFilter.type === 'tag' && activeTagIds.length > 0 && (
        <DropdownMenuItem onClick={handleRemoveActiveTag}>
          <IconTagOff className='h-4 w-4 mr-2' />
          {isMultiSelect
            ? `Remove Tag from ${targetIds.length} Items`
            : activeTagIds.length > 1
              ? `Remove ${activeTagIds.length} Tags`
              : 'Remove Tag'}
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Download className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Export ${targetIds.length} Items` : 'Export As'}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className='w-48'>
          <DropdownMenuItem onClick={handleExportCslJson}>
            <FileJson className='h-4 w-4 mr-2' />
            CSL JSON...
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportBibtex}>
            <FileCode className='h-4 w-4 mr-2' />
            BibTeX...
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onShowExportDialog?.(targetIds)}>
            <FolderOutput className='h-4 w-4 mr-2' />
            BibLaTeX with Files...
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportAsArchive}>
            <Archive className='h-4 w-4 mr-2' />
            Wren Archive...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyCslJson}>
            <Copy className='h-4 w-4 mr-2' />
            Copy as CSL JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyBibtex}>
            <Copy className='h-4 w-4 mr-2' />
            Copy as BibTeX
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={handleCopyTitle}>
        <Copy className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Copy ${targetIds.length} Titles` : 'Copy Title'}
      </DropdownMenuItem>

      {!isMultiSelect && (
        <DropdownMenuItem onClick={handleCopyWrenLink}>
          <Link className='h-4 w-4 mr-2' />
          Copy Wren Link
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={handleParseWithAI}>
        <Sparkles className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Parse Attachments (${targetIds.length} Entries)` : 'Parse Attachments with AI'}
        {!isMultiSelect && entry.hasStructuredContent && (
          <CircleCheck className='h-4 w-4 ml-1 text-green-600' />
        )}
      </DropdownMenuItem>

      <DropdownMenuItem onClick={handleExtractMetadataWithAI}>
        <Cpu className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Extract Metadata (${targetIds.length} Entries)` : 'Extract Metadata with AI'}
      </DropdownMenuItem>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <RefreshCw className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Re-extract ${targetIds.length} Entries` : 'Re-extract Attachments'}
          {!isMultiSelect && entry.hasExtractedText && (
            <CircleCheck className='h-4 w-4 ml-1 text-green-600' />
          )}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className='w-56'>
          <DropdownMenuItem onClick={() => handleReextractAttachments(false)}>
            <RefreshCw className='h-4 w-4 mr-2' />
            Re-extract Text
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleReextractAttachments(true)}>
            <RefreshCw className='h-4 w-4 mr-2' />
            Re-extract with OCR
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={() => {
        const { showShareDialog } = useUIStore.getState();
        const titles = entry ? [entry.title] : [];
        showShareDialog('entries', targetIds, titles);
        onClose?.();
      }}>
        <Share2 className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Share ${targetIds.length} Entries` : 'Share Entry'}
      </DropdownMenuItem>

      <DropdownMenuItem onClick={handleDelete} className='text-destructive focus:text-destructive'>
        <Trash2 className='h-4 w-4 mr-2' />
        {isMultiSelect ? `Delete ${targetIds.length} Entries` : 'Delete Entry'}
        <DropdownMenuShortcut>Del</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

// Original wrapper component for backwards compatibility
export function EntryContextMenu({ entry, children }: EntryContextMenuProps) {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const {
    targetIds,
    isMultiSelect,
    collections,
    tags,
    activeCollectionId,
    activeTagIds,
    activeFilter,
    handleOpen,
    handleShowInFinder,
    handleCopyTitle,
    handleAddToCollection,
    handleRemoveFromCollection,
    handleAddTag,
    handleRemoveActiveTag,
    handleAddPdfAttachment,
    handleAddFileAttachment,
    handleAddMarkdownAttachment,
    handleCreateNote,
    handleDelete,
    handleParseWithAI,
    handleExtractMetadataWithAI,
    handleReextractAttachments,
    handleExportCslJson,
    handleExportBibtex,
    handleCopyCslJson,
    handleCopyBibtex,
    handleExportAsArchive,
    handleCopyWrenLink,
  } = useEntryActions({ entry });

  const handleExportBiblatexWithFiles = async (options: ExportOptions) => {
    try {
      setIsExporting(true);
      const outputDir = await open({
        directory: true,
        title: 'Select Export Folder',
      });
      if (outputDir) {
        const result = await exportToBiblatexWithFiles(targetIds, outputDir, options);
        toast.success(
          `Exported ${result.entriesExported} entries, ${result.filesExported} files, ${result.notesExported} notes`,
        );
        setShowExportDialog(false);
      }
    } catch (err) {
      console.error('Failed to export to BibLaTeX:', err);
      toast.error('Failed to export to BibLaTeX');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-56'>
        <ContextMenuItem onClick={handleOpen}>
          <ExternalLink className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Open ${targetIds.length} Items` : 'Open'}
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleShowInFinder}>
          <FolderOpen className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Show ${targetIds.length} in Finder` : 'Show in Finder'}
        </ContextMenuItem>

        <ContextMenuSeparator />

        {!isMultiSelect && (
          <>
            <ContextMenuItem onClick={handleCreateNote}>
              <StickyNote className='h-4 w-4 mr-2' />
              Add Note
            </ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Plus className='h-4 w-4 mr-2' />
                Add Attachment
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className='w-48'>
                <ContextMenuItem onClick={handleAddPdfAttachment}>
                  <File className='h-4 w-4 mr-2' />
                  PDF...
                </ContextMenuItem>
                <ContextMenuItem onClick={handleAddMarkdownAttachment}>
                  <FileText className='h-4 w-4 mr-2' />
                  Markdown...
                </ContextMenuItem>
                <ContextMenuItem onClick={handleAddFileAttachment}>
                  <Paperclip className='h-4 w-4 mr-2' />
                  File...
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />
          </>
        )}

        {collections.length > 0 && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderPlus className='h-4 w-4 mr-2' />
                {isMultiSelect ? `Add ${targetIds.length} to Collection` : 'Add to Collection'}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className='w-48'>
                {collections.map((collection) => (
                  <ContextMenuItem
                    key={collection.id}
                    onClick={() => handleAddToCollection(collection.id)}
                  >
                    <FolderOpen
                      className='h-4 w-4 mr-2'
                      fill={collection.color || 'transparent'}
                      stroke={collection.color || 'currentColor'}
                    />
                    {collection.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            {activeCollectionId && (
              <ContextMenuItem onClick={() => handleRemoveFromCollection(activeCollectionId)}>
                <FolderMinus className='h-4 w-4 mr-2' />
                {isMultiSelect
                  ? `Remove ${targetIds.length} from Collection`
                  : 'Remove from Collection'}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}

        {tags.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Tags className='h-4 w-4 mr-2' />
              {isMultiSelect ? `Add Tag to ${targetIds.length} Items` : 'Add Tag'}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className='w-48'>
              {tags.map((tag) => (
                <ContextMenuItem key={tag.id} onClick={() => handleAddTag(tag.name)}>
                  {/* Only show color dot if tag has a color or is not imported */}
                  {(tag.color || !tag.isImported) && (
                    <span
                      className='w-2 h-2 rounded-full mr-2'
                      style={{ backgroundColor: tag.color || '#6b7280' }}
                    />
                  )}
                  {tag.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem disabled>
            <Tags className='h-4 w-4 mr-2' />
            Add Tag (no tags exist)
          </ContextMenuItem>
        )}
        {activeFilter.type === 'tag' && activeTagIds.length > 0 && (
          <ContextMenuItem onClick={handleRemoveActiveTag}>
            <IconTagOff className='h-4 w-4 mr-2' />
            {isMultiSelect
              ? `Remove Tag from ${targetIds.length} Items`
              : activeTagIds.length > 1
                ? `Remove ${activeTagIds.length} Tags`
                : 'Remove Tag'}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Download className='h-4 w-4 mr-2' />
            {isMultiSelect ? `Export ${targetIds.length} Items` : 'Export As'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className='w-48'>
            <ContextMenuItem onClick={handleExportCslJson}>
              <FileJson className='h-4 w-4 mr-2' />
              CSL JSON...
            </ContextMenuItem>
            <ContextMenuItem onClick={handleExportBibtex}>
              <FileCode className='h-4 w-4 mr-2' />
              BibTeX...
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setShowExportDialog(true)}>
              <FolderOutput className='h-4 w-4 mr-2' />
              BibLaTeX with Files...
            </ContextMenuItem>
            <ContextMenuItem onClick={handleExportAsArchive}>
              <Archive className='h-4 w-4 mr-2' />
              Wren Archive...
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleCopyCslJson}>
              <Copy className='h-4 w-4 mr-2' />
              Copy as CSL JSON
            </ContextMenuItem>
            <ContextMenuItem onClick={handleCopyBibtex}>
              <Copy className='h-4 w-4 mr-2' />
              Copy as BibTeX
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleCopyTitle}>
          <Copy className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Copy ${targetIds.length} Titles` : 'Copy Title'}
        </ContextMenuItem>

        {!isMultiSelect && (
          <ContextMenuItem onClick={handleCopyWrenLink}>
            <Link className='h-4 w-4 mr-2' />
            Copy Wren Link
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleParseWithAI}>
          <Sparkles className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Parse Attachments (${targetIds.length} Entries)` : 'Parse Attachments with AI'}
          {!isMultiSelect && entry.hasStructuredContent && (
            <CircleCheck className='h-4 w-4 ml-1 text-green-600' />
          )}
        </ContextMenuItem>

        <ContextMenuItem onClick={handleExtractMetadataWithAI}>
          <Cpu className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Extract Metadata (${targetIds.length} Entries)` : 'Extract Metadata with AI'}
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <RefreshCw className='h-4 w-4 mr-2' />
            {isMultiSelect ? `Re-extract ${targetIds.length} Entries` : 'Re-extract Attachments'}
            {!isMultiSelect && entry.hasExtractedText && (
              <CircleCheck className='h-4 w-4 ml-1 text-green-600' />
            )}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className='w-56'>
            <ContextMenuItem onClick={() => handleReextractAttachments(false)}>
              <RefreshCw className='h-4 w-4 mr-2' />
              Re-extract Text
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleReextractAttachments(true)}>
              <RefreshCw className='h-4 w-4 mr-2' />
              Re-extract with OCR
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={() => {
            const { showShareDialog } = useUIStore.getState();
            const titles = targetIds.length === 1 && entry ? [entry.title] : [];
            showShareDialog('entries', targetIds, titles);
          }}
        >
          <Share2 className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Share ${targetIds.length} Entries` : 'Share Entry'}
        </ContextMenuItem>

        <ContextMenuItem
          onClick={handleDelete}
          className='text-destructive focus:text-destructive'
        >
          <Trash2 className='h-4 w-4 mr-2' />
          {isMultiSelect ? `Delete ${targetIds.length} Entries` : 'Delete Entry'}
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <ExportOptionsDialog
      open={showExportDialog}
      onClose={() => setShowExportDialog(false)}
      onExport={handleExportBiblatexWithFiles}
      entryCount={targetIds.length}
      isExporting={isExporting}
    />
    </>
  );
}
