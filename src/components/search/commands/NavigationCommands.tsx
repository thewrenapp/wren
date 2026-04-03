import { Command } from "cmdk";
import {
  File, FileText, FolderOpen, Settings, Moon, Sun, Monitor,
  Library, BookOpen, StickyNote, X, Layers, Pin, Copy,
  ChevronRight, Columns2, ArrowRightFromLine, Trash2,
} from "lucide-react";
import { sidebarIcons } from "@/lib/icons";
import type { Tab } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useUIStore } from "@/stores/uiStore";
import type { CommandHandlers, CommandsProps } from "./types";
import { CommandItem, ShortcutBadge } from "./shared";

interface TabCommandsProps {
  tabs: Tab[];
  activeTabId: string | null;
  activeRightTabId: string | null;
  activeTab: Tab | undefined;
  tabTypeLabels: Record<string, string>;
  splitEnabled: boolean;
  focusedPane: "left" | "right";
  tabActions: CommandsProps["tabActions"];
  handleSelect: (cb: () => void) => void;
  showEntryInFinder: (id: number) => Promise<void>;
  getEntry: (id: number) => Promise<unknown>;
}

export function TabCommands({
  tabs, activeTabId, activeRightTabId, activeTab, tabTypeLabels,
  splitEnabled, focusedPane, tabActions, handleSelect,
  showEntryInFinder, getEntry,
}: TabCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Tabs</div>
      {tabs
        .filter(t => t.id !== activeTabId)
        .map((tab) => {
          const tabLabel = tab.type === "library" ? "Library"
            : tab.type === "welcome" ? "Welcome"
            : tab.type === "markdown" ? "Extracted Text"
            : tab.type === "entry" ? (tabTypeLabels[tab.id] || "Entry")
            : tab.type;
          const isPdf = tabTypeLabels[tab.id] === "PDF";
          const isNote = tab.type === "entry" && tabTypeLabels[tab.id] === "Notes";
          return (
            <Command.Item
              key={`switch-${tab.id}`}
              value={`switch to tab ${tab.title} ${tabLabel} ${tab.id}`}
              onSelect={() => handleSelect(() => tabActions.setActiveTab(tab.id))}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
                {tab.type === "library" ? <Library className="h-4 w-4 text-muted-foreground" /> :
                 tab.type === "welcome" ? <BookOpen className="h-4 w-4 text-muted-foreground" /> :
                 tab.type === "markdown" ? <FileText className="h-4 w-4 text-muted-foreground" /> :
                 isPdf ? <File className="h-4 w-4 text-red-500" /> :
                 isNote ? <StickyNote className="h-4 w-4 text-muted-foreground" /> :
                 <File className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{tab.title}</span>
                <span className="text-xs text-muted-foreground">{tabLabel}</span>
              </div>
            </Command.Item>
          );
        })}
      {tabs.length > 0 && (
        <Command.Item
          value="close current tab"
          onSelect={() => handleSelect(() => { if (activeTabId) tabActions.closeTab(activeTabId); })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Close Current Tab</span></div>
          <ShortcutBadge keys={["⌘", "W"]} />
        </Command.Item>
      )}
      {tabs.length > 1 && (
        <>
          <Command.Item
            value="close other tabs"
            onSelect={() => handleSelect(() => { if (activeTabId) tabActions.closeOtherTabs(activeTabId); })}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
              <Layers className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1"><span className="block text-sm font-medium">Close Other Tabs</span></div>
          </Command.Item>
          <Command.Item
            value="close all tabs"
            onSelect={() => handleSelect(() => tabActions.closeAllTabs())}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
              <X className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1"><span className="block text-sm font-medium">Close All Tabs</span></div>
          </Command.Item>
        </>
      )}
      {activeTab && tabs.indexOf(activeTab) < tabs.length - 1 && (
        <Command.Item
          value="close tabs to the right"
          onSelect={() => handleSelect(() => { if (activeTabId) tabActions.closeTabsToRight(activeTabId); })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Close Tabs to the Right</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.type !== "library" && !activeTab.pinned && (
        <Command.Item
          value="pin current tab"
          onSelect={() => handleSelect(() => { if (activeTabId) tabActions.pinTab(activeTabId); })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <Pin className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Pin Current Tab</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.pinned && (
        <Command.Item
          value="unpin current tab"
          onSelect={() => handleSelect(() => { if (activeTabId) tabActions.unpinTab(activeTabId); })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <Pin className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Unpin Current Tab</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.type !== "library" && activeTab.type !== "welcome" && (
        <Command.Item
          value="duplicate current tab"
          onSelect={() => handleSelect(() => { if (activeTabId) tabActions.duplicateTab(activeTabId); })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <Copy className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Duplicate Current Tab</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.entryId && (
        <Command.Item
          value="show in library reveal entry"
          onSelect={() => handleSelect(async () => {
            if (!activeTab.entryId) return;
            const entryId = Number(activeTab.entryId);
            tabActions.openTab({ type: "library", title: "Library" });
            let isTrashed = false;
            try { await getEntry(entryId); } catch { isTrashed = true; }
            const { selectEntry, setFilter, setSearchQuery } = useLibraryStore.getState();
            const { setActiveFilter } = useUIStore.getState();
            if (isTrashed) {
              setActiveFilter("trash");
            } else {
              setActiveFilter("all");
              setFilter({ type: "all" });
              setSearchQuery("");
            }
            selectEntry(entryId);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent("wren:scroll-to-entry", { detail: { entryId } }));
            }, 200);
          })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <Library className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Show in Library</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.entryId && (
        <Command.Item
          value="find in finder reveal file current tab"
          onSelect={() => handleSelect(async () => {
            if (!activeTab.entryId) return;
            try { await showEntryInFinder(Number(activeTab.entryId)); } catch (err) { console.error("Failed to show in Finder:", err); }
          })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Find in Finder</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.type === "entry" && activeTab.entryId && (
        <Command.Item
          value="open extracted content text"
          onSelect={() => handleSelect(() => {
            tabActions.openTab({ type: "markdown", title: activeTab.title, entryId: activeTab.entryId!, attachmentId: activeTab.attachmentId });
          })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Open Extracted Content</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.type === "markdown" && activeTab.entryId && (
        <Command.Item
          value="open main file viewer"
          onSelect={() => handleSelect(() => {
            tabActions.openTab({ type: "entry", title: activeTab.title, entryId: activeTab.entryId! });
          })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Open Main File</span></div>
        </Command.Item>
      )}
      {activeTab && activeTab.type !== "library" && (
        <Command.Item
          value="split right move to right pane"
          onSelect={() => handleSelect(() => {
            const tabId = focusedPane === "right" ? activeRightTabId : activeTabId;
            if (tabId) tabActions.moveTabToPane(tabId, focusedPane === "right" ? "left" : "right");
          })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <ArrowRightFromLine className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">{splitEnabled ? "Move to Other Pane" : "Split Right"}</span></div>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">⌘\</span>
        </Command.Item>
      )}
      {splitEnabled && (
        <Command.Item
          value="close split pane merge"
          onSelect={() => handleSelect(() => tabActions.disableSplit())}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <Columns2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Close Split Pane</span></div>
        </Command.Item>
      )}
      {splitEnabled && (
        <Command.Item
          value="focus other pane left right"
          onSelect={() => handleSelect(() => tabActions.setFocusedPane(focusedPane === "left" ? "right" : "left"))}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <Columns2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Focus {focusedPane === "left" ? "Right" : "Left"} Pane</span></div>
        </Command.Item>
      )}
    </Command.Group>
  );
}

interface NavigateCommandsProps {
  handleNavigateTo: CommandHandlers["handleNavigateTo"];
  trashCount: number;
}

export function NavigateCommands({ handleNavigateTo, trashCount }: NavigateCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Navigate</div>
      <CommandItem value="go to all items library" onSelect={() => handleNavigateTo("all")} icon={<Library className="h-4 w-4 text-muted-foreground" />} iconBg="bg-muted" label="Go to All Items" />
      <CommandItem value="go to pdfs documents files" onSelect={() => handleNavigateTo("pdfs")} icon={<sidebarIcons.pdfs className="h-4 w-4 text-red-500" />} iconBg="bg-red-500/10" label="Go to PDFs" />
      <CommandItem value="go to notes documents" onSelect={() => handleNavigateTo("notes")} icon={<sidebarIcons.notes className="h-4 w-4 text-amber-500" />} iconBg="bg-amber-500/10" label="Go to Notes" />
      <CommandItem value="go to recently added recent" onSelect={() => handleNavigateTo("recent")} icon={<sidebarIcons.recent className="h-4 w-4 text-blue-500" />} iconBg="bg-blue-500/10" label="Go to Recently Added" />
      <CommandItem value="go to untagged no tags" onSelect={() => handleNavigateTo("untagged")} icon={<sidebarIcons.untagged className="h-4 w-4 text-muted-foreground" />} iconBg="bg-muted" label="Go to Untagged" />
      <CommandItem value="go to duplicates merge" onSelect={() => handleNavigateTo("duplicates")} icon={<sidebarIcons.duplicates className="h-4 w-4 text-amber-500" />} iconBg="bg-amber-500/10" label="Go to Duplicates" />
      <Command.Item value="go to trash deleted" onSelect={() => handleNavigateTo("trash")} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10"><Trash2 className="h-4 w-4 text-red-500" /></div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Go to Trash</span>
          {trashCount > 0 && <span className="text-xs text-muted-foreground">{trashCount} items</span>}
        </div>
      </Command.Item>
    </Command.Group>
  );
}

interface SettingsCommandsProps {
  theme: string;
  handleSelect: (cb: () => void) => void;
  uiActions: CommandsProps["uiActions"];
}

export function SettingsCommands({ theme, handleSelect, uiActions }: SettingsCommandsProps) {
  return (
    <Command.Group>
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Settings</div>
      <Command.Item
        value="toggle theme dark light mode appearance"
        onSelect={() =>
          handleSelect(() => {
            const themes = ["system", "light", "dark"] as const;
            const current = themes.indexOf(theme as typeof themes[number]);
            const next = themes[(current + 1) % themes.length];
            uiActions.setTheme(next);
          })
        }
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
          {theme === "system" ? <Monitor className="h-4 w-4 text-muted-foreground" /> :
           theme === "light" ? <Sun className="h-4 w-4 text-amber-500" /> :
           <Moon className="h-4 w-4 text-primary" />}
        </div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Toggle Theme</span>
          <span className="text-xs text-muted-foreground">Current: {theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
        </div>
      </Command.Item>
      <Command.Item
        value="settings preferences configure options"
        onSelect={() => handleSelect(() => uiActions.setSettingsOpen(true))}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
          <Settings className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <span className="block text-sm font-medium">Settings</span>
          <span className="text-xs text-muted-foreground">Configure app preferences</span>
        </div>
        <ShortcutBadge keys={["⌘", ","]} />
      </Command.Item>
    </Command.Group>
  );
}
