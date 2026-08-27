#!/usr/bin/env bash
# BL-1195 D1 (hardener bounce 20260828): coordinator and specifier are both
# master-resident (roles.tsv worktree-name "master") - the SAME physical
# checkout, not one-worktree-per-role like every other pipeline role. The
# worktree-drift guard's in-progress-task exemption only ever consulted the
# CURRENTLY INVOKING role's own in_process mailbox, so the coordinator's own
# turn - with no in_process parcel of its own - false-flagged the
# specifier's routine, legitimate, uncommitted WIP on `main` (Article 1.2
# spec/prompt drafting, no handoff parcel involved) as unexplained drift and
# refused (WORKTREE_DRIFT_DETECTED, exit 2). The reverse (specifier refused
# by coordinator's WIP) is symmetric. Every other pipeline role has its own
# dedicated `.worktrees/<role>`, so this shape is structurally impossible
# there - scenario 04/05 below cover ONLY the master-resident pairing;
# scenario 06 confirms a non-master role is unaffected. Real git fixture, no
# mocked git - same established pattern as test_worktree_drift_guard.sh
# (this file's sibling, which this file deliberately does not duplicate).

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
# real-roles.tsv worktree-name ("master" - the literal
# mailbox-base-dir/D1 check consults; hardener's own repro's roles.tsv used
# the role name in that column instead, which is not what production
# actually writes there and would have masked this exact bug behind an
# unrelated "no mailbox at all" empty-dir accident. See
# `.swarmforge/roles.tsv` in the live swarm for the real shape this
# mirrors.)
printf 'coordinator\tmaster\t%s\tmain\tCoordinator\tclaude\tguard-boundary-only\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tmain\tSpecifier\tclaude\tguard-boundary-only\n' "$ROOT" \
  >> "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT/.swarmforge/swarm-identity"

drop_handoff() {  # dir role name
  printf 'id: %s\nfrom: coder\nto: %s\nrecipient: %s\npriority: 00\ntype: git_handoff\ntask: BL-000-demo\ncommit: 0000000000\n\nbody for %s\n' \
    "$3" "$2" "$2" "$3" > "$1/00_$3.handoff"
}

run_ready() {  # <role> - sets OUT, ERR, RC
  set +e
  OUT="$(cd "$ROOT" && SWARMFORGE_ROLE="$1" bb "$READY" 2>"$ROOT/stderr.txt")"
  RC=$?
  set -e
  ERR="$(cat "$ROOT/stderr.txt")"
}

# ── scenario 04: specifier's own legitimate WIP must not refuse the ──────
# coordinator's turn, which has no in_process parcel of its own.
echo "specifier drafting a new ticket spec, mid-edit" > "$ROOT/$DRIFT_REL"
drop_handoff "$ROOT/.swarmforge/handoffs/specifier/inbox/in_process" specifier resume-spec
run_ready coordinator
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  && fail "04: coordinator must not be refused for specifier's own legitimate WIP on the shared master checkout, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "04: expected control to reach dispatch once specifier's in-progress task explains the shared checkout's drift, got rc=$RC err=$ERR"
pass "04: coordinator's own turn is not false-flagged for specifier's legitimate uncommitted WIP"

# ── scenario 05: symmetric - coordinator's own WIP must not refuse the ───
# specifier's turn either.
rm -f "$ROOT/.swarmforge/handoffs/specifier/inbox/in_process/00_resume-spec.handoff"
drop_handoff "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" coordinator resume-coord
run_ready specifier
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  && fail "05: specifier must not be refused for coordinator's own legitimate WIP on the shared master checkout, got: $ERR"
echo "$ERR" | grep -q "INVALID_RECEIVE_MODE" \
  || fail "05: expected control to reach dispatch once coordinator's in-progress task explains the shared checkout's drift, got rc=$RC err=$ERR"
pass "05: specifier's own turn is not false-flagged for coordinator's legitimate uncommitted WIP"

# ── scenario 06: with NEITHER master-resident role holding an in-progress ─
# task, the SAME drift is still correctly refused - this fix only widens
# the exemption's SOURCE, it never disables the guard itself.
rm -f "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process/00_resume-coord.handoff"
run_ready coordinator
[[ $RC -ne 0 ]] || fail "06: expected a refusal once no master-resident role has an in-progress task, rc=0 out=$OUT"
echo "$ERR" | grep -q "WORKTREE_DRIFT_DETECTED" \
  || fail "06: expected a drift report once no master-resident role has an in-progress task, got: $ERR"
pass "06: with no master-resident role's task explaining it, the SAME drift is still refused"

echo "ALL PASS"
