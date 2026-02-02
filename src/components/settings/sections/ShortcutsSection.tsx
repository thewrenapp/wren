export function ShortcutsSection() {
  return (
    <div className="space-y-8">
      {/* Navigation */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Navigation
        </h3>

        <div className="space-y-1">
          <ShortcutRow keys={["⌘", "K"]} description="Open command palette" />
          <ShortcutRow keys={["⌘", "W"]} description="Close current tab" />
          <ShortcutRow keys={["⌘", "1-9"]} description="Switch to tab by number" />
          <ShortcutRow keys={["⌘", "⇧", "["]} description="Previous tab" />
          <ShortcutRow keys={["⌘", "⇧", "]"]} description="Next tab" />
        </div>
      </section>

      {/* Library */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Library
        </h3>

        <div className="space-y-1">
          <ShortcutRow keys={["⌘", "⇧", "V"]} description="Toggle list/card view" />
          <ShortcutRow keys={["⌘", "A"]} description="Select all items" />
          <ShortcutRow keys={["↑", "↓"]} description="Navigate items" />
          <ShortcutRow keys={["⇧", "↑/↓"]} description="Extend selection" />
          <ShortcutRow keys={["Esc"]} description="Clear selection" />
          <ShortcutRow keys={["Enter"]} description="Open selected item" />
          <ShortcutRow keys={["Delete"]} description="Move selected to trash" />
        </div>
      </section>

      {/* PDF Viewer */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          PDF Viewer
        </h3>

        <div className="space-y-1">
          <ShortcutRow keys={["⌘", "+"]} description="Zoom in" />
          <ShortcutRow keys={["⌘", "-"]} description="Zoom out" />
          <ShortcutRow keys={["⌘", "0"]} description="Reset zoom" />
          <ShortcutRow keys={["Space"]} description="Scroll down" />
          <ShortcutRow keys={["⇧", "Space"]} description="Scroll up" />
        </div>
      </section>

      {/* Editor */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Editor
        </h3>

        <div className="space-y-1">
          <ShortcutRow keys={["⌘", "S"]} description="Save note" />
          <ShortcutRow keys={["⌘", "B"]} description="Bold text" />
          <ShortcutRow keys={["⌘", "I"]} description="Italic text" />
          <ShortcutRow keys={["⌘", "["]} description="Insert link" />
        </div>
      </section>
    </div>
  );
}

interface ShortcutRowProps {
  keys: string[];
  description: string;
}

function ShortcutRow({ keys, description }: ShortcutRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="px-2 py-1 text-xs font-medium bg-muted rounded border border-border min-w-[24px] text-center"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}
