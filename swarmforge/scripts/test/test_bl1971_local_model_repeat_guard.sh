#!/usr/bin/env bash
# BL-1971 (stamp-off of the 2026-10-04 repeat-guard hotfix): a local-model
# seat's .qwen/settings.json registers the master checkout's
# local_model_repeat_guard.bb as a qwen PostToolUse hook for every tool, the
# provider entry merge keeps it, and the guard warns, with the call's
# result, about a call the seat has already made twice with the same
# arguments since its last edit, commit or compaction - and adds nothing
# otherwise. It never refuses: a refusal made the iq3 coder re-send the
# identical call until qwen's own loop dialog halted its turn (2026-10-04).
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

# BL-2055/BL-897: local_model_repeat_guard.bb copies handoff_lib.bb's
# sidecar-suffixes rather than load-filing it (measured: loading
# handoff_lib.bb costs ~100ms more than this hook's own baseline, and it
# runs on every tool call) - this is what keeps the copy from drifting
# from the original it is a copy of.
agree="$(bb -e "
(load-file \"$SCRIPTS/handoff_lib.bb\")
(load-file \"$GUARD\")
(println (= handoff-lib/sidecar-suffixes local-model-repeat-guard/sidecar-suffixes))
")"
[[ "$agree" == "true" ]] || fail "local_model_repeat_guard.bb's copied sidecar-suffixes disagrees with handoff_lib.bb's own: $agree"
pass "local_model_repeat_guard.bb's copied sidecar-suffixes list agrees with handoff_lib.bb's own (BL-897)"

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
groups = [g for g in d["hooks"]["PostToolUse"] if g["matcher"] == ""]
assert len(groups) == 1, d["hooks"]["PostToolUse"]
hooks = groups[0]["hooks"]
assert len(hooks) == 1 and hooks[0]["type"] == "command", hooks
assert hooks[0]["command"] == sys.argv[2], hooks
pre = [g for g in d["hooks"].get("PreToolUse", []) if g["matcher"] == "run_shell_command"]
assert len(pre) == 1, d["hooks"].get("PreToolUse")
assert "tool_miss_heal_hook.bb" in pre[0]["hooks"][0]["command"], pre
assert "PreCompact" in d["hooks"], d["hooks"]
' "$SETTINGS" "bb '$GUARD'"
}

guard_registered || fail "settings.json carries no single PostToolUse command hook for every tool naming $GUARD, or lacks the run_shell_command PreToolUse heal"
pass "the settings register the master checkout's repeat guard after every tool, beside PreCompact and the run_shell_command miss-heal PreToolUse"

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
compaction() { printf '{"type":"system","subtype":"chat_compression","systemPayload":{"compressedHistory":[{"role":"user","parts":[{"text":"<state_snapshot>\\n<next_step>\\nWrite tmp/handoff.txt and send it.\\n</next_step>\\n</state_snapshot>"}]}]}}\n'; }
LOG='{"command":"git log -3 abc123","description":"trace"}'
LOG_OTHER_DESC='{"command":"git log -3 abc123","description":"trace again"}'

decide() { # transcript tool_name tool_input
  python3 -c 'import json,sys; print(json.dumps({"tool_name":sys.argv[1],"tool_input":json.loads(sys.argv[2]),"transcript_path":sys.argv[3],"hook_event_name":"PostToolUse"}))' "$2" "$3" "$1" | bb "$GUARD"
}

T="$ROOT/twice.jsonl"
{ call run_shell_command "$LOG"; call read_file '{"file_path":"/x"}'; call run_shell_command "$LOG"; call run_shell_command "$LOG_OTHER_DESC"; } > "$T"
out="$(decide "$T" run_shell_command "$LOG_OTHER_DESC")"
python3 -c '
import json, sys
o = json.loads(sys.argv[1])["hookSpecificOutput"]
assert o["hookEventName"] == "PostToolUse", o
assert "permissionDecision" not in o, o
assert "3 times" in o["additionalContext"], o
' "$out" || fail "a third identical call with no edit between was not warned about: $out"
pass "a third identical call since the last edit is warned about with its result, whatever its description says, and never refused"

{ compaction; call run_shell_command "$LOG"; call run_shell_command "$LOG"; call run_shell_command "$LOG"; } > "$T"
out="$(decide "$T" run_shell_command "$LOG")"
[[ "$out" == *"Write tmp/handoff.txt and send it."* ]] || fail "the warning does not name the last summary's next step: $out"
pass "the warning names the next step the last compaction summary gave"

{ call run_shell_command "$LOG"; call run_shell_command "$LOG"; } > "$T"
out="$(decide "$T" run_shell_command "$LOG")"
[[ -z "$out" ]] || fail "a second identical call was warned about (the in-flight call counted against itself): $out"
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
  [[ -z "$out" ]] || fail "a repeat after $reset was warned about: $out"
done
pass "an edit, a write, a compaction, a commit or a handoff starts a fresh window"

RFN='{"command":"swarmforge/scripts/ready_for_next.sh"}'
{ call run_shell_command "$RFN"; call run_shell_command "$RFN"; call run_shell_command "$RFN"; } > "$T"
out="$(decide "$T" run_shell_command "$RFN")"
[[ "$out" == *"3 times"* ]] || fail "a third ready_for_next.sh with no edit between was not warned about: $out"
pass "a third ready_for_next.sh since the last edit is warned about (STOP-banner loop; not a window reset)"

decide_resp() { # tool_input tool_response_text
  python3 -c 'import json,sys; print(json.dumps({"tool_name":"run_shell_command","tool_input":json.loads(sys.argv[1]),"tool_response":{"llmContent":sys.argv[2],"returnDisplay":""},"transcript_path":sys.argv[3],"hook_event_name":"PostToolUse"}))' "$1" "$2" "$ROOT/missing.jsonl" | bb "$GUARD"
}
STOP_OUT='STOP. You already have in_process handoff work. Do NOT run ready_for_next.sh again.
Open the TASK already shown.'
out="$(decide_resp "$RFN" "$STOP_OUT")"
[[ "$out" == *"STOP means continue the parcel"* && "$out" == *"inbox/in_process"* ]] || fail "STOP banner output got no ready_for_next hint: $out"
out="$(decide_resp "$RFN" "TASK: .swarmforge/handoffs/inbox/in_process/00_x.handoff")"
[[ -z "$out" ]] || fail "ready_for_next without STOP text got a stop hint: $out"
out="$(decide_resp '{"command":"ls"}' "$STOP_OUT")"
[[ -z "$out" ]] || fail "a non-ready_for_next command got a stop hint: $out"
pass "ready_for_next that reprints the STOP banner is told to Read in_process next"

{ call edit '{"file_path":"/x","old_string":"a","new_string":"b"}'; call edit '{"file_path":"/x","old_string":"a","new_string":"b"}'; call edit '{"file_path":"/x","old_string":"a","new_string":"b"}'; } > "$T"
out="$(decide "$T" edit '{"file_path":"/x","old_string":"a","new_string":"b"}')"
[[ -z "$out" ]] || fail "an edit was warned about: $out"
{ for i in 1 2 3; do call run_shell_command '{"command":"swarmforge/scripts/swarm_handoff.sh tmp/handoff.txt"}'; done; } > "$T"
out="$(decide "$T" run_shell_command '{"command":"swarmforge/scripts/swarm_handoff.sh tmp/handoff.txt"}')"
[[ -z "$out" ]] || fail "a repeated handoff send was warned about: $out"
pass "edits and state-changing commands are never warned about"

OFFSET_FILE="$ROOT/offset.txt"; seq 1 20 > "$OFFSET_FILE"
{ call read_file "{\"file_path\":\"$OFFSET_FILE\",\"offset\":1,\"limit\":10}"; } > "$T"
out="$(decide "$T" read_file "{\"file_path\":\"$OFFSET_FILE\",\"offset\":1,\"limit\":10}")"
[[ "$out" == *"use offset 0"* && "$out" != *"REPEAT"* ]] || fail "a read_file at offset 1 got no offset hint: $out"
{ call read_file "{\"file_path\":\"$OFFSET_FILE\",\"offset\":0,\"limit\":10}"; } > "$T"
out="$(decide "$T" read_file "{\"file_path\":\"$OFFSET_FILE\",\"offset\":0,\"limit\":10}")"
[[ -z "$out" ]] || fail "a read_file at offset 0 was given a note: $out"
{ for i in 1 2 3 4; do call read_file "{\"file_path\":\"$OFFSET_FILE\",\"offset\":1,\"limit\":1}"; done; } > "$T"
out="$(decide "$T" read_file "{\"file_path\":\"$OFFSET_FILE\",\"offset\":1,\"limit\":1}")"
[[ "$out" == *"REPEAT"* && "$out" == *"use offset 0"* ]] || fail "a repeated offset-1 read lost one of its two notes: $out"
out="$(decide "$ROOT/missing.jsonl" read_file "{\"file_path\":\"$OFFSET_FILE\",\"offset\":1}")"
[[ "$out" == *"use offset 0"* ]] || fail "the offset hint needs no transcript, but none came: $out"
pass "a read_file at offset 1 is told offset counts from 0, alone or beside the repeat note (2026-10-05)"

out="$(decide "$ROOT/missing.jsonl" run_shell_command '{"command":"sleep 300 # intentional-sleep: wait for the suite"}')"
[[ "$out" == *"run it in the foreground"* ]] || fail "a sleep command got no hint: $out"
out="$(decide "$ROOT/missing.jsonl" run_shell_command '{"command":"cd extension && sleep 90 && cat x.log"}')"
[[ "$out" == *"run it in the foreground"* ]] || fail "a chained sleep got no hint: $out"
out="$(decide "$ROOT/missing.jsonl" run_shell_command '{"command":"grep -n sleepy x.log"}')"
[[ -z "$out" ]] || fail "a command that only mentions sleep got a hint: $out"
pass "a shell command that sleeps is told to run the command in the foreground instead (2026-10-05)"

BIG="$ROOT/big.txt"; seq 1 400 > "$BIG"; SMALL="$ROOT/small.txt"; seq 1 50 > "$SMALL"
out="$(decide "$ROOT/missing.jsonl" read_file "{\"file_path\":\"$BIG\"}")"
[[ "$out" == *"has 400 lines"* ]] || fail "a whole read of a 400-line file got no hint: $out"
out="$(decide "$ROOT/missing.jsonl" read_file "{\"file_path\":\"$BIG\",\"offset\":0,\"limit\":100}")"
[[ -z "$out" ]] || fail "a 100-line read of a big file got a note: $out"
out="$(decide "$ROOT/missing.jsonl" read_file "{\"file_path\":\"$SMALL\"}")"
[[ -z "$out" ]] || fail "a whole read of a small file got a note: $out"
out="$(decide "$ROOT/missing.jsonl" read_file "{\"file_path\":\"$ROOT/nope/stepRegistry.js\"}")"
[[ "$out" == *"git ls-files | grep stepRegistry.js"* ]] || fail "a read of a missing path got no find hint: $out"
out="$(decide "$ROOT/missing.jsonl" run_shell_command '{"command":"npm run test:properties 2>&1 | tail -30"}')"
[[ "$out" == *"npm runs from extension/"* ]] || fail "npm from the root got no hint: $out"
out="$(decide "$ROOT/missing.jsonl" run_shell_command '{"command":"cd extension && npm test"}')"
[[ -z "$out" ]] || fail "npm from extension/ got a note: $out"
pass "a whole read of a big file, a guessed path and npm from the root each get a hint; a ranged read, a small file and npm in extension/ get none (2026-10-05)"

decide_in() { # dir tool_name tool_input -> the hook run with cwd in dir
  python3 -c 'import json,sys; print(json.dumps({"tool_name":sys.argv[1],"tool_input":json.loads(sys.argv[2]),"transcript_path":sys.argv[3],"cwd":sys.argv[4],"hook_event_name":"PostToolUse"}))' "$2" "$3" "$ROOT/missing.jsonl" "$1" | bb "$GUARD"
}
mkdir -p "$ROOT/specs/features" "$ROOT/specs/pipeline/steps"; touch "$ROOT/specs/features/BL-531-x.feature"
out="$(decide_in "$ROOT" run_shell_command '{"command":"ls specs/pipeline/features/ | grep -i 531"}')"
[[ "$out" == *"specs/pipeline/features/"*"does not exist here"* ]] || fail "an ls of a missing directory got no hint: $out"
out="$(decide_in "$ROOT" run_shell_command '{"command":"grep -n \"a/b pattern\" specs/features/BL-531-x.feature"}')"
[[ -z "$out" ]] || fail "a grep with a slash in its quoted pattern and an existing path got a note: $out"
out="$(decide_in "$ROOT" run_shell_command '{"command":"git log -3 --format=%s"}')"
[[ -z "$out" ]] || fail "a command that names no path got a note: $out"
out="$(decide_in "$ROOT" run_shell_command '{"command":"cat specs/features/BL-531-x.feature > tmp/new/out.txt"}')"
[[ -z "$out" ]] || fail "a redirect target was read as a path: $out"
pass "a read-only shell command naming a path that does not exist is told so; quoted patterns, redirects and existing paths are not (2026-10-05)"

g() { printf '{"command":"grep -n \\"defn parse-instant-ms\\" swarmforge/scripts/%s.bb"}' "$1"; }
{ for pass_no in 1 2; do for f in a b c d; do call run_shell_command "$(g $f)"; done; done
  call run_shell_command "$(g a)"; call run_shell_command "$(g b)"; } > "$T"
out="$(decide "$T" run_shell_command "$(g b)")"
[[ "$out" == *"LOOP: your last 6 calls"*"a cycle of 4 calls"* ]] || fail "six repeats in a row over four calls got no cycle note: $out"
{ for pass_no in 1 2; do for f in a b c d; do call run_shell_command "$(g $f)"; done; done; call run_shell_command "$(g a)"; } > "$T"
out="$(decide "$T" run_shell_command "$(g a)")"
[[ "$out" != *"LOOP:"* ]] || fail "five repeats in a row got a cycle note: $out"
{ for f in a b c d a b; do call run_shell_command "$(g $f)"; done; call run_shell_command "$(g x)"
  for f in a b c d; do call run_shell_command "$(g $f)"; done; } > "$T"
out="$(decide "$T" run_shell_command "$(g d)")"
[[ "$out" != *"LOOP:"* ]] || fail "a run broken by a new call got a cycle note: $out"
{ for f in a b c d; do call run_shell_command "$(g $f)"; done; reset_edit
  for f in a b c d a b; do call run_shell_command "$(g $f)"; done; } > "$T"
out="$(decide "$T" run_shell_command "$(g b)")"
[[ "$out" != *"LOOP:"* ]] || fail "repeats from before an edit were counted into a cycle: $out"
pass "six calls in a row that each repeat one already made since the last edit get a note naming the cycle; five, a broken run, or an edit between get none (2026-10-05)"

E4='{"file_path":"/w/x.bb","old_string":"a)))]","new_string":"a))))]"}'
E5='{"file_path":"/w/x.bb","old_string":"a))))]","new_string":"a)))]"}'
{ call edit "$E4"; call edit "$E5"; } > "$T"
out="$(decide "$T" edit "$E5")"
[[ "$out" == *"UNDO: this edit puts back"*"flipped these lines 2 times"* ]] || fail "an edit that reverses the one before got no undo note: $out"
{ call edit "$E4"; call edit "$E5"; call edit "$E4"; call edit "$E5"; } > "$T"
out="$(decide "$T" edit "$E5")"
[[ "$out" == *"flipped these lines 4 times"* ]] || fail "the undo note does not count the flips: $out"
{ call edit "$E4"; } > "$T"
out="$(decide "$T" edit "$E4")"
[[ -z "$out" ]] || fail "a first edit got a note: $out"
{ call edit '{"file_path":"/w/y.bb","old_string":"a)))]","new_string":"a))))]"}'; call edit "$E5"; } > "$T"
out="$(decide "$T" edit "$E5")"
[[ -z "$out" ]] || fail "an edit that reverses an edit of another file got a note: $out"
pass "an edit that puts back what an earlier edit of the same file replaced is told so and counted; a first edit or another file's edit is not (2026-10-05)"

F1='{"command":"node specs/pipeline/cli.js specs/features/BL-632-x.feature 2>&1 | tail -3"}'
F2='{"command":"node specs/pipeline/cli.js specs/features/BL-632-x.feature 2>&1 | grep -E passed"}'
{ call run_shell_command "$F1"; call run_shell_command "$F2"; } > "$T"
out="$(decide "$T" run_shell_command "$F2")"
[[ "$out" == *"You already ran \`node specs/pipeline/cli.js specs/features/BL-632-x.feature 2>&1\` with another filter"*"> tmp/out.txt 2>&1"* ]] || fail "a command re-run with only another filter got no hint: $out"
{ call run_shell_command "$F1"; } > "$T"
out="$(decide "$T" run_shell_command "$F1")"
[[ -z "$out" ]] || fail "a first filtered run got a note: $out"
{ call run_shell_command "$F1"; reset_edit; call run_shell_command "$F2"; } > "$T"
out="$(decide "$T" run_shell_command "$F2")"
[[ "$out" != *"You already ran"* ]] || fail "a re-run after an edit got the re-run hint: $out"
{ call run_shell_command '{"command":"git log --oneline | head -3"}'; call run_shell_command '{"command":"git status || true | head -3"}'; } > "$T"
out="$(decide "$T" run_shell_command '{"command":"git status || true | head -3"}')"
[[ "$out" != *"You already ran"* ]] || fail "different commands were taken for one re-run: $out"
pass "a command re-run only to filter its output another way is told to save it once; a first run, a run after an edit, or another command is not (2026-10-05)"

decide_resp() { # tool_input llm_content
  python3 -c 'import json,sys; print(json.dumps({"tool_name":"run_shell_command","tool_input":json.loads(sys.argv[1]),"tool_response":{"llmContent":sys.argv[2],"returnDisplay":""},"transcript_path":sys.argv[3],"hook_event_name":"PostToolUse"}))' "$1" "$2" "$ROOT/missing.jsonl" | bb "$GUARD"
}
EMPTY=$'Command: x\nDirectory: (root)\nOutput: (empty)\nError: (none)\nExit Code: 1'
FOUND=$'Command: x\nDirectory: (root)\nOutput: 52:(defn parse-instant-ms\nError: (none)\nExit Code: 0'
out="$(decide_resp "$(g a)" "$EMPTY")"
[[ "$out" == *"grep found nothing"* ]] || fail "a grep with empty output got no hint: $out"
out="$(decide_resp '{"command":"git ls-files | grep -i bl1987"}' "$EMPTY")"
[[ "$out" == *"grep found nothing"* ]] || fail "a piped grep with empty output got no hint: $out"
out="$(decide_resp "{\"command\":\"grep -n parse-instant-ms $BIG\"}" "$FOUND")"
[[ -z "$out" ]] || fail "a grep that found something got a note: $out"
out="$(decide_resp '{"command":"node specs/pipeline/cli.js specs/features/BL-925-x.feature 2>&1 | grep -E \"^# tests\""}' "$EMPTY")"
[[ "$out" == *"grep found nothing in the output of"*"tmp/out.txt"* && "$out" != *"not in those files"* ]] || fail "an empty grep over a run's output was told the name is not in those files: $out"
out="$(decide_resp '{"command":"git diff --stat"}' "$EMPTY")"
[[ -z "$out" ]] || fail "a command that is not a grep got the grep hint: $out"
pass "a grep that prints nothing is told the name is not in those files; a grep that finds something, or another empty command, is not (2026-10-05)"

D1="$(mktemp -d)"
register_tmp_dir "$D1"
mkdir -p "$D1/tmp"
echo 'a line' > "$D1/tmp/notes.md"
out="$(bb -e "(load-file \"$GUARD\") (in-ns (quote local-model-repeat-guard)) (println (override-message \"Edit tmp/notes.md: add a line\" (named-write-path \"Edit tmp/notes.md: add a line\") \"$D1\"))")"
[[ "$out" == *"$D1/tmp/notes.md"* ]] || fail "the existing-file restart message did not name the file at its absolute path: $out"
[[ "$out" != *"Do not read"* ]] || fail "the existing-file restart message told the seat not to read the file: $out"
pass "a restart on a file that exists names it at its absolute path and never says do not read (BL-2056)"

printf 'not json\n{"type":"assistant"}\n' > "$T"
out="$(decide "$T" run_shell_command "$LOG")"
[[ -z "$out" ]] || fail "a transcript with no readable calls added something: $out"
out="$(decide "$ROOT/missing.jsonl" run_shell_command "$LOG")"
[[ -z "$out" ]] || fail "a missing transcript added something: $out"
out="$(echo 'not json' | bb "$GUARD")"
[[ -z "$out" ]] || fail "an unreadable event added something: $out"
pass "an unreadable event or transcript adds nothing"

# Hotfix 2026-10-10: hunting for ready_for_next / expedite while holding
# in_process must name the real helper and forbid declaring idle.
HOLD_WT="$(mktemp -d)"
register_tmp_dir "$HOLD_WT"
mkdir -p "$HOLD_WT/.swarmforge/handoffs/inbox/in_process"
printf 'task: BL-2120\n' > "$HOLD_WT/.swarmforge/handoffs/inbox/in_process/00_test_from_coordinator_to_coder_for_coder.handoff"
MISS=$'Command: ls ready_for_next*\nDirectory: (root)\nOutput: ls: cannot access \'ready_for_next*\': No such file or directory\nError: (none)\nExit Code: 2'
decide_path() { # tool_input llm_content cwd
  python3 -c 'import json,sys; print(json.dumps({"tool_name":"run_shell_command","tool_input":json.loads(sys.argv[1]),"tool_response":{"llmContent":sys.argv[2],"returnDisplay":""},"cwd":sys.argv[3],"transcript_path":sys.argv[4],"hook_event_name":"PostToolUse"}))' "$1" "$2" "$3" "$ROOT/missing.jsonl" | bb "$GUARD"
}
out="$(decide_path '{"command":"ls ready_for_next*"}' "$MISS" "$HOLD_WT")"
[[ "$out" == *"still hold in_process parcel"*"./swarmforge/scripts/ready_for_next.sh"* ]] || fail "a ready_for_next hunt miss while holding a parcel got no path hint: $out"
out="$(decide_path '{"command":"ls ../.swarmforge/expedite/BL-999/"}' $'Output: prompt.md\nExit Code: 0' "$HOLD_WT")"
[[ "$out" == *"ignore"*".swarmforge/expedite/"* || "$out" == *"expedite"* ]] || fail "an expedite listing while holding a parcel got no hint: $out"
out="$(decide_path '{"command":"git status"}' $'Output: clean\nExit Code: 0' "$HOLD_WT")"
[[ "$out" != *"ready_for_next.sh lives"* ]] || fail "an unrelated shell call got the path hint: $out"
pass "a ready_for_next hunt miss or expedite listing while holding in_process names the real helper and forbids declaring idle (2026-10-10)"
