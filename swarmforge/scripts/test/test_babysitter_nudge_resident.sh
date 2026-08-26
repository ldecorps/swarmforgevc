#!/usr/bin/env bash
# Verified babysitter resident nudge — BL-093 seam for hawk -> swarm panes.
# Covers: verified submit (C-m/C-j), SKIP_BUSY when pane mid-turn, graceful
# NO_NUDGE when swarm not running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NUDGE="$SCRIPT_DIR/../babysitter_nudge_resident.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
CODER_WT="$ROOT/.worktrees/coder"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
BEFORE_STDOUT_FILE="$ROOT/before-stdout.txt"
AFTER_STDOUT_FILE="$ROOT/after-stdout.txt"
CAPTURE_COUNT_FILE="$ROOT/capture-count"
export CALL_LOG BEFORE_STDOUT_FILE AFTER_STDOUT_FILE CAPTURE_COUNT_FILE

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "capture-pane" ]]; then
    count="$(cat "$CAPTURE_COUNT_FILE" 2>/dev/null || echo 0)"
    echo $((count + 1)) > "$CAPTURE_COUNT_FILE"
    if [[ "$count" == "0" ]]; then
      cat "$BEFORE_STDOUT_FILE" 2>/dev/null
    else
      cat "$AFTER_STDOUT_FILE" 2>/dev/null
    fi
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

MSG='BABYSITTER: commit uncommitted work now, then continue the in_process task.'

# ── 1: idle pane — literal + verified submit ────────────────────────────────
printf '❯ \n' > "$BEFORE_STDOUT_FILE"
printf '❯ \n' > "$AFTER_STDOUT_FILE"
: > "$CALL_LOG"
echo 0 > "$CAPTURE_COUNT_FILE"
OUT="$(PATH="$FAKE_BIN:$PATH" bb "$NUDGE" "$ROOT" coder "$MSG")"
grep -q "^NUDGED:" <<< "$OUT" || fail "01: expected NUDGED; got: $OUT"
grep -q -- "$MSG" "$CALL_LOG" || fail "01: expected message literal in tmux log"
grep -q -- 'C-m' "$CALL_LOG" || fail "01: expected verified submit (C-m)"
pass "01: idle pane receives verified nudge with Enter"

# ── 2: busy pane — no inject, SKIP_BUSY ─────────────────────────────────────
printf '  esc to interrupt\n' > "$BEFORE_STDOUT_FILE"
printf '❯ \n' > "$AFTER_STDOUT_FILE"
: > "$CALL_LOG"
echo 0 > "$CAPTURE_COUNT_FILE"
OUT="$(PATH="$FAKE_BIN:$PATH" bb "$NUDGE" "$ROOT" coder "$MSG")"
grep -q "^SKIP_BUSY:" <<< "$OUT" || fail "02: expected SKIP_BUSY; got: $OUT"
grep -q -- '-l' "$CALL_LOG" && fail "02: must not send literal while pane busy; log: $(cat "$CALL_LOG")"
pass "02: mid-turn pane skips inject (SKIP_BUSY)"

# ── 3: no swarm — graceful NO_NUDGE ─────────────────────────────────────────
NO_SWARM="$(mktemp -d)"
OUT="$(bb "$NUDGE" "$NO_SWARM" coder "$MSG")"
grep -q "^NO_NUDGE:" <<< "$OUT" || fail "03: expected NO_NUDGE; got: $OUT"
rm -rf "$NO_SWARM"
pass "03: missing swarm degrades gracefully"

echo "ALL PASS"
