#!/usr/bin/env bash
# BL-106 branch-ns-03: check_branch_namespace.bb fails fast, naming the
# expected branch, when a role worktree's branch is outside its swarm's
# namespace; passes silently once every role matches.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK="$SCRIPT_DIR/../check_branch_namespace.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" commit -q --allow-empty -m init

CODER_WT="$ROOT/.worktrees/coder"
mkdir -p "$ROOT/.worktrees"
git -C "$ROOT" worktree add -q -b "swarmforge-coder" "$CODER_WT" >/dev/null

mkdir -p "$ROOT/.swarmforge"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" >> "$ROOT/.swarmforge/roles.tsv"

# ── 01: default (primary) swarm, still on the old scheme -> fails fast ─────
set +e
OUT="$(bb "$CHECK" "$ROOT" 2>&1)"
RC=$?
set -e
[[ "$RC" != 0 ]] || fail "01: expected a nonzero exit for a mismatched branch; got 0"
grep -q 'MISMATCH: role coder is on branch "swarmforge-coder", expected "primary/coder"' <<< "$OUT" \
  || fail "01: expected a MISMATCH line naming the expected branch; got: $OUT"
pass "01: a worktree outside its swarm's namespace fails fast, naming the expected branch"

# ── 02: after renaming to the unified scheme, the check passes ─────────────
git -C "$ROOT" branch -m "swarmforge-coder" "primary/coder"
OUT="$(bb "$CHECK" "$ROOT")"
echo "$OUT" | grep -q "^OK: every role worktree branch matches the primary/<role> namespace$" \
  || fail "02: expected an OK report once every branch matches; got: $OUT"
pass "02: every role worktree on its unified branch passes silently"

# ── 03: a non-default swarm_name is honored ─────────────────────────────────
git -C "$ROOT" branch -m "primary/coder" "alpha/coder"
printf 'swarm_name\talpha\nswarm_mode\tautonomous\nswarm_mode_primary\talpha\n' > "$ROOT/.swarmforge/swarm-identity"
OUT="$(bb "$CHECK" "$ROOT")"
echo "$OUT" | grep -q "^OK: every role worktree branch matches the alpha/<role> namespace$" \
  || fail "03: expected the check to honor a non-default swarm_name; got: $OUT"
pass "03: a non-default swarm_name namespace is checked, not just the primary default"

echo "ALL PASS"
