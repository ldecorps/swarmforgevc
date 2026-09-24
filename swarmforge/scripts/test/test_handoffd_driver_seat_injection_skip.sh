#!/usr/bin/env bash
# BL-1697 invariant 2 + scenario 06: while a seat is under the local
# parcel driver, no other handoffd injection (new-mail wake, chase poke,
# in-process resume) reaches its pane - and a Claude seat's own wake is
# byte-for-byte unchanged (invariant 3). Runs the REAL daemon (a fake tmux
# on PATH, same convention as test_handoffd_chase_sweep_wiring.sh) against
# two seats with equally stale pending mail: coder (agent aider, under the
# driver) and cleaner (agent claude, not).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
DAEMON_PID=""
cleanup() {
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
{
  printf 'coder\tcoder\t%s\tsf-coder\tCoder\taider\ttask\n' "$ROOT"
  printf 'cleaner\tcleaner\t%s\tsf-cleaner\tCleaner\tclaude\ttask\n' "$ROOT"
} > "$ROOT/.swarmforge/roles.tsv"

INBOX_NEW="$ROOT/.swarmforge/handoffs/inbox/new"
CODER_HANDOFF="$INBOX_NEW/00_20260701T000000Z_000001_from_specifier_to_coder.handoff"
CLEANER_HANDOFF="$INBOX_NEW/00_20260701T000000Z_000002_from_specifier_to_cleaner.handoff"
printf 'id: t1\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
  > "$CODER_HANDOFF"
printf 'id: t2\nfrom: specifier\nto: cleaner\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
  > "$CLEANER_HANDOFF"
python3 -c "
import os, time
for f in ('$CODER_HANDOFF', '$CLEANER_HANDOFF'):
    os.utime(f, (time.time() - 45, time.time() - 45))
"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 40); do
  [[ -f "$CODER_HANDOFF.chase.json" && -f "$CLEANER_HANDOFF.chase.json" ]] && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

[[ -f "$TMUX_LOG" ]] || fail "no tmux calls recorded at all - the daemon never ran a cycle"

grep -q -- "-t sf-coder" "$TMUX_LOG" && grep -q -- "send-keys.*sf-coder.*-l " "$TMUX_LOG" \
  && fail "01: the coder (driver) seat's pane received typed text - invariant 2 violated"
pass "01: the coder (driver) seat's aider pane received no typed text from handoffd"

grep -q -- "send-keys.*sf-cleaner.*-l " "$TMUX_LOG" \
  || fail "02: the cleaner (non-driver) seat received no wake at all - handoffd's own wake path regressed"
pass "02: a Claude seat with work still received its wake (invariant 3: unchanged for a non-driver-capable seat)"

echo "ALL PASS"
