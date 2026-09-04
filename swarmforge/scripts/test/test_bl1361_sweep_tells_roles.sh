#!/usr/bin/env bash
# BL-1361 e2e: the post-QA branch sweep TELLS the roles it could not settle.
#
# Drives the REAL sweep through the REAL send (swarm_handoff.bb) against real
# role worktrees, and reads the parcels that land in their mailboxes. BL-668's
# "surfaced to its role" was a log line for 125 surfacings; a test that read
# the log would have passed against that defect.
#
# BL-1242: independent guards do NOT run under `set -e`.
# BL-1390: no blind prefix sweep - the shared isolation helper owns $WORK.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FIXTURE_PREFIX="bl1361-sweep-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1361_SUITE_BOUND_SECONDS:-900}" "$@"
trap 'rm -rf "$WORK"' EXIT

in_fixture() {
  local dir="${1:-}"
  [[ -n "$dir" && "$dir" == "$WORK"/* && -d "$dir" ]] || return 1
  local common
  common="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in /*) [[ "$common" == "$WORK"/* ]] || return 1 ;; *) : ;; esac
}
g() { in_fixture "$1" || { fail "refusing git outside the fixture: '${1:-<empty>}'"; return 1; }; git -C "$1" "${@:2}"; }
gq() { g "$@" >/dev/null 2>&1; }

ROOT="$WORK/repo"
mkdir -p "$ROOT/.swarmforge/daemon" "$ROOT/swarmforge"
cp -R "$REPO_ROOT/swarmforge/scripts" "$WORK/shared-scripts" || fail "could not stage scripts"
ln -s "$WORK/shared-scripts" "$ROOT/swarmforge/scripts"

git init -q -b main "$ROOT"
for kv in user.email:t@t user.name:t commit.gpgsign:false; do g "$ROOT" config "${kv%%:*}" "${kv##*:}" >/dev/null; done
echo seed > "$ROOT/seed.txt"; gq "$ROOT" add -A; gq "$ROOT" commit -m seed
BASE="$(g "$ROOT" rev-parse HEAD)"

# Two role worktrees: one dirty (wakes), one merely divergent (deferred).
for role in cleaner architect; do
  gq "$ROOT" worktree add -q -b "swarmforge-$role" "$WORK/$role" "$BASE"
  for kv in user.email:t@t user.name:t commit.gpgsign:false; do g "$WORK/$role" config "${kv%%:*}" "${kv##*:}" >/dev/null; done
  mkdir -p "$ROOT/.swarmforge/handoffs/$role/inbox/new" \
           "$ROOT/.swarmforge/handoffs/$role/inbox/in_process" \
           "$ROOT/.swarmforge/handoffs/$role/inbox/completed"
done
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$WORK/cleaner"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$WORK/architect"
} > "$ROOT/.swarmforge/roles.tsv"

# What the daemon reads before any sweep: a socket path, today's briefing (so
# the unrelated briefing sweep is not due), and a fake tmux on PATH.
mkdir -p "$ROOT/docs/briefings" "$ROOT/bin" "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
         "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" \
         "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" \
         "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed"
echo "$ROOT/fake-socket" > "$ROOT/.swarmforge/tmux-socket"
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/$(date -u +%Y-%m-%d).md"
printf 'config active_backlog_max_depth 50\n' > "$ROOT/swarmforge/swarmforge.conf"
printf '#!/usr/bin/env bash\nexit 0\n' > "$ROOT/bin/tmux"; chmod +x "$ROOT/bin/tmux"

# cleaner: dirty. architect: its own commit, so it cannot fast-forward.
echo dirt > "$WORK/cleaner/dirty.txt"
echo own > "$WORK/architect/own.txt"; gq "$WORK/architect" add -A; gq "$WORK/architect" commit -m "architect's own work"

# A landed commit on main that both are behind.
echo landed > "$ROOT/landed.txt"; gq "$ROOT" add -A; gq "$ROOT" commit -m "QA: landed"
LANDED="$(g "$ROOT" rev-parse HEAD)"
gq "$ROOT" update-ref refs/remotes/origin/main "$LANDED"

# The REAL daemon, one sweep pass. post_qa_branch_sweep_cli.bb is BL-668's
# acceptance seam with FAKE adapters - it cannot exercise the send this ticket
# adds, and a test that drove it would report green for a role nobody told,
# which is the very defect here.
run_sweep() {
  ( cd "$ROOT" && SWARMFORGE_ALLOW_TMP_DAEMON=1 PATH="$ROOT/bin:$PATH" \
      timeout 300 bb "$WORK/shared-scripts/handoffd.bb" "$ROOT" --post-qa-sweep-once \
      >"$WORK/sweep$1.out" 2>"$WORK/sweep$1.err" )
}

# The parcel, wherever delivery put it: a fixture has no live swarm, so a
# delivered note may rest in the sender's sent/ rather than the recipient's
# inbox. What matters for this ticket is that a real parcel addressed to the
# role exists at all - BL-668's "surfacing" was a log line and nothing else.
notes_for() {
  grep -rl "to: $1" "$ROOT/.swarmforge/handoffs" --include='*.handoff' 2>/dev/null \
    | xargs cat 2>/dev/null
}
note_count() {
  grep -rl "to: $1" "$ROOT/.swarmforge/handoffs" --include='*.handoff' 2>/dev/null | wc -l | tr -d ' '
}
daemon_log() { cat "$ROOT/.swarmforge/daemon"/*.log 2>/dev/null; }

run_sweep 1
if [[ "$(note_count cleaner)" == "1" ]]; then
  pass "the surfaced dirty role is told exactly once"
else
  fail "cleaner got $(note_count cleaner) notes; sweep said: $(tail -3 "$WORK/sweep1.err" 2>/dev/null)"
fi
if grep -q "$(echo "$LANDED" | cut -c1-10)" <<<"$(notes_for cleaner)"; then
  pass "and the message names the landed commit"
else
  fail "the note does not name the landed commit: $(notes_for cleaner | tail -2)"
fi
if grep -q 'dirty worktree' <<<"$(notes_for cleaner)"; then
  pass "and the reason it was surfaced"
else
  fail "the note does not name the reason"
fi
if [[ "$(note_count architect)" == "1" ]]; then
  pass "a divergent role is told too (told for every reason)"
else
  fail "architect got $(note_count architect) notes"
fi
# The human's ruling: told for every reason, WOKEN only for a dirty worktree.
if daemon_log | grep -q 'post-qa-branch-sweep-told cleaner dirty-worktree woken'; then
  pass "the dirty role is WOKEN - the one reason that does not resolve itself"
else
  fail "the dirty role was not woken: $(daemon_log | grep post-qa-branch-sweep-told | tail -2)"
fi
if daemon_log | grep -q 'post-qa-branch-sweep-told architect divergent-branch deferred'; then
  pass "the divergent role is told but DEFERRED - its next parcel merges it anyway"
else
  fail "the divergent role was not deferred: $(daemon_log | grep post-qa-branch-sweep-told | tail -2)"
fi

before_cleaner="$(note_count cleaner)"; before_architect="$(note_count architect)"
run_sweep 2
if [[ "$(note_count cleaner)" == "$before_cleaner" && "$(note_count architect)" == "$before_architect" ]]; then
  pass "a repeat sweep of the same state tells nobody a second time"
else
  fail "a repeat sweep sent more notes"
fi

# Invariant 1: nothing was merged, reset, rebased or stashed; the surfaced
# worktrees are exactly as they were.
if [[ -f "$WORK/cleaner/dirty.txt" ]] && [[ -n "$(g "$WORK/cleaner" status --porcelain 2>/dev/null)" ]]; then
  pass "the dirty worktree is untouched - still dirty, nothing stashed"
else
  fail "the sweep touched the dirty worktree"
fi
if [[ "$(g "$WORK/architect" log -1 --format=%s)" == "architect's own work" ]]; then
  pass "the divergent branch is untouched - no merge, reset or rebase"
else
  fail "the divergent branch was moved: $(g "$WORK/architect" log -1 --format=%s)"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
