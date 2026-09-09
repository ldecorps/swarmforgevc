#!/usr/bin/env bash
# Hotfix 2026-09-09 (fresh-target): a respawned/rotated seat is woken at
# daemon startup even when its mailbox fingerprint is unchanged.
#
# Incident: the documenter seat was rotated at 07:54Z with its parcel still
# in in_process; handoffd's startup-notify read the pre-rotation wake-dedup
# sidecar, logged `wake-dedup-skip documenter unchanged-mailbox`, and the
# fresh aider session never received `! ./swarmforge/scripts/ready_for_next.sh`
# (2h28m flow-stall escalation).
#
# Fixture: the fake tmux answers `list-panes -F #{pane_pid}` with
# $FAKE_PANE_PID so the test can change the seat identity between runs.
#   run 1 (pid 111): no sidecar             -> coder woken
#   run 2 (pid 111): same mailbox, same pid -> suppressed (no new wake)
#   run 3 (pid 222): same mailbox, NEW pid  -> woken again (fresh-target)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: intentional throwaway test root
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

CODER_WT="$ROOT/.worktrees/coder"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
mkdir -p "$CODER_WT/.swarmforge/handoffs/inbox/new"
printf 'type: git_handoff\nto: coder\npriority: 50\ntask: BL-020\n' \
  > "$CODER_WT/.swarmforge/handoffs/inbox/new/50_test_pending.handoff"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
NOTIFY_LOG="$ROOT/tmux-calls.log"
export NOTIFY_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$NOTIFY_LOG"
case "$*" in
  *list-panes*pane_pid*) echo "${FAKE_PANE_PID:-}";;
esac
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

wakes() { grep -c 'send-keys -t swarmforge-coder -l' "$NOTIFY_LOG" 2>/dev/null || true; }

FAKE_PANE_PID=111 PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --startup-notify-only
n1=$(wakes)
[[ "$n1" -ge 1 ]] || fail "run 1: coder was not woken at all (wakes=$n1)"
pass "run 1: fresh sidecar, coder woken (wakes=$n1)"

SIDECAR="$ROOT/.swarmforge/daemon/wake-dedup/coder.json"
[[ -f "$SIDECAR" ]] || fail "sidecar not written at $SIDECAR"
grep -q '"lastTargetEpoch":"pane-pid:111"' "$SIDECAR" || fail "sidecar does not record the seat epoch: $(cat "$SIDECAR")"
pass "sidecar records lastTargetEpoch pane-pid:111"

FAKE_PANE_PID=111 PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --startup-notify-only
n2=$(wakes)
[[ "$n2" -eq "$n1" ]] || fail "run 2: same seat + unchanged mailbox must be suppressed (wakes $n1 -> $n2)"
pass "run 2: same seat, unchanged mailbox, suppressed"

FAKE_PANE_PID=222 PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --startup-notify-only
n3=$(wakes)
[[ "$n3" -gt "$n2" ]] || fail "run 3: respawned seat (new pane pid) was NOT woken despite unchanged mailbox (wakes $n2 -> $n3)"
pass "run 3: respawned seat woken again (fresh-target)"
grep -q '"lastTargetEpoch":"pane-pid:222"' "$SIDECAR" || fail "sidecar epoch not advanced: $(cat "$SIDECAR")"
pass "sidecar epoch advanced to pane-pid:222"
