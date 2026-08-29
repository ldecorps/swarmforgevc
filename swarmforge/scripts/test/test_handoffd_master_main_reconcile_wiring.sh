#!/usr/bin/env bash
# BL-891: handoffd.bb's consolidated poll loop reconciles the master
# checkout's OWN `main` ref against origin, sharing the same cadence as
# every other *-sweep! above it (mirror-image direction of BL-356's
# push-sweep!). BL-919 narrowed the gate: a dirty tree only blocks when a
# dirty path actually overlaps a path the incoming merge would change.
# BL-920 adds a second, additive signal: a block that PERSISTS past the
# coordinator's first-tick note escalates once to the operator (Telegram
# OPERATOR topic + email).
#
# The DECISION/STATE logic itself (gating on dirty/merge-changed path
# overlap, self-healing surfaced-once state, BL-920's tick-persistence/
# escalate-once state machine) is exhaustively covered by
# master_main_reconcile_lib_test_runner.bb (pure unit tests) and
# master_main_reconcile_lib_property_runner.bb (BL-891's, BL-919's, and
# BL-920's own declared invariants, generator-based); this test only proves
# the real daemon reaches and fires master-main-reconcile-sweep! - and, for
# BL-920, its new :escalate! adapter - against a REAL git repo and a REAL
# local remote, on its own cadence - same "one real wiring proof, not
# re-run per scenario" posture as test_handoffd_push_sweep_wiring.sh,
# walking BL-919's own qa_e2e_procedure (a)-(f) against real git, plus
# BL-920's own qa_e2e_procedure step 2 (persistent-block escalation).

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
#    this sweep judges dirt via `git status --porcelain`, so the daemon's
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

# BL-1248: the shipped swarmforge/swarmforge.conf now ships the sweep OFF
# by default - this fixture exists to prove the reconcile mechanics
# themselves (BL-891/919/920), so it must explicitly opt back in, exactly
# like a real operator would via a one-line config edit. Committed (not
# gitignored) so the working tree reads clean before the daemon starts,
# same posture as docs/briefings above.
mkdir -p "$ROOT/swarmforge"
echo "config master_main_reconcile_enabled true" > "$ROOT/swarmforge/swarmforge.conf"
git -C "$ROOT" add .gitignore docs/briefings swarmforge/swarmforge.conf
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

land_new_file() {
  local marker="$1"
  git -C "$CLONE" pull -q origin main
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

# Content-based, unlike wait_for_log: "master-main-reconcile reconciled" is
# a generic log line that recurs across every scenario in this file, so
# waiting for its mere PRESENCE in the accumulated log is a false-pass once
# any earlier scenario has already reconciled once. Waiting for the actual
# observable outcome (the file containing what only a successful reconcile
# could have put there) is unambiguous regardless of scenario order.
wait_for_content() {
  local path="$1" pattern="$2" timeout_s="$3" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$path" ]] && grep -q "$pattern" "$path" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

# ── scenario 04 (qa_e2e_procedure not applicable - inherited from BL-891):
#    the drift check is observable while divergence is small ─────────────
wait_for_log "master-main-reconcile drift ahead=[0-9]* behind=0" 20 \
  || fail "expected the reconcile sweep to log the ahead/behind drift within 20s; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "the drift check reports both ahead and behind counts before it accumulates"

# ── scenario 01 (qa_e2e_procedure d): a landed commit reaches the master
#    checkout's main ref, ROOT has no local-only commits yet, so this must
#    be a pure fast-forward - ROOT's main lands EXACTLY on the same sha
#    origin has. ─────────────────────────────────────────────────────────
LANDED_1_SHA="$(land_new_file landed-1)"

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
#    re-run, the ticket's own QA procedure (d)) ────────────────────────────
wait_for_log "master-main-reconcile up-to-date" 15 \
  || fail "expected a later sweep to report up-to-date once reconciled, got: $(cat "$LOG_FILE")"
pass "a later sweep sees the reconciled state and changes nothing further"

# ── scenario 02 (qa_e2e_procedure d): local-only bookkeeping commits are
#    reconciled, not discarded - ROOT gets its OWN local-only commit
#    (coordinator/specifier bookkeeping) while origin independently lands
#    another commit, so the two refs genuinely DIVERGE (both ahead and
#    behind), exactly like the ticket's own measured incident. ────────────
echo "bookkeeping" > "$ROOT/backlog/done/BL-bookkeeping-test.yaml"
git -C "$ROOT" add backlog/done/BL-bookkeeping-test.yaml
git -C "$ROOT" commit -q -m "coordinator bookkeeping, local-only"
LOCAL_ONLY_SHA="$(git -C "$ROOT" rev-parse HEAD)"

LANDED_2_SHA="$(land_new_file landed-2)"

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

# ── scenario A (qa_e2e_procedure 1, the ticket's own existence proof): a
#    dirty tree whose dirty path does NOT overlap what the incoming merge
#    would change reconciles exactly like a clean tree would - the whole
#    point of BL-919. seed.txt is untouched by landed-3 (a new file), so
#    dirtying seed.txt must NOT block. Dirtied BEFORE landing (not after) so
#    there is no window where the daemon could observe a still-clean tree
#    and reconcile before this scenario's own dirt is even in place. ──────
echo "root-local-dirty-edit" >> "$ROOT/seed.txt"
SEED_DIRTY_CONTENT_BEFORE="$(cat "$ROOT/seed.txt")"
LANDED_3_SHA="$(land_new_file landed-3)"

wait_for_file "$ROOT/landed-3.txt" 20 \
  || fail "expected ROOT's working tree to contain landed-3 - a non-overlapping dirty tree must still reconcile; log: $(cat "$LOG_FILE" 2>/dev/null)"
git -C "$ROOT" merge-base --is-ancestor "$LANDED_3_SHA" main \
  || fail "expected landed-3 to be reachable from ROOT's main; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "a dirty tree whose dirty path does not overlap the incoming merge reconciles (BL-919's own existence proof)"

SEED_DIRTY_CONTENT_AFTER="$(cat "$ROOT/seed.txt")"
[[ "$SEED_DIRTY_CONTENT_BEFORE" == "$SEED_DIRTY_CONTENT_AFTER" ]] \
  || fail "expected the non-overlapping dirty file to stay byte-identical through the reconcile, was [$SEED_DIRTY_CONTENT_BEFORE] now [$SEED_DIRTY_CONTENT_AFTER]"
SEED_STATUS="$(git -C "$ROOT" status --porcelain -- seed.txt)"
[[ -n "$SEED_STATUS" ]] \
  || fail "expected seed.txt's uncommitted dirt to still show in git status after reconciling (never silently committed or discarded)"
pass "the non-overlapping dirty file survives the reconcile byte-identical and still uncommitted"

git -C "$ROOT" checkout -q -- seed.txt

# ── scenario B (qa_e2e_procedure 2): a dirty path that the incoming merge
#    DOES change blocks reconciliation entirely, and the surfaced note
#    names the offending path. Dirtied BEFORE landing (not after), same
#    race-window reasoning as scenario A. ──────────────────────────────────
ROOT_HEAD_BEFORE_OVERLAP="$(git -C "$ROOT" rev-parse main)"
echo "root-conflicting-local-edit" >> "$ROOT/seed.txt"

git -C "$CLONE" pull -q origin main
echo "origin-changes-seed" >> "$CLONE/seed.txt"
git -C "$CLONE" add seed.txt
git -C "$CLONE" commit -q -m "QA lands landed-4 (modifies seed.txt)"
git -C "$CLONE" push -q origin main
LANDED_4_SHA="$(git -C "$CLONE" rev-parse HEAD)"

wait_for_log "master-main-reconcile-surfaced BL-891.*seed.txt" 20 \
  || fail "expected a surfaced note naming seed.txt as the overlapping dirty path; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "a dirty path the incoming merge also changes blocks reconciliation, and the surfaced note names it"

# Give the daemon a couple more full cadence ticks to (wrongly) act, then
# confirm it genuinely never did - not just that it hasn't YET.
sleep 3
ROOT_HEAD_AFTER_OVERLAP="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_AFTER_OVERLAP" == "$ROOT_HEAD_BEFORE_OVERLAP" ]] \
  || fail "expected ROOT's main to stay untouched while overlap-blocked, was $ROOT_HEAD_BEFORE_OVERLAP now $ROOT_HEAD_AFTER_OVERLAP"
grep -q "master-main-reconcile-sweep-error" "$LOG_FILE" && fail "the reconcile sweep threw while overlap-blocked; got: $(cat "$LOG_FILE")"
LOCAL_EDIT_STILL_PRESENT="$(grep -c "root-conflicting-local-edit" "$ROOT/seed.txt" || true)"
[[ "$LOCAL_EDIT_STILL_PRESENT" -ge 1 ]] \
  || fail "expected the overlapping local edit to survive untouched while blocked (never reset/stashed away)"
pass "an overlapping dirty path is never touched while blocked - no reset, stash, or force-update, no merge attempted"

# ── BL-920: the block above has now sat through several 1s-cadence poll
#    ticks (the surfaced-note wait plus the 3s hold above) - well past the
#    default escalation threshold of 3 consecutive ticks. Confirm the
#    operator escalation actually fires end-to-end (real daemon, real
#    Telegram-outbox file write), additive to the coordinator note already
#    asserted above (qa_e2e_procedure step 2). ────────────────────────────
wait_for_log "master-main-reconcile-escalation dirty" 20 \
  || fail "expected a dirty block persisting past the escalation threshold to escalate to the operator (BL-920); log: $(cat "$LOG_FILE" 2>/dev/null)"
wait_for_content "$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl" "dirty-blocked" 5 \
  || fail "expected the operator escalation to reach the Telegram OPERATOR-topic outbox"
pass "a dirty block persisting past the escalation threshold escalates to the operator, additive to the first-tick coordinator note (BL-920)"

# ── resolving the overlap lets a later tick reconcile normally
#    (self-healing, not permanently stuck) ─────────────────────────────────
git -C "$ROOT" checkout -q -- seed.txt

wait_for_content "$ROOT/seed.txt" "origin-changes-seed" 20 \
  || fail "expected reconciliation to resume once the overlapping path was clean again; log: $(cat "$LOG_FILE" 2>/dev/null)"
git -C "$ROOT" merge-base --is-ancestor "$LANDED_4_SHA" main \
  || fail "expected landed-4 (the seed.txt-modifying commit) to reach ROOT's main once unblocked"
pass "reconciliation self-heals once the overlapping path is clean again, without any further landing"

# ── scenario C (qa_e2e_procedure 3): an untracked file sitting exactly
#    where the incoming merge would create one blocks reconciliation rather
#    than letting a real `git merge` fail mid-operation. Created BEFORE
#    landing (not after), same race-window reasoning as scenario A. ───────
ROOT_HEAD_BEFORE_CLASH="$(git -C "$ROOT" rev-parse main)"
echo "local-untracked-content" > "$ROOT/clash.txt"

git -C "$CLONE" pull -q origin main
echo "origin-clash-content" > "$CLONE/clash.txt"
git -C "$CLONE" add clash.txt
git -C "$CLONE" commit -q -m "QA lands landed-5 (adds clash.txt)"
git -C "$CLONE" push -q origin main
LANDED_5_SHA="$(git -C "$CLONE" rev-parse HEAD)"

wait_for_log "master-main-reconcile-surfaced BL-891.*clash.txt" 20 \
  || fail "expected a surfaced note naming clash.txt as the overlapping untracked path; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "an untracked file clashing with a path the incoming merge would create blocks reconciliation, named in the surfaced note"

sleep 3
ROOT_HEAD_AFTER_CLASH="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_AFTER_CLASH" == "$ROOT_HEAD_BEFORE_CLASH" ]] \
  || fail "expected ROOT's main to stay untouched while the untracked clash was blocked, was $ROOT_HEAD_BEFORE_CLASH now $ROOT_HEAD_AFTER_CLASH"
CLASH_CONTENT="$(cat "$ROOT/clash.txt")"
[[ "$CLASH_CONTENT" == "local-untracked-content" ]] \
  || fail "expected the untracked clash.txt to stay exactly as the local file left it, got [$CLASH_CONTENT]"
pass "an untracked-file clash is refused up front rather than letting a real git merge fail mid-operation"

rm "$ROOT/clash.txt"

wait_for_file "$ROOT/clash.txt" 20 \
  || fail "expected reconciliation to resume once the untracked clash was removed; log: $(cat "$LOG_FILE" 2>/dev/null)"
git -C "$ROOT" merge-base --is-ancestor "$LANDED_5_SHA" main \
  || fail "expected landed-5 (the clash.txt-adding commit) to reach ROOT's main once unblocked"
CLASH_CONTENT_AFTER="$(cat "$ROOT/clash.txt")"
[[ "$CLASH_CONTENT_AFTER" == "origin-clash-content" ]] \
  || fail "expected clash.txt to contain origin's content once the clash-blocked reconcile self-healed, got [$CLASH_CONTENT_AFTER]"
pass "reconciliation self-heals once the untracked clash is removed, without any further landing"

# ── scenario D (qa_e2e_procedure 5): a genuine content conflict on an
#    otherwise-clean tree is attempted (never pre-emptively refused), aborts
#    cleanly (no in-progress merge state), and the reset-to-origin recovery
#    then completes exactly as it does today (BL-1214 qa_e2e_procedure step
#    2 - the conflicting-divergence path is a deliberate constraint NOT to
#    weaken: a real conflict still resolves via reset onto origin/main,
#    same as before this ticket's :ff-absorb real-merge-attempt change). ──
echo "root-conflict-line" >> "$ROOT/seed.txt"
git -C "$ROOT" add seed.txt
git -C "$ROOT" commit -q -m "root-only conflicting edit to seed.txt"
ROOT_HEAD_BEFORE_CONFLICT="$(git -C "$ROOT" rev-parse main)"

git -C "$CLONE" pull -q origin main
echo "origin-conflict-line" >> "$CLONE/seed.txt"
git -C "$CLONE" add seed.txt
git -C "$CLONE" commit -q -m "origin-only conflicting edit to seed.txt"
git -C "$CLONE" push -q origin main
LANDED_6_SHA="$(git -C "$CLONE" rev-parse HEAD)"

wait_for_log "master-main-reconcile conflict" 20 \
  || fail "expected a genuine content conflict on an otherwise-clean tree to be attempted and reported; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "a genuine content conflict on an otherwise-clean tree is attempted (never pre-emptively refused) and reported"

wait_for_content "$ROOT/seed.txt" "origin-conflict-line" 20 \
  || fail "expected the reset-to-origin recovery to complete exactly as it does today once the conflicting merge aborted; log: $(cat "$LOG_FILE" 2>/dev/null)"
ROOT_HEAD_AFTER_CONFLICT="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_AFTER_CONFLICT" == "$LANDED_6_SHA" ]] \
  || fail "expected ROOT's main to land on origin's tip via the unweakened reset recovery, was $ROOT_HEAD_BEFORE_CONFLICT now $ROOT_HEAD_AFTER_CONFLICT (want $LANDED_6_SHA)"
[[ ! -f "$ROOT/.git/MERGE_HEAD" ]] \
  || fail "expected the aborted merge to leave no MERGE_HEAD - checkout left mid-merge"
CONFLICT_STATUS="$(git -C "$ROOT" status --porcelain)"
[[ -z "$CONFLICT_STATUS" ]] \
  || fail "expected the working tree to be clean after the aborted conflict and completed reset recovery, got: $CONFLICT_STATUS"
pass "an aborted merge conflict leaves no in-progress merge state, and the reset-to-origin recovery completes exactly as it does today"

# ── BL-1248 (qa_e2e_procedure scenario 02, "the one that matters"): with
#    the switch OFF, a genuine two-way divergence is left alone entirely -
#    nothing reachable from the cadence tick moves, resets, or discards the
#    local-only commit (invariant 1). Then the switch flips back ON to
#    prove this exact fixture genuinely WOULD have reconciled, so the
#    off-case assertion above is not vacuously green. ─────────────────────
sed -i 's/^config master_main_reconcile_enabled true$/config master_main_reconcile_enabled false/' "$ROOT/swarmforge/swarmforge.conf"
sleep 2  # let the daemon re-read the flipped config before this scenario's own state exists

mkdir -p "$ROOT/backlog/done"
echo "switch-off-local-bookkeeping" > "$ROOT/backlog/done/BL-1248-switch-off-test.yaml"
git -C "$ROOT" add backlog/done/BL-1248-switch-off-test.yaml
git -C "$ROOT" commit -q -m "coordinator bookkeeping while switch is off, local-only"
LOCAL_ONLY_SWITCH_OFF_SHA="$(git -C "$ROOT" rev-parse HEAD)"

git -C "$CLONE" pull -q origin main
echo "landed-switch-off" > "$CLONE/landed-switch-off.txt"
git -C "$CLONE" add landed-switch-off.txt
git -C "$CLONE" commit -q -m "QA lands landed-switch-off"
git -C "$CLONE" push -q origin main

wait_for_log "master-main-reconcile skipped-by-config" 20 \
  || fail "expected the reconcile sweep to log a config-skip while the switch is off; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "switching the sweep off is visible in the daemon log (BL-1248 scenario 03)"

sleep 3
ROOT_HEAD_AFTER_SWITCH_OFF="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_AFTER_SWITCH_OFF" == "$LOCAL_ONLY_SWITCH_OFF_SHA" ]] \
  || fail "expected main to stay exactly at the local-only bookkeeping commit while the switch is off, was $LOCAL_ONLY_SWITCH_OFF_SHA now $ROOT_HEAD_AFTER_SWITCH_OFF"
[[ ! -f "$ROOT/landed-switch-off.txt" ]] \
  || fail "expected the landed file to be ABSENT while the switch is off - a merge happened despite the kill switch"
git -C "$ROOT" merge-base --is-ancestor "$LOCAL_ONLY_SWITCH_OFF_SHA" main \
  || fail "expected the local-only bookkeeping commit to remain reachable from main while the switch is off"
pass "with the switch off, a genuine two-way divergence is left alone entirely - no merge, reset, or absorb runs, and the local-only commit stays reachable from main (BL-1248 invariant 1, real-git half)"

sed -i 's/^config master_main_reconcile_enabled false$/config master_main_reconcile_enabled true/' "$ROOT/swarmforge/swarmforge.conf"

wait_for_file "$ROOT/landed-switch-off.txt" 20 \
  || fail "expected flipping the switch back on to let this exact divergence reconcile - it was never a vacuously-green fixture; log: $(cat "$LOG_FILE" 2>/dev/null)"
git -C "$ROOT" merge-base --is-ancestor "$LOCAL_ONLY_SWITCH_OFF_SHA" main \
  || fail "expected the local-only commit to remain reachable after reconciling with the switch back on"
pass "flipping the switch back on reconciles this exact fixture - the off-case assertion above was not vacuously green (BL-1248 qa_e2e_procedure scenario 02)"

# ── BL-1256: the stay-loud gate must run against a REAL daemon tick, not
#    sweep! called in isolation with a hand-passed disabled flag - that is
#    exactly the blind-gate shape this ticket exists to close (see its own
#    feature file). Stop the persistent background daemon now (it has
#    already proven the full cadence loop above); the remaining scenarios
#    fire deterministic single ticks via `--reconcile-sweep-once`, a fresh
#    `bb handoffd.bb` invocation per tick, so there is no wall-clock wait
#    and no race with a still-running background daemon touching the same
#    ROOT. ───────────────────────────────────────────────────────────────
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""


# The log lines this file already asserts on ("master-main-reconcile
# drift ...", "master-main-reconcile-surfaced BL-891.*seed.txt") recur
# verbatim across scenarios (scenario B above already surfaced seed.txt's
# overlap once), so grepping the WHOLE accumulated log after a tick would
# false-pass even if this specific tick logged nothing new. Every BL-1256
# assertion below greps only the slice APPENDED by that one tick.
tail_since_line() {
  local from_line="$1"
  tail -n "+$((from_line + 1))" "$LOG_FILE"
}

run_one_reconcile_tick() {
  local lines_before
  lines_before="$(wc -l < "$LOG_FILE")"
  env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
    PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --reconcile-sweep-once
  wait_for_content "$LOG_FILE" "reconcile-sweep-once done" 5 \
    || fail "BL-1256: expected the one-shot tick to log its own completion; log: $(cat "$LOG_FILE" 2>/dev/null)"
  tail_since_line "$lines_before"
}

# By the time the background daemon above stopped, the fixture's switch is
# ON and the last reconcile reached :up-to-date (state cleared to {}) - a
# clean slate for a fresh episode. Flip the switch off, then create the
# SAME shape of genuine dirty-blocked divergence as scenario B above
# (a local dirty edit overlapping a path the incoming landed commit also
# changes), so the tick under test is a real "declined to act, must still
# go loud" case, not a should-reconcile-but-disabled no-op.
sed -i 's/^config master_main_reconcile_enabled true$/config master_main_reconcile_enabled false/' "$ROOT/swarmforge/swarmforge.conf"

ROOT_HEAD_BEFORE_BL1256="$(git -C "$ROOT" rev-parse main)"
echo "root-bl1256-local-edit" >> "$ROOT/seed.txt"

git -C "$CLONE" pull -q origin main
echo "origin-bl1256-changes-seed" >> "$CLONE/seed.txt"
git -C "$CLONE" add seed.txt
git -C "$CLONE" commit -q -m "QA lands landed-bl1256 (modifies seed.txt)"
git -C "$CLONE" push -q origin main

# ── scenario 01: one real tick still surfaces the divergence it declined
#    to reconcile ────────────────────────────────────────────────────────
TICK1_LOG="$(run_one_reconcile_tick)"

grep -q "master-main-reconcile drift ahead=[0-9]* behind=[0-9]*" <<< "$TICK1_LOG" \
  || fail "BL-1256 scenario 01: expected the drift line to be recorded by the one real tick; tick log: $TICK1_LOG"
grep -q "master-main-reconcile-surfaced BL-891.*seed.txt" <<< "$TICK1_LOG" \
  || fail "BL-1256 scenario 01: expected the divergence to be surfaced to a human by the same tick; tick log: $TICK1_LOG"
ROOT_HEAD_AFTER_BL1256_TICK1="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_AFTER_BL1256_TICK1" == "$ROOT_HEAD_BEFORE_BL1256" ]] \
  || fail "BL-1256 scenario 01: expected no commit reachable from local main before the tick to be discarded, was $ROOT_HEAD_BEFORE_BL1256 now $ROOT_HEAD_AFTER_BL1256_TICK1"
pass "with the switch off, a real daemon tick (--reconcile-sweep-once) still surfaces the divergence it declined to reconcile (BL-1256 scenario 01)"

# ── scenario 02: a block that persists past the escalation threshold (3,
#    master_main_reconcile_lib.bb's escalation-default-threshold) still
#    escalates to the operator, even with the switch off. The tick above
#    was ticks=1 of this same episode (same reason "dirty", same overlap);
#    two more real ticks bring it to ticks=3, crossing the threshold - the
#    escalation itself is asserted only on the tick that actually crosses
#    it, not on the whole accumulated log. ────────────────────────────────
run_one_reconcile_tick > /dev/null
TICK3_LOG="$(run_one_reconcile_tick)"

grep -q "master-main-reconcile-escalation dirty" <<< "$TICK3_LOG" \
  || fail "BL-1256 scenario 02: expected a dirty block persisting past the escalation threshold to still escalate with the switch off; tick log: $TICK3_LOG"
wait_for_content "$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl" "dirty-blocked" 5 \
  || fail "BL-1256 scenario 02: expected the operator escalation to reach the Telegram OPERATOR-topic outbox"
ROOT_HEAD_AFTER_BL1256_TICK3="$(git -C "$ROOT" rev-parse main)"
[[ "$ROOT_HEAD_AFTER_BL1256_TICK3" == "$ROOT_HEAD_BEFORE_BL1256" ]] \
  || fail "BL-1256 scenario 02: expected local main to still be untouched after 3 declined ticks, was $ROOT_HEAD_BEFORE_BL1256 now $ROOT_HEAD_AFTER_BL1256_TICK3"
pass "with the switch off, a block that persists past the escalation threshold still escalates to the operator (BL-1256 scenario 02)"

git -C "$ROOT" checkout -q -- seed.txt

echo "ALL SCENARIOS PASS"
