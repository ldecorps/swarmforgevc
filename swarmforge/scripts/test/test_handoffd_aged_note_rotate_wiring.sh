#!/usr/bin/env bash
# BL-576 (hardener finding F1): architect review found that the acceptance
# feature's own step handlers hand-build mono-router-lib score rows in JS,
# bypassing handoffd.bb's role-mail-row entirely - the ONE place the
# regression it names could occur ("delete aged-notes from (concat held
# git-hfs aged-notes) and every acceptance/unit assertion stays green while
# note-only mailboxes starve in production"). This is a real (but fake-tmux)
# daemon wiring test over the two untested points:
#   (a) role-mail-row feeds an aged note's created_at into :newest-created-at
#       (the ordering key), not just :aged-note-count;
#   (b) a FRESH note never rotates the resident (the broadcast-thrash guard
#       this ticket must not weaken).
#
# Drives the real chase sweep end to end: a dormant role holding only an
# aged note gets rotated to (rotate-resident-to! actually fires, via a fake
# tmux respawn-pane), and a competing dormant role's OLDER git_handoff must
# lose to the NEWER aged note - which fails today if aged notes are ever
# dropped from the ordering concat, even though every existing unit/
# acceptance assertion would still pass.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

RESIDENT_SESSION="swarmforge-coder"

make_fake_tmux() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "\$TMUX_LOG"
target=""
prev=""
for arg in "\$@"; do
  if [[ "\$prev" == "-t" ]]; then target="\$arg"; fi
  prev="\$arg"
done
if [[ "\$*" == *"has-session"* ]]; then
  if [[ "\$target" == "$RESIDENT_SESSION" ]]; then exit 0; else exit 1; fi
fi
if [[ "\$*" == *"capture-pane"* ]]; then
  echo ""
  exit 0
fi
exit 0
TMUX
  chmod +x "$bin_dir/tmux"
}

iso_ago() {
  # minutes ago, real wall clock (note-aged?/role-mail-row read System/currentTimeMillis)
  python3 -c "import datetime,sys; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1"
}

backdate() {
  python3 -c "import os,time,sys; p=sys.argv[1]; os.utime(p, (time.time()-45, time.time()-45))" "$1"
}

setup_common_fixture() {
  local root="$1"
  git -C "$root" init -q
  git -C "$root" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init

  mkdir -p "$root/.swarmforge" "$root/.swarmforge/launch" "$root/backlog/active"

  local coder_wt="$root/wt-coder"
  local spec_wt="$root/wt-specifier"
  local clean_wt="$root/wt-cleaner"
  mkdir -p "$coder_wt/.swarmforge/handoffs/inbox/new" "$coder_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$spec_wt/.swarmforge/handoffs/inbox/new" "$spec_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$clean_wt/.swarmforge/handoffs/inbox/new" "$clean_wt/.swarmforge/handoffs/inbox/in_process"

  {
    printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$coder_wt"
    printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$spec_wt"
    printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$clean_wt"
  } > "$root/.swarmforge/roles.tsv"

  touch "$root/fake.sock"
  echo "$root/fake.sock" > "$root/.swarmforge/tmux-socket"

  printf '#!/bin/sh\nexit 0\n' > "$root/.swarmforge/launch/specifier.sh"
  chmod +x "$root/.swarmforge/launch/specifier.sh"

  echo "$spec_wt"
  echo "$clean_wt"
}

run_daemon() {
  local root="$1" fake_bin="$2"
  # bash -c ... exec: guarantees $! is the real bb pid (no lingering cd
  # subshell wrapper to lose track of when killing/waiting on it later).
  # stdout/stderr MUST be redirected to a file, not inherited: this function
  # is invoked as PID_A="$(run_daemon ...)" - a background job that still
  # holds the command-substitution pipe's write end keeps that $(...) call
  # blocked until the (multi-minute) daemon exits, hanging the whole script.
  SWARMFORGE_ALLOW_TMP_DAEMON=1 PATH="$fake_bin:$PATH" \
    bash -c "cd '$root' && exec bb '$HANDOFFD' '$root'" > "$root/daemon-stdout.log" 2>&1 &
  echo $!
}

stop_daemon() {
  local root="$1" pid="$2"
  mkdir -p "$root/.swarmforge/daemon"
  touch "$root/.swarmforge/daemon/stop"
  wait "$pid" 2>/dev/null || true
}

# ── Scenario A: aged note in a note-only mailbox actually rotates ──────────
# and a competing OLDER git_handoff in another dormant mailbox must lose -
# this is the ordering-key regression F1 names (role-mail-row must feed the
# aged note's created_at into :newest-created-at, not just :aged-note-count).
ROOT_A="$(cd "$(mktemp -d)" && pwd -P)"
FAKE_BIN_A="$ROOT_A/bin"
PID_A=""
cleanup_a() {
  [[ -n "$PID_A" ]] && kill "$PID_A" 2>/dev/null || true
  rm -rf "$ROOT_A"
}
trap cleanup_a EXIT

make_fake_tmux "$FAKE_BIN_A"
TMUX_LOG="$ROOT_A/tmux-calls.log"
export TMUX_LOG
touch "$TMUX_LOG"

mapfile -t FIXTURE_A < <(setup_common_fixture "$ROOT_A")
SPEC_WT_A="${FIXTURE_A[0]}"
CLEAN_WT_A="${FIXTURE_A[1]}"

# specifier: ONE note, enqueued 25 minutes ago (aged past the 20-minute default).
NOTE_AT_A="$(iso_ago 25)"
NOTE_FILE_A="$SPEC_WT_A/.swarmforge/handoffs/inbox/new/00_note_from_qa_to_specifier.handoff"
printf 'id: n1\nfrom: qa\nto: specifier\npriority: 00\ntype: note\nmessage: merge up\nenqueued_at: %s\ncreated_at: %s\n\nbody\n' \
  "$NOTE_AT_A" "$NOTE_AT_A" > "$NOTE_FILE_A"
backdate "$NOTE_FILE_A"

# cleaner: an OLDER (40-minutes-ago) git_handoff - actionable regardless of
# age, but the note above is NEWER, so preferred-rotate-target must still
# pick specifier if (and only if) the aged note feeds the ordering key.
GH_AT_A="$(iso_ago 40)"
GH_FILE_A="$CLEAN_WT_A/.swarmforge/handoffs/inbox/new/00_gh_from_architect_to_cleaner.handoff"
printf 'id: g1\nfrom: architect\nto: cleaner\npriority: 00\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\ncreated_at: %s\n\nmerge_and_process architect aaaaaaaaaa\n' \
  "$GH_AT_A" > "$GH_FILE_A"
backdate "$GH_FILE_A"

PID_A="$(run_daemon "$ROOT_A" "$FAKE_BIN_A")"

LOG_A="$ROOT_A/.swarmforge/daemon/handoffd.log"
DEADLINE=$(( $(date +%s) + 40 ))
while [[ $(date +%s) -lt $DEADLINE ]]; do
  [[ -f "$LOG_A" ]] && grep -q "chase-rotate specifier" "$LOG_A" && break
  sleep 0.5
done

stop_daemon "$ROOT_A" "$PID_A"

[[ -f "$LOG_A" ]] || fail "A: handoffd never wrote a log file"
grep -q "chase-rotate specifier" "$LOG_A" \
  || fail "A: the resident was never rotated to specifier for its aged note (log: $(cat "$LOG_A" 2>/dev/null))"
grep -q "chase-rotate cleaner" "$LOG_A" \
  && fail "A: cleaner's OLDER git_handoff wrongly won the rotate over specifier's newer aged note"
[[ -f "$ROOT_A/.swarmforge/mono-router-active-role" ]] \
  || fail "A: rotate-resident-to! never wrote the mono-router-active-role marker"
grep -q "^specifier$" "$ROOT_A/.swarmforge/mono-router-active-role" \
  || fail "A: mono-router-active-role does not read 'specifier' after the rotate"
grep -q "respawn-pane" "$TMUX_LOG" || fail "A: no real tmux respawn-pane call was made"
pass "A (F1 ordering-key wiring): an aged note in an otherwise-empty mailbox out-ranks an older git_handoff and the resident actually rotates to it"

trap - EXIT
cleanup_a

# ── Scenario B: a FRESH note never rotates the resident (broadcast-thrash guard) ──
ROOT_B="$(cd "$(mktemp -d)" && pwd -P)"
FAKE_BIN_B="$ROOT_B/bin"
PID_B=""
cleanup_b() {
  [[ -n "$PID_B" ]] && kill "$PID_B" 2>/dev/null || true
  rm -rf "$ROOT_B"
}
trap cleanup_b EXIT

make_fake_tmux "$FAKE_BIN_B"
TMUX_LOG="$ROOT_B/tmux-calls.log"
export TMUX_LOG
touch "$TMUX_LOG"

mapfile -t FIXTURE_B < <(setup_common_fixture "$ROOT_B")
SPEC_WT_B="${FIXTURE_B[0]}"

# specifier: ONE note enqueued 2 minutes ago - well short of the 20-minute
# default threshold. The FILE mtime is still backdated past chaseTimeoutSeconds
# so the chase sweep actually reaches this item (mtime staleness gates WHEN
# chase looks at an item at all; note_actionable_after_ms gates whether that
# look is allowed to rotate the resident - two independent clocks).
NOTE_AT_B="$(iso_ago 2)"
NOTE_FILE_B="$SPEC_WT_B/.swarmforge/handoffs/inbox/new/00_note_from_qa_to_specifier.handoff"
printf 'id: n1\nfrom: qa\nto: specifier\npriority: 00\ntype: note\nmessage: merge up\nenqueued_at: %s\ncreated_at: %s\n\nbody\n' \
  "$NOTE_AT_B" "$NOTE_AT_B" > "$NOTE_FILE_B"
backdate "$NOTE_FILE_B"

PID_B="$(run_daemon "$ROOT_B" "$FAKE_BIN_B")"

LOG_B="$ROOT_B/.swarmforge/daemon/handoffd.log"
DEADLINE=$(( $(date +%s) + 40 ))
while [[ $(date +%s) -lt $DEADLINE ]]; do
  [[ -f "$LOG_B" ]] && grep -q "chase-rotate-skip-broadcast specifier" "$LOG_B" && break
  sleep 0.5
done

stop_daemon "$ROOT_B" "$PID_B"

[[ -f "$LOG_B" ]] || fail "B: handoffd never wrote a log file"
grep -q "chase-rotate-skip-broadcast specifier" "$LOG_B" \
  || fail "B: the fresh note was never even considered (expected a skip-broadcast decision); log: $(cat "$LOG_B" 2>/dev/null)"
grep -q "chase-rotate specifier" "$LOG_B" \
  && fail "B: a FRESH note (2 minutes old) wrongly rotated the resident - the broadcast-thrash guard regressed"
[[ -f "$ROOT_B/.swarmforge/mono-router-active-role" ]] \
  && fail "B: mono-router-active-role was written even though nothing should have rotated"
pass "B (F1 fresh-note guard): a fresh note never rotates the resident, preserving the broadcast-thrash protection"

trap - EXIT
cleanup_b

echo "ALL PASS: test_handoffd_aged_note_rotate_wiring.sh"
