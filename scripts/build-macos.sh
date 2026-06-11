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

echo "▶︎  Building…"
npm run tauri build "$@"

dmg="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)"
if [[ -z "$dmg" || ! -f "$dmg" ]]; then
  echo "❌ No .dmg was produced."
  exit 1
fi
echo "✓  Built: $dmg"

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
