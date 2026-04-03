import { Command } from "cmdk";
import {
  File, FileText, RefreshCw, Tag, Trash2, Pencil, FilePlus2, StickyNote,
} from "lucide-react";
import type { CommandsProps } from "./types";
import { SubMenuShell, EmptyMessage, CollectionIcon, RenameForm } from "./shared";
import {
  CollectionPicker, TagPicker, RemoveFromCollectionPicker,
  RemoveTagPicker, ExportCollectionPicker, ExportTagPicker,
} from "./SubMenuPickers";

export function SubMenuRenderer({ props }: { props: CommandsProps }) {
  const { subMenu } = props;

  if (subMenu === "collection") return <CollectionPicker props={props} />;
  if (subMenu === "tag") return <TagPicker props={props} />;
  if (subMenu === "removeFromCollection") return <RemoveFromCollectionPicker props={props} />;
  if (subMenu === "removeTag") return <RemoveTagPicker props={props} />;
  if (subMenu === "exportCollection") return <ExportCollectionPicker props={props} />;
  if (subMenu === "exportTag") return <ExportTagPicker props={props} />;
  if (subMenu === "renameCollection") return <RenameCollectionDialog props={props} />;
  if (subMenu === "deleteCollection") return <DeleteCollectionDialog props={props} />;
  if (subMenu === "renameTag") return <RenameTagDialog props={props} />;
  if (subMenu === "deleteTag") return <DeleteTagDialog props={props} />;
  if (subMenu === "deleteAttachment") return <DeleteAttachmentDialog props={props} />;
  if (subMenu === "reindexAttachment") return <ReindexAttachmentDialog props={props} />;
  if (subMenu === "createEntryType") return <CreateEntryTypeDialog props={props} />;
  return null;
}

function RenameCollectionDialog({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, collections, renameInput, setRenameInput, selectedItemId, setSelectedItemId, handlers } = props;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); setRenameInput(""); setSelectedItemId(null); }} />
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <Pencil className="h-5 w-5 text-primary shrink-0" />
            <span className="text-base">Rename Collection</span>
            <button onClick={() => { setSubMenu(null); setRenameInput(""); setSelectedItemId(null); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">← Back</button>
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {selectedItemId ? (
              <RenameForm placeholder="New collection name..." value={renameInput} onChange={setRenameInput} onCancel={() => { setSelectedItemId(null); setRenameInput(""); }} onConfirm={() => handlers.handleRenameCollection(selectedItemId)} />
            ) : (
              collections.map((c) => (
                <Command.Item key={c.id} onSelect={() => { setSelectedItemId(c.id); setRenameInput(c.name); }} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
                  <CollectionIcon color={c.color} />
                  <span className="text-sm font-medium">{c.name}</span>
                </Command.Item>
              ))
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function DeleteCollectionDialog({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, collections, handlers } = props;
  return (
    <SubMenuShell icon={<Trash2 className="h-5 w-5 text-destructive shrink-0" />} title="Delete Collection" onBack={() => setSubMenu(null)} onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}>
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {collections.length === 0 ? <EmptyMessage>No collections available.</EmptyMessage> : collections.map((c) => (
          <Command.Item key={c.id} onSelect={() => handlers.handleDeleteCollection(c.id, c.name)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-destructive/10 hover:bg-destructive/5">
            <CollectionIcon color={c.color} />
            <span className="text-sm font-medium">{c.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">{c.itemCount} items</span>
          </Command.Item>
        ))}
      </Command.List>
    </SubMenuShell>
  );
}

function RenameTagDialog({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, tags, renameInput, setRenameInput, selectedItemId, setSelectedItemId, handlers } = props;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); setRenameInput(""); setSelectedItemId(null); }} />
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <Pencil className="h-5 w-5 text-primary shrink-0" />
            <span className="text-base">Rename Tag</span>
            <button onClick={() => { setSubMenu(null); setRenameInput(""); setSelectedItemId(null); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">← Back</button>
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {selectedItemId ? (
              <RenameForm placeholder="New tag name..." value={renameInput} onChange={setRenameInput} onCancel={() => { setSelectedItemId(null); setRenameInput(""); }} onConfirm={() => handlers.handleRenameTag(selectedItemId)} />
            ) : (
              tags.map((tag) => (
                <Command.Item key={tag.id} onSelect={() => { setSelectedItemId(tag.id); setRenameInput(tag.name); }} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg" style={{ backgroundColor: tag.color ? `${tag.color}20` : 'transparent' }}>
                    <Tag className="h-4 w-4" style={{ color: tag.color || 'var(--muted-foreground)' }} />
                  </div>
                  <span className="text-sm font-medium">{tag.name}</span>
                </Command.Item>
              ))
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function DeleteTagDialog({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, tags, handlers } = props;
  return (
    <SubMenuShell icon={<Trash2 className="h-5 w-5 text-destructive shrink-0" />} title="Delete Tag" onBack={() => setSubMenu(null)} onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}>
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {tags.length === 0 ? <EmptyMessage>No tags available.</EmptyMessage> : tags.map((tag) => (
          <Command.Item key={tag.id} onSelect={() => handlers.handleDeleteTag(tag.id, tag.name)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-destructive/10 hover:bg-destructive/5">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg" style={{ backgroundColor: tag.color ? `${tag.color}20` : 'transparent' }}>
              <Tag className="h-4 w-4" style={{ color: tag.color || 'var(--muted-foreground)' }} />
            </div>
            <span className="text-sm font-medium">{tag.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">{tag.itemCount} items</span>
          </Command.Item>
        ))}
      </Command.List>
    </SubMenuShell>
  );
}

function DeleteAttachmentDialog({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, entryAttachments, setEntryAttachments, handlers } = props;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); setEntryAttachments([]); }} />
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <Trash2 className="h-5 w-5 text-destructive shrink-0" />
            <span className="text-base">Delete Attachment</span>
            <button onClick={() => { setSubMenu(null); setEntryAttachments([]); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">← Back</button>
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {entryAttachments.length === 0 ? <EmptyMessage>No attachments available.</EmptyMessage> : entryAttachments.map((a) => (
              <Command.Item key={a.id} onSelect={() => handlers.handleDeleteAttachment(a.id)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-destructive/10 hover:bg-destructive/5">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                  {a.attachmentType === "pdf" ? <File className="h-4 w-4 text-red-500" /> : a.attachmentType === "note" ? <StickyNote className="h-4 w-4 text-yellow-500" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{a.title || a.filePath || "Untitled"}</span>
                  <span className="text-xs text-muted-foreground">{a.attachmentTypeDisplay}</span>
                </div>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function ReindexAttachmentDialog({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, entryAttachments, setEntryAttachments, handlers } = props;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); setEntryAttachments([]); }} />
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <RefreshCw className="h-5 w-5 text-blue-500 shrink-0" />
            <span className="text-base">Re-extract Attachment</span>
            <button onClick={() => { setSubMenu(null); setEntryAttachments([]); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">← Back</button>
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {entryAttachments.length === 0 ? <EmptyMessage>No attachments available.</EmptyMessage> : entryAttachments.map((a) => (
              <div key={a.id} className="mb-1">
                <Command.Item value={`reindex ${a.title || a.filePath || ''}`} onSelect={() => handlers.handleReindexAttachmentCmd(a.id, false)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10">
                    {a.attachmentType === "pdf" ? <File className="h-4 w-4 text-blue-500" /> : a.attachmentType === "note" ? <StickyNote className="h-4 w-4 text-yellow-500" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{a.title || a.filePath || "Untitled"}</span>
                    <span className="text-xs text-muted-foreground">{a.attachmentTypeDisplay} — Re-extract</span>
                  </div>
                </Command.Item>
                <Command.Item value={`reindex ocr ${a.title || a.filePath || ''}`} onSelect={() => handlers.handleReindexAttachmentCmd(a.id, true)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-11">
                  <div className="flex-1 min-w-0"><span className="text-xs text-muted-foreground">Force OCR (for scanned documents)</span></div>
                </Command.Item>
              </div>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function CreateEntryTypeDialog({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, itemTypes, handlers } = props;
  return (
    <SubMenuShell icon={<FilePlus2 className="h-5 w-5 text-green-500 shrink-0" />} title="Select Reference Type" onBack={() => setSubMenu(null)} onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}>
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {itemTypes.length === 0 ? <EmptyMessage>No entry types available.</EmptyMessage> : itemTypes.map((type) => (
          <Command.Item key={type.id} onSelect={() => handlers.handleCreateEntryWithType(type.name)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10"><FileText className="h-4 w-4 text-green-500" /></div>
            <span className="text-sm font-medium">{type.displayName}</span>
          </Command.Item>
        ))}
      </Command.List>
    </SubMenuShell>
  );
}
