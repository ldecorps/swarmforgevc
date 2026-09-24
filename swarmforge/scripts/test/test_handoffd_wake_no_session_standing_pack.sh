#!/usr/bin/env bash
# BL-1719: a wake for a recipient with no tmux session never lands in
# another role's pane. Drives the REAL handoff_lib.bb/wake-session (via
# handoff_inject_lib.bb's deliver-parcel! - "the sender's own send" - and
# handoffd.bb's own notify! - "the handoff daemon") against a REAL private
# tmux server (BL-1390's proof posture: never the live one) started by this
# test - never a fake tmux binary, since what is under test is whether a
# real tmux send lands in the wrong real pane.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROBE="$SCRIPT_DIR/bl1719_wake_no_session_probe.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: this ROOT is an intentional throwaway test root
SOCK="$ROOT/private.sock"
unset TMUX 2>/dev/null || true

cleanup() {
  tmux -S "$SOCK" kill-server 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

WT_CODER2="$ROOT/wt-coder2"
mkdir -p "$ROOT/.swarmforge/handoffs/sent" "$WT_CODER2/.swarmforge/handoffs/inbox/new" "$WT_CODER2/.swarmforge/handoffs/inbox/completed"

echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
# specifier first (BL-1719's own live-incident shape: the mono-router
# resident remap picks the FIRST non-coordinator roles.tsv row); coder@2
# second, with a configured session that has NO matching tmux session.
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder@2\tcoder\t%s\tswarmforge-coder@2\tCoder2\tclaude\ttask\n' "$WT_CODER2" >> "$ROOT/.swarmforge/roles.tsv"

# A REAL private tmux server - specifier's session exists, coder@2's does not.
tmux -S "$SOCK" new-session -d -s swarmforge-specifier -n agent 2>/dev/null

# BL-1390 proof posture: the live repo's own tmux socket path never appears
# anywhere in this fixture - this test's own writes/reads stay confined to
# the private $SOCK under $ROOT, never touching the real running swarm.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIVE_SOCK_FILE="$REPO_ROOT/.swarmforge/tmux-socket"
if [[ -f "$LIVE_SOCK_FILE" ]]; then
  LIVE_SOCK="$(cat "$LIVE_SOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$LIVE_SOCK" ]] && grep -RIl -F -- "$LIVE_SOCK" "$ROOT" >/dev/null 2>&1; then
    fail "the live tmux socket path ($LIVE_SOCK) leaked into the fixture"
  fi
fi
pass "the live tmux socket path never appears in the fixture"

specifier_pane_text() {
  tmux -S "$SOCK" capture-pane -t swarmforge-specifier -p 2>/dev/null
}
# Let the pane's own shell finish starting and print its prompt before
# taking the "before" snapshot - otherwise that natural startup lag reads
# as a false "something was typed" difference against the "after" snapshot.
sleep 1
BEFORE_PANE="$(specifier_pane_text)"

write_note_outbox() {
  local f="$ROOT/.swarmforge/handoffs/sent/note-to-coder2.handoff"
  cat > "$f" <<EOF
id: bl1719-fixture-note-1
from: specifier
to: coder@2
priority: 00
type: note
message: BL-1719 fixture note
created_at: 2026-09-24T00:00:00Z

BL-1719 fixture note
EOF
  printf '%s' "$f"
}

# ── Scenario Outline 01: standing pack, both delivery paths ────────────────

# Path A: "the sender's own send" (handoff_inject_lib.bb's deliver-parcel!)
OUTBOX_A="$(write_note_outbox)"
SYNC_OUT="$(bb "$PROBE" sync-deliver "$ROOT" "$OUTBOX_A" specifier 2>&1)"
AFTER_PANE_A="$(specifier_pane_text)"
[[ "$AFTER_PANE_A" == "$BEFORE_PANE" ]] \
  || fail "01a: nothing should be typed into the specifier's pane, but pane text changed: before=[$BEFORE_PANE] after=[$AFTER_PANE_A]"
pass "01a: the sender's own send types nothing into the specifier's pane"

echo "$SYNC_OUT" | grep -q "deliver-notify-skip-no-session coder@2 swarmforge-coder@2" \
  || fail "01a: expected a skip logged naming coder@2's missing session (swarmforge-coder@2), got: $SYNC_OUT"
pass "01a: the sender's own send logs the skip naming coder@2's missing session"

grep -q "outcome=skip role=coder@2 session=swarmforge-coder@2" "$ROOT/.swarmforge/handoffs/inject-traffic.log" 2>/dev/null \
  || fail "01a: expected an inject-traffic.log skip row naming coder@2's own session, got: $(cat "$ROOT/.swarmforge/handoffs/inject-traffic.log" 2>/dev/null || echo '<missing>')"
pass "01a: the sender's own send records the skip in inject-traffic.log naming coder@2's own session, never another role's"

shopt -s nullglob
INBOX_FILES=("$WT_CODER2/.swarmforge/handoffs/inbox/new"/*.handoff)
shopt -u nullglob
(( ${#INBOX_FILES[@]} >= 1 )) \
  || fail "01a: expected the note in coder@2's own inbox/new/, found: ${INBOX_FILES[*]:-<none>}"
pass "01a: the note is in coder@2's inbox"

# Path B: "the handoff daemon" (handoffd.bb's own notify!)
DAEMON_OUT="$(bb "$PROBE" daemon-notify "$ROOT" "$SOCK" "swarmforge-coder@2" claude 2>&1)"
AFTER_PANE_B="$(specifier_pane_text)"
[[ "$AFTER_PANE_B" == "$BEFORE_PANE" ]] \
  || fail "01b: nothing should be typed into the specifier's pane, but pane text changed: before=[$BEFORE_PANE] after=[$AFTER_PANE_B]"
pass "01b: the handoff daemon types nothing into the specifier's pane"

grep -q "wake-skip-no-session swarmforge-coder@2" "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null \
  || fail "01b: expected handoffd.log to log the skip naming swarmforge-coder@2, got: $(cat "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null || echo '<missing>')"
pass "01b: the handoff daemon logs the skip naming coder@2's missing session"

# ── QA bounce D1 (2026-09-24): every OTHER injection path, not just the
#    two delivery paths above, must also reach no pane for a session-less
#    standing-pack recipient - notify-in-process-resume! (chase's own
#    stuck-nudge path), context-clear-injectors (the /clear + startup
#    re-read path), and babysitter_nudge_lib's own nudge, none of which
#    goes through handoff_inject_lib/handoffd's own notify! ──────────────

# Path C: the in-process resume nudge (handoffd.bb's own notify-in-process-resume!)
: > "$ROOT/.swarmforge/daemon/handoffd.log"
bb "$PROBE" daemon-resume "$ROOT" "$SOCK" "swarmforge-coder@2" claude >/dev/null 2>&1
AFTER_PANE_C="$(specifier_pane_text)"
[[ "$AFTER_PANE_C" == "$BEFORE_PANE" ]] \
  || fail "01c: the in-process resume nudge should type nothing into the specifier's pane, but pane text changed: [$AFTER_PANE_C]"
pass "01c: the in-process resume nudge types nothing into the specifier's pane"
grep -q "wake-skip-no-session swarmforge-coder@2" "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null \
  || fail "01c: expected handoffd.log to log the skip naming swarmforge-coder@2"
pass "01c: the in-process resume nudge logs the skip naming coder@2's missing session"

# Path D: the context-clear injectors (/clear and the startup re-read)
CLEAR_OUT="$(bb "$PROBE" daemon-context-clear "$ROOT" "$SOCK" coder@2 "swarmforge-coder@2" claude 2>&1)"
AFTER_PANE_D="$(specifier_pane_text)"
[[ "$AFTER_PANE_D" == "$BEFORE_PANE" ]] \
  || fail "01d: context-clear should type nothing into the specifier's pane, but pane text changed: [$AFTER_PANE_D]"
pass "01d: context-clear (both /clear and the startup re-read) types nothing into the specifier's pane"
echo "$CLEAR_OUT" | grep -q "INJECT_CLEAR: :no-session" \
  || fail "01d: expected the /clear inject to report :no-session, got: $CLEAR_OUT"
echo "$CLEAR_OUT" | grep -q "INJECT_STARTUP_REREAD: :no-session" \
  || fail "01d: expected the startup re-read inject to report :no-session, got: $CLEAR_OUT"
pass "01d: both context-clear injectors report :no-session, naming nothing to send"

# Path E: the babysitter's own nudge (a separate mechanism from handoffd)
NUDGE_OUT="$(bb "$PROBE" babysitter-nudge "$ROOT" coder@2 "hello" 2>&1)"
AFTER_PANE_E="$(specifier_pane_text)"
[[ "$AFTER_PANE_E" == "$BEFORE_PANE" ]] \
  || fail "01e: the babysitter nudge should type nothing into the specifier's pane, but pane text changed: [$AFTER_PANE_E]"
pass "01e: the babysitter's own nudge types nothing into the specifier's pane"
echo "$NUDGE_OUT" | grep -q ":status :no-session" \
  || fail "01e: expected the babysitter nudge to report :no-session, got: $NUDGE_OUT"
echo "$NUDGE_OUT" | grep -q "coder@2" \
  || fail "01e: expected the babysitter nudge's own detail to name coder@2, got: $NUDGE_OUT"
pass "01e: the babysitter's own nudge reports :no-session, naming coder@2's missing session"

# ── Scenario 02: a rotation-router pack keeps its resident remap ──────────
# "the sender's own send", matching the feature's own wording - a SECOND,
# fresh outbox file (scenario 01a's own was already delivered above).
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
cat > "$ROOT/.swarmforge/handoffs/sent/note-to-coder2-2.handoff" <<EOF
id: bl1719-fixture-note-2
from: specifier
to: coder@2
priority: 00
type: note
message: BL-1719 fixture note two
created_at: 2026-09-24T00:00:01Z

BL-1719 fixture note two
EOF
SYNC_OUT_2="$(bb "$PROBE" sync-deliver "$ROOT" "$ROOT/.swarmforge/handoffs/sent/note-to-coder2-2.handoff" specifier 2>&1)"
AFTER_PANE_2="$(specifier_pane_text)"
[[ "$AFTER_PANE_2" != "$BEFORE_PANE" ]] \
  || fail "02: expected the dormant role's wake to reach the resident's (specifier's) pane in a rotation-router pack, but nothing changed: $SYNC_OUT_2"
pass "02: a rotation-router pack still remaps a dormant role's wake to the resident"

echo "test_handoffd_wake_no_session_standing_pack: ALL SCENARIOS PASSED"
