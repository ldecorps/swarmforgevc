#!/usr/bin/env bash
# BL-1991: a local-model seat's generated launch script (write_role_
# launch_script's `local-model)` case in swarmforge.sh) must relaunch
# qwen with a pending restart override after qwen exits for ANY reason -
# including the repeat guard's own end-qwen-process! kill, which is a
# non-zero/signalled exit.
#
# Architect bounce 2026-10-05 (backlog/evidence/BL-1991-architect-bounce-
# 20261005.md): the whole generated launch script runs under `set -euo
# pipefail` (write_role_launch_script's fixed template header), so a
# killed-for-restart qwen aborted the script before the pending-override
# check ever ran - the one case this feature exists to handle silently
# defeated it. This test runs the REAL case block (extracted from the
# live swarmforge.sh the same way test_bl1971_local_model_repeat_guard.sh
# extracts write_local_model_qwen_settings) under the real template's own
# `set -euo pipefail`, against a fake qwen, so a regression that drops
# the `|| true` fix is caught here rather than only on a live pane.
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TEST_DIR/lib/tmp_cleanup.sh"
SCRIPTS="$(cd "$TEST_DIR/.." && pwd)"
SWARMFORGE_SH="$SCRIPTS/swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Extract the `local-model)` ... `;;` case block, the same awk shape
# test_bl1971 uses for a whole function.
case_text="$(awk '
  /^    local-model\)/ { flag=1 }
  flag { print }
  flag && /^      ;;/ { exit }
' "$SWARMFORGE_SH")"
[[ -n "$case_text" ]] || fail "local-model) case not found in $SWARMFORGE_SH"

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
BIN="$ROOT/bin"
mkdir -p "$BIN" "$ROOT/.swarmforge/local-seat-restart"

# A zsh harness: run the REAL case block (wrapped in its own case
# statement, with the one function it calls stubbed) to build
# launch_body, then source launch_body itself under the real template's
# own `set -euo pipefail` - exactly the two-stage shape
# write_role_launch_script itself uses (build the string, then the
# caller writes and runs it).
build_launch_body() {
  local role_worktree="$1" prompt_file="$2"
  local harness="$ROOT/harness.zsh"
  {
    printf '#!/usr/bin/env zsh\n'
    printf 'function swarm_only_strip_seat_tier() { echo "$1"; }\n'
    printf 'local role_worktree=%q\n' "$role_worktree"
    printf 'local prompt_file=%q\n' "$prompt_file"
    printf 'local extra_cli=""\n'
    printf 'local agent="local-model"\n'
    printf 'local launch_body=""\n'
    printf 'case "$agent" in\n'
    printf '%s\n' "$case_text"
    printf 'esac\n'
    printf 'print -r -- "$launch_body" > %q\n' "$ROOT/launch_body.sh"
  } > "$harness"
  zsh -f "$harness"
}

run_launch_body() {
  local qwen_exit="$1"
  cat > "$BIN/qwen" <<FAKE
#!/usr/bin/env zsh
echo "QWEN_INVOKED \$*" >> "$ROOT/qwen_calls.log"
exit $qwen_exit
FAKE
  chmod +x "$BIN/qwen"
  : > "$ROOT/qwen_calls.log"
  PATH="$BIN:/usr/bin:/bin" LOCAL_RESUME_NOTE="" \
    zsh -f -c "set -euo pipefail; source $(printf '%q' "$ROOT/launch_body.sh"); echo SCRIPT_FINISHED"
}

build_launch_body "$ROOT" "$ROOT/card.md"
[[ -s "$ROOT/launch_body.sh" ]] || fail "the case block produced no launch_body"
grep -q 'pending_msgs' "$ROOT/launch_body.sh" || fail "launch_body does not contain the restart loop"
pass "the real local-model) case block builds a launch_body carrying the restart loop"

# Scenario 1: qwen exits non-zero (the repeat guard's kill) with a pending
# override waiting - the script must survive set -e, relaunch once with
# that override, and consume the file.
echo "override after kill" > "$ROOT/.swarmforge/local-seat-restart/parcel.json.msg"
out="$(run_launch_body 143)"
[[ "$out" == *"SCRIPT_FINISHED"* ]] || fail "the script aborted under set -e instead of reaching the restart loop: $out"
calls="$(cat "$ROOT/qwen_calls.log")"
[[ "$(wc -l < "$ROOT/qwen_calls.log")" -eq 2 ]] || fail "expected exactly 2 qwen invocations (kickoff + one relaunch), got:\n$calls"
last_call="$(tail -1 "$ROOT/qwen_calls.log")"
[[ "$last_call" == *"override after kill"* ]] || fail "the relaunch's message was not the pending override: $calls"
[[ ! -e "$ROOT/.swarmforge/local-seat-restart/parcel.json.msg" ]] || fail "the pending override file was not consumed"
pass "a non-zero qwen exit (the repeat guard's kill) with a pending override relaunches qwen with it, surviving set -e"

# Scenario 2: qwen exits non-zero with NOTHING pending - an ordinary crash,
# unrelated to a restart - must still just end the script, no loop.
out="$(run_launch_body 143)"
[[ "$out" == *"SCRIPT_FINISHED"* ]] || fail "an ordinary non-zero qwen exit aborted the script: $out"
[[ "$(wc -l < "$ROOT/qwen_calls.log")" -eq 1 ]] || fail "expected exactly 1 qwen invocation (no restart pending), got:\n$(cat "$ROOT/qwen_calls.log")"
pass "a non-zero qwen exit with nothing pending runs the script to completion with no relaunch loop"

# Scenario 3: qwen exits 0 (an ordinary clean exit) with nothing pending -
# must behave identically to scenario 2.
out="$(run_launch_body 0)"
[[ "$out" == *"SCRIPT_FINISHED"* ]] || fail "a clean qwen exit did not reach the end of the script: $out"
[[ "$(wc -l < "$ROOT/qwen_calls.log")" -eq 1 ]] || fail "expected exactly 1 qwen invocation, got:\n$(cat "$ROOT/qwen_calls.log")"
pass "a clean qwen exit with nothing pending runs the script to completion with no relaunch loop"

echo "ALL PASS"
