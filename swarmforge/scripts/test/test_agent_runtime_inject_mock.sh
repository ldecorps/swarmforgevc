#!/usr/bin/env bash
# Unit test: agent_runtime_inject executes mock-agent steps through fake tmux.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INJECT="$SCRIPT_DIR/../agent_runtime_inject.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
SESSION="swarmforge-mock"
CALL_LOG="$ROOT/tmux-calls.log"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

export CALL_LOG
PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$INJECT\")
(agent-runtime-inject/notify-agent! \"$SOCK\" \"$SESSION\" \"mock\")
(agent-runtime-inject/run-bootstrap! \"$SOCK\" \"$SESSION\" \"mock\" \"coder\" \"/tmp/prompt.md\" false)
"

grep -q -- '-l MOCK_WAKE' "$CALL_LOG" || fail "expected mock wake literal send"
grep -q -- '-l MOCK_BOOTSTRAP' "$CALL_LOG" || fail "expected mock bootstrap literal send"
grep -c -- 'C-m' "$CALL_LOG" | grep -qE '^[2-9]' || fail "expected submit keys for wake and bootstrap"

pass "mock agent inject uses facade steps through tmux"
echo "ALL PASS"
