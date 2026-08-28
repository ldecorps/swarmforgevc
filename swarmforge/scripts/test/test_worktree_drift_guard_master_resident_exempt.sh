#!/usr/bin/env bash
# BL-1195 D1, re-fix round (architect bounce 20260828): the shared `master`
# checkout is a genuinely concurrent, multi-writer surface by DESIGN, not
# merely the coordinator+specifier pair - commit_integrity_lib.bb's own
# header names coordinator bookkeeping, the BL-topic-record writer, QA's
# fast-forward, the specifier, and operator_file_question.bb as all
# committing into ONE git index with no isolation, and several of those
# writers (Article 1.2 spec/prompt drafting, backlog bookkeeping) have no
# handoff parcel to point at even in principle. The coder's FIRST fix
# (union every master-resident role's in_process mailbox into the
# exemption) still refused whenever NEITHER master-resident role held a
# dispatched parcel - exactly hardener's own reproduction, which drops no
# handoff anywhere. This file's fix instead exempts master-resident
# worktrees from this guard's drift check entirely: a role whose own
# worktree-name is "master" is never refused for tracked drift, with or
# without an in-progress parcel. Every OTHER pipeline role keeps its own
# dedicated `.worktrees/<role>`, so the guard's full original detection
# value is retained there - see test_worktree_drift_guard.sh (this file's
# sibling, unchanged) for those scenarios. Real git fixture, no mocked git.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

install_scripts() {
  local wt="$1"
  mkdir -p "$wt/swarmforge/scripts"
  cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$wt/swarmforge/scripts/"
}

DRIFT_REL="seed.txt"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT

git -C "$ROOT" init -q -b main
mkdir -p "$ROOT/swarmforge/scripts"
echo "ORIGINAL: known-good content" > "$ROOT/$DRIFT_REL"
printf '.swarmforge/\n' > "$ROOT/.gitignore"
git -C "$ROOT" add "$DRIFT_REL" .gitignore
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m base
install_scripts "$ROOT"
READY="$ROOT/swarmforge/scripts/ready_for_next.bb"

mkdir -p "$ROOT/.swarmforge" \
         "$ROOT/.swarmforge/handoffs/coordinator/inbox/"{new,in_process,completed} \
         "$ROOT/.swarmforge/handoffs/specifier/inbox/"{new,in_process,completed}

# Both master-resident roles point at the SAME root path with the SAME
# real-roles.tsv worktree-name ("master" - the literal check
# `enforce-worktree-drift-guard!` consults).
printf 'coordinator\tmaster\t%s\tmain\tCoordinator\tclaude\tguard-boundary-only\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tmain\tSpecifier\tclaude\tguard-boundary-only\n' "$ROOT" \
  >> "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT/.swarmforge/swarm-identity"

run_ready() {  # <role> - sets OUT, ERR, RC
  set +e
  OUT="$(cd "$ROOT" && SWARMFORGE_ROLE="$1" bb "$READY" 2>"$ROOT/stderr.txt")"
  RC=$?
  set -e
  ERR="$(cat "$ROOT/stderr.txt")"
}

# ── scenario 04 (hardener's own reproduction, verbatim): specifier's own ─
# legitimate WIP, with NO handoff parcel dropped anywhere - the exact shape
# the coder's first fix still refused.
echo "specifier drafting a new ticket spec, mid-edit" > "$ROOT/$DRIFT_REL"
run_ready coordinator
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  && fail "04: coordinator must not be refused for specifier's own legitimate WIP with no parcel anywhere, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "04: expected control to reach dispatch on the shared master checkout even with no parcel explaining the drift, got rc=$RC err=$ERR"
pass "04: coordinator's own turn is not false-flagged for specifier's legitimate uncommitted WIP with no dispatched parcel anywhere"

# ── scenario 05: symmetric - specifier's own turn, same unexplained drift,
# same exemption.
run_ready specifier
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  && fail "05: specifier must not be refused for the shared master checkout's own drift either, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "05: expected control to reach dispatch, got rc=$RC err=$ERR"
pass "05: specifier's own turn is not false-flagged for the same shared-checkout drift"

# ── scenario 06: a non-master role (coder-shaped worktree-name) is ───────
# UNAFFECTED by the master carve-out - the SAME unexplained drift there is
# still refused. Reuses this fixture's own root as a second, non-master
# "worktree" row to prove the carve-out is keyed on worktree-name, not on
# role identity or on the physical path.
printf 'coder\tcoder\t%s\tmain\tCoder\tclaude\tguard-boundary-only\n' "$ROOT" \
  >> "$ROOT/.swarmforge/roles.tsv"
mkdir -p "$ROOT/.swarmforge/handoffs/inbox/"{new,in_process,completed}
run_ready coder
[[ $RC -ne 0 ]] || fail "06: expected a refusal for a non-master role's own unexplained drift, rc=0 out=$OUT"
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  || fail "06: expected a drift report for a non-master role, got: $ERR"
pass "06: a non-master role's own worktree keeps full drift detection - only master is exempted"

echo "ALL PASS"
