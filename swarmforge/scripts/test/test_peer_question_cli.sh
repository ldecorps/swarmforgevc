#!/usr/bin/env bash
# BL-1754: drives the REAL peer_question.bb against the real
# peer_question_fixture.sh (same fixture bl1754PeerQuestionSteps.js uses),
# never a reimplementation of the CLI. Covers what the Gherkin feature
# doesn't need to: the bare-invocation usage line, and the "claude exited
# nonzero for a reason other than a timeout" path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$REAL_SCRIPTS_DIR/peer_question.bb"
FIXTURE_SH="$SCRIPT_DIR/peer_question_fixture.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

# 01: bare invocation - no arguments at all - prints usage and exits nonzero.
set +e
out01="$(bb "$CLI" 2>&1)"
ec01=$?
set -e
[[ "$ec01" != "0" ]] || fail "01: expected a nonzero exit for a bare invocation, got 0"
echo "$out01" | grep -i "usage" >/dev/null || fail "01: expected a usage line, got: $out01"
pass "01: bare invocation prints usage and exits nonzero"

# 02: a missing --question (project-root/--from/--to present) is ALSO a
# usage refusal, never a crash reading a nil question.
DEST02="$ROOT/fx02"
bash "$FIXTURE_SH" "$DEST02" > /dev/null
set +e
out02="$(bb "$CLI" "$DEST02" --from QA --to specifier 2>&1)"
ec02=$?
set -e
[[ "$ec02" != "0" ]] || fail "02: expected a nonzero exit for a missing --question, got 0"
echo "$out02" | grep -i "usage" >/dev/null || fail "02: expected a usage line, got: $out02"
pass "02: a missing required flag is a usage refusal, not a crash"

# 03: a normal ask - the fake answers, the CLI prints it on stdout, exits 0,
# and records from/to/question/answer under .swarmforge/peer-questions/.
DEST03="$ROOT/fx03"
bash "$FIXTURE_SH" "$DEST03" > /dev/null
export CLAUDE_FAKE_LOG="$DEST03/claude-calls.log"
export CLAUDE_FAKE_ANSWER="the answer is 42"
: > "$CLAUDE_FAKE_LOG"
out03="$(PATH="$DEST03/fake-bin:$PATH" bb "$CLI" "$DEST03" --from QA --to specifier --question "does scenario 03 still apply?")"
[[ "$out03" == "the answer is 42" ]] || fail "03: expected the fake's answer on stdout, got: $out03"
record03="$(find "$DEST03/.swarmforge/peer-questions" -type f -name '*.json' | head -1)"
[[ -n "$record03" ]] || fail "03: expected a question record to be written"
grep -q '"status" : "answered"' "$record03" || fail "03: expected status answered, got: $(cat "$record03")"
grep -q '"answer" : "the answer is 42"' "$record03" || fail "03: expected the answer recorded verbatim"
grep -q '"question" : "does scenario 03 still apply?"' "$record03" || fail "03: expected the question recorded verbatim"
unset CLAUDE_FAKE_LOG CLAUDE_FAKE_ANSWER
pass "03: a normal ask prints the answer, exits 0, records from/to/question/answer"

# 04: an unsupported provider (aider) refuses by name, exits nonzero, and
# claude is never invoked (the log stays empty).
DEST04="$ROOT/fx04"
bash "$FIXTURE_SH" "$DEST04" --to-provider specifier=aider > /dev/null
export CLAUDE_FAKE_LOG="$DEST04/claude-calls.log"
: > "$CLAUDE_FAKE_LOG"
set +e
out04="$(PATH="$DEST04/fake-bin:$PATH" bb "$CLI" "$DEST04" --from QA --to specifier --question "q?" 2>&1)"
ec04=$?
set -e
[[ "$ec04" != "0" ]] || fail "04: expected a nonzero exit for an unsupported provider, got 0"
echo "$out04" | grep "aider" >/dev/null || fail "04: expected the refusal to name the provider, got: $out04"
[[ ! -s "$CLAUDE_FAKE_LOG" ]] || fail "04: expected claude to never be invoked, got: $(cat "$CLAUDE_FAKE_LOG")"
unset CLAUDE_FAKE_LOG
pass "04: an unsupported provider refuses by name, never invokes claude"

# 05: unanswered within the bound - the fake never returns - times out,
# exits nonzero, and the fake's own process is confirmed dead afterward
# (this ticket's invariant 2: no process the helper started is alive).
DEST05="$ROOT/fx05"
bash "$FIXTURE_SH" "$DEST05" > /dev/null
export CLAUDE_FAKE_LOG="$DEST05/claude-calls.log"
export CLAUDE_FAKE_PIDFILE="$DEST05/claude.pid"
export CLAUDE_FAKE_SLEEP_S=30
: > "$CLAUDE_FAKE_LOG"
set +e
out05="$(PATH="$DEST05/fake-bin:$PATH" bb "$CLI" "$DEST05" --from QA --to specifier --question "q?" --timeout-s 2 2>&1)"
ec05=$?
set -e
[[ "$ec05" != "0" ]] || fail "05: expected a nonzero exit on timeout, got 0"
echo "$out05" | grep -i "timed out\|timeout" >/dev/null || fail "05: expected the output to say it timed out, got: $out05"
sleep 1
fake_pid="$(cat "$DEST05/claude.pid" 2>/dev/null || true)"
[[ -n "$fake_pid" ]] || fail "05: expected the fake to have recorded its own pid"
if kill -0 "$fake_pid" 2>/dev/null; then
  fail "05: the timed-out fake claude process is still alive (pid $fake_pid)"
fi
unset CLAUDE_FAKE_LOG CLAUDE_FAKE_PIDFILE CLAUDE_FAKE_SLEEP_S
pass "05: an unanswered ask times out, exits nonzero, and leaves no live process"

# 06: claude exits nonzero for a reason other than a timeout - never
# reported as "answered", never reported as "timed-out" either.
DEST06="$ROOT/fx06"
bash "$FIXTURE_SH" "$DEST06" > /dev/null
export CLAUDE_FAKE_LOG="$DEST06/claude-calls.log"
export CLAUDE_FAKE_EXIT=1
: > "$CLAUDE_FAKE_LOG"
set +e
out06="$(PATH="$DEST06/fake-bin:$PATH" bb "$CLI" "$DEST06" --from QA --to specifier --question "q?" 2>&1)"
ec06=$?
set -e
[[ "$ec06" != "0" ]] || fail "06: expected a nonzero exit, got 0"
record06="$(find "$DEST06/.swarmforge/peer-questions" -type f -name '*.json' | head -1)"
[[ -n "$record06" ]] || fail "06: expected a question record to be written even on a bare claude failure"
grep -q '"status" : "failed"' "$record06" || fail "06: expected status failed, got: $(cat "$record06")"
unset CLAUDE_FAKE_LOG CLAUDE_FAKE_EXIT
pass "06: a bare claude failure (not a timeout) is reported as failed, never answered"

echo "test_peer_question_cli: ALL CHECKS PASSED"
