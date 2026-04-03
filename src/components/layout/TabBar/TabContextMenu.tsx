import { useCallback } from "react";
import { X, Pin, FolderOpen, FileText, Copy, Link, Library, ChevronRight, ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useUIStore } from "@/stores/uiStore";
import { showEntryInFinder, showAttachmentInFinder, showMarkdownInFinder, getEntry, getEntryAttachments } from "@/services/tauri/commands";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { buildEntryLink, buildPdfLink } from "@/lib/wrenLinks";
import { toast } from "@/stores/toastStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function TabContextMenu({ tab, tabIndex, totalTabs, pane = "left", children }: {
  tab: Tab;
  tabIndex: number;
  totalTabs: number;
  pane?: "left" | "right";
  children: React.ReactNode;
}) {
  const {
    openTab, closeTab, closeOtherTabs, closeAllTabs, closeTabsToRight,
    pinTab, unpinTab, duplicateTab, moveTabToPane, splitEnabled,
  } = useTabStore();

  const hasEntryId = !!tab.entryId;
  const isLibrary = tab.type === "library";
  const isWelcome = tab.type === "welcome";
  const isEntry = tab.type === "entry";
  const isMarkdown = tab.type === "markdown";
  const isNote = tab.data?.attachmentType === "note";
  const hasTabsToRight = tabIndex < totalTabs - 1;

  const handleShowInLibrary = useCallback(async () => {
    if (!tab.entryId) return;
    const entryId = Number(tab.entryId);
    openTab({ type: "library", title: "Library" });
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
  }, [tab.entryId, openTab]);

  const handleFindInFinder = useCallback(async () => {
    if (!tab.entryId) return;
    try {
      if ((isMarkdown || tab.type === "parsed") && tab.attachmentId) {
        await showMarkdownInFinder(Number(tab.attachmentId), tab.type === "parsed");
      } else if (tab.attachmentId) {
        await showAttachmentInFinder(Number(tab.attachmentId));
      } else {
        await showEntryInFinder(Number(tab.entryId));
      }
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
  }, [tab.entryId, tab.attachmentId, tab.type, isMarkdown]);

  const handleOpenExtracted = useCallback(() => {
    if (!tab.entryId) return;
    openTab({ type: "markdown", title: tab.title, entryId: tab.entryId, attachmentId: tab.attachmentId });
  }, [tab, openTab]);

  const handleOpenMainFile = useCallback(() => {
    if (!tab.entryId) return;
    openTab({ type: "entry", title: tab.title, entryId: tab.entryId, attachmentId: tab.attachmentId });
  }, [tab, openTab]);

  const handleCopyEntryLink = useCallback(async () => {
    if (!tab.entryId) return;
    try {
      const entry = await getEntry(Number(tab.entryId));
      await writeText(buildEntryLink(entry.key));
      toast.success("Entry link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  }, [tab.entryId]);

  const handleCopyPdfLink = useCallback(async () => {
    if (!tab.entryId || !tab.attachmentId) return;
    try {
      const entry = await getEntry(Number(tab.entryId));
      const attachments = await getEntryAttachments(Number(tab.entryId));
      const attachment = attachments.find((a) => String(a.id) === tab.attachmentId);
      if (attachment) {
        await writeText(buildPdfLink(entry.key, attachment.key));
        toast.success("PDF link copied");
      }
    } catch {
      toast.error("Failed to copy link");
    }
  }, [tab.entryId, tab.attachmentId]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {hasEntryId && (
          <>
            <ContextMenuItem onClick={handleShowInLibrary}>
              <Library className="h-4 w-4 mr-2" />Show in Library
            </ContextMenuItem>
            <ContextMenuItem onClick={handleFindInFinder}>
              <FolderOpen className="h-4 w-4 mr-2" />Find in Finder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleCopyEntryLink}>
              <Link className="h-4 w-4 mr-2" />Copy Entry Link
            </ContextMenuItem>
            {isEntry && tab.attachmentId && (
              <ContextMenuItem onClick={handleCopyPdfLink}>
                <Link className="h-4 w-4 mr-2" />Copy PDF Link
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}
        {isEntry && hasEntryId && !isNote && (
          <>
            <ContextMenuItem onClick={handleOpenExtracted}>
              <FileText className="h-4 w-4 mr-2" />Open Extracted Content
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {isMarkdown && hasEntryId && (
          <>
            <ContextMenuItem onClick={handleOpenMainFile}>
              <ChevronRight className="h-4 w-4 mr-2" />Open Main File
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {!isLibrary && (
          <>
            {tab.pinned ? (
              <ContextMenuItem onClick={() => unpinTab(tab.id)}>
                <Pin className="h-4 w-4 mr-2" />Unpin Tab
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onClick={() => pinTab(tab.id)}>
                <Pin className="h-4 w-4 mr-2" />Pin Tab
              </ContextMenuItem>
            )}
          </>
        )}
        {!isLibrary && !isWelcome && (
          <ContextMenuItem onClick={() => duplicateTab(tab.id)}>
            <Copy className="h-4 w-4 mr-2" />Duplicate Tab
          </ContextMenuItem>
        )}
        {!isLibrary && (
          <>
            <ContextMenuSeparator />
            {pane === "left" && (
              <ContextMenuItem onClick={() => moveTabToPane(tab.id, "right")}>
                <ArrowRightFromLine className="h-4 w-4 mr-2" />{splitEnabled ? "Move to Right Pane" : "Split Right"}
              </ContextMenuItem>
            )}
            {pane === "right" && (
              <ContextMenuItem onClick={() => moveTabToPane(tab.id, "left")}>
                <ArrowLeftFromLine className="h-4 w-4 mr-2" />Move to Left Pane
              </ContextMenuItem>
            )}
          </>
        )}
        <ContextMenuSeparator />
        {!isLibrary && (
          <ContextMenuItem onClick={() => closeTab(tab.id)}>
            <X className="h-4 w-4 mr-2" />Close Tab
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => closeOtherTabs(tab.id)}>Close Other Tabs</ContextMenuItem>
        {hasTabsToRight && (
          <ContextMenuItem onClick={() => closeTabsToRight(tab.id)}>Close Tabs to the Right</ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => closeAllTabs()}>Close All Tabs</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
