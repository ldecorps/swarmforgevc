#!/usr/bin/env bash
# BL-1971 (stamp-off of the 2026-10-04 repeat-guard hotfix): a local-model
# seat's .qwen/settings.json registers the master checkout's
# local_model_repeat_guard.bb as a qwen PreToolUse hook for every tool, the
# provider entry merge keeps it, and the guard refuses a call the seat has
# already made twice with the same arguments since its last edit, commit or
# compaction - and lets everything else run.
#
# The writer is EXTRACTED from the live swarmforge.sh and eval'd, the same
# way test_bl1949_local_model_precompact_hook.sh does it.
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$TEST_DIR"
source "$TEST_DIR/lib/tmp_cleanup.sh"
SCRIPTS="$(cd "$TEST_DIR/.." && pwd)"
SWARMFORGE_SH="$SCRIPTS/swarmforge.sh"
GUARD="$SCRIPTS/local_model_repeat_guard.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

fn_text="$(awk '
  /^write_local_model_qwen_settings\(\) \{/ { flag=1 }
  flag && in_heredoc { print; if ($0 == "JSON") { in_heredoc=0 }; next }
  flag && /<<.JSON.$/ { in_heredoc=1; print; next }
  flag { print }
  flag && !in_heredoc && /^\}/ { exit }
' "$SWARMFORGE_SH")"
[[ -n "$fn_text" ]] || fail "write_local_model_qwen_settings not found in $SWARMFORGE_SH"
eval "$fn_text"

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
SCRIPT_DIR="$SCRIPTS"
write_local_model_qwen_settings "$ROOT"
SETTINGS="$ROOT/.qwen/settings.json"

guard_registered() {
  python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
groups = d["hooks"]["PreToolUse"]
assert len(groups) == 1, groups
assert groups[0]["matcher"] == "", groups
hooks = groups[0]["hooks"]
assert len(hooks) == 1 and hooks[0]["type"] == "command", hooks
assert hooks[0]["command"] == sys.argv[2], hooks
assert "PreCompact" in d["hooks"] and "PostToolUse" in d["hooks"], d["hooks"]
' "$SETTINGS" "bb '$GUARD'"
}

guard_registered || fail "settings.json carries no single PreToolUse command hook for every tool naming $GUARD"
pass "the settings register the master checkout's repeat guard for every tool, beside the other hooks"

! grep -q '__SWARMFORGE_REPEAT_GUARD__' "$SETTINGS" || fail "the repeat guard placeholder was left in the written settings"
pass "no repeat guard placeholder is left in the written settings"

bb "$SCRIPTS/local_model_qwen_provider_cli.bb" write \
  --settings-file "$SETTINGS" --model "fixture-model:latest" \
  --endpoint-url "http://127.0.0.1:9/v1" --context-length 32768 \
  --base-url "http://127.0.0.1:9/v1" --role coder >/dev/null 2>&1 || true
guard_registered || fail "the provider entry merge dropped the repeat guard"
pass "the provider entry merge keeps the repeat guard"

# A qwen session transcript, one JSONL record per line, in the shape qwen
# 0.24.7 writes: assistant records carry message.parts[].functionCall, a
# compaction is a system record with subtype chat_compression. qwen writes a
# model turn's calls BEFORE it runs them (measured 2026-10-04: a call's
# record precedes its tool_result by up to 28 s), so every fixture ends with
# the in-flight call itself, as the live transcript does when the hook runs.
call() { printf '{"type":"assistant","message":{"role":"model","parts":[{"functionCall":{"name":"%s","args":%s}}]}}\n' "$1" "$2"; }
compaction() { printf '{"type":"system","subtype":"chat_compression"}\n'; }
LOG='{"command":"git log -3 abc123","description":"trace"}'
LOG_OTHER_DESC='{"command":"git log -3 abc123","description":"trace again"}'

decide() { # transcript tool_name tool_input
  python3 -c 'import json,sys; print(json.dumps({"tool_name":sys.argv[1],"tool_input":json.loads(sys.argv[2]),"transcript_path":sys.argv[3],"hook_event_name":"PreToolUse"}))' "$2" "$3" "$1" | bb "$GUARD"
}

T="$ROOT/twice.jsonl"
{ call run_shell_command "$LOG"; call read_file '{"file_path":"/x"}'; call run_shell_command "$LOG"; call run_shell_command "$LOG_OTHER_DESC"; } > "$T"
out="$(decide "$T" run_shell_command "$LOG_OTHER_DESC")"
python3 -c '
import json, sys
o = json.loads(sys.argv[1])["hookSpecificOutput"]
assert o["hookEventName"] == "PreToolUse", o
assert o["permissionDecision"] == "deny", o
assert "2 times" in o["permissionDecisionReason"], o
' "$out" || fail "a third identical call with no edit between was not refused: $out"
pass "a third identical call since the last edit is refused, whatever its description says"

{ call run_shell_command "$LOG"; call run_shell_command "$LOG"; } > "$T"
out="$(decide "$T" run_shell_command "$LOG")"
[[ -z "$out" ]] || fail "a second identical call was refused (the in-flight call counted against itself): $out"
pass "a second identical call runs: the in-flight call the transcript already holds is not counted"

printf '{"type":"assistant","message":{"role":"model","parts":[{"functionCall":{"name":"run_shell_command","args":%s}},{"functionCall":{"name":"read_file","args":{"file_path":"/y"}}}]}}\n' "$LOG" > "$T"
out="$(decide "$T" run_shell_command "$LOG")"
[[ -z "$out" ]] || fail "a call that is not the last part of its own turn counted against itself: $out"
pass "a turn that makes several calls does not count the in-flight one against itself"

reset_edit() { call edit '{"file_path":"/x","old_string":"a","new_string":"b"}'; }
reset_write() { call write_file '{"file_path":"/x","content":"c"}'; }
reset_compaction() { compaction; }
reset_commit() { call run_shell_command '{"command":"git commit -m wip"}'; }
reset_handoff() { call run_shell_command '{"command":"swarmforge/scripts/swarm_handoff.sh tmp/handoff.txt"}'; }
for reset in reset_edit reset_write reset_compaction reset_commit reset_handoff; do
  { call run_shell_command "$LOG"; call run_shell_command "$LOG"; "$reset"; call run_shell_command "$LOG"; } > "$T"
  out="$(decide "$T" run_shell_command "$LOG")"
  [[ -z "$out" ]] || fail "a repeat after $reset was refused: $out"
done
pass "an edit, a write, a compaction, a commit or a handoff starts a fresh window"

{ call edit '{"file_path":"/x","old_string":"a","new_string":"b"}'; call edit '{"file_path":"/x","old_string":"a","new_string":"b"}'; call edit '{"file_path":"/x","old_string":"a","new_string":"b"}'; } > "$T"
out="$(decide "$T" edit '{"file_path":"/x","old_string":"a","new_string":"b"}')"
[[ -z "$out" ]] || fail "an edit was refused: $out"
{ for i in 1 2 3; do call run_shell_command '{"command":"swarmforge/scripts/swarm_handoff.sh tmp/handoff.txt"}'; done; } > "$T"
out="$(decide "$T" run_shell_command '{"command":"swarmforge/scripts/swarm_handoff.sh tmp/handoff.txt"}')"
[[ -z "$out" ]] || fail "a repeated handoff send was refused: $out"
pass "edits and state-changing commands are never refused"

printf 'not json\n{"type":"assistant"}\n' > "$T"
out="$(decide "$T" run_shell_command "$LOG")"
[[ -z "$out" ]] || fail "a transcript with no readable calls refused something: $out"
out="$(decide "$ROOT/missing.jsonl" run_shell_command "$LOG")"
[[ -z "$out" ]] || fail "a missing transcript refused something: $out"
out="$(echo 'not json' | bb "$GUARD")"
[[ -z "$out" ]] || fail "an unreadable event refused something: $out"
pass "an unreadable event or transcript refuses nothing"
