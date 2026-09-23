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

# BL-258: an optional :text override sends the caller-supplied literal
# instead of the agent's default wake message, through the SAME
# capture/submit/retry machinery (no separate send path to duplicate).
: > "$CALL_LOG"
PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$INJECT\")
(agent-runtime-inject/notify-agent! \"$SOCK\" \"$SESSION\" \"mock\" :text \"An arbitrary override literal for this test only.\")
"

grep -q -- '-l MOCK_WAKE' "$CALL_LOG" && fail "expected the :text override to replace the default mock wake literal, not send it too"
grep -q -- "An arbitrary override literal" "$CALL_LOG" || fail "expected the :text override literal to be sent via tmux send-keys"

pass ":text override replaces the default wake message through the same tmux machinery"

# 2026-09-23: an aider (:shell-run-script) :text override still gets the
# no-narration suffix appended, but its "nothing to do" fallback command
# must be overridable via :fallback-command - the in-process-resume banner
# forbids ready_for_next.sh in its own body, so its caller (handoffd's
# notify-in-process-resume!) must NOT get the default fallback, which would
# tell the agent to reply with exactly that forbidden command.
: > "$CALL_LOG"
PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$INJECT\")
(agent-runtime-inject/notify-agent! \"$SOCK\" \"$SESSION\" \"aider\" :text \"STOP. Do NOT run ready_for_next.sh again.\")
"
grep -q -- 'reply must be exactly this one line: `! swarmforge/scripts/ready_for_next.sh`' "$CALL_LOG" \
  || fail "expected the DEFAULT fallback (no :fallback-command given) to stay ready_for_next.sh, byte-for-byte, for backward compat"

pass "aider :text override with no :fallback-command keeps today's ready_for_next.sh fallback"

: > "$CALL_LOG"
PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$INJECT\")
(agent-runtime-inject/notify-agent! \"$SOCK\" \"$SESSION\" \"aider\" :text \"STOP. Do NOT run ready_for_next.sh again.\" :fallback-command \"true\")
"
grep -q -- 'reply must be exactly this one line: `! true`' "$CALL_LOG" \
  || fail "expected :fallback-command \"true\" to replace the literal fallback command"
grep -q -- 'ready_for_next.sh`' "$CALL_LOG" \
  && fail "expected the forbidden ready_for_next.sh to be ABSENT from the fallback when overridden"

pass "aider :text override with :fallback-command \"true\" never reinstates the forbidden command"
echo "ALL PASS"
