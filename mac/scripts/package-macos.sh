#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
if [ "$(/usr/bin/uname -s)" != "Darwin" ]; then echo "Build this native app on macOS." >&2; exit 1; fi
if ! /usr/bin/xcrun --find swift >/dev/null 2>&1; then echo "Developer build requires Xcode or its command-line tools. The finished app does not." >&2; exit 1; fi
cd "$ROOT"
/usr/bin/xcrun swift build --configuration release --arch arm64 --scratch-path "$ROOT/.build-macos"
BIN="$(/usr/bin/xcrun swift build --configuration release --arch arm64 --scratch-path "$ROOT/.build-macos" --show-bin-path)"
APP="$ROOT/dist/TeamLoop.app"
case "$APP" in "$ROOT/dist/TeamLoop.app") ;; *) exit 1;; esac
if [ -e "$APP" ]; then /bin/rm -rf "$APP"; fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/runtime" "$APP/Contents/Resources/core"
/bin/cp "$BIN/TeamLoopMac" "$APP/Contents/MacOS/TeamLoopMac"
/bin/cp "$ROOT/core/"*.mjs "$APP/Contents/Resources/core/"
/bin/bash "$ROOT/scripts/fetch-runtime.sh" "$APP/Contents/Resources/runtime"
/bin/cp "$ROOT/scripts/Info.plist" "$APP/Contents/Info.plist"
if [ -f "$ROOT/LICENSE" ]; then /bin/cp "$ROOT/LICENSE" "$APP/Contents/Resources/TEAMLOOP-LICENSE.txt"; fi
if [ -f "$ROOT/NOTICE" ]; then /bin/cp "$ROOT/NOTICE" "$APP/Contents/Resources/TEAMLOOP-NOTICE.txt"; fi
if [ -f "$ROOT/core/provider-registry.json" ]; then /bin/cp "$ROOT/core/provider-registry.json" "$APP/Contents/Resources/core/"; fi
# An ad-hoc build is explicitly a local development artifact. It is NOT notarized.
IDENTITY="${SIGNING_IDENTITY:--}"
if [ "$IDENTITY" = "-" ]; then
  /usr/bin/codesign --force --sign - "$APP/Contents/Resources/runtime/node"
  /usr/bin/codesign --force --entitlements "$ROOT/scripts/App.entitlements.plist" --sign - "$APP/Contents/MacOS/TeamLoopMac"
  /usr/bin/codesign --force --entitlements "$ROOT/scripts/App.entitlements.plist" --sign - "$APP"
  /usr/bin/printf '%s\n' 'LOCAL DEVELOPMENT BUILD: ad-hoc signed, not notarized. Do not present as a Gatekeeper-ready consumer release.' > "$ROOT/dist/BUILD-STATUS.txt"
else
  /usr/bin/codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP/Contents/Resources/runtime/node"
  /usr/bin/codesign --force --options runtime --timestamp --entitlements "$ROOT/scripts/App.entitlements.plist" --sign "$IDENTITY" "$APP/Contents/MacOS/TeamLoopMac"
  /usr/bin/codesign --force --options runtime --timestamp --entitlements "$ROOT/scripts/App.entitlements.plist" --sign "$IDENTITY" "$APP"
  /usr/bin/printf '%s\n' 'Developer ID signed. Notarization must succeed before distribution.' > "$ROOT/dist/BUILD-STATUS.txt"
fi
/usr/bin/codesign --verify --strict --deep --verbose=2 "$APP"
/usr/bin/plutil -lint "$APP/Contents/Info.plist"
# Exercise the shipped runtime/modules against isolated state, without provider calls.
SMOKE="$(/usr/bin/mktemp -d "$ROOT/.build-macos/bundle-smoke.XXXXXX")"
trap '/bin/rm -rf "$SMOKE"' EXIT
TEAMLOOP_STATE_DIR="$SMOKE/state" "$APP/Contents/Resources/runtime/node" --jitless "$APP/Contents/Resources/core/cli.mjs" snapshot </dev/null > "$SMOKE/snapshot.json"
"$APP/Contents/Resources/runtime/node" --jitless --input-type=module - "$SMOKE/snapshot.json" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const snapshot = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(snapshot.settings.preventSleep, true);
assert.equal(snapshot.settings.emailEnabled, false);
assert.ok(Array.isArray(snapshot.meters));
assert.ok(Array.isArray(snapshot.runs));
assert.ok(snapshot.policy);
console.log('Packaged runtime/core snapshot smoke passed (no provider calls).');
NODE
if /usr/bin/find "$APP" -type f \( -name '*.exe' -o -name '*.dll' -o -name '*.ps1' -o -name '*.bat' -o -name '*.cmd' \) | /usr/bin/grep -q .; then
  echo 'Unexpected platform dependency in the Mac bundle.' >&2; exit 1
fi
/usr/bin/ditto -c -k --keepParent "$APP" "$ROOT/dist/TeamLoop-macos-arm64.zip"
if [ -n "${NOTARY_PROFILE:-}" ]; then
  if [ "$IDENTITY" = "-" ]; then echo "Notarization requires a Developer ID signing identity." >&2; exit 1; fi
  /usr/bin/xcrun notarytool submit "$ROOT/dist/TeamLoop-macos-arm64.zip" --keychain-profile "$NOTARY_PROFILE" --wait
  /usr/bin/xcrun stapler staple "$APP"
  /usr/sbin/spctl --assess --type execute --verbose=2 "$APP"
  /usr/bin/ditto -c -k --keepParent "$APP" "$ROOT/dist/TeamLoop-macos-arm64.zip"
  /usr/bin/printf '%s\n' 'Developer ID signed and notarized; validate on a separate clean Mac before handing over.' > "$ROOT/dist/BUILD-STATUS.txt"
fi
echo "Built $APP"
/bin/cat "$ROOT/dist/BUILD-STATUS.txt"
