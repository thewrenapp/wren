import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Share2, CloudOff, Loader2 } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/stores/toastStore";

interface AuthState {
  signedIn: boolean;
  uid?: string;
  email?: string;
  displayName?: string;
}

export function ShareDialog() {
  const { shareDialog, hideShareDialog } = useUIStore();
  const { open, entryIds, entryTitles, collectionName } = shareDialog;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [loading, setLoading] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [checked, setChecked] = useState(false);

  // Check auth state when dialog opens
  if (open && !checked) {
    invoke<AuthState>("get_auth_state").then((a) => {
      setAuth(a);
      setChecked(true);
    });
  }

  // Reset when dialog closes
  const handleClose = () => {
    hideShareDialog();
    setEmail("");
    setChecked(false);
  };

  const handleShare = async () => {
    if (!email) return;
    setLoading(true);
    try {
      // TODO: Wire to create_share backend when sharing transport is ready
      toast.info("Sharing will be available once connected to Firebase. Entry data is ready for sync.");
      handleClose();
    } catch (err) {
      toast.error(`${err}`);
    } finally {
      setLoading(false);
    }
  };

  const title = collectionName
    ? `Share "${collectionName}"`
    : entryTitles.length === 1
      ? `Share "${entryTitles[0]}"`
      : `Share ${entryIds.length} entries`;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30">
              <Share2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <DialogTitle>Share</DialogTitle>
              <DialogDescription className="mt-1">{title}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {auth && !auth.signedIn ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <CloudOff className="h-12 w-12 text-muted-foreground" />
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">Sign in required</p>
              <p className="text-xs text-muted-foreground max-w-[280px]">
                Go to Settings → Sync → Account & Sharing to sign in, then come
                back here to share.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Invite by email</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@university.edu"
                  onKeyDown={(e) => e.key === "Enter" && handleShare()}
                  className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "editor" | "viewer")
                  }
                  className="px-3 py-2 text-sm border rounded-md bg-background"
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">View only</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          {auth?.signedIn && (
            <Button onClick={handleShare} disabled={!email || loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
