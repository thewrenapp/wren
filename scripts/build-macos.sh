#!/usr/bin/env bash
#
# Build, sign, notarize, and staple a macOS release of Wren.
#
# Requires an Apple Developer account. Provide your own credentials via
# environment variables (e.g. in your shell profile, or a local untracked file):
#
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Your Name (TEAMID)"
#   APPLE_API_KEY            App Store Connect API key ID (e.g. ABCDE12345)
#   APPLE_API_ISSUER         API key issuer ID (a UUID)
#   APPLE_API_KEY_PATH       path to your .p8 API key file
#
# Signing uses APPLE_SIGNING_IDENTITY. Notarization runs only if the three API
# variables are all set; otherwise the app is built and signed but not notarized.
#
# Usage:  ./scripts/build-macos.sh [extra args passed to `tauri build`]

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "⚠️  APPLE_SIGNING_IDENTITY is not set — the build will be ad-hoc signed"
  echo "    (fine for local testing, not distributable). Set it for a real release."
fi

echo "▶︎  Building app…"
npm run tauri build "$@"

# Tauri is configured to bundle only the .app — its create-dmg AppleScript breaks
# on recent macOS ("statusbar visible … -10006"). Find the freshly built app;
# with `--target <triple>` it lands under src-tauri/target/<triple>/release/….
app="$(find src-tauri/target -type d -name 'Wren.app' -path '*/bundle/macos/*' -print0 2>/dev/null \
        | xargs -0 ls -dt 2>/dev/null | head -1 || true)"
if [[ -z "$app" || ! -d "$app" ]]; then
  echo "❌ No .app was produced."
  exit 1
fi
echo "✓  Built: $app"

# Build the DMG with hdiutil — app + an /Applications drop-link, no Finder scripting.
version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
case "$app" in
  *aarch64-apple-darwin*)   arch=aarch64 ;;
  *x86_64-apple-darwin*)    arch=x86_64 ;;
  *universal-apple-darwin*) arch=universal ;;
  *)                        arch="$(uname -m)" ;;
esac
dmg="$(cd "$(dirname "$app")/.." && pwd)/Wren_${version}_${arch}.dmg"
staging="$(mktemp -d)"
cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"
rm -f "$dmg"
echo "▶︎  Creating DMG…"
hdiutil create -volname "Wren" -srcfolder "$staging" -ov -format UDZO -fs HFS+ "$dmg" >/dev/null
rm -rf "$staging"
echo "✓  DMG: $dmg"

# Sign the DMG container too (Apple-recommended; makes Gatekeeper assessment clean).
echo "▶︎  Signing DMG…"
codesign --force --sign "${APPLE_SIGNING_IDENTITY:--}" "$dmg"

if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
  echo "▶︎  Notarizing…"
  xcrun notarytool submit "$dmg" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait

  echo "▶︎  Stapling…"
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose "$dmg" || true

  echo "✅  Notarized & stapled: $dmg"
else
  echo "ℹ️  Skipping notarization — set APPLE_API_KEY, APPLE_API_ISSUER and"
  echo "    APPLE_API_KEY_PATH to notarize."
  echo "✅  Built (not notarized): $dmg"
fi

# Also emit a stable, versionless filename so the website's
# `releases/latest/download/Wren-<arch>.dmg` link always resolves. Upload this
# copy as a release asset alongside (or instead of) the versioned one.
case "$arch" in
  aarch64 | arm64) stable_arch="arm64" ;;
  *)               stable_arch="$arch" ;;
esac
stable="$(dirname "$dmg")/Wren-${stable_arch}.dmg"
cp -f "$dmg" "$stable"
echo "✓  Stable copy for release upload: $stable"
