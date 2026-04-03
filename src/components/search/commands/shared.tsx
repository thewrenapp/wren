import { Command } from "cmdk";
import { Library, Tag } from "lucide-react";

export function ShortcutBadge({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5 ml-auto">
      {keys.map((key, i) => (
        <kbd key={i} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">
          {key}
        </kbd>
      ))}
    </div>
  );
}

export function SubMenuShell({ icon, title, onBack, onBackdropClick, children }: {
  icon: React.ReactNode;
  title: string;
  onBack: () => void;
  onBackdropClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onBackdropClick} />
      <div className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl px-4">
        <Command className="rounded-xl border border-border/50 shadow-2xl bg-popover/95 backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            {icon}
            <span className="text-base">{title}</span>
            <button onClick={onBack} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              ← Back
            </button>
          </div>
          {children}
        </Command>
      </div>
    </div>
  );
}

export function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function CollectionIcon({ color }: { color?: string }) {
  return (
    <div className="flex items-center justify-center h-8 w-8 rounded-lg" style={{ backgroundColor: `${color || '#8B5CF6'}20` }}>
      <Library className="h-4 w-4" style={{ color: color || '#8B5CF6' }} />
    </div>
  );
}

export function TagIcon({ tag }: { tag: { color?: string; isImported: boolean } }) {
  return (
    <div
      className="flex items-center justify-center h-8 w-8 rounded-lg"
      style={{ backgroundColor: (tag.color || !tag.isImported) ? `${tag.color || '#3B82F6'}20` : 'transparent' }}
    >
      <Tag className="h-4 w-4" style={{ color: (tag.color || !tag.isImported) ? (tag.color || '#3B82F6') : 'var(--muted-foreground)' }} />
    </div>
  );
}

export function RenameForm({ placeholder, value, onChange, onCancel, onConfirm }: {
  placeholder: string;
  value: string;
  onChange: (val: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="p-3">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onConfirm();
          }
        }}
      />
      <div className="flex gap-2 mt-3">
        <button onClick={onCancel} className="flex-1 px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={!value.trim()}
          className="flex-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          Rename
        </button>
      </div>
    </div>
  );
}

export function CommandItem({ value, onSelect, icon, iconBg, label, description, shortcut }: {
  value: string;
  onSelect: () => void;
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  description?: string;
  shortcut?: string[];
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors aria-selected:bg-accent/50 hover:bg-accent/30"
    >
      <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </div>
      {shortcut && <ShortcutBadge keys={shortcut} />}
    </Command.Item>
  );
}
