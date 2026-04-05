import { useEffect, useState } from "react";
import {
  Cloud,
  CloudOff,
  FolderOpen,
  FolderSync,
  Check,
  Loader2,
  LogOut,
  Share2,
  User,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { getLibraryPath } from "@/services/tauri";
import { useUIStore } from "@/stores/uiStore";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "@/stores/toastStore";

interface AuthState {
  signedIn: boolean;
  uid?: string;
  email?: string;
  displayName?: string;
}

export function SyncSection() {
  const [libraryPath, setLibraryPath] = useState("");
  const [syncFolder, setSyncFolder] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  // Auth state
  const [auth, setAuth] = useState<AuthState>({ signedIn: false });
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "reset">("signin");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    getLibraryPath().then(setLibraryPath).catch(console.error);
    invoke<string | null>("get_setting_value_cmd", { key: "sync_folder" })
      .then((val) => {
        if (val) {
          setSyncFolder(val);
          setSyncEnabled(true);
        }
      })
      .catch(() => {});
    invoke<AuthState>("get_auth_state")
      .then(setAuth)
      .catch(() => {});

    // Listen for OAuth callback (Google/Apple sign-in via browser)
    const unlisten = listen<{ uid: string; email: string; displayName?: string }>(
      "auth:signed-in",
      (event) => {
        setAuth({
          signedIn: true,
          uid: event.payload.uid,
          email: event.payload.email,
          displayName: event.payload.displayName,
        });
        toast.success("Signed in");
      },
    );
    return () => { unlisten.then((f) => f()); };
  }, []);

  const doSetup = async (folder: string) => {
    setSettingUp(true);
    try {
      await invoke("setup_sync_folder", { syncFolder: folder });
      setSyncFolder(folder);
      setSyncEnabled(true);
      toast.success("Sync enabled");
    } catch (err) {
      toast.error(`Failed to set up sync: ${err}`);
    } finally {
      setSettingUp(false);
    }
  };

  const handleChooseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Sync Folder",
      });
      if (selected && typeof selected === "string") {
        await doSetup(selected);
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  };

  const handleEnableICloud = async () => {
    const home = libraryPath.replace(/\/\.wren$/, "");
    const icloudPath = `${home}/Library/Mobile Documents/com~apple~CloudDocs/Wren`;
    await doSetup(icloudPath);
  };

  const handleDisableSync = async () => {
    setSettingUp(true);
    try {
      await invoke("disable_sync");
      setSyncFolder("");
      setSyncEnabled(false);
      toast.success("Sync disabled");
    } catch (err) {
      toast.error(`Failed to disable sync: ${err}`);
    } finally {
      setSettingUp(false);
    }
  };

  const validatePassword = (pw: string): string | null => {
    if (pw.length < 8) return "Password must be at least 8 characters";
    if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
    if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter";
    if (!/[0-9]/.test(pw)) return "Password must contain a number";
    return null;
  };

  const handleSubmit = async () => {
    setAuthError("");

    if (authMode === "reset") {
      if (!authEmail) { setAuthError("Enter your email"); return; }
      setAuthLoading(true);
      try {
        await invoke("reset_password", { email: authEmail });
        toast.success("Password reset email sent. Check your inbox.");
        setAuthMode("signin");
      } catch (err) {
        setAuthError(`${err}`);
      } finally {
        setAuthLoading(false);
      }
      return;
    }

    if (!authEmail || !authPassword) {
      setAuthError("Email and password are required");
      return;
    }

    if (authMode === "signup") {
      const pwError = validatePassword(authPassword);
      if (pwError) { setAuthError(pwError); return; }
      if (authPassword !== authConfirmPassword) {
        setAuthError("Passwords do not match");
        return;
      }
    }

    setAuthLoading(true);
    try {
      const cmd = authMode === "signup" ? "sign_up_email" : "sign_in_email";
      const result = await invoke<AuthState>(cmd, {
        email: authEmail,
        password: authPassword,
      });
      setAuth(result);
      setAuthEmail("");
      setAuthPassword("");
      setAuthConfirmPassword("");
      toast.success(authMode === "signup" ? "Account created" : "Signed in");
    } catch (err) {
      const msg = `${err}`;
      if (msg.includes("EMAIL_NOT_FOUND")) setAuthError("No account with this email");
      else if (msg.includes("INVALID_PASSWORD") || msg.includes("INVALID_LOGIN_CREDENTIALS"))
        setAuthError("Incorrect password");
      else if (msg.includes("EMAIL_EXISTS")) setAuthError("An account with this email already exists");
      else if (msg.includes("WEAK_PASSWORD")) setAuthError("Password is too weak (min 6 characters)");
      else if (msg.includes("INVALID_EMAIL")) setAuthError("Invalid email address");
      else if (msg.includes("TOO_MANY_ATTEMPTS")) setAuthError("Too many attempts. Try again later.");
      else setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await invoke("sign_out");
      setAuth({ signedIn: false });
      toast.success("Signed out");
    } catch (err) {
      toast.error(`${err}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* Multi-Device Sync */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Multi-Device Sync
        </h3>

        {!syncEnabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
              <CloudOff className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Sync not configured</p>
                <p className="text-xs text-muted-foreground">
                  Choose a cloud-synced folder to keep your library in sync
                  across devices.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleEnableICloud}
                disabled={settingUp}
              >
                {settingUp ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4 mr-2" />
                )}
                Use iCloud Drive
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleChooseFolder}
                disabled={settingUp}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Choose Folder
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Works with iCloud Drive, Dropbox, Google Drive, OneDrive, or any
              folder-syncing service.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-md border bg-green-500/5 border-green-500/20">
              <FolderSync className="h-5 w-5 text-green-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Sync active</p>
                <p className="text-xs text-muted-foreground truncate">
                  {syncFolder}
                </p>
              </div>
              <Check className="h-4 w-4 text-green-500 shrink-0" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleChooseFolder}
                disabled={settingUp}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Change Folder
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisableSync}
                disabled={settingUp}
              >
                {settingUp && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Disable Sync
              </Button>
            </div>
            <div className="p-3 rounded-md bg-muted/30 border">
              <p className="text-xs text-muted-foreground">
                Your library folder is symlinked to the sync folder. Entry
                metadata, PDFs, and notes sync automatically via your cloud
                service.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* What Syncs */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          What Syncs
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2 rounded-md bg-green-500/5 border border-green-500/10">
            <p className="font-medium text-green-700 dark:text-green-400 mb-1">
              Synced
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>Entry metadata</li>
              <li>PDFs & attachments</li>
              <li>Annotations & notes</li>
              <li>Tags & collections</li>
            </ul>
          </div>
          <div className="p-2 rounded-md bg-muted/30 border">
            <p className="font-medium text-muted-foreground mb-1">
              Per-device
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>Search index</li>
              <li>Vector embeddings</li>
              <li>Database cache</li>
              <li>API keys</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Account & Sharing */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Account & Sharing
        </h3>

        {auth.signedIn ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-md border bg-green-500/5 border-green-500/20">
              <User className="h-5 w-5 text-green-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {auth.displayName || auth.email}
                </p>
                {auth.displayName && (
                  <p className="text-xs text-muted-foreground">{auth.email}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-1" />
                Sign Out
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const { showShareDialog } = useUIStore.getState();
                showShareDialog('library', [], []);
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share Entire Library
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-1">
              Sign in to share collections and entries with collaborators.
            </p>
            <div className="mb-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={async () => {
                  setAuthLoading(true);
                  setAuthError("");
                  try {
                    const result = await invoke<AuthState>("sign_in_google");
                    setAuth(result);
                    toast.success("Signed in with Google");
                  } catch (err) {
                    setAuthError(`${err}`);
                  } finally {
                    setAuthLoading(false);
                  }
                }}
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                )}
                Continue with Google
              </Button>
            </div>
            <div className="relative mb-3">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  {authMode === "reset" ? "Reset password" : "Or with email"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <input
                type="email"
                value={authEmail}
                onChange={(e) => { setAuthEmail(e.target.value); setAuthError(""); }}
                placeholder="Email"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {authMode !== "reset" && (
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => { setAuthPassword(e.target.value); setAuthError(""); }}
                  placeholder="Password"
                  onKeyDown={(e) => e.key === "Enter" && authMode === "signin" && handleSubmit()}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
              {authMode === "signup" && (
                <>
                  <input
                    type="password"
                    value={authConfirmPassword}
                    onChange={(e) => { setAuthConfirmPassword(e.target.value); setAuthError(""); }}
                    placeholder="Confirm password"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {authPassword && (
                    <div className="space-y-1">
                      {[
                        { test: authPassword.length >= 8, label: "At least 8 characters" },
                        { test: /[A-Z]/.test(authPassword), label: "Uppercase letter" },
                        { test: /[a-z]/.test(authPassword), label: "Lowercase letter" },
                        { test: /[0-9]/.test(authPassword), label: "Number" },
                      ].map(({ test, label }) => (
                        <p key={label} className={`text-xs flex items-center gap-1.5 ${test ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                          {test ? <Check className="h-3 w-3" /> : <span className="h-3 w-3 inline-block" />}
                          {label}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
              {authError && (
                <p className="text-xs text-red-500">{authError}</p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={authLoading || !authEmail || (authMode !== "reset" && !authPassword)}
                >
                  {authLoading && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {authMode === "signup" ? "Create Account" : authMode === "reset" ? "Send Reset Link" : "Sign In"}
                </Button>
                {authMode === "signin" && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setAuthMode("reset"); setAuthError(""); }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="pt-1">
                {authMode === "signin" && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthPassword(""); }}
                  >
                    Need an account? Sign up
                  </button>
                )}
                {(authMode === "signup" || authMode === "reset") && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthPassword(""); setAuthConfirmPassword(""); }}
                  >
                    Back to sign in
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
