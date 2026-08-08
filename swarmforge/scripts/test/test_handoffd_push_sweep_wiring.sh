#!/usr/bin/env bash
# BL-356: handoffd.bb's consolidated poll loop now also sweeps for unpushed
# work on local `main`, sharing the same cadence as every other *-sweep!
# above it. The DECISION/STATE logic itself (ahead/behind classification,
# bounded push-retry backoff, delivery-based alarm arming) is exhaustively
# covered by push_sweep_lib_test_runner.bb (pure unit tests) and the
# BL-356 acceptance suite (push_sweep_cli.bb, forced results, no real git/
# network); this test only proves the real daemon reaches and fires
# push-sweep! against a REAL git repo and a REAL local remote, on its own
# cadence, each poll cycle - same "one real wiring proof, not re-run per
# scenario" posture as test_handoffd_resource_sample_wiring.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
REMOTE="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT" "$REMOTE"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

# ── a real bare remote, and a real project-root with one unpushed commit ──
git init --quiet --bare "$REMOTE"

git init --quiet "$ROOT"
git -C "$ROOT" config user.email "test@example.com"
git -C "$ROOT" config user.name "Test"
git -C "$ROOT" checkout -q -b main
echo "first" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "seed commit"
git -C "$ROOT" remote add origin "$REMOTE"
git -C "$ROOT" push -q origin main
# One unpublished commit - this is what push-sweep! must reach origin.
echo "second" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "unpushed commit"
# BL-630: push-sweep now refuses to publish a tip that is not a
# swarmforge-QA ancestor - this fixture's unpushed commit represents
# QA-approved work reaching origin, so swarmforge-QA points at the same
# tip (a commit is trivially its own ancestor).
git -C "$ROOT" branch swarmforge-QA main

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
# test_handoffd_resource_sample_wiring.sh already uses.
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" setsid bb "$HANDOFFD" "$ROOT" &
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

wait_for_log "push-sweep pushed" 30 \
  || fail "the push sweep never logged a successful push within 30s; log: $(cat "$LOG_FILE" 2>/dev/null)"

# ── origin actually received the unpushed commit (real git, real remote) ──
LOCAL_HEAD="$(git -C "$ROOT" rev-parse main)"
REMOTE_HEAD="$(git -C "$REMOTE" rev-parse main)"
[[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] \
  || fail "expected origin's main to match local main after the sweep, got local=$LOCAL_HEAD remote=$REMOTE_HEAD"
pass "push-sweep! shells to real git and lands local main's unpushed commit on origin"

# ── the sweep never threw ──────────────────────────────────────────────────
grep -q "push-sweep-error" "$LOG_FILE" && fail "the push sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the push sweep ran without throwing"

# ── an already-published main stays quiet on a later cycle ────────────────
# push-sweep! only runs every chase-sweep-every-cycles (10) poll cycles
# (~10s at poll-ms=1000) - a blind `sleep 6` here can land before the next
# tick ever fires (confirmed: this raced on a plain, unmodified main
# checkout too - a pre-existing flake, not introduced by BL-630). Poll for
# the log line instead of guessing a fixed sleep.
wait_for_log "push-sweep up-to-date" 15 \
  || fail "expected a later sweep to report up-to-date once published, got: $(cat "$LOG_FILE")"
pass "a later sweep sees the published state and pushes nothing further"

# ── BL-630: a commit that is not a swarmforge-QA ancestor is never
#    published, proven against the REAL git adapter (push-sweep-qa-gate-
#    facts! in handoffd.bb), not just the forced-result CLI/lib tests ──────
echo "third" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "un-QA'd commit"
NON_QA_SHA="$(git -C "$ROOT" rev-parse HEAD)"

wait_for_log "qa-refused" 15 \
  || fail "the push sweep never refused the non-QA-ancestor commit within 15s; log: $(cat "$LOG_FILE" 2>/dev/null)"
grep -q "qa-refused non-qa-ancestor $NON_QA_SHA" "$LOG_FILE" \
  || fail "expected the refusal to name $NON_QA_SHA, got: $(cat "$LOG_FILE")"
pass "push-sweep! refuses a real commit that is not a swarmforge-QA ancestor, naming its sha"

REMOTE_HEAD_AFTER="$(git -C "$REMOTE" rev-parse main)"
[[ "$REMOTE_HEAD_AFTER" != "$NON_QA_SHA" ]] \
  || fail "the non-QA-ancestor commit must never reach origin, but origin/main is now $REMOTE_HEAD_AFTER"
[[ "$REMOTE_HEAD_AFTER" == "$LOCAL_HEAD" ]] \
  || fail "expected origin/main to stay at the earlier QA-approved tip $LOCAL_HEAD, got $REMOTE_HEAD_AFTER"
pass "origin/main stays at the last QA-approved tip, never advancing to the refused commit"

wait_for_remote_head() {
  local expected_sha="$1" timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ "$(git -C "$REMOTE" rev-parse main 2>/dev/null)" == "$expected_sha" ]] && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

# ── BL-630 architect bounce (2026-07-30): a genuine QA-approved landing via
#    a REAL `git merge --no-ff` (the routine shape whenever local main has
#    diverged since swarmforge-QA was cut - see backlog/evidence/BL-630-
#    push-sweep-refuses-non-qa-approved-main-bounce-20260730.md) must still
#    publish. Reset past the still-jammed non-QA commit above - it is a
#    throwaway probe commit this fixture never intended to land, not
#    something under test here - then build the shape the bounce reproduced:
#    a bookkeeping-only commit lands directly on main (the divergence
#    trigger), a real feature commit lands only on the QA-approved branch,
#    and QA merges that branch into main with --no-ff.
git -C "$ROOT" reset --hard -q "$LOCAL_HEAD"

git -C "$ROOT" checkout -q -b feature-merge-test "$LOCAL_HEAD"
mkdir -p "$ROOT/extension/src"
echo "feature" > "$ROOT/extension/src/merge_test.ts"
git -C "$ROOT" add extension/src/merge_test.ts
git -C "$ROOT" commit -q -m "real feature work, QA-approved"
FEATURE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" branch -f swarmforge-QA feature-merge-test

git -C "$ROOT" checkout -q main
mkdir -p "$ROOT/backlog/done"
echo "bookkeeping" > "$ROOT/backlog/done/BL-merge-test.yaml"
git -C "$ROOT" add backlog/done/BL-merge-test.yaml
git -C "$ROOT" commit -q -m "coordinator bookkeeping lands directly on main"

git -C "$ROOT" merge --no-ff -q feature-merge-test -m "QA merge feature-merge-test into main"
MERGE_SHA="$(git -C "$ROOT" rev-parse HEAD)"

wait_for_remote_head "$MERGE_SHA" 30 \
  || fail "expected origin/main to reach the QA-approved merge commit $MERGE_SHA within 30s; log: $(cat "$LOG_FILE" 2>/dev/null); origin=$(git -C "$REMOTE" rev-parse main 2>/dev/null)"
pass "a real git merge --no-ff landing a QA-approved feature (diverged by a bookkeeping commit on main) still publishes"

grep -q "qa-refused non-qa-ancestor $MERGE_SHA" "$LOG_FILE" \
  && fail "the QA-approved merge commit $MERGE_SHA must never be refused, but it was: $(cat "$LOG_FILE")"
pass "the QA-approved merge commit itself is never independently flagged non-qa-ancestor"

grep -q "qa-refused non-qa-ancestor $FEATURE_SHA" "$LOG_FILE" \
  && fail "the feature commit $FEATURE_SHA is a swarmforge-QA ancestor and must never be refused, but it was: $(cat "$LOG_FILE")"
pass "the feature commit folded in by the merge is recognized as its own QA-approved entry"

# ── BL-630 architect bounce #2 (2026-07-30): a merge that resolves a real
#    conflict by hand carries content that exists in NEITHER parent's tree -
#    that content was never independently QA-approved and is invisible to
#    every other commit's own single-parent diff, so it must be scrutinized
#    on its own and refused if it touches a non-bookkeeping path. Build a
#    forced conflict on the same file both sides touch, resolve it with
#    content matching neither side, and prove the resulting merge commit is
#    refused (see backlog/evidence/BL-630-push-sweep-refuses-non-qa-
#    approved-main-bounce-20260730-2.md).
git -C "$ROOT" checkout -q -b conflict-feature-test "$MERGE_SHA"
echo "feature-branch-change" > "$ROOT/extension/src/merge_test.ts"
git -C "$ROOT" add extension/src/merge_test.ts
git -C "$ROOT" commit -q -m "feature branch edits merge_test.ts, QA-approved"
git -C "$ROOT" branch -f swarmforge-QA conflict-feature-test

git -C "$ROOT" checkout -q main
echo "main-branch-change" > "$ROOT/extension/src/merge_test.ts"
git -C "$ROOT" add extension/src/merge_test.ts
git -C "$ROOT" commit -q -m "unrelated main-side edit to the same file"

git -C "$ROOT" merge --no-ff conflict-feature-test -m "QA merge conflict-feature-test into main" \
  || true
grep -q "^<<<<<<<" "$ROOT/extension/src/merge_test.ts" \
  || fail "expected a real git merge conflict in this fixture, got none"
echo "CONFLICT-RESOLUTION-NEVER-QA-APPROVED" > "$ROOT/extension/src/merge_test.ts"
git -C "$ROOT" add extension/src/merge_test.ts
git -C "$ROOT" commit -q -m "QA merge conflict-feature-test into main (conflict resolved by hand)"
CONFLICT_MERGE_SHA="$(git -C "$ROOT" rev-parse HEAD)"

wait_for_log "qa-refused non-qa-ancestor $CONFLICT_MERGE_SHA" 15 \
  || fail "expected the hand-resolved-conflict merge $CONFLICT_MERGE_SHA to be refused within 15s; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "a merge commit whose own hand-resolved conflict content touches a non-bookkeeping path is refused, not waved through as :merge? true"

REMOTE_HEAD_AFTER_CONFLICT="$(git -C "$REMOTE" rev-parse main)"
[[ "$REMOTE_HEAD_AFTER_CONFLICT" != "$CONFLICT_MERGE_SHA" ]] \
  || fail "the unreviewed conflict-resolution content must never reach origin, but origin/main is now $REMOTE_HEAD_AFTER_CONFLICT"
[[ "$REMOTE_HEAD_AFTER_CONFLICT" == "$MERGE_SHA" ]] \
  || fail "expected origin/main to stay at the last QA-approved tip $MERGE_SHA, got $REMOTE_HEAD_AFTER_CONFLICT"
pass "origin/main stays at the last QA-approved tip, never advancing to the unreviewed conflict-resolution merge"

# ── BL-630 hardener pass (QA bounce #3, 2026-07-30): a real OCTOPUS merge
#    (3+ parents) - QA's bounce evidence named this as an untested edge case
#    for `git-changed-paths-combined`'s `-c` combined-diff, which the
#    two-parent fixtures above cannot exercise. First prove a TRIVIAL octopus
#    merge (each parent touches a disjoint file, no independent content)
#    still publishes; then prove a hand-crafted CONTENT-BEARING octopus
#    merge (built via `commit-tree`, since git's octopus strategy itself
#    refuses on any real conflict - there is no ordinary `git merge` path to
#    a content-bearing octopus commit) is refused exactly like the
#    two-parent hand-resolved-conflict case above.
git -C "$ROOT" checkout -q main
git -C "$ROOT" reset --hard -q "$MERGE_SHA"

git -C "$ROOT" checkout -qb octopus-feature-a "$MERGE_SHA"
mkdir -p "$ROOT/extension/src"
echo "feature-a" > "$ROOT/extension/src/octopus_a.ts"
git -C "$ROOT" add extension/src/octopus_a.ts
git -C "$ROOT" commit -q -m "octopus feature A, QA-approved"
OCTOPUS_FEATURE_A="$(git -C "$ROOT" rev-parse HEAD)"

git -C "$ROOT" checkout -qb octopus-feature-b "$MERGE_SHA"
echo "feature-b" > "$ROOT/extension/src/octopus_b.ts"
git -C "$ROOT" add extension/src/octopus_b.ts
git -C "$ROOT" commit -q -m "octopus feature B, QA-approved"
OCTOPUS_FEATURE_B="$(git -C "$ROOT" rev-parse HEAD)"

# Both features are QA-approved: fold them into swarmforge-QA via their own
# (two-parent) merge so each feature commit is individually a swarmforge-QA
# ancestor - qa-gate-decision checks each ahead-commit, not the octopus tip.
git -C "$ROOT" checkout -qb qa-octopus-approval "$MERGE_SHA"
git -C "$ROOT" merge -q --no-ff octopus-feature-a octopus-feature-b -m "QA approves both octopus features"
git -C "$ROOT" branch -f swarmforge-QA qa-octopus-approval

git -C "$ROOT" checkout -q main
mkdir -p "$ROOT/backlog/done"
echo "bookkeeping-for-octopus" > "$ROOT/backlog/done/BL-octopus-test.yaml"
git -C "$ROOT" add backlog/done/BL-octopus-test.yaml
git -C "$ROOT" commit -q -m "coordinator bookkeeping lands directly on main (octopus divergence trigger)"

git -C "$ROOT" merge -q octopus-feature-a octopus-feature-b -m "trivial octopus merge into main (disjoint files, no independent content)"
TRIVIAL_OCTOPUS_SHA="$(git -C "$ROOT" rev-parse HEAD)"
[[ "$(git -C "$ROOT" log -1 --format=%P "$TRIVIAL_OCTOPUS_SHA" | wc -w | tr -d ' ')" == "3" ]] \
  || fail "expected a real 3-parent octopus merge, got $(git -C "$ROOT" log -1 --format=%P "$TRIVIAL_OCTOPUS_SHA")"

wait_for_remote_head "$TRIVIAL_OCTOPUS_SHA" 30 \
  || fail "expected origin/main to reach the trivial octopus merge $TRIVIAL_OCTOPUS_SHA within 30s; log: $(cat "$LOG_FILE" 2>/dev/null); origin=$(git -C "$REMOTE" rev-parse main 2>/dev/null)"
pass "a real 3-parent octopus merge with no independent content of its own (disjoint files, both QA-approved) still publishes"

grep -q "qa-refused non-qa-ancestor $TRIVIAL_OCTOPUS_SHA" "$LOG_FILE" \
  && fail "the trivial octopus merge $TRIVIAL_OCTOPUS_SHA carries no content of its own and must never be refused, but it was: $(cat "$LOG_FILE")"
pass "the trivial octopus merge itself is never independently flagged non-qa-ancestor"

# ── content-bearing octopus: hand-craft a 3-parent commit whose tree
#    overwrites one parent's file with content matching NEITHER parent -
#    the octopus-merge equivalent of a hand-resolved conflict. Ordinary
#    `git merge` cannot produce this (octopus refuses on any real conflict),
#    so build the tree and commit object directly with `commit-tree`, then
#    move `main` onto it exactly as a real (mis-)landing would.
git -C "$ROOT" checkout -qb octopus-feature-c "$TRIVIAL_OCTOPUS_SHA"
echo "feature-c" > "$ROOT/extension/src/octopus_c.ts"
git -C "$ROOT" add extension/src/octopus_c.ts
git -C "$ROOT" commit -q -m "octopus feature C, QA-approved"
OCTOPUS_FEATURE_C="$(git -C "$ROOT" rev-parse HEAD)"

git -C "$ROOT" checkout -qb octopus-feature-d "$TRIVIAL_OCTOPUS_SHA"
echo "feature-d" > "$ROOT/extension/src/octopus_d.ts"
git -C "$ROOT" add extension/src/octopus_d.ts
git -C "$ROOT" commit -q -m "octopus feature D, QA-approved"
OCTOPUS_FEATURE_D="$(git -C "$ROOT" rev-parse HEAD)"

git -C "$ROOT" checkout -qb qa-octopus-approval-2 "$TRIVIAL_OCTOPUS_SHA"
git -C "$ROOT" merge -q --no-ff octopus-feature-c octopus-feature-d -m "QA approves both octopus features (round 2)"
git -C "$ROOT" branch -f swarmforge-QA qa-octopus-approval-2

git -C "$ROOT" checkout -q main
echo "unrelated-main-side-edit" > "$ROOT/extension/src/octopus_main_side.ts"
git -C "$ROOT" add extension/src/octopus_main_side.ts
git -C "$ROOT" commit -q -m "unrelated main-side edit (octopus divergence trigger, round 2)"
MAIN_TIP_BEFORE_BAD_OCTOPUS="$(git -C "$ROOT" rev-parse HEAD)"

echo "HAND-EDITED-INTO-OCTOPUS-NEVER-QA-APPROVED" > "$ROOT/extension/src/octopus_c.ts"
git -C "$ROOT" add extension/src/octopus_c.ts
CONTENT_BEARING_TREE="$(git -C "$ROOT" write-tree)"
CONTENT_BEARING_OCTOPUS_SHA="$(git -C "$ROOT" commit-tree "$CONTENT_BEARING_TREE" \
  -p "$MAIN_TIP_BEFORE_BAD_OCTOPUS" -p "$OCTOPUS_FEATURE_C" -p "$OCTOPUS_FEATURE_D" \
  -m "octopus merge into main (hand-edited content, never independently QA-approved)")"
git -C "$ROOT" update-ref refs/heads/main "$CONTENT_BEARING_OCTOPUS_SHA"
git -C "$ROOT" checkout -q main

wait_for_log "qa-refused non-qa-ancestor $CONTENT_BEARING_OCTOPUS_SHA" 15 \
  || fail "expected the hand-edited content-bearing octopus merge $CONTENT_BEARING_OCTOPUS_SHA to be refused within 15s; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "a 3-parent octopus merge whose own hand-edited content touches a non-bookkeeping path is refused, not waved through as :merge? true"

REMOTE_HEAD_AFTER_OCTOPUS="$(git -C "$REMOTE" rev-parse main)"
[[ "$REMOTE_HEAD_AFTER_OCTOPUS" != "$CONTENT_BEARING_OCTOPUS_SHA" ]] \
  || fail "the unreviewed octopus content must never reach origin, but origin/main is now $REMOTE_HEAD_AFTER_OCTOPUS"
[[ "$REMOTE_HEAD_AFTER_OCTOPUS" == "$TRIVIAL_OCTOPUS_SHA" ]] \
  || fail "expected origin/main to stay at the last QA-approved tip $TRIVIAL_OCTOPUS_SHA, got $REMOTE_HEAD_AFTER_OCTOPUS"
pass "origin/main stays at the last QA-approved tip, never advancing to the unreviewed content-bearing octopus merge"

# ── BL-855: a real no-op landing merge (`git merge -s ours`) - the exact
#    incident shape (f28a84ad): correct ancestry, an accurate-sounding
#    message, a genuinely swarmforge-QA-approved second parent, but the
#    merge's own tree takes NONE of that parent's content. Must be refused
#    before it ever reaches origin - and BL-630's own qa-gate-decision
#    would wave this exact shape through (its second parent IS approved),
#    which is the gap this ticket closes.
git -C "$ROOT" checkout -q main
git -C "$ROOT" reset --hard -q "$TRIVIAL_OCTOPUS_SHA"

git -C "$ROOT" checkout -qb noop-feature-test "$TRIVIAL_OCTOPUS_SHA"
mkdir -p "$ROOT/swarmforge/scripts"
echo "noop-feature-content" > "$ROOT/swarmforge/scripts/noop_test.bb"
git -C "$ROOT" add swarmforge/scripts/noop_test.bb
git -C "$ROOT" commit -q -m "real feature work, QA-approved (BL-855 no-op fixture)"
NOOP_FEATURE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" branch -f swarmforge-QA noop-feature-test

git -C "$ROOT" checkout -q main
git -C "$ROOT" merge -s ours -q noop-feature-test -m "QA merge noop-feature-test into main (BL-855 no-op fixture)"
NOOP_MERGE_SHA="$(git -C "$ROOT" rev-parse HEAD)"

# Sanity: this really is the f28a84ad shape - correct ancestry (the feature
# commit IS a parent) but none of its content landed on disk.
git -C "$ROOT" merge-base --is-ancestor "$NOOP_FEATURE_SHA" "$NOOP_MERGE_SHA" \
  || fail "expected the no-op merge to still record the feature commit as an ancestor"
[[ -f "$ROOT/swarmforge/scripts/noop_test.bb" ]] \
  && fail "fixture bug: expected 'git merge -s ours' to take none of the feature branch's content, but noop_test.bb is present on disk"

wait_for_log "noop-merge-refused" 15 \
  || fail "expected the no-op landing merge $NOOP_MERGE_SHA to be refused within 15s; log: $(cat "$LOG_FILE" 2>/dev/null)"
grep -q "noop-merge-refused noop-landing-merge $NOOP_MERGE_SHA<-$NOOP_FEATURE_SHA" "$LOG_FILE" \
  || fail "expected the refusal to name the merge $NOOP_MERGE_SHA and its second parent $NOOP_FEATURE_SHA, got: $(cat "$LOG_FILE")"
pass "push-sweep! refuses a real 'git merge -s ours' no-op landing merge, naming the merge and its second parent"

REMOTE_HEAD_AFTER_NOOP="$(git -C "$REMOTE" rev-parse main)"
[[ "$REMOTE_HEAD_AFTER_NOOP" != "$NOOP_MERGE_SHA" ]] \
  || fail "the no-op landing merge must never reach origin, but origin/main is now $REMOTE_HEAD_AFTER_NOOP"
[[ "$REMOTE_HEAD_AFTER_NOOP" == "$TRIVIAL_OCTOPUS_SHA" ]] \
  || fail "expected origin/main to stay at the last good tip $TRIVIAL_OCTOPUS_SHA, got $REMOTE_HEAD_AFTER_NOOP"
pass "origin/main stays at the last good tip, never advancing to the no-op landing merge"

# Being genuinely QA-approved does not excuse it (BL-855 invariant 1): the
# underlying feature commit itself is a real swarmforge-QA ancestor and
# must never be independently flagged - only the merge that dropped it.
grep -q "qa-refused non-qa-ancestor $NOOP_FEATURE_SHA" "$LOG_FILE" \
  && fail "the underlying feature commit $NOOP_FEATURE_SHA is a genuine swarmforge-QA ancestor and must never itself be refused, but it was: $(cat "$LOG_FILE")"
pass "the underlying QA-approved feature commit is never itself flagged - only the no-op merge that discarded it"

echo "ALL PASS"
