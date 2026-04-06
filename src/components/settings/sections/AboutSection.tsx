import { AppLogo } from "@/components/ui/AppLogo";

export function AboutSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <AppLogo size={56} />
        <div>
          <h3 className="text-base font-semibold">Wren</h3>
          <p className="text-sm text-muted-foreground">
            Reference Manager for the Modern Researcher
          </p>
          <p className="text-sm text-muted-foreground">Version 0.1.0</p>
        </div>
      </div>

      <hr className="border-border" />

      <p className="text-sm text-muted-foreground">
        A local-first reference manager. Your library, your data.
      </p>
    </div>
  );
}
