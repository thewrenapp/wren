import { useState, useRef, useEffect, useCallback } from "react";
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

interface UserSuggestion {
  email: string;
  displayName: string;
}

export function ShareDialog() {
  const { shareDialog, hideShareDialog } = useUIStore();
  const { open, shareType, entryIds, entryTitles, collectionName } = shareDialog;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [loading, setLoading] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [checked, setChecked] = useState(false);

  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check auth state when dialog opens
  if (open && !checked) {
    invoke<AuthState>("get_auth_state").then((a) => {
      setAuth(a);
      setChecked(true);
    });
  }

  const searchUsers = useCallback(async (prefix: string) => {
    if (prefix.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const results = await invoke<UserSuggestion[]>("search_users_by_email", { prefix });
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchUsers(value), 300);
  };

  const selectSuggestion = (suggestion: UserSuggestion) => {
    setEmail(suggestion.email);
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleClose = () => {
    hideShareDialog();
    setEmail("");
    setChecked(false);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleShare = async () => {
    if (!email) return;
    setLoading(true);
    try {
      await invoke("create_share", {
        email: email.toLowerCase(),
        role,
        shareType,
        collectionId: shareDialog.collectionId,
        entryIds: entryIds.length > 0 ? entryIds : null,
      });
      toast.success(`Shared with ${email}`);
      handleClose();
    } catch (err) {
      toast.error(`${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) {
      if (e.key === "Enter") handleShare();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        selectSuggestion(suggestions[selectedIndex]);
      } else {
        setShowSuggestions(false);
        handleShare();
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const title = shareType === "library"
    ? "Share your library"
    : shareType === "collection"
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
                Go to Settings &rarr; Sync &rarr; Account & Sharing to sign in, then come
                back here to share.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Invite by email</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="email"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    onKeyDown={handleKeyDown}
                    placeholder="colleague@university.edu"
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {showSuggestions && (
                    <div className="absolute z-50 w-full mt-1 border rounded-md bg-popover shadow-md overflow-hidden">
                      {suggestions.map((s, i) => (
                        <button
                          key={s.email}
                          type="button"
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-accent cursor-pointer ${
                            i === selectedIndex ? "bg-accent" : ""
                          }`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectSuggestion(s)}
                        >
                          <div className="font-medium truncate">{s.email}</div>
                          {s.displayName && (
                            <div className="text-xs text-muted-foreground truncate">
                              {s.displayName}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
