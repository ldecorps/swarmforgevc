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

git -C "$ROOT" init -q -b main
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
cp "$SCRIPT_DIR/../property_suite_standing_allowlist_lib.sh" "$ROOT/swarmforge/scripts/property_suite_standing_allowlist_lib.sh"
cp "$SCRIPT_DIR/../property_suite_standing_allowlist.tsv" "$ROOT/swarmforge/scripts/property_suite_standing_allowlist.tsv"
cp "$SCRIPT_DIR/../property_suite_shared_repo_guard.sh" "$ROOT/swarmforge/scripts/property_suite_shared_repo_guard.sh"
cp "$SCRIPT_DIR/../incoming_merge_parent_lib.sh" "$ROOT/swarmforge/scripts/incoming_merge_parent_lib.sh"
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

# ── 08: BL-1121 reconcile import (MERGE_HEAD + byte-identical) skips suite ─
# Fixture commits must not fire the repo's pre-commit (pipeline-code on main).
git -C "$ROOT" config core.hooksPath /dev/null
git -C "$ROOT" reset -q --hard HEAD
rm -rf "$ROOT/extension"
mkdir -p "$ROOT/extension/src"
echo "base" > "$ROOT/extension/src/pipelineBoard.ts"
git -C "$ROOT" add extension/src/pipelineBoard.ts
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m base-ext \
  || fail "08: base-ext commit failed"
git -C "$ROOT" checkout -q -b incoming
echo "imported" > "$ROOT/extension/src/pipelineBoard.ts"
git -C "$ROOT" add extension/src/pipelineBoard.ts
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m incoming-ext \
  || fail "08: incoming-ext commit failed"
INCOMING_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" checkout -q main
# Divergent tip so merge is not a fast-forward; keep local unrelated change.
mkdir -p "$ROOT/docs"
echo "local-only" > "$ROOT/docs/local.txt"
git -C "$ROOT" add docs/local.txt
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m local-docs \
  || fail "08: local-docs commit failed"
git -C "$ROOT" -c user.email=test@test -c user.name=test \
  merge --no-commit --no-ff "$INCOMING_SHA" >/dev/null 2>&1 \
  || fail "08: setup merge --no-commit must succeed"
set +e
OUT08="$(cd "$ROOT" && bash "$GUARD" "${RED[@]}" 2>&1)"
ST08=$?
set -e
[[ "$ST08" -eq 0 ]] || fail "08: reconcile import must allow without suite, got $ST08: $OUT08"
echo "$OUT08" | grep -q 'property-suite-guard: skip-reconcile-import' \
  || fail "08: expected skip-reconcile-import marker, got: $OUT08"
echo "$OUT08" | grep -q 'property-suite-guard: run' \
  && fail "08: must not run the suite for byte-identical import"
echo "$OUT08" | grep -qi 'overridden' \
  && fail "08: must not use recovery override for standing reconcile skip"
pass "08: MERGE_HEAD byte-identical import skips suite (not env override)"
git -C "$ROOT" merge --abort >/dev/null 2>&1 || git -C "$ROOT" reset -q --hard HEAD

# ── 09: ordinary extension/src commit still runs (invariant 2) ────────────
git -C "$ROOT" checkout -q main
rm -rf "$ROOT/extension"
mkdir -p "$ROOT/extension/src"
echo "fresh-edit" > "$ROOT/extension/src/pipelineBoard.ts"
git -C "$ROOT" add extension/src/pipelineBoard.ts
set +e
OUT09="$(cd "$ROOT" && bash "$GUARD" "${GREEN[@]}" 2>&1)"
ST09=$?
set -e
[[ "$ST09" -eq 0 ]] || fail "09: ordinary green suite must allow: $OUT09"
echo "$OUT09" | grep -q 'property-suite-guard: run' \
  || fail "09: ordinary commit must run the suite, got: $OUT09"
echo "$OUT09" | grep -q 'skip-reconcile-import' \
  && fail "09: ordinary commit must not claim reconcile-import skip"
pass "09: non-reconcile extension/src commit still runs the suite"

# ── 10: recovery override stays distinct from skip-reconcile-import ───────
set +e
OUT10="$(cd "$ROOT" && SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 bash "$GUARD" "${RED[@]}" 2>&1)"
ST10=$?
set -e
[[ "$ST10" -eq 0 ]] || fail "10: override must allow"
echo "$OUT10" | grep -qi 'overridden' \
  || fail "10: override path must warn overridden"
echo "$OUT10" | grep -q 'skip-reconcile-import' \
  && fail "10: override must not print skip-reconcile-import"
pass "10: SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD remains recovery-only (distinct marker)"

# ── 11: BL-1175 all-allowlisted standing reds allow without SKIP ─────────
stage extension/src/pipelineBoard.ts
ALLOWLISTED_RED=(bash -c 'printf "%s\n" " FAIL  test/bl632CommitTimeGuardInvariants.property.test.js > x" >&2; exit 1')
set +e
OUT11="$(cd "$ROOT" && bash "$GUARD" "${ALLOWLISTED_RED[@]}" 2>&1)"
ST11=$?
set -e
[[ "$ST11" -eq 0 ]] || fail "11: all-allowlisted reds must allow, got $ST11: $OUT11"
echo "$OUT11" | grep -q 'allowlisted-standing-reds' \
  || fail "11: expected allowlisted-standing-reds marker, got: $OUT11"
echo "$OUT11" | grep -qi 'overridden' \
  && fail "11: must not use SKIP override for allowlisted standing reds"
pass "11: all-allowlisted standing reds allow commit without SKIP"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 12: BL-1175 non-allowlisted red still blocks ─────────────────────────
stage extension/src/pipelineBoard.ts
MIXED_RED=(bash -c 'printf "%s\n" " FAIL  test/bl632CommitTimeGuardInvariants.property.test.js > x" " FAIL  test/pipelineBoard.property.test.js > y" >&2; exit 1')
set +e
OUT12="$(cd "$ROOT" && bash "$GUARD" "${MIXED_RED[@]}" 2>&1)"
ST12=$?
set -e
[[ "$ST12" -ne 0 ]] || fail "12: mixed allowlisted + non-allowlisted must block"
echo "$OUT12" | grep -q 'pipelineBoard.property.test.js' \
  || fail "12: must name non-allowlisted file, got: $OUT12"
echo "$OUT12" | grep -q 'non-allowlisted' \
  || fail "12: expected non-allowlisted rejection marker, got: $OUT12"
pass "12: non-allowlisted failure still blocks the commit"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 13: BL-1175 green parcel path — ordinary run still enforced ──────────
stage extension/src/pipelineBoard.ts
set +e
OUT13="$(cd "$ROOT" && bash "$GUARD" "${RED[@]}" 2>&1)"
ST13=$?
set -e
[[ "$ST13" -ne 0 ]] || fail "13: unallowlisted red must still block"
echo "$OUT13" | grep -q 'pipelineBoard.property.test.js' \
  || fail "13: must name failing property file, got: $OUT13"
pass "13: guard still refuses silent unallowlisted reds"
git -C "$ROOT" reset -q HEAD
rm -rf "$ROOT/extension"

# ── 14: BL-1175 extension/test/ FAIL path normalizes to allowlist key ─────
stage extension/src/pipelineBoard.ts
EXT_ALLOWLISTED_RED=(bash -c 'printf "%s\n" " FAIL  extension/test/bl632CommitTimeGuardInvariants.property.test.js > x" >&2; exit 1')
set +e
OUT14="$(cd "$ROOT" && bash "$GUARD" "${EXT_ALLOWLISTED_RED[@]}" 2>&1)"
ST14=$?
set -e
[[ "$ST14" -eq 0 ]] || fail "14: extension/test/ allowlisted FAIL must allow, got $ST14: $OUT14"
echo "$OUT14" | grep -q 'allowlisted-standing-reds' \
  || fail "14: expected allowlisted-standing-reds after normalize, got: $OUT14"
pass "14: extension/test/ FAIL path normalizes onto allowlist key"

echo "ALL PASS"
