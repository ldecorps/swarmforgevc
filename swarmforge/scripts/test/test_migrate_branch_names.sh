#!/usr/bin/env bash
# BL-106: rehearses migrate_branch_names.sh against a scratch clone - never
# the live repo (the ticket's own non-behavioral gate: "migration rehearsed
# on a scratch clone before the live run"). Covers acceptance scenario
# BL-106 branch-ns-04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATE="$SCRIPT_DIR/../migrate_branch_names.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" commit -q --allow-empty -m init

WORKTREES="$ROOT/.worktrees"
mkdir -p "$WORKTREES"

# ── fixture: three worktrees on the two old mixed schemes ───────────────────
git -C "$ROOT" worktree add -q -b "swarmforge-coder" "$WORKTREES/coder" >/dev/null
git -C "$ROOT" worktree add -q -b "swarm/cleaner" "$WORKTREES/cleaner" >/dev/null
git -C "$ROOT" worktree add -q -b "primary/architect" "$WORKTREES/architect" >/dev/null

# A fully-merged stale duplicate of coder's branch (simulates the leftover
# swarm/<role> vs swarmforge-<role> pair the ticket names) - same HEAD as
# swarmforge-coder, so it is trivially "fully merged" into whatever coder's
# new branch becomes.
git -C "$ROOT" branch "swarm/coder" "swarmforge-coder"

# An UNMERGED stale duplicate for cleaner - has a commit swarm/cleaner (the
# branch actually in use) does not, so it must survive the prune.
git -C "$ROOT" worktree add -q -b "unmerged-scratch" "$WORKTREES/unmerged-scratch" >/dev/null
git -C "$WORKTREES/unmerged-scratch" commit -q --allow-empty -m "work nobody merged yet"
git -C "$ROOT" branch -m "unmerged-scratch" "swarmforge-cleaner"
git -C "$ROOT" worktree remove "$WORKTREES/unmerged-scratch"

CODER_HEAD_BEFORE="$(git -C "$WORKTREES/coder" rev-parse HEAD)"
CLEANER_HEAD_BEFORE="$(git -C "$WORKTREES/cleaner" rev-parse HEAD)"
ARCHITECT_HEAD_BEFORE="$(git -C "$WORKTREES/architect" rev-parse HEAD)"

mkdir -p "$ROOT/.swarmforge"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$WORKTREES/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$WORKTREES/cleaner" >> "$ROOT/.swarmforge/roles.tsv"
printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$WORKTREES/architect" >> "$ROOT/.swarmforge/roles.tsv"

OUT="$(bash "$MIGRATE" "$ROOT" "primary")"

# ── 01: a swarmforge-<role> branch is renamed, HEAD unchanged ──────────────
[[ "$(git -C "$WORKTREES/coder" rev-parse --abbrev-ref HEAD)" == "primary/coder" ]] \
  || fail "01: coder worktree is not on primary/coder"
[[ "$(git -C "$WORKTREES/coder" rev-parse HEAD)" == "$CODER_HEAD_BEFORE" ]] \
  || fail "01: coder's HEAD changed during migration - content/history must never move"
pass "01: swarmforge-coder renamed to primary/coder with identical HEAD"

# ── 02: a swarm/<role> branch is renamed too ────────────────────────────────
[[ "$(git -C "$WORKTREES/cleaner" rev-parse --abbrev-ref HEAD)" == "primary/cleaner" ]] \
  || fail "02: cleaner worktree is not on primary/cleaner"
[[ "$(git -C "$WORKTREES/cleaner" rev-parse HEAD)" == "$CLEANER_HEAD_BEFORE" ]] \
  || fail "02: cleaner's HEAD changed during migration"
pass "02: swarm/cleaner renamed to primary/cleaner with identical HEAD"

# ── 03: already-unified branch is left alone (idempotent) ──────────────────
[[ "$(git -C "$WORKTREES/architect" rev-parse --abbrev-ref HEAD)" == "primary/architect" ]] \
  || fail "03: architect worktree branch changed unexpectedly"
[[ "$(git -C "$WORKTREES/architect" rev-parse HEAD)" == "$ARCHITECT_HEAD_BEFORE" ]] \
  || fail "03: architect's HEAD changed"
grep -q "^OK: architect already on primary/architect$" <<< "$OUT" \
  || fail "03: expected an OK (no-op) report for architect; got: $OUT"
pass "03: a worktree already on the unified branch is left alone"

# ── 04: a fully-merged stale duplicate is pruned ────────────────────────────
git -C "$ROOT" show-ref --verify --quiet "refs/heads/swarm/coder" \
  && fail "04: fully-merged duplicate branch swarm/coder was not pruned"
grep -q "PRUNE: deleting fully-merged duplicate branch swarm/coder" <<< "$OUT" \
  || fail "04: expected a PRUNE report for swarm/coder; got: $OUT"
pass "04: a fully-merged stale duplicate branch is pruned"

# ── 05: an UNMERGED stale duplicate is left in place, reported, not deleted ─
git -C "$ROOT" show-ref --verify --quiet "refs/heads/swarmforge-cleaner" \
  || fail "05: unmerged duplicate branch swarmforge-cleaner was deleted - unmerged work must never be discarded"
grep -q "SKIP-PRUNE: swarmforge-cleaner is NOT fully merged" <<< "$OUT" \
  || fail "05: expected a SKIP-PRUNE report naming swarmforge-cleaner; got: $OUT"
pass "05: an unmerged stale duplicate branch survives the prune and is reported"

# ── 06: master/coordinator+specifier row has no worktree branch touched ────
[[ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" != "primary/master" ]] \
  || fail "06: the master checkout's own branch must never be touched by this migration"
pass "06: the master row (coordinator/specifier) is skipped, not treated as a worktree to rename"

# ── 07: two non-master roles sharing one physical worktree are processed once ─
# roles.tsv can list the same worktree_path under two role rows (mirrors how
# coordinator+specifier share master, but for a non-master worktree_name).
# Without the seen_worktrees guard, the second row would re-run the rename/
# prune steps against the same physical worktree, printing the RENAME line
# for that role again.
ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$ROOT2"' EXIT
git -C "$ROOT2" init -q
git -C "$ROOT2" config user.email "test@test"
git -C "$ROOT2" config user.name "test"
git -C "$ROOT2" commit -q --allow-empty -m init
mkdir -p "$ROOT2/.worktrees"
git -C "$ROOT2" worktree add -q -b "swarmforge-shared" "$ROOT2/.worktrees/shared" >/dev/null

mkdir -p "$ROOT2/.swarmforge"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT2"
  printf 'shared\tshared\t%s\tswarmforge-shared\tShared\tclaude\ttask\n' "$ROOT2/.worktrees/shared"
  printf 'shared2\tshared\t%s\tswarmforge-shared2\tShared2\tclaude\ttask\n' "$ROOT2/.worktrees/shared"
} > "$ROOT2/.swarmforge/roles.tsv"

OUT2="$(bash "$MIGRATE" "$ROOT2" "primary")"
RENAME_LINES="$(grep -c '^RENAME: ' <<< "$OUT2" || true)"
[[ "$RENAME_LINES" -eq 1 ]] \
  || fail "07: expected exactly one RENAME line for a worktree shared by two role rows; got $RENAME_LINES: $OUT2"
pass "07: two role rows pointing at the same physical worktree are migrated once, not twice"

echo "ALL PASS"
