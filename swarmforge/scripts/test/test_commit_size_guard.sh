#!/usr/bin/env bash
# BL-105: the commit size guard rejects any staged file over the configured
# threshold (default 50 MB), naming the offending file and its size, so
# GitHub's 100 MB hard object-size limit can never be silently exceeded
# again the way extension/stryker-incremental.json (113.69 MB) was.
# Covers BL-105 hygiene-03/04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIVE_REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUARD="$SCRIPT_DIR/../check_commit_size.sh"
IS_QA_ANCESTOR="$SCRIPT_DIR/../is_qa_ancestor.sh"
HELPER="$LIVE_REPO_ROOT/extension/test/helpers/commitGuardFixtureSet.js"

# BL-1484: an optional first argument naming a scratch repo root to derive
# the copy set from (the $1 seam shape test_run_commit_guards.sh's own
# runner-path argument uses) - a handler's seam scenario builds one under
# mkdtemp with an extra guard planted. The live repo is the default and is
# never written by this test.
DERIVE_ROOT="${1:-$LIVE_REPO_ROOT}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

# ── 1: a small staged file passes ───────────────────────────────────────────
echo "small content" > "$ROOT/small.txt"
git -C "$ROOT" add small.txt
(cd "$ROOT" && bash "$GUARD" 50) || fail "01: a small staged file must pass the guard"
pass "01: a small staged file passes the size guard"

# ── 2: a file over the threshold (using a low threshold to avoid actually
#       writing 50MB in a test) is rejected, naming the file and its size ──
dd if=/dev/zero of="$ROOT/oversized.bin" bs=1024 count=2048 >/dev/null 2>&1
git -C "$ROOT" add oversized.bin
set +e
OUT="$(cd "$ROOT" && bash "$GUARD" 1 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "02: expected the guard to reject a file over the threshold"
echo "$OUT" | grep -q "oversized.bin" || fail "02: error must name the offending file, got: $OUT"
echo "$OUT" | grep -qi "MB" || fail "02: error must state a size, got: $OUT"
pass "02: an oversized staged file is rejected, naming the file and its size"

git -C "$ROOT" reset -q oversized.bin
rm -f "$ROOT/oversized.bin"

# ── 3: default threshold (50 MB) lets an ordinary-sized file through ───────
dd if=/dev/zero of="$ROOT/medium.bin" bs=1024 count=100 >/dev/null 2>&1
git -C "$ROOT" add medium.bin
(cd "$ROOT" && bash "$GUARD") || fail "03: a 100KB file must pass the default 50MB threshold"
pass "03: the default threshold does not flag an ordinary-sized file"
git -C "$ROOT" reset -q medium.bin
rm -f "$ROOT/medium.bin"

# ── 4: wired as a real git pre-commit hook via core.hooksPath, an actual
#       `git commit` is blocked - not just the standalone script ──────────
# BL-1484: every file the pre-commit chain needs (the runner, the chain lib,
# every guard the runner names, and the libs those source), read at run time
# through BL-1398's helper - never an enumerated `cp` per guard, which is
# what let the runner's own file (run_commit_guards.sh, BL-1252) go
# uncopied here while the hook that `exec`s it was copied verbatim, dying
# "No such file or directory" on every real commit (red since 2026-08-30).
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
CHAIN_FILES="$(node -e '
  const { deriveCommitGuardFixtureSet } = require(process.argv[1]);
  const r = deriveCommitGuardFixtureSet({ repoRoot: process.argv[2], hookRels: ["swarmforge/git-hooks/pre-commit"] });
  process.stdout.write(r.files.join("\n"));
' "$HELPER" "$DERIVE_ROOT")"
echo "derived copy set: $(echo "$CHAIN_FILES" | tr '\n' ' ')"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  mkdir -p "$ROOT/$(dirname "$rel")"
  cp "$DERIVE_ROOT/$rel" "$ROOT/$rel"
done <<< "$CHAIN_FILES"
# An EMPTY step registry, so BL-1303's guard asks its real question here
# rather than refusing every commit because a repo with no acceptance
# pipeline has no registry to read (BL-1408's worked example). Its compiled
# checker resolves relative to the guard's own script dir, so link the real
# out tree beside the copied guard.
mkdir -p "$ROOT/specs/pipeline/steps" "$ROOT/extension"
printf 'module.exports = [];\n' > "$ROOT/specs/pipeline/steps/index.js"
ln -s "$SCRIPT_DIR/../../../extension/out" "$ROOT/extension/out" 2>/dev/null || true
# is_qa_ancestor.sh: invoked by check_pipeline_code_on_main.sh as a
# subprocess, never `run_guard`'d or `source`'d - outside the derived
# chain-list class this ticket is about (a single fixed dependency, not a
# hand-enumerated list that drifts as the chain grows).
cp "$IS_QA_ANCESTOR" "$ROOT/swarmforge/scripts/is_qa_ancestor.sh"
chmod +x "$ROOT/swarmforge/scripts/"*.sh "$ROOT/swarmforge/git-hooks/pre-commit"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks

dd if=/dev/zero of="$ROOT/blob.bin" bs=1048576 count=51 >/dev/null 2>&1
git -C "$ROOT" add blob.bin
set +e
OUT4="$(cd "$ROOT" && git -c user.email=test@test -c user.name=test commit -q -m "oversized" 2>&1)"
STATUS4=$?
set -e
[[ "$STATUS4" -ne 0 ]] || fail "04: expected the real git commit to be blocked by the installed pre-commit hook"
echo "$OUT4" | grep -q "blob.bin" || fail "04: hook output must name the offending file, got: $OUT4"
pass "04: an installed pre-commit hook (core.hooksPath) blocks a real git commit introducing an oversized file"

# ── 5: with the hook installed, an ordinary commit still succeeds ─────────
git -C "$ROOT" reset -q blob.bin
rm -f "$ROOT/blob.bin"
echo "ordinary content" > "$ROOT/ordinary.txt"
git -C "$ROOT" add ordinary.txt
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "ordinary" \
  || fail "05: an ordinary commit must still succeed with the guard hook installed"
pass "05: the installed hook does not block an ordinary commit"

echo "ALL PASS"
