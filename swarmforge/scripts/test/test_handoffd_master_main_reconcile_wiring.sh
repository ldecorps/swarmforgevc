#!/usr/bin/env bash
# BL-891: handoffd.bb's consolidated poll loop now also reconciles the
# master checkout's OWN `main` ref against origin, sharing the same cadence
# as every other *-sweep! above it (mirror-image direction of BL-356's
# push-sweep!). The DECISION/STATE logic itself (gating on a clean tree,
# self-healing surfaced-once state) is exhaustively covered by
# master_main_reconcile_lib_test_runner.bb (pure unit tests) and
# master_main_reconcile_lib_property_runner.bb (the ticket's 2 declared
# invariants, generator-based); this test only proves the real daemon
# reaches and fires master-main-reconcile-sweep! against a REAL git repo
# and a REAL local remote, on its own cadence - same "one real wiring
# proof, not re-run per scenario" posture as
# test_handoffd_push_sweep_wiring.sh, walking the ticket's own QA
# end-to-end procedure (a)-(d) against real git.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
source "$SCRIPT_DIR/../portable_daemon_spawn_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
REMOTE="$(cd "$(mktemp -d)" && pwd -P)"
CLONE="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT" "$REMOTE" "$CLONE"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

# ── a real bare remote, and a real master-checkout project-root ───────────
git init --quiet --bare "$REMOTE"
# The bare remote's HEAD defaults to whatever init.defaultBranch is (often
# "master") regardless of what branch is later pushed - point it at "main"
# up front so a later clone's own default-branch checkout resolves cleanly
# instead of warning "remote HEAD refers to nonexistent ref".
git -C "$REMOTE" symbolic-ref HEAD refs/heads/main

git init --quiet "$ROOT"
git -C "$ROOT" config user.email "test@example.com"
git -C "$ROOT" config user.name "Test"
git -C "$ROOT" checkout -q -b main
echo "first" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "seed commit"
git -C "$ROOT" remote add origin "$REMOTE"
git -C "$ROOT" push -q origin main

SOCK="$ROOT/fake.sock"
touch "$SOCK"

mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$ROOT	swarmforge-coordinator	Coordinator	claude	task
TSV

# Neutralize the unrelated briefing-generation sweep (already-generated
# today means morning-trigger-due? is false) - same technique
# test_handoffd_push_sweep_wiring.sh already uses.
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# ── ROOT must start with a CLEAN working tree once the daemon comes up -
#    this sweep judges "clean" via `git status --porcelain`, so the daemon's
#    own runtime scaffolding (.swarmforge/ state, the fixture's fake tmux
#    socket/bin) must be gitignored exactly like the real repo's own
#    .gitignore already does, and the briefing file committed, or every
#    tick would read as dirty before this test ever dirties anything on
#    purpose. ──────────────────────────────────────────────────────────────
cat > "$ROOT/.gitignore" <<'GITIGNORE'
.swarmforge/
bin/
fake.sock
GITIGNORE
git -C "$ROOT" add .gitignore docs/briefings
git -C "$ROOT" commit -q -m "fixture scaffold"
# Keep ROOT and origin in sync after the scaffold commit, so scenario 01
# below (no local-only commits yet) is a genuine pure fast-forward - not
# muddied by the scaffold commit itself counting as "local-only".
git -C "$ROOT" push -q origin main

# A SEPARATE clone, taken only NOW (after ROOT and origin are back in sync
# post-scaffold), stands in for QA's own worktree landing a commit by
# `git push origin HEAD:main` - this must never touch ROOT's own working
# tree or index, exactly like the real QA worktree can't.
git clone --quiet --branch main "$REMOTE" "$CLONE"
git -C "$CLONE" config user.email "qa@example.com"
git -C "$CLONE" config user.name "QA"

land_on_origin() {
  local marker="$1"
  echo "$marker" > "$CLONE/$marker.txt"
  git -C "$CLONE" add "$marker.txt"
  git -C "$CLONE" commit -q -m "QA lands $marker"
  git -C "$CLONE" push -q origin main
  git -C "$CLONE" rev-parse HEAD
}

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
portable_spawn_daemon_or_fail bb \
  env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT"
DAEMON_PID=$!

wait_for_log() {
  local pattern="$1" timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$LOG_FILE" ]] && grep -q "$pattern" "$LOG_FILE" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

wait_for_file() {
  local path="$1" timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$path" ]] && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

# ── scenario 04: the drift check is observable while divergence is small ──
wait_for_log "master-main-reconcile drift ahead=[0-9]* behind=0" 20 \
  || fail "expected the reconcile sweep to log the ahead/behind drift within 20s; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "the drift check reports both ahead and behind counts before it accumulates"

# ── scenario 01: a landed commit reaches the master checkout's main ref,
#    ROOT has no local-only commits yet, so this must be a pure fast-
#    forward - ROOT's main lands EXACTLY on the same sha origin has. ──────
LANDED_1_SHA="$(land_on_origin landed-1)"

wait_for_log "master-main-reconcile reconciled" 20 \
  || fail "the reconcile sweep never logged a successful reconcile within 20s; log: $(cat "$LOG_FILE" 2>/dev/null)"
wait_for_file "$ROOT/landed-1.txt" 5 \
  || fail "expected ROOT's working tree to contain the landed file after reconciling"

ROOT_HEAD_1="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_1" == "$LANDED_1_SHA" ]] \
  || fail "expected a pure fast-forward to the landed commit $LANDED_1_SHA, got $ROOT_HEAD_1"
pass "a landed commit reaches the master checkout's main ref via a pure fast-forward (no local-only commits yet)"

# ── the sweep never threw ──────────────────────────────────────────────────
grep -q "master-main-reconcile-sweep-error" "$LOG_FILE" && fail "the reconcile sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the reconcile sweep ran without throwing"

# ── an already-published main stays quiet on a later cycle (idempotent
#    re-run, the ticket's own QA procedure (c)) ────────────────────────────
wait_for_log "master-main-reconcile up-to-date" 15 \
  || fail "expected a later sweep to report up-to-date once reconciled, got: $(cat "$LOG_FILE")"
pass "a later sweep sees the reconciled state and changes nothing further"

# ── scenario 02: local-only bookkeeping commits are reconciled, not
#    discarded - ROOT gets its OWN local-only commit (coordinator/specifier
#    bookkeeping) while origin independently lands another commit, so the
#    two refs genuinely DIVERGE (both ahead and behind), exactly like the
#    ticket's own measured incident. ────────────────────────────────────────
echo "bookkeeping" > "$ROOT/backlog/done/BL-bookkeeping-test.yaml"
git -C "$ROOT" add backlog/done/BL-bookkeeping-test.yaml
git -C "$ROOT" commit -q -m "coordinator bookkeeping, local-only"
LOCAL_ONLY_SHA="$(git -C "$ROOT" rev-parse HEAD)"

LANDED_2_SHA="$(land_on_origin landed-2)"

wait_for_file "$ROOT/landed-2.txt" 20 \
  || fail "expected ROOT's working tree to contain landed-2 after the divergence was reconciled; log: $(cat "$LOG_FILE" 2>/dev/null)"

git -C "$ROOT" merge-base --is-ancestor "$LANDED_2_SHA" main \
  || fail "expected the second landed commit $LANDED_2_SHA to be an ancestor of ROOT's main"
git -C "$ROOT" merge-base --is-ancestor "$LOCAL_ONLY_SHA" main \
  || fail "expected the local-only bookkeeping commit $LOCAL_ONLY_SHA to STAY reachable from ROOT's main, not be discarded"
pass "a genuine two-way divergence reconciles with BOTH the landed commit and the local-only bookkeeping commit reachable"

git -C "$ROOT" rev-parse -q --verify main^2 > /dev/null \
  || fail "expected reconciling a genuine divergence to produce a real merge commit (2 parents), main has only 1"
pass "reconciling a genuine divergence produces a real merge commit, never a rewrite of local history"

# ── scenario 03: a master checkout that cannot be reconciled cleanly is
#    surfaced, never forced - a dirty working tree blocks the sweep
#    entirely, leaving the ref exactly where it was. ────────────────────────
LANDED_3_SHA="$(land_on_origin landed-3)"
ROOT_HEAD_BEFORE_DIRTY="$(git -C "$ROOT" rev-parse main)"
echo "uncommitted change" >> "$ROOT/seed.txt"

wait_for_log "master-main-reconcile dirty-blocked" 20 \
  || fail "expected the reconcile sweep to log dirty-blocked within 20s once the working tree was dirtied; log: $(cat "$LOG_FILE" 2>/dev/null)"
wait_for_log "master-main-reconcile-surfaced BL-891.*dirty" 10 \
  || fail "expected a surfaced note naming the dirty-tree reason; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "a dirty working tree blocks reconciliation and is surfaced with its reason"

# Give the daemon a couple more full cadence ticks to (wrongly) act, then
# confirm it genuinely never did - not just that it hasn't YET.
sleep 3
ROOT_HEAD_AFTER_DIRTY="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_AFTER_DIRTY" == "$ROOT_HEAD_BEFORE_DIRTY" ]] \
  || fail "expected ROOT's main to stay untouched while dirty, was $ROOT_HEAD_BEFORE_DIRTY now $ROOT_HEAD_AFTER_DIRTY"
DIRTY_STATUS="$(git -C "$ROOT" status --porcelain)"
[[ -n "$DIRTY_STATUS" ]] \
  || fail "expected the uncommitted change to still be present (never reset/stashed away)"
grep -q "master-main-reconcile conflict" "$LOG_FILE" \
  && fail "a dirty tree must never even attempt a merge, but a conflict outcome was logged: $(cat "$LOG_FILE")"
pass "no reset, stash, or force-update was ever performed while the tree was dirty - left byte-identical"

# ── resolving the dirty tree lets a later tick reconcile normally
#    (self-healing, not permanently stuck) ─────────────────────────────────
git -C "$ROOT" checkout -q -- seed.txt

wait_for_file "$ROOT/landed-3.txt" 20 \
  || fail "expected reconciliation to resume once the working tree was clean again; log: $(cat "$LOG_FILE" 2>/dev/null)"
git -C "$ROOT" merge-base --is-ancestor "$LANDED_3_SHA" main \
  || fail "expected the third landed commit $LANDED_3_SHA to reach ROOT's main once unblocked"
pass "reconciliation self-heals once the working tree is clean again, without any further landing"

echo "ALL SCENARIOS PASS"
