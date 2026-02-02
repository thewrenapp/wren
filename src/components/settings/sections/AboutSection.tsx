import { ExternalLink } from "lucide-react";
import { AppLogo } from "@/components/ui/AppLogo";

export function AboutSection() {
  return (
    <div className="space-y-8">
      {/* App Info */}
      <section className="space-y-4">
        <div className="flex items-center gap-4">
          <AppLogo size={64} className="shadow-md" />
          <div>
            <h3 className="text-xl font-semibold">Wren</h3>
            <p className="text-sm text-muted-foreground">
              Reference Management for the Modern Researcher
            </p>
          </div>
        </div>
      </section>

      {/* Version Info */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Version
        </h3>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span>0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Build</span>
            <span>Development</span>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Built With
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <TechItem name="Tauri" version="2.x" />
          <TechItem name="React" version="18" />
          <TechItem name="Rust" version="1.75+" />
          <TechItem name="SQLite" version="3" />
        </div>
      </section>

      {/* Links */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Resources
        </h3>

        <div className="space-y-2">
          <LinkItem label="Documentation" href="#" />
          <LinkItem label="Report an Issue" href="#" />
          <LinkItem label="Source Code" href="#" />
        </div>
      </section>

      {/* Credits */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Credits
        </h3>

        <p className="text-sm text-muted-foreground">
          Wren is inspired by great tools like Zotero, Papers, and Notion.
          Built with love for researchers everywhere.
        </p>
      </section>
    </div>
  );
}

interface TechItemProps {
  name: string;
  version: string;
}

function TechItem({ name, version }: TechItemProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50">
      <span className="text-sm font-medium">{name}</span>
      <span className="text-xs text-muted-foreground">{version}</span>
    </div>
  );
}

interface LinkItemProps {
  label: string;
  href: string;
}

function LinkItem({ label, href }: LinkItemProps) {
  return (
    <a
      href={href}
      className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/50 transition-colors group"
    >
      <span className="text-sm">{label}</span>
      <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
    </a>
  );
}
