#!/usr/bin/env bash
# BL-1829: write_local_model_qwen_settings writes a local-model seat's own
# project-level qwen settings (.qwen/settings.json) naming only the six
# tools its role loop uses, in both key forms qwen 0.22.2 reads, and
# never touches anything outside the given worktree.
#
# The function is EXTRACTED from the live swarmforge.sh and eval'd rather
# than copied (same posture as test_bl1328_qwen_model_token_forms.sh) - a
# copy would drift from the shipped writer silently, and sourcing
# swarmforge.sh outright would run the swarm launcher. The function body
# itself uses no zsh-specific syntax, so a plain bash harness exercises it
# identically to the real (zsh) swarmforge.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# The plain "flag && /^\}/ {exit}" idiom (test_bl1328's own convention)
# would stop at the JSON heredoc's OWN closing brace, which sits at
# column 0 - so the heredoc-body lines are tracked and skipped over
# (never treated as a candidate function-closing line) until the literal
# terminator is seen.
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

write_local_model_qwen_settings "$ROOT"

SETTINGS="$ROOT/.qwen/settings.json"
[[ -f "$SETTINGS" ]] || fail "expected $SETTINGS to exist"
pass "writes .qwen/settings.json into the given worktree"

json_ok="$(python3 -c 'import json; json.load(open("'"$SETTINGS"'")); print("ok")' 2>&1)"
[[ "$json_ok" == "ok" ]] || fail "settings.json is not valid JSON: $json_ok"
pass "settings.json is valid JSON"

# BL-1840 (amended): autoCompactThreshold changes nothing at the windows
# this swarm serves (proven against qwen's own --debug log) and would
# only ever make compaction fire sooner - the settings writer no longer
# writes it at all.
HAS_AUTO_COMPACT="$(python3 -c '
import json
d = json.load(open("'"$SETTINGS"'"))
print("autoCompactThreshold" in d.get("context", {}))
')"
[[ "$HAS_AUTO_COMPACT" == "False" ]] || fail "expected no context.autoCompactThreshold in the written settings"
pass "BL-1840: no context.autoCompactThreshold in the written settings"

CORE_EXPECTED='["run_shell_command", "read_file", "write_file", "edit", "glob", "grep_search"]'
EXCLUDE_EXPECTED='["agent", "enter_worktree", "exit_worktree", "get_goal", "list_agents", "record_artifact", "report_findings", "send_message", "skill", "task_stop", "tool_search", "update_goal", "ask_user_question", "enter_plan_mode", "exit_plan_mode", "propose_goal"]'

read_node() {
  python3 -c "
import json
d = json.load(open('$SETTINGS'))
node = d
for k in '$1'.split('.'):
    node = node[k]
print(json.dumps(node))
"
}

check_eq() {
  local label="$1" expected="$2" actual="$3"
  [[ "$actual" == "$expected" ]] || fail "$label: expected $expected, got $actual"
  pass "$label"
}

check_eq "flat coreTools names exactly the six loop tools" "$CORE_EXPECTED" "$(read_node coreTools)"
check_eq "nested tools.core names exactly the six loop tools" "$CORE_EXPECTED" "$(read_node tools.core)"
check_eq "flat excludeTools names the always-on extras and the four tools that wait for a human" "$EXCLUDE_EXPECTED" "$(read_node excludeTools)"
check_eq "nested tools.exclude names the always-on extras and the four tools that wait for a human" "$EXCLUDE_EXPECTED" "$(read_node tools.exclude)"

# A tool named neither core nor excluded is untested territory this
# ticket does not rely on - every one of the six loop tools must appear
# in coreTools and NOT in excludeTools (and vice versa for the excluded).
OVERLAP="$(python3 -c '
import json
d = json.load(open("'"$SETTINGS"'"))
core = set(d["coreTools"])
excl = set(d["excludeTools"])
print(sorted(core & excl))
')"
[[ "$OVERLAP" == "[]" ]] || fail "coreTools and excludeTools must never overlap, got: $OVERLAP"
pass "coreTools and excludeTools never name the same tool"

# Never the operator's own ~/.qwen - only ever <worktree>/.qwen.
ROOT2="$(mktemp -d)"
register_tmp_dir "$ROOT2"
FAKE_HOME="$(mktemp -d)"
register_tmp_dir "$FAKE_HOME"
HOME="$FAKE_HOME" write_local_model_qwen_settings "$ROOT2"
[[ -f "$ROOT2/.qwen/settings.json" ]] || fail "expected settings.json under the given worktree"
[[ ! -e "$FAKE_HOME/.qwen" ]] || fail "must never write under HOME - only the given worktree"
pass "never writes under HOME, only the given worktree"

echo "ALL PASS: BL-1829 write_local_model_qwen_settings"
