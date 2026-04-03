import { Command } from "cmdk";
import { Plus, Settings2, Pencil, Trash2 } from "lucide-react";
import type { Tag as TagType } from "@/services/tauri";
import type { SubMenu, CommandsProps } from "./types";
import { CommandItem } from "./shared";

interface TagsCommandsProps {
  tags: TagType[];
  selectedEntryIds: number[];
  setSubMenu: (menu: SubMenu) => void;
  handleSelect: (cb: () => void) => void;
  uiActions: CommandsProps["uiActions"];
}

export function TagsCommands({ tags, selectedEntryIds, setSubMenu, handleSelect, uiActions }: TagsCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Tags</div>
      <Command.Item value="manage tags edit merge delete colors" onSelect={() => handleSelect(() => uiActions.setTagManagementDialogOpen(true))} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10"><Settings2 className="h-4 w-4 text-blue-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Manage Tags</span>
          <span className="text-xs text-muted-foreground">Create, merge, delete, and edit tag colors</span>
        </div>
      </Command.Item>
      <Command.Item value="create tag new add" onSelect={() => setSubMenu("tag")} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-500/10"><Plus className="h-4 w-4 text-blue-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Create Tag</span>
          <span className="text-xs text-muted-foreground">Create a new tag{selectedEntryIds.length > 0 ? " and add to selection" : ""}</span>
        </div>
      </Command.Item>
      {tags.length > 0 && (
        <>
          <CommandItem value="rename tag edit name" onSelect={() => setSubMenu("renameTag")} icon={<Pencil className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Rename Tag..." />
          <CommandItem value="delete tag remove" onSelect={() => setSubMenu("deleteTag")} icon={<Trash2 className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Delete Tag..." />
        </>
      )}
    </Command.Group>
  );
}
