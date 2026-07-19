#!/usr/bin/env bash
# Covers the collision branch in handoff_inject_lib.bb's move-with-collision.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../handoff_inject_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/sent"
SOURCE="$ROOT/source.handoff"
TARGET="$ROOT/sent/source.handoff"
printf 'source' > "$SOURCE"
printf 'existing' > "$TARGET"

bb -e "(load-file \"$LIB\")
(require '[babashka.fs :as fs])
(let [source (fs/path \"$ROOT\" \"source.handoff\")
      target-dir (fs/path \"$ROOT\" \"sent\")
      target (fs/path target-dir \"source.handoff\")]
  (let [moved (handoff-inject-lib/move-with-collision source target-dir)]
    (when (fs/exists? source)
      (throw (Exception. \"source file should have been moved\")))
    (when-not (fs/exists? moved)
      (throw (Exception. \"moved target file should exist\")))
    (when (= (str moved) (str target))
      (throw (Exception. \"collision branch should rename the target file\")))
    (when (= (str moved) (str source))
      (throw (Exception. \"moved target should not remain at the original source path\")))))"

pass "collision branch renames an existing target instead of overwriting it"
echo "ALL PASS"
