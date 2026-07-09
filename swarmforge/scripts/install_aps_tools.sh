#!/usr/bin/env bash
# BL-111: fetches the pinned Babashka APS tools (gherkin-parser, the IR-DRY
# checker) from unclebob/Acceptance-Pipeline-Specification at the exact
# commit recorded in swarmforge.lock.json, and vendors them under
# swarmforge/vendor/aps/ so the gate scripts and lint gate never need
# network access at run time.
#
# Never resolves "latest" - the pin is read from the lock file, and the
# checked-out commit is verified to match it before anything is copied into
# place. Bumping the pin is a human commit (engineering.prompt); this
# script only ever re-vendors at whatever SHA the lock file currently
# names, and running it again is idempotent (re-vendors cleanly).
#
# Only the Babashka implementation (bb.edn + bb/) is vendored, per
# engineering.prompt: "Prefer the Babashka APS tools; use the Go tools only
# if the Babashka ones fail in this environment."
#
# Usage: install_aps_tools.sh [repo-root]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
LOCK_FILE="$ROOT/swarmforge.lock.json"
VENDOR_DIR="$ROOT/swarmforge/vendor/aps"

[[ -f "$LOCK_FILE" ]] || { echo "Error: $LOCK_FILE not found" >&2; exit 1; }

REPO_URL="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['aps']['repo'])" "$LOCK_FILE")"
PINNED_SHA="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['aps']['commit'])" "$LOCK_FILE")"

TMP_CLONE="$(mktemp -d)"
trap 'rm -rf "$TMP_CLONE"' EXIT

git clone --quiet "$REPO_URL" "$TMP_CLONE"
git -C "$TMP_CLONE" checkout --quiet "$PINNED_SHA"

ACTUAL_SHA="$(git -C "$TMP_CLONE" rev-parse HEAD)"
if [[ "$ACTUAL_SHA" != "$PINNED_SHA" ]]; then
  echo "Error: checked-out commit $ACTUAL_SHA does not match the pinned $PINNED_SHA in $LOCK_FILE" >&2
  exit 1
fi

[[ -f "$TMP_CLONE/bb.edn" ]] || { echo "Error: pinned commit has no bb.edn at repo root" >&2; exit 1; }
[[ -d "$TMP_CLONE/bb" ]] || { echo "Error: pinned commit has no bb/ directory" >&2; exit 1; }

rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"
cp "$TMP_CLONE/bb.edn" "$VENDOR_DIR/bb.edn"
cp -r "$TMP_CLONE/bb" "$VENDOR_DIR/bb"

echo "Vendored APS tools at $PINNED_SHA into $VENDOR_DIR"
