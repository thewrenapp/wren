import { Command } from "cmdk";
import {
  Search, RotateCcw, Trash2, PanelLeftClose, BookOpen,
} from "lucide-react";
import type { CommandsProps } from "./types";
import { ShortcutBadge } from "./shared";
import {
  SelectedEntryCommands, PdfCommands, EpubCommands,
  HtmlCommands, ImageCommands, EditorCommands,
  MarkdownCommands, WelcomeCommands,
} from "./EntryCommands";
import { CollectionsCommands, ExportCommands, CreateCommands } from "./CollectionCommands";
import { TagsCommands } from "./TagCommands";
import { ViewCommands } from "./ViewCommands";
import { TabCommands, NavigateCommands, SettingsCommands } from "./NavigationCommands";

export function CommandGroups({ props }: { props: CommandsProps }) {
  const {
    handlers, viewerContext, contextAttachmentId,
    tabs, activeTabId, activeRightTabId, activeTab, tabTypeLabels,
    splitEnabled, focusedPane,
    collections, tags, selectedEntryIds,
    activeFilter, activeCollectionId, activeTagIds,
    trashCount, viewModeByFilter, sortField, sortDirection,
    libraryLayout, columns, theme, savedSearches,
    libraryInfoPaneEnabled,
    tabActions, uiActions, setSubMenu, setCommandPaletteOpen,
  } = props;

  return (
    <>
      {viewerContext === "pdf" && <PdfCommands setCommandPaletteOpen={setCommandPaletteOpen} handleSelect={handlers.handleSelect} togglePdfLeftPanel={uiActions.togglePdfLeftPanel} />}
      {viewerContext === "epub" && <EpubCommands setCommandPaletteOpen={setCommandPaletteOpen} handleSelect={handlers.handleSelect} toggleEpubLeftPanel={uiActions.toggleEpubLeftPanel} />}
      {viewerContext === "html" && <HtmlCommands setCommandPaletteOpen={setCommandPaletteOpen} handleSelect={handlers.handleSelect} toggleHtmlLeftPanel={uiActions.toggleHtmlLeftPanel} />}
      {viewerContext === "image" && <ImageCommands setCommandPaletteOpen={setCommandPaletteOpen} />}
      {viewerContext === "note" && <EditorCommands setCommandPaletteOpen={setCommandPaletteOpen} />}
      {viewerContext === "markdown" && <MarkdownCommands setCommandPaletteOpen={setCommandPaletteOpen} contextAttachmentId={contextAttachmentId} reindexAttachment={uiActions.reindexAttachment} />}
      {viewerContext === "welcome" && <WelcomeCommands handleImportPdf={handlers.handleImportPdf} handleImportFolder={handlers.handleImportFolder} />}

      {tabs.length > 0 && (
        <TabCommands
          tabs={tabs}
          activeTabId={activeTabId}
          activeRightTabId={activeRightTabId}
          activeTab={activeTab}
          tabTypeLabels={tabTypeLabels}
          splitEnabled={splitEnabled}
          focusedPane={focusedPane}
          tabActions={tabActions}
          handleSelect={handlers.handleSelect}
          showEntryInFinder={uiActions.showEntryInFinder}
          getEntry={uiActions.getEntry}
        />
      )}

      <Command.Group>
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
          Layout
        </div>
        <Command.Item
          value="toggle sidebar show hide"
          onSelect={() => handlers.handleSelect(() => uiActions.toggleSidebar())}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted">
            <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1"><span className="block text-sm font-medium">Toggle Sidebar</span></div>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">⌘B</span>
        </Command.Item>
      </Command.Group>

      {selectedEntryIds.length > 0 && activeFilter !== "trash" && (
        <SelectedEntryCommands
          handlers={handlers}
          selectedEntryIds={selectedEntryIds}
          activeCollectionId={activeCollectionId}
          activeTagIds={activeTagIds}
          collections={collections}
          tags={tags}
          setSubMenu={setSubMenu}
          setCommandPaletteOpen={setCommandPaletteOpen}
        />
      )}

      {activeFilter === "trash" && selectedEntryIds.length > 0 && (
        <Command.Group>
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            Trash ({selectedEntryIds.length} selected)
          </div>
          <Command.Item
            value="restore from trash undo"
            onSelect={handlers.handleRestoreFromTrash}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-green-500/10">
              <RotateCcw className="h-4 w-4 text-green-500" />
            </div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Restore from Trash</span>
            </div>
            <ShortcutBadge keys={["⌘", "⇧", "Z"]} />
          </Command.Item>
          <Command.Item
            value="permanent delete forever"
            onSelect={handlers.handlePermanentDelete}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
              <Trash2 className="h-4 w-4 text-red-500" />
            </div>
            <div className="flex-1">
              <span className="block text-sm font-medium">Permanently Delete</span>
              <span className="text-xs text-muted-foreground">Cannot be undone</span>
            </div>
          </Command.Item>
        </Command.Group>
      )}

      <ExportCommands
        handlers={handlers}
        selectedEntryIds={selectedEntryIds}
        collections={collections}
        tags={tags}
        setSubMenu={setSubMenu}
      />

      <CreateCommands
        handlers={handlers}
        setSubMenu={setSubMenu}
        uiActions={uiActions}
      />

      <TagsCommands
        tags={tags}
        selectedEntryIds={selectedEntryIds}
        setSubMenu={setSubMenu}
        handleSelect={handlers.handleSelect}
        uiActions={uiActions}
      />

      <CollectionsCommands
        collections={collections}
        setSubMenu={setSubMenu}
        handleSelect={handlers.handleSelect}
        uiActions={uiActions}
      />

      <ViewCommands
        handlers={handlers}
        viewModeByFilter={viewModeByFilter}
        activeFilter={activeFilter}
        sortField={sortField}
        sortDirection={sortDirection}
        libraryLayout={libraryLayout}
        columns={columns}
        trashCount={trashCount}
        libraryInfoPaneEnabled={libraryInfoPaneEnabled}
        uiActions={uiActions}
        setCommandPaletteOpen={setCommandPaletteOpen}
      />

      {savedSearches.length > 0 && (
        <Command.Group>
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            Saved Searches
          </div>
          {savedSearches.map(search => (
            <Command.Item
              key={search.id}
              value={`saved search ${search.name} filter`}
              onSelect={() => handlers.handleSelect(() => uiActions.setActiveSavedSearch(search.id))}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
            >
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
                <Search className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <span className="block text-sm font-medium">{search.name}</span>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}

      <NavigateCommands handleNavigateTo={handlers.handleNavigateTo} trashCount={trashCount} />

      <Command.Group>
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
          Search
        </div>
        <Command.Item
          value="advanced search filter criteria smart"
          onSelect={() => handlers.handleSelect(() => uiActions.setAdvancedSearchOpen(true))}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
            <BookOpen className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <span className="block text-sm font-medium">Advanced Search</span>
            <span className="text-xs text-muted-foreground">Search with multiple criteria</span>
          </div>
          <ShortcutBadge keys={["⌘", "⇧", "F"]} />
        </Command.Item>
      </Command.Group>

      <SettingsCommands
        theme={theme}
        handleSelect={handlers.handleSelect}
        uiActions={uiActions}
      />
    </>
  );
}
