#!/usr/bin/env bash
# BL-570: property-suite drift guard — unit scenarios (injectable suite runner).
# Mirrors test_commit_size_guard.sh: drives the standalone script in a temp
# git repo; never a FORCE_RESULT env bypass in the production path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_property_suite_drift.sh"
PRE_COMMIT_HOOK="$SCRIPT_DIR/../../git-hooks/pre-commit"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

GREEN=(bash -c 'exit 0')
RED=(bash -c 'echo "FAIL extension/test/pipelineBoard.property.test.js" >&2; exit 1')
UNAVAIL=(bash -c 'exit 127')

stage() {
  local rel="$1"
  mkdir -p "$ROOT/$(dirname "$rel")"
  echo "v1" > "$ROOT/$rel"
  git -C "$ROOT" add "$rel"
}

# ── 01: docs-only staged path skips the suite ─────────────────────────────
stage docs/diagrams/architecture.md
set +e
OUT01="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST01=$?
set -e
[[ "$ST01" -eq 0 ]] || fail "01: docs-only must allow, got $ST01: $OUT01"
echo "$OUT01" | grep -q 'property-suite-guard: skip-paths' \
  || fail "01: expected skip-paths marker, got: $OUT01"
echo "$OUT01" | grep -q 'property-suite-guard: run' \
  && fail "01: must not run the suite for docs-only"
pass "01: docs-only staged path skips the property suite"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/docs"

# ── 02: extension/src triggers a green suite and allows ───────────────────
stage extension/src/pipelineBoard.ts
set +e
OUT02="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST02=$?
set -e
[[ "$ST02" -eq 0 ]] || fail "02: green suite must allow, got $ST02: $OUT02"
echo "$OUT02" | grep -q 'property-suite-guard: run' \
  || fail "02: expected run marker, got: $OUT02"
pass "02: extension/src with green suite allows"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 03: *.property.test.js triggers the suite ─────────────────────────────
stage extension/test/pipelineBoard.property.test.js
set +e
OUT03="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST03=$?
set -e
[[ "$ST03" -eq 0 ]] || fail "03: property test path must allow when green: $OUT03"
echo "$OUT03" | grep -q 'property-suite-guard: run' \
  || fail "03: expected run marker, got: $OUT03"
pass "03: *.property.test.js staged path runs the suite"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 04: red suite blocks and names the property file ──────────────────────
stage extension/src/pipelineBoard.ts
set +e
OUT04="$(cd "$ROOT" && bash "$GUARD" "${RED[@]}" 2>&1)"
ST04=$?
set -e
[[ "$ST04" -ne 0 ]] || fail "04: red suite must block"
echo "$OUT04" | grep -q 'pipelineBoard.property.test.js' \
  || fail "04: must name failing property file, got: $OUT04"
pass "04: red suite blocks and names the property test file"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 05: unavailable toolchain fails open with skipped warning ─────────────
stage extension/src/pipelineBoard.ts
set +e
OUT05="$(cd "$ROOT" && bash "$GUARD" "${UNAVAIL[@]}" 2>&1)"
ST05=$?
set -e
[[ "$ST05" -eq 0 ]] || fail "05: unavailable must allow, got $ST05: $OUT05"
echo "$OUT05" | grep -qi 'skipped' \
  || fail "05: must warn skipped, got: $OUT05"
pass "05: unavailable toolchain fails open with skipped warning"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 06: override allows a red suite with overridden warning ───────────────
stage extension/src/pipelineBoard.ts
set +e
OUT06="$(cd "$ROOT" && SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 bash "$GUARD" "${RED[@]}" 2>&1)"
ST06=$?
set -e
[[ "$ST06" -eq 0 ]] || fail "06: override must allow, got $ST06: $OUT06"
echo "$OUT06" | grep -qi 'overridden' \
  || fail "06: must warn overridden, got: $OUT06"
pass "06: override lets a red suite through with overridden warning"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 07: pre-commit wiring invokes the new guard (script must exist) ───────
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_property_suite_drift.sh"
cp "$SCRIPT_DIR/../property_suite_shared_repo_guard.sh" "$ROOT/swarmforge/scripts/property_suite_shared_repo_guard.sh"
cp "$SCRIPT_DIR/../check_commit_size.sh" "$ROOT/swarmforge/scripts/check_commit_size.sh"
cp "$SCRIPT_DIR/../check_ticket_deletion.sh" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$SCRIPT_DIR/../check_pipeline_code_on_main.sh" "$ROOT/swarmforge/scripts/check_pipeline_code_on_main.sh"
cp "$PRE_COMMIT_HOOK" "$ROOT/swarmforge/git-hooks/pre-commit"
chmod +x "$ROOT/swarmforge/scripts/"*.sh "$ROOT/swarmforge/git-hooks/pre-commit"
# Load-bearing: must be an executable line, not only the name in a comment
# (commenting out the call otherwise survives a bare grep -q).
grep -v '^[[:space:]]*#' "$ROOT/swarmforge/git-hooks/pre-commit" \
  | grep -q 'check_property_suite_drift\.sh' \
  || fail "07: pre-commit must invoke check_property_suite_drift.sh (non-comment)"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks
stage backlog/paused/BL-999-example.yaml
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m ordinary \
  || fail "07: ordinary commit must succeed with the property guard wired"
pass "07: pre-commit wires the property guard; docs/backlog commit still succeeds"

echo "ALL PASS"
