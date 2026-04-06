import { Command } from "cmdk";
import {
  FolderPlus, FolderMinus, Plus, Tag, Download, Library,
} from "lucide-react";
import { IconTagOff } from "@tabler/icons-react";
import type { CommandsProps } from "./types";
import { SubMenuShell, EmptyMessage, CollectionIcon, TagIcon } from "./shared";

export function CollectionPicker({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, collections, handlers } = props;
  return (
    <SubMenuShell
      icon={<FolderPlus className="h-5 w-5 text-primary shrink-0" />}
      title="Add to Collection"
      onBack={() => setSubMenu(null)}
      onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
    >
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {collections.length === 0 ? (
          <EmptyMessage>No collections yet. Create one first.</EmptyMessage>
        ) : (
          collections.map((collection) => (
            <Command.Item
              key={collection.id}
              onSelect={() => handlers.handleAddToCollection(collection.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <CollectionIcon color={collection.color} />
              <span className="text-sm font-medium">{collection.name}</span>
            </Command.Item>
          ))
        )}
      </Command.List>
    </SubMenuShell>
  );
}

export function TagPicker({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, tags, newTagName, setNewTagName, handlers } = props;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
      />
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <Tag className="h-5 w-5 text-primary shrink-0" />
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Search or create tag..."
              className="flex-1 text-base bg-transparent outline-none placeholder:text-muted-foreground/60"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && newTagName.trim()) handlers.handleCreateAndAddTag(); }}
            />
            <button onClick={() => setSubMenu(null)} className="text-xs text-muted-foreground hover:text-foreground">
              ← Back
            </button>
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {newTagName.trim() && !tags.find(t => t.name.toLowerCase() === newTagName.toLowerCase()) && (
              <Command.Item
                onSelect={handlers.handleCreateAndAddTag}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
                  <Plus className="h-4 w-4 text-green-500" />
                </div>
                <span className="text-sm font-medium">Create &quot;{newTagName}&quot;</span>
              </Command.Item>
            )}
            {tags
              .filter(tag => !newTagName || tag.name.toLowerCase().includes(newTagName.toLowerCase()))
              .map((tag) => (
                <Command.Item
                  key={tag.id}
                  onSelect={() => handlers.handleAddTag(tag.name)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
                >
                  <TagIcon tag={tag} />
                  <span className="text-sm font-medium">{tag.name}</span>
                </Command.Item>
              ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

export function RemoveFromCollectionPicker({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, collections, handlers, activeCollectionId } = props;
  const relevantCollections = activeCollectionId
    ? collections.filter(c => c.id === activeCollectionId)
    : collections;
  return (
    <SubMenuShell
      icon={<FolderMinus className="h-5 w-5 text-primary shrink-0" />}
      title="Remove from Collection"
      onBack={() => setSubMenu(null)}
      onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
    >
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {relevantCollections.length === 0 ? (
          <EmptyMessage>No collections available.</EmptyMessage>
        ) : (
          relevantCollections.map((collection) => (
            <Command.Item
              key={collection.id}
              onSelect={() => handlers.handleRemoveFromCollection(collection.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <CollectionIcon color={collection.color} />
              <span className="text-sm font-medium">{collection.name}</span>
            </Command.Item>
          ))
        )}
      </Command.List>
    </SubMenuShell>
  );
}

export function RemoveTagPicker({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, tags, handlers, activeTagIds } = props;
  const relevantTags = activeTagIds.length > 0 ? tags.filter(t => activeTagIds.includes(t.id)) : tags;
  return (
    <SubMenuShell
      icon={<IconTagOff className="h-5 w-5 text-primary shrink-0" />}
      title="Remove Tag"
      onBack={() => setSubMenu(null)}
      onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
    >
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {relevantTags.length === 0 ? (
          <EmptyMessage>No tags to remove.</EmptyMessage>
        ) : (
          relevantTags.map((tag) => (
            <Command.Item
              key={tag.id}
              onSelect={() => handlers.handleRemoveTag(tag.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <div
                className="flex items-center justify-center h-8 w-8 rounded-lg"
                style={{ backgroundColor: tag.color ? `${tag.color}20` : 'transparent' }}
              >
                <Tag className="h-4 w-4" style={{ color: tag.color || 'var(--muted-foreground)' }} />
              </div>
              <span className="text-sm font-medium">{tag.name}</span>
            </Command.Item>
          ))
        )}
      </Command.List>
    </SubMenuShell>
  );
}

export function ExportCollectionPicker({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, collections, handlers } = props;
  return (
    <SubMenuShell
      icon={<Download className="h-5 w-5 text-primary shrink-0" />}
      title="Export Collection"
      onBack={() => setSubMenu(null)}
      onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
    >
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {collections.length === 0 ? (
          <EmptyMessage>No collections available.</EmptyMessage>
        ) : (
          collections.map((collection) => (
            <div key={collection.id} className="mb-2">
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                <Library className="h-3 w-3" style={{ color: collection.color || '#8B5CF6' }} />
                {collection.name} ({collection.itemCount})
              </div>
              <Command.Item onSelect={() => handlers.handleExportCollection(collection.id, collection.name, "bibtex")} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export as BibTeX</span>
              </Command.Item>
              <Command.Item onSelect={() => handlers.handleExportCollection(collection.id, collection.name, "csl")} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export as CSL JSON</span>
              </Command.Item>
              <Command.Item onSelect={() => handlers.handleExportCollectionWithFiles(collection.id, collection.name)} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export with Files...</span>
              </Command.Item>
              <Command.Item onSelect={() => handlers.handleExportCollectionAsArchive(collection.id, collection.name)} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export as Wren Archive</span>
              </Command.Item>
            </div>
          ))
        )}
      </Command.List>
    </SubMenuShell>
  );
}

export function ExportTagPicker({ props }: { props: CommandsProps }) {
  const { setSubMenu, setCommandPaletteOpen, tags, handlers } = props;
  return (
    <SubMenuShell
      icon={<Download className="h-5 w-5 text-primary shrink-0" />}
      title="Export Tag"
      onBack={() => setSubMenu(null)}
      onBackdropClick={() => { setSubMenu(null); setCommandPaletteOpen(false); }}
    >
      <Command.List className="max-h-[300px] overflow-y-auto p-2">
        {tags.length === 0 ? (
          <EmptyMessage>No tags available.</EmptyMessage>
        ) : (
          tags.map((tag) => (
            <div key={tag.id} className="mb-2">
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                <Tag className="h-3 w-3" style={{ color: tag.color || 'var(--muted-foreground)' }} />
                {tag.name} ({tag.itemCount})
              </div>
              <Command.Item onSelect={() => handlers.handleExportTag(tag.id, tag.name, "bibtex")} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export as BibTeX</span>
              </Command.Item>
              <Command.Item onSelect={() => handlers.handleExportTag(tag.id, tag.name, "csl")} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export as CSL JSON</span>
              </Command.Item>
              <Command.Item onSelect={() => handlers.handleExportTagWithFiles(tag.id, tag.name)} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export with Files...</span>
              </Command.Item>
              <Command.Item onSelect={() => handlers.handleExportTagAsArchive(tag.id, tag.name)} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30 ml-4">
                <span className="text-sm">Export as Wren Archive</span>
              </Command.Item>
            </div>
          ))
        )}
      </Command.List>
    </SubMenuShell>
  );
}
