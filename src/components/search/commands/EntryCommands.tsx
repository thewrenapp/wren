import { Command } from "cmdk";
import {
  Search, FileText, FolderOpen, Plus, Tag, Sparkles,
  Trash2, FolderPlus, FolderMinus, RefreshCw, Copy, CopyPlus,
  ExternalLink, RotateCcw, Pencil, ZoomIn, ZoomOut, Maximize,
  RotateCw, Printer, PanelLeft, Bold, Italic, Strikethrough,
  Code, Link, Heading1, Heading2, Heading3, List, ListChecks,
  Quote, Minus, ArrowLeft, ArrowRight, StickyNote, Table2,
  BookOpen, FileUp, Highlighter, MessageCircle, Paperclip,
} from "lucide-react";
import { toast } from "@/stores/toastStore";
import { IconTagOff } from "@tabler/icons-react";
import type { Collection, Tag as TagType } from "@/services/tauri";
import type { CommandHandlers, SubMenu } from "./types";
import { CommandItem, ShortcutBadge } from "./shared";

interface SelectedEntryCommandsProps {
  handlers: CommandHandlers;
  selectedEntryIds: number[];
  activeCollectionId: number | null;
  activeTagIds: number[];
  collections: Collection[];
  tags: TagType[];
  setSubMenu: (menu: SubMenu) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export function SelectedEntryCommands({
  handlers, selectedEntryIds, activeCollectionId, activeTagIds,
  collections, tags, setSubMenu, setCommandPaletteOpen,
}: SelectedEntryCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
        Selected ({selectedEntryIds.length})
      </div>
      <CommandItem value="show in finder reveal files" onSelect={handlers.handleShowInFinder} icon={<ExternalLink className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Show in Finder" shortcut={["⌘", "⇧", "R"]} />
      <CommandItem value="copy title clipboard" onSelect={handlers.handleCopyTitle} icon={<Copy className="h-4 w-4 text-cyan-500" />} iconBg="bg-cyan-500/10" label={`Copy Title${selectedEntryIds.length > 1 ? "s" : ""}`} shortcut={["⌘", "⇧", "T"]} />
      {selectedEntryIds.length === 1 && (
        <CommandItem value="copy wren link url deep link" onSelect={handlers.handleCopyWrenLink} icon={<Link className="h-4 w-4 text-cyan-500" />} iconBg="bg-cyan-500/10" label="Copy Wren Link" />
      )}
      <CommandItem value="add to collection folder" onSelect={() => setSubMenu("collection")} icon={<FolderPlus className="h-4 w-4 text-violet-500" />} iconBg="bg-violet-500/10" label="Add to Collection" />
      {(activeCollectionId || collections.length > 0) && (
        <CommandItem
          value="remove from collection folder"
          onSelect={() => activeCollectionId ? handlers.handleRemoveFromCollection(activeCollectionId) : setSubMenu("removeFromCollection")}
          icon={<FolderMinus className="h-4 w-4 text-orange-500" />}
          iconBg="bg-orange-500/10"
          label="Remove from Collection"
        />
      )}
      <CommandItem value="add tag label" onSelect={() => setSubMenu("tag")} icon={<Tag className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Add Tag" />
      {(activeTagIds.length > 0 || tags.length > 0) && (
        <CommandItem
          value="remove tag label"
          onSelect={() => activeTagIds.length === 1 ? handlers.handleRemoveTag(activeTagIds[0]) : setSubMenu("removeTag")}
          icon={<IconTagOff className="h-4 w-4 text-orange-500" />}
          iconBg="bg-orange-500/10"
          label="Remove Tag"
        />
      )}
      {selectedEntryIds.length === 1 && (
        <>
          <CommandItem value="add pdf attachment file" onSelect={handlers.handleAddPdfAttachment} icon={<FileUp className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Add PDF Attachment" shortcut={["⌘", "⇧", "A"]} />
          <CommandItem value="import pdf annotations highlights" onSelect={handlers.handleImportPdfAnnotations} icon={<FileText className="h-4 w-4 text-yellow-500" />} iconBg="bg-yellow-500/10" label="Import PDF Annotations" />
          <Command.Item
            value="create note add notes"
            onSelect={handlers.handleCreateNote}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
              <StickyNote className="h-4 w-4 text-green-500" />
            </div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Add Note</span>
              <span className="block text-xs text-muted-foreground">Create a new note for this entry</span>
            </div>
          </Command.Item>
          <Command.Item
            value="attach markdown file md text"
            onSelect={handlers.handleAddMarkdownAttachment}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
              <FileText className="h-4 w-4 text-blue-500" />
            </div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Attach Markdown File...</span>
              <span className="block text-xs text-muted-foreground">Attach an existing markdown file</span>
            </div>
          </Command.Item>
          <Command.Item
            value="insert new table database"
            onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:insert-new-table")); }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10">
              <Table2 className="h-4 w-4 text-purple-500" />
            </div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Insert New Table</span>
              <span className="block text-xs text-muted-foreground">Create an inline database table</span>
            </div>
          </Command.Item>
          <Command.Item
            value="insert existing table browse search database"
            onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:browse-tables")); }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10">
              <Table2 className="h-4 w-4 text-purple-500" />
            </div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Insert Existing Table...</span>
              <span className="block text-xs text-muted-foreground">Browse and embed or link to a table</span>
            </div>
          </Command.Item>
          <CommandItem value="delete attachment remove file" onSelect={handlers.handleOpenDeleteAttachment} icon={<Trash2 className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Delete Attachment..." />
          <CommandItem value="reindex re-extract attachment text" onSelect={() => handlers.handleOpenReindexAttachment(false)} icon={<RefreshCw className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Re-extract Attachment..." />
          <Command.Item
            value="reindex re-extract attachment force ocr scanned"
            onSelect={() => handlers.handleOpenReindexAttachment(true)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
              <RefreshCw className="h-4 w-4 text-blue-500" />
            </div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Re-extract with OCR...</span>
              <span className="block text-xs text-muted-foreground">Force OCR for scanned documents</span>
            </div>
          </Command.Item>
          <CommandItem value="duplicate entry copy" onSelect={handlers.handleDuplicate} icon={<CopyPlus className="h-4 w-4 text-amber-500" />} iconBg="bg-amber-500/10" label="Duplicate Entry" shortcut={["⌘", "D"]} />
        </>
      )}
      <Command.Item
        value="parse with ai llm structure document sections"
        onSelect={handlers.handleParseWithAI}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-500/10">
          <Sparkles className="h-4 w-4 text-purple-500" />
        </div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Parse Attachments with AI</span>
          <span className="block text-xs text-muted-foreground">Extract structured sections from all attachments using LLM</span>
        </div>
      </Command.Item>
      <CommandItem value="delete move trash" onSelect={handlers.handleDeleteSelected} icon={<Trash2 className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Move to Trash" shortcut={["⌫"]} />
    </Command.Group>
  );
}

export function PdfCommands({ setCommandPaletteOpen, handleSelect, togglePdfLeftPanel }: {
  setCommandPaletteOpen: (open: boolean) => void;
  handleSelect: (cb: () => void) => void;
  togglePdfLeftPanel: () => void;
}) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">PDF</div>
      <CommandItem value="search in pdf find text" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:pdf-search")); }} icon={<Search className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Search in PDF" shortcut={["⌘", "F"]} />
      <CommandItem value="zoom in pdf enlarge" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:pdf-zoom-in")); }} icon={<ZoomIn className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Zoom In" shortcut={["⌘", "+"]} />
      <CommandItem value="zoom out pdf shrink" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:pdf-zoom-out")); }} icon={<ZoomOut className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Zoom Out" shortcut={["⌘", "-"]} />
      <CommandItem value="fit width pdf scale" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:pdf-fit-width")); }} icon={<Maximize className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Fit to Width" />
      <CommandItem value="fit page pdf scale" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:pdf-fit-page")); }} icon={<Maximize className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Fit to Page" />
      <CommandItem value="toggle edit annotation mode pdf highlight" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:pdf-toggle-edit")); }} icon={<Pencil className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Toggle Edit Mode" />
      <CommandItem value="toggle pdf sidebar outline thumbnails left panel" onSelect={() => handleSelect(() => togglePdfLeftPanel())} icon={<PanelLeft className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Toggle PDF Sidebar" />
      <CommandItem value="print pdf document" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:pdf-print")); }} icon={<Printer className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Print" shortcut={["⌘", "P"]} />
    </Command.Group>
  );
}

export function EpubCommands({ setCommandPaletteOpen, handleSelect, toggleEpubLeftPanel }: {
  setCommandPaletteOpen: (open: boolean) => void;
  handleSelect: (cb: () => void) => void;
  toggleEpubLeftPanel: () => void;
}) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">EPUB</div>
      <CommandItem value="search in epub find text" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:epub-search")); }} icon={<Search className="h-4 w-4 text-emerald-500" />} iconBg="bg-emerald-500/10" label="Search in EPUB" shortcut={["⌘", "F"]} />
      <CommandItem value="next page chapter epub forward" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:epub-next")); }} icon={<ArrowRight className="h-4 w-4 text-emerald-500" />} iconBg="bg-emerald-500/10" label="Next Page" />
      <CommandItem value="previous page chapter epub back" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:epub-prev")); }} icon={<ArrowLeft className="h-4 w-4 text-emerald-500" />} iconBg="bg-emerald-500/10" label="Previous Page" />
      <CommandItem value="increase font size zoom in epub" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:epub-zoom-in")); }} icon={<ZoomIn className="h-4 w-4 text-emerald-500" />} iconBg="bg-emerald-500/10" label="Increase Font Size" />
      <CommandItem value="decrease font size zoom out epub" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:epub-zoom-out")); }} icon={<ZoomOut className="h-4 w-4 text-emerald-500" />} iconBg="bg-emerald-500/10" label="Decrease Font Size" />
      <CommandItem value="toggle epub sidebar outline toc" onSelect={() => handleSelect(() => toggleEpubLeftPanel())} icon={<PanelLeft className="h-4 w-4 text-emerald-500" />} iconBg="bg-emerald-500/10" label="Toggle EPUB Sidebar" />
    </Command.Group>
  );
}

export function HtmlCommands({ setCommandPaletteOpen, handleSelect, toggleHtmlLeftPanel }: {
  setCommandPaletteOpen: (open: boolean) => void;
  handleSelect: (cb: () => void) => void;
  toggleHtmlLeftPanel: () => void;
}) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Web Snapshot</div>
      <CommandItem value="search in html page find text" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:html-search")); }} icon={<Search className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Search in Page" shortcut={["⌘", "F"]} />
      <CommandItem value="zoom in html enlarge" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:html-zoom-in")); }} icon={<ZoomIn className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Zoom In" />
      <CommandItem value="zoom out html shrink" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:html-zoom-out")); }} icon={<ZoomOut className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Zoom Out" />
      <CommandItem value="toggle edit annotation mode html highlight" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:html-toggle-edit")); }} icon={<Pencil className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Toggle Edit Mode" />
      <CommandItem value="toggle html sidebar outline left panel" onSelect={() => handleSelect(() => toggleHtmlLeftPanel())} icon={<PanelLeft className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Toggle Sidebar" />
      <CommandItem value="print html page document" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:html-print")); }} icon={<Printer className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Print" shortcut={["⌘", "P"]} />
    </Command.Group>
  );
}

export function ImageCommands({ setCommandPaletteOpen }: { setCommandPaletteOpen: (open: boolean) => void }) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Image</div>
      <CommandItem value="zoom in image enlarge" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:image-zoom-in")); }} icon={<ZoomIn className="h-4 w-4 text-purple-500" />} iconBg="bg-purple-500/10" label="Zoom In" shortcut={["⌘", "+"]} />
      <CommandItem value="zoom out image shrink" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:image-zoom-out")); }} icon={<ZoomOut className="h-4 w-4 text-purple-500" />} iconBg="bg-purple-500/10" label="Zoom Out" shortcut={["⌘", "-"]} />
      <CommandItem value="rotate image clockwise" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:image-rotate")); }} icon={<RotateCw className="h-4 w-4 text-purple-500" />} iconBg="bg-purple-500/10" label="Rotate" />
      <CommandItem value="reset view image original" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:image-reset")); }} icon={<RotateCcw className="h-4 w-4 text-purple-500" />} iconBg="bg-purple-500/10" label="Reset View" />
      <CommandItem value="print image document" onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event("wren:image-print")); }} icon={<Printer className="h-4 w-4 text-purple-500" />} iconBg="bg-purple-500/10" label="Print" shortcut={["⌘", "P"]} />
    </Command.Group>
  );
}

export function EditorCommands({ setCommandPaletteOpen }: { setCommandPaletteOpen: (open: boolean) => void }) {
  const editorItems: { value: string; event: string; icon: React.ReactNode; label: string; description?: string; shortcut?: string[] }[] = [
    { value: "bold formatting text editor", event: "wren:editor-bold", icon: <Bold className="h-4 w-4 text-green-500" />, label: "Bold", shortcut: ["⌘", "B"] },
    { value: "italic formatting text editor", event: "wren:editor-italic", icon: <Italic className="h-4 w-4 text-green-500" />, label: "Italic", shortcut: ["⌘", "I"] },
    { value: "strikethrough formatting text editor", event: "wren:editor-strikethrough", icon: <Strikethrough className="h-4 w-4 text-green-500" />, label: "Strikethrough", shortcut: ["⌘", "⇧", "S"] },
    { value: "code inline formatting editor", event: "wren:editor-code", icon: <Code className="h-4 w-4 text-green-500" />, label: "Inline Code", shortcut: ["⌘", "E"] },
    { value: "link url editor insert", event: "wren:editor-link", icon: <Link className="h-4 w-4 text-green-500" />, label: "Insert Link", shortcut: ["⌘", "K"] },
    { value: "heading 1 h1 editor", event: "wren:editor-h1", icon: <Heading1 className="h-4 w-4 text-green-500" />, label: "Heading 1" },
    { value: "heading 2 h2 editor", event: "wren:editor-h2", icon: <Heading2 className="h-4 w-4 text-green-500" />, label: "Heading 2" },
    { value: "heading 3 h3 editor", event: "wren:editor-h3", icon: <Heading3 className="h-4 w-4 text-green-500" />, label: "Heading 3" },
    { value: "bullet list unordered editor", event: "wren:editor-bullet-list", icon: <List className="h-4 w-4 text-green-500" />, label: "Bullet List" },
    { value: "task list checkbox todo editor", event: "wren:editor-task-list", icon: <ListChecks className="h-4 w-4 text-green-500" />, label: "Task List" },
    { value: "blockquote quote editor", event: "wren:editor-blockquote", icon: <Quote className="h-4 w-4 text-green-500" />, label: "Blockquote" },
    { value: "code block fenced editor programming", event: "wren:editor-code-block", icon: <Code className="h-4 w-4 text-green-500" />, label: "Code Block", description: "Insert fenced code block" },
    { value: "math equation latex katex editor", event: "wren:editor-math", icon: <span className="text-sm font-mono text-green-500">∑</span>, label: "Math Block", description: "Insert LaTeX math equation" },
    { value: "callout admonition note tip warning editor", event: "wren:editor-callout", icon: <BookOpen className="h-4 w-4 text-green-500" />, label: "Insert Callout", description: "Note, Tip, Warning, etc." },
    { value: "horizontal rule divider separator editor", event: "wren:editor-hr", icon: <Minus className="h-4 w-4 text-green-500" />, label: "Horizontal Rule" },
    { value: "highlight mark yellow editor", event: "wren:editor-highlight", icon: <Highlighter className="h-4 w-4 text-green-500" />, label: "Highlight", description: "Highlight selected text" },
    { value: "comment annotate note editor", event: "wren:editor-add-comment", icon: <MessageCircle className="h-4 w-4 text-green-500" />, label: "Add Comment", description: "Comment on selected text" },
    { value: "insert new table database editor", event: "wren:insert-new-table", icon: <Table2 className="h-4 w-4 text-green-500" />, label: "Insert New Table", description: "Create an inline database table" },
    { value: "insert existing table browse search database editor", event: "wren:browse-tables", icon: <Table2 className="h-4 w-4 text-green-500" />, label: "Insert Existing Table...", description: "Browse and embed or link to a table" },
    { value: "insert link entry reference cite paper editor", event: "wren:editor-link-entry", icon: <FileText className="h-4 w-4 text-green-500" />, label: "Insert Entry Link", description: "Link to a library entry" },
    { value: "insert link attachment file pdf note editor", event: "wren:editor-link-attachment", icon: <Paperclip className="h-4 w-4 text-green-500" />, label: "Insert Attachment Link", description: "Link to an attachment" },
    { value: "insert link tag reference label editor", event: "wren:editor-link-tag", icon: <Tag className="h-4 w-4 text-green-500" />, label: "Insert Tag Link", description: "Link to a tag" },
    { value: "insert link collection folder group editor", event: "wren:editor-link-collection", icon: <FolderOpen className="h-4 w-4 text-green-500" />, label: "Insert Collection Link", description: "Link to a collection" },
  ];

  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Editor</div>
      {editorItems.map(item => (
        <Command.Item
          key={item.value}
          value={item.value}
          onSelect={() => { setCommandPaletteOpen(false); window.dispatchEvent(new Event(item.event)); }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
            {item.icon}
          </div>
          <div className="flex-1">
            <span className="block text-sm font-medium">{item.label}</span>
            {item.description && <span className="block text-xs text-muted-foreground">{item.description}</span>}
          </div>
          {item.shortcut && <ShortcutBadge keys={item.shortcut} />}
        </Command.Item>
      ))}
    </Command.Group>
  );
}

export function MarkdownCommands({ setCommandPaletteOpen, contextAttachmentId, reindexAttachment }: {
  setCommandPaletteOpen: (open: boolean) => void;
  contextAttachmentId: number | null;
  reindexAttachment: (id: number, opts?: { forceOcr: boolean }) => Promise<void>;
}) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Extracted Text</div>
      <Command.Item
        value="re-extract reindex text current document"
        onSelect={async () => {
          if (!contextAttachmentId) return;
          setCommandPaletteOpen(false);
          const loadingId = toast.loading("Re-extracting text...");
          try {
            await reindexAttachment(contextAttachmentId);
            toast.dismiss(loadingId);
            toast.success("Text re-extracted successfully");
          } catch (err) {
            toast.dismiss(loadingId);
            toast.error(`Re-extraction failed: ${err}`);
          }
        }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
          <RefreshCw className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1"><span className="block text-sm font-medium">Re-extract Text</span></div>
      </Command.Item>
      <Command.Item
        value="re-extract reindex force ocr scanned document"
        onSelect={async () => {
          if (!contextAttachmentId) return;
          setCommandPaletteOpen(false);
          const loadingId = toast.loading("Re-extracting with OCR...");
          try {
            await reindexAttachment(contextAttachmentId, { forceOcr: true });
            toast.dismiss(loadingId);
            toast.success("OCR re-extraction complete");
          } catch (err) {
            toast.dismiss(loadingId);
            toast.error(`OCR re-extraction failed: ${err}`);
          }
        }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
          <RefreshCw className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Re-extract with OCR</span>
          <span className="block text-xs text-muted-foreground">Force OCR for scanned documents</span>
        </div>
      </Command.Item>
    </Command.Group>
  );
}

export function WelcomeCommands({ handleImportPdf, handleImportFolder }: { handleImportPdf: () => void; handleImportFolder: () => void }) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Quick Start</div>
      <CommandItem value="import pdf add document quick start" onSelect={handleImportPdf} icon={<Plus className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Import PDF" />
      <CommandItem value="import folder pdfs multiple quick start" onSelect={handleImportFolder} icon={<FolderOpen className="h-4 w-4 text-amber-500" />} iconBg="bg-amber-500/10" label="Import Folder" />
    </Command.Group>
  );
}
