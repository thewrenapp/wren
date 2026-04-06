import { Command } from "cmdk";
import {
  Plus, Settings2, Pencil, Trash2, Library,
  FolderOpen, Upload, Download, FilePlus2, Archive,
} from "lucide-react";
import type { Collection } from "@/services/tauri";
import type { CommandHandlers, SubMenu, CommandsProps } from "./types";
import { CommandItem } from "./shared";

interface CollectionsCommandsProps {
  collections: Collection[];
  setSubMenu: (menu: SubMenu) => void;
  handleSelect: (cb: () => void) => void;
  uiActions: CommandsProps["uiActions"];
}

export function CollectionsCommands({ collections, setSubMenu, handleSelect, uiActions }: CollectionsCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Collections</div>
      <Command.Item value="manage collections edit merge delete colors" onSelect={() => handleSelect(() => uiActions.setCollectionManagementDialogOpen(true))} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10"><Settings2 className="h-4 w-4 text-violet-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Manage Collections</span>
          <span className="text-xs text-muted-foreground">Merge, delete, and edit collection colors</span>
        </div>
      </Command.Item>
      <Command.Item value="create collection new add organize" onSelect={() => handleSelect(() => uiActions.setNewCollectionDialogOpen(true))} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10"><Plus className="h-4 w-4 text-violet-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Create Collection</span>
          <span className="text-xs text-muted-foreground">Create a new collection to organize entries</span>
        </div>
      </Command.Item>
      {collections.length > 0 && (
        <>
          <CommandItem value="rename collection edit name" onSelect={() => setSubMenu("renameCollection")} icon={<Pencil className="h-4 w-4 text-violet-500" />} iconBg="bg-violet-500/10" label="Rename Collection..." />
          <CommandItem value="delete collection remove" onSelect={() => setSubMenu("deleteCollection")} icon={<Trash2 className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Delete Collection..." />
        </>
      )}
    </Command.Group>
  );
}

interface ExportCommandsProps {
  handlers: CommandHandlers;
  selectedEntryIds: number[];
  collections: Collection[];
  tags: { id: number; name: string; itemCount: number }[];
  setSubMenu: (menu: SubMenu) => void;
}

export function ExportCommands({ handlers, selectedEntryIds, collections, tags, setSubMenu }: ExportCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Export</div>
      {selectedEntryIds.length > 0 && (
        <>
          <Command.Item value="export selected bibtex" onSelect={handlers.handleExportSelectedBibtex} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10"><Download className="h-4 w-4 text-emerald-500" /></div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Export Selected as BibTeX</span>
              <span className="text-xs text-muted-foreground">{selectedEntryIds.length} entries</span>
            </div>
          </Command.Item>
          <Command.Item value="export selected csl json" onSelect={handlers.handleExportSelectedCsl} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10"><Download className="h-4 w-4 text-emerald-500" /></div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Export Selected as CSL JSON</span>
              <span className="text-xs text-muted-foreground">{selectedEntryIds.length} entries</span>
            </div>
          </Command.Item>
          <CommandItem value="copy bibtex clipboard" onSelect={handlers.handleCopyBibtex} icon={<Download className="h-4 w-4 text-cyan-500" />} iconBg="bg-cyan-500/10" label="Copy as BibTeX" shortcut={["⌘", "⇧", "C"]} />
          <CommandItem value="copy csl json clipboard" onSelect={handlers.handleCopyCsl} icon={<Download className="h-4 w-4 text-cyan-500" />} iconBg="bg-cyan-500/10" label="Copy as CSL JSON" />
          <Command.Item value="export selected biblatex files attachments" onSelect={() => handlers.openExportDialog("selected")} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10"><FolderOpen className="h-4 w-4 text-purple-500" /></div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Export Selected as BibLaTeX with Files</span>
              <span className="text-xs text-muted-foreground">{selectedEntryIds.length} entries with attachments</span>
            </div>
          </Command.Item>
          <Command.Item value="export selected wren archive native" onSelect={handlers.handleExportSelectedAsArchive} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10"><Archive className="h-4 w-4 text-amber-500" /></div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Export Selected as Wren Archive</span>
              <span className="text-xs text-muted-foreground">{selectedEntryIds.length} entries as .wrenitem</span>
            </div>
          </Command.Item>
        </>
      )}
      <Command.Item value="export all bibtex library" onSelect={handlers.handleExportAllBibtex} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10"><Download className="h-4 w-4 text-emerald-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Export All as BibTeX</span>
          <span className="text-xs text-muted-foreground">Entire library</span>
        </div>
      </Command.Item>
      <Command.Item value="export all csl json library" onSelect={handlers.handleExportAllCsl} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10"><Download className="h-4 w-4 text-emerald-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Export All as CSL JSON</span>
          <span className="text-xs text-muted-foreground">Entire library</span>
        </div>
      </Command.Item>
      <Command.Item value="export all biblatex files attachments library" onSelect={() => handlers.openExportDialog("all")} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10"><FolderOpen className="h-4 w-4 text-purple-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Export All as BibLaTeX with Files</span>
          <span className="text-xs text-muted-foreground">Entire library with attachments</span>
        </div>
      </Command.Item>
      <Command.Item value="export library backup wren archive" onSelect={handlers.handleExportLibraryAsArchive} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10"><Archive className="h-4 w-4 text-amber-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Export Library Backup (.wren)</span>
          <span className="text-xs text-muted-foreground">Full library with all files and settings</span>
        </div>
      </Command.Item>
      {collections.length > 0 && (
        <Command.Item value="export collection folder" onSelect={() => setSubMenu("exportCollection")} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10"><Library className="h-4 w-4 text-violet-500" /></div>
          <div className="flex-1">
            <span className="block text-sm font-medium">Export Collection...</span>
            <span className="text-xs text-muted-foreground">Export a specific collection</span>
          </div>
        </Command.Item>
      )}
      {tags.length > 0 && (
        <Command.Item value="export tag label" onSelect={() => setSubMenu("exportTag")} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10"><Download className="h-4 w-4 text-blue-500" /></div>
          <div className="flex-1">
            <span className="block text-sm font-medium">Export Tag...</span>
            <span className="text-xs text-muted-foreground">Export entries with a specific tag</span>
          </div>
        </Command.Item>
      )}
    </Command.Group>
  );
}

interface CreateCommandsProps {
  handlers: CommandHandlers;
  setSubMenu: (menu: SubMenu) => void;
  uiActions: CommandsProps["uiActions"];
}

export function CreateCommands({ handlers, setSubMenu, uiActions }: CreateCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Create</div>
      <Command.Item value="create new reference manual entry type" onSelect={() => setSubMenu("createEntryType")} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10"><FilePlus2 className="h-4 w-4 text-green-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Create Manual Reference...</span>
          <span className="text-xs text-muted-foreground">Select entry type and add manually</span>
        </div>
      </Command.Item>
      <Command.Item value="import pdf add document" onSelect={handlers.handleImportPdf} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10"><Plus className="h-4 w-4 text-red-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Import PDF</span>
          <span className="text-xs text-muted-foreground">Add a PDF document to your library</span>
        </div>
      </Command.Item>
      <Command.Item value="import folder pdfs multiple" onSelect={handlers.handleImportFolder} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10"><FolderOpen className="h-4 w-4 text-amber-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Import Folder</span>
          <span className="text-xs text-muted-foreground">Import multiple PDFs from a folder</span>
        </div>
      </Command.Item>
      <Command.Item value="import bibtex bib references" onSelect={handlers.handleImportBibtex} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-teal-500/10"><Upload className="h-4 w-4 text-teal-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Import BibTeX</span>
          <span className="text-xs text-muted-foreground">Import references from a .bib file</span>
        </div>
      </Command.Item>
      <Command.Item value="import csl json references" onSelect={handlers.handleImportCslJson} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-teal-500/10"><Upload className="h-4 w-4 text-teal-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Import CSL JSON</span>
          <span className="text-xs text-muted-foreground">Import references from a CSL JSON file</span>
        </div>
      </Command.Item>
      <Command.Item value="import biblatex files zotero pdfs attachments" onSelect={handlers.handleImportBiblatexWithFiles} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10"><FolderOpen className="h-4 w-4 text-purple-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Import BibLaTeX with Files</span>
          <span className="text-xs text-muted-foreground">Import from Zotero export folder with PDFs</span>
        </div>
      </Command.Item>
      <Command.Item value="import wren archive native wrenitem restore" onSelect={handlers.handleImportArchive} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10"><Archive className="h-4 w-4 text-amber-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Import Wren Archive</span>
          <span className="text-xs text-muted-foreground">Import from .wrenitem or .wren backup</span>
        </div>
      </Command.Item>
      <Command.Item value="new collection create organize" onSelect={() => handlers.handleSelect(() => uiActions.setNewCollectionDialogOpen(true))} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-violet-500/10"><Library className="h-4 w-4 text-violet-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">New Collection</span>
          <span className="text-xs text-muted-foreground">Organize entries into a collection</span>
        </div>
      </Command.Item>
    </Command.Group>
  );
}
