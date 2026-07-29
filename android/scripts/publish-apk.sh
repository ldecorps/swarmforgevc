#!/usr/bin/env bash
# Publish the debug Float Companion APK to the Cloudflare-served public dir.
# Without this step, phones keep downloading a stale build (HTTP 304 / old bytes).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
DIST="$ROOT/android/dist"
PUBLIC="$ROOT/.swarmforge/operator/public"
if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC — run: cd android && ./gradlew :app:assembleDebug" >&2
  exit 1
fi
AAPT=$(ls "$ROOT/.swarmforge/android-sdk/build-tools/"*/aapt 2>/dev/null | head -1 || true)
VER="unknown"
if [[ -n "$AAPT" ]]; then
  VER=$("$AAPT" dump badging "$SRC" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
fi
SAFE_VER=${VER//\//-}
mkdir -p "$DIST" "$PUBLIC"
cp -f "$SRC" "$DIST/swarmforge-float-companion-debug.apk"
cp -f "$SRC" "$DIST/swarmforge-float-companion-${SAFE_VER}.apk"
cp -f "$SRC" "$PUBLIC/swarmforge-float-companion-debug.apk"
cp -f "$SRC" "$PUBLIC/swarmforge-float-companion-${SAFE_VER}.apk"
echo "Published $VER →"
ls -lh "$PUBLIC"/swarmforge-float-companion*.apk
echo "Prefer versioned URL path: /swarmforge-float-companion-${SAFE_VER}.apk (avoids CDN/browser 304 stale installs)"
