#!/usr/bin/env bash
# BL-1949 (stamp-off of the 2026-10-04 bounded-compaction hotfix): a
# local-model seat's .qwen/settings.json registers the master checkout's
# local_model_precompact_hook.sh as a qwen PreCompact hook, the provider
# entry merge keeps it, and the hook prints the additionalContext qwen
# appends to its compaction prompt.
#
# The writer is EXTRACTED from the live swarmforge.sh and eval'd, the
# same way test_bl1829_local_model_qwen_settings.sh does it, so this test
# cannot drift from the shipped writer.
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$TEST_DIR"
source "$TEST_DIR/lib/tmp_cleanup.sh"
SCRIPTS="$(cd "$TEST_DIR/.." && pwd)"
SWARMFORGE_SH="$SCRIPTS/swarmforge.sh"
HOOK="$SCRIPTS/local_model_precompact_hook.sh"

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

# swarmforge.sh's own SCRIPT_DIR is the master checkout's scripts dir.
SCRIPT_DIR="$SCRIPTS"
write_local_model_qwen_settings "$ROOT"
SETTINGS="$ROOT/.qwen/settings.json"

hook_cmd="$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
groups = d["hooks"]["PreCompact"]
assert len(groups) == 1 and groups[0]["matcher"] == "", groups
hooks = groups[0]["hooks"]
assert len(hooks) == 1 and hooks[0]["type"] == "command", hooks
print(hooks[0]["command"])
' "$SETTINGS")" || fail "settings.json carries no single PreCompact command hook matching every trigger"
[[ "$hook_cmd" == "bash '$HOOK'" ]] || fail "hook command is <$hook_cmd>, expected <bash '$HOOK'>"
[[ -f "$HOOK" ]] || fail "the hook the settings name does not exist: $HOOK"
pass "the settings register the master checkout's PreCompact hook for every trigger"

python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["model"]["chatCompression"]["maxRecentFilesToRetain"] == 0, d.get("model")
' "$SETTINGS" || fail "settings.json does not set model.chatCompression.maxRecentFilesToRetain to 0"
pass "the settings stop qwen re-attaching recently read files after a compaction"

python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["memory"]["enableManagedAutoMemory"] is False, d.get("memory")
' "$SETTINGS" || fail "settings.json does not switch qwen's managed auto memory off"
pass "the settings switch qwen's managed auto memory off"

grep -q '__SWARMFORGE_PRECOMPACT_HOOK__' "$SETTINGS" && fail "the hook placeholder survived into the settings"
pass "no placeholder is left in the written settings"

# The provider entry merge (local_model_qwen_provider_cli.bb) rewrites the
# file; the hook must survive it. A given --context-length means the CLI
# asks Ollama nothing.
bb "$SCRIPTS/local_model_qwen_provider_cli.bb" write \
  --settings-file "$SETTINGS" --model "fixture-model:latest" \
  --endpoint-url "http://127.0.0.1:9/v1" --context-length 32768 \
  --base-url "http://127.0.0.1:9/v1" --role coder >/dev/null 2>&1 || true
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["hooks"]["PreCompact"][0]["hooks"][0]["command"] == sys.argv[2]
' "$SETTINGS" "bash '$HOOK'" || fail "the provider entry merge dropped the PreCompact hook"
pass "the provider entry merge keeps the hook"
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["model"]["chatCompression"]["maxRecentFilesToRetain"] == 0, d.get("model")
' "$SETTINGS" || fail "the provider entry merge dropped maxRecentFilesToRetain"
pass "the provider entry merge keeps maxRecentFilesToRetain 0"
python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["memory"]["enableManagedAutoMemory"] is False, d.get("memory")
' "$SETTINGS" || fail "the provider entry merge dropped enableManagedAutoMemory"
pass "the provider entry merge keeps managed auto memory off"


out="$(bash "$HOOK" </dev/null)"
python3 -c '
import json, sys
d = json.loads(sys.argv[1])
o = d["hookSpecificOutput"]
assert o["hookEventName"] == "PreCompact", o
ctx = o["additionalContext"]
assert len(ctx) < 4000, len(ctx)
for needle in ("<next_step> first", "<current_work>", "<pending_tasks>", "Do not write an <analysis> block", "</state_snapshot>"):
    assert needle in ctx, needle
' "$out" || fail "hook output is not the bounded-summary instruction: $out"
pass "the hook prints a PreCompact additionalContext that puts the resume sections first, under qwen's 4000-char limit"

out2="$(printf '{"trigger":"auto","custom_instructions":""}' | bash "$HOOK")"
[[ "$out2" == "$out" ]] || fail "the hook's output depends on its event input"
pass "the hook drains its event input and answers the same"
