#!/usr/bin/env bash
# BL-036: redo_from salvages a failed/rejected pipeline run by abandoning the
# item's stale handoffs, checkpoint-tagging HEAD, and re-injecting a fresh
# git_handoff at the named stage. Covers scenarios BL-036 redo-from-stage-01..05.

set -euo pipefail

# BL-128: every bb "$REDO" invocation below relies on queue-handoff!'s
# SWARMFORGE_ROLE-unset fallback to "coordinator" (salvage_lib.bb) to land
# its freshly-queued handoff in $OUTBOX (coordinator's own per-role
# mailbox). Before the mailbox split this didn't matter - every role's
# outbox was the same shared flat directory - but now an ambient
# SWARMFORGE_ROLE inherited from the invoking shell (e.g. run interactively
# inside one of the pipeline agents' own role-scoped sessions, which already
# export it) silently redirects the queued handoff into THAT role's own
# mailbox instead, failing every assertion against $OUTBOX. Unset it here so
# this test's outcome depends only on its own fixture, never on the caller's
# environment.
unset SWARMFORGE_ROLE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REDO="$SCRIPT_DIR/../redo_from.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: git repo with roles + a coder worktree ──────────────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
C1="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m two
HEAD10="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"

mkdir -p "$ROOT/.swarmforge" "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT/.swarmforge/handoffs/inbox/completed"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT"
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CODER_WT"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$CODER_WT"
  printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$CODER_WT"
  printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$CODER_WT"
  printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$ROOT"
} > "$ROOT/.swarmforge/roles.tsv"

ITEM="BL-900"
TASK="BL-900-demo-item"
# BL-128: queue-handoff! sends as coordinator by default (salvage_lib.bb's
# own SWARMFORGE_ROLE fallback), so redo's freshly-queued handoff lands in
# coordinator's own per-role outbox, not the old shared flat one.
OUTBOX="$ROOT/.swarmforge/handoffs/coordinator/outbox"

drop_handoff() {  # dir name recipient extra-header
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n%s\nbody\n' \
    "$2" "$3" "$3" "$TASK" "$C1" "${4:-}" > "$1/00_$2.handoff"
}

# ── 05: invalid stage rejected, nothing produced ─────────────────────────────
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/new" "stale1" "coder"
set +e
OUT="$(cd "$ROOT" && bb "$REDO" "$ITEM" "tester" 2>&1)"
RC=$?
set -e
[[ $RC -ne 0 ]] || fail "05: invalid stage did not fail"
grep -q "coder | cleaner | architect | hardender | documenter | qa" <<< "$OUT" \
  || fail "05: error does not list valid stages; got: $OUT"
[[ -z "$(git -C "$ROOT" tag -l 'redo/*')" ]] || fail "05: tag created on invalid stage"
[[ -f "$CODER_WT/.swarmforge/handoffs/inbox/new/00_stale1.handoff" ]] \
  || fail "05: stale handoff touched on invalid stage"
[[ ! -d "$OUTBOX" || -z "$(ls "$OUTBOX" 2>/dev/null | grep -v tmp || true)" ]] \
  || fail "05: handoff queued on invalid stage"
pass "05: invalid stage rejected with valid-stage list, nothing produced"

# ── 01+02+03: redo from cleaner abandons stale mail, tags, re-injects ────────
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/in_process" "stale2" "coder"
# prior handoff TO cleaner establishes the last known good commit (C1)
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/completed" "prior-cleaner" "cleaner"

OUT="$(cd "$CODER_WT" && bb "$REDO" "$ITEM" cleaner)"

[[ -z "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/new/" 2>/dev/null)" ]] \
  || fail "02: inbox/new still has stale handoffs"
[[ -z "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/in_process/" 2>/dev/null)" ]] \
  || fail "02: in_process still has stale handoffs"
[[ "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/abandoned/" | wc -l | tr -d ' ')" == "2" ]] \
  || fail "02: expected 2 abandoned handoffs"
pass "02: stale new/in_process handoffs abandoned before re-injection"

TAG="$(git -C "$ROOT" tag -l "redo/$ITEM/cleaner/*")"
[[ -n "$TAG" ]] || fail "01: no checkpoint tag redo/$ITEM/cleaner/*"
QUEUED="$(ls "$OUTBOX"/*.handoff 2>/dev/null | head -1)"
[[ -n "$QUEUED" ]] || fail "01: no fresh handoff queued"
grep -q "^to: cleaner$" "$QUEUED" || fail "01: fresh handoff not addressed to cleaner"
grep -q "^task: $TASK$" "$QUEUED" || fail "01: task name not preserved"
grep -q "^commit: $C1$" "$QUEUED" || fail "01: did not use last known good commit for cleaner"
pass "01: checkpoint tagged and fresh handoff re-injected at cleaner with last good commit"

grep -q '"event":"redo"' "$ROOT/.swarmforge/run-log.jsonl" || fail "03: no redo entry in run log"
grep -q '"from_stage":"cleaner"' "$ROOT/.swarmforge/run-log.jsonl" || fail "03: from_stage missing"
pass "03: redo recorded in run-log.jsonl with from_stage"

# ── 01 (coder variant): redo from coder uses current HEAD ────────────────────
rm -f "$OUTBOX"/*.handoff
(cd "$ROOT" && bb "$REDO" "$ITEM" coder > /dev/null)
QUEUED="$(ls "$OUTBOX"/*.handoff | head -1)"
grep -q "^to: coder$" "$QUEUED" || fail "01-coder: not addressed to coder"
grep -q "^commit: $HEAD10$" "$QUEUED" || fail "01-coder: coder redo must use current HEAD"
pass "01-coder: redo from coder uses current HEAD"

# ── 04: QA rejection_reason is accepted by swarm_handoff and captured ────────
mkdir -p "$ROOT/tmp"
printf 'type: git_handoff\nto: coder\npriority: 00\ntask: %s\ncommit: %s\nrejection_reason: acceptance scenario 3 fails on empty input\n' \
  "$TASK" "$C1" > "$ROOT/tmp/reject-draft.txt"
(cd "$ROOT" && SWARMFORGE_ROLE=QA bb "$SWARM_HANDOFF" "$ROOT/tmp/reject-draft.txt" > /dev/null) \
  || fail "04: swarm_handoff rejected a draft carrying rejection_reason"
# QA's own worktree-name ("QA", not "master") keeps QA's flat, unprefixed
# outbox layout - distinct from $OUTBOX above, which is coordinator's.
QA_OUTBOX="$ROOT/.swarmforge/handoffs/outbox"
REJECTED="$(ls -t "$QA_OUTBOX"/*.handoff | head -1)"
grep -q "^rejection_reason: acceptance scenario 3 fails on empty input$" "$REJECTED" \
  || fail "04: rejection_reason header not preserved in the queued handoff"
# simulate delivery: the rejection lands in the coder inbox, then gets redone
mv "$REJECTED" "$CODER_WT/.swarmforge/handoffs/inbox/new/00_zz_rejection.handoff"

(cd "$ROOT" && bb "$REDO" "$ITEM" coder > /dev/null)
grep -q '"reason":"acceptance scenario 3 fails on empty input"' "$ROOT/.swarmforge/run-log.jsonl" \
  || fail "04: redo log did not capture the rejection_reason"
pass "04: rejection_reason validated, preserved, and captured in the redo log"

# ── DEFECT (QA): two redos in the same second must not collide on the tag ────
rm -f "$OUTBOX"/*.handoff
(cd "$ROOT" && bb "$REDO" "$ITEM" cleaner > /dev/null) || fail "tag-collision: first rapid redo failed"
(cd "$ROOT" && bb "$REDO" "$ITEM" cleaner > /dev/null) || fail "tag-collision: second same-second redo failed"
RAPID_TAGS="$(git -C "$ROOT" tag -l "redo/$ITEM/cleaner/*" | wc -l | tr -d ' ')"
[[ "$RAPID_TAGS" -ge 3 ]] || fail "tag-collision: expected distinct tags per redo, found $RAPID_TAGS"
pass "tag-collision: same-second redos produce distinct checkpoint tags"

# ── HARDENING: force an actual `git tag` collision deterministically ────────
# Millisecond-resolution timestamps make a real collision astronomically rare
# in practice (verified: 20 truly parallel redo_from invocations never
# produced two identical millisecond stamps), so the scenario above never
# exercises the retry-with-suffix branch of tag-checkpoint! at all — it only
# proves the happy path still works. A fake `git` that reports "already
# exists" for the first tag attempt forces that branch to actually run.
FAKE_BIN="$ROOT/fakebin"
mkdir -p "$FAKE_BIN"
COLLIDE_MARKER="$ROOT/tmp/collide-once"
mkdir -p "$ROOT/tmp"
REAL_GIT="$(command -v git)"
cat > "$FAKE_BIN/git" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "tag" && ! -e "$COLLIDE_MARKER" ]]; then
  touch "$COLLIDE_MARKER"
  echo "fatal: tag '\$2' already exists" >&2
  exit 128
fi
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$FAKE_BIN/git"

rm -f "$OUTBOX"/*.handoff
OUT="$(cd "$ROOT" && PATH="$FAKE_BIN:$PATH" bb "$REDO" "$ITEM" cleaner)" \
  || fail "tag-collision-forced: redo aborted instead of retrying past the collision"
CHECKPOINT_TAG="$(grep '^CHECKPOINT: ' <<< "$OUT" | sed 's/^CHECKPOINT: //')"
[[ -n "$(git -C "$ROOT" tag -l "$CHECKPOINT_TAG")" ]] \
  || fail "tag-collision-forced: reported checkpoint tag was never actually created"
[[ "$CHECKPOINT_TAG" == *-2 ]] \
  || fail "tag-collision-forced: expected a -2 suffixed retry tag, got $CHECKPOINT_TAG"
pass "tag-collision-forced: a real git-tag collision is retried with a suffix, not aborted"

# ── 01 (outline sweep): every stage maps to a queueable recipient ────────────
for stage in architect hardender documenter qa; do
  rm -f "$OUTBOX"/*.handoff
  (cd "$ROOT" && bb "$REDO" "$ITEM" "$stage" > /dev/null) || fail "01-$stage: redo failed"
  QUEUED="$(ls "$OUTBOX"/*.handoff | head -1)"
  role="$stage"; [[ "$stage" == "qa" ]] && role="QA"
  grep -q "^to: $role$" "$QUEUED" || fail "01-$stage: not addressed to $role"
  [[ -n "$(git -C "$ROOT" tag -l "redo/$ITEM/$stage/*")" ]] || fail "01-$stage: no tag"
done
pass "01: all pipeline stages accept a redo and address the right role"

echo "ALL PASS"
