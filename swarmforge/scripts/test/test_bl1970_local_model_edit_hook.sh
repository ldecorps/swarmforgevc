#!/usr/bin/env bash
# BL-1970 (stamp-off of the 2026-10-04 edit-hook hotfix): a local-model
# seat's .qwen/settings.json registers the master checkout's
# local_model_edit_hook.bb as a qwen PostToolUse hook for edit and
# write_file, the provider entry merge keeps it, and the hook answers an
# edit that leaves Clojure source unreadable with the reader's line and
# column - and says nothing otherwise.
#
# The writer is EXTRACTED from the live swarmforge.sh and eval'd, the same
# way test_bl1949_local_model_precompact_hook.sh does it, so this test
# cannot drift from the shipped writer.
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$TEST_DIR"
source "$TEST_DIR/lib/tmp_cleanup.sh"
SCRIPTS="$(cd "$TEST_DIR/.." && pwd)"
SWARMFORGE_SH="$SCRIPTS/swarmforge.sh"
HOOK="$SCRIPTS/local_model_edit_hook.bb"

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

edit_hook_registered() {
  python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
groups = d["hooks"]["PostToolUse"]
assert len(groups) == 1, groups
assert groups[0]["matcher"] == "edit|write_file", groups
hooks = groups[0]["hooks"]
assert len(hooks) == 1 and hooks[0]["type"] == "command", hooks
assert hooks[0]["command"] == sys.argv[2], hooks
' "$SETTINGS" "bb '$HOOK'"
}

edit_hook_registered || fail "settings.json carries no single PostToolUse command hook for edit and write_file naming $HOOK"
pass "the settings register the master checkout's edit hook for edit and write_file"

python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
assert d["hooks"]["PreCompact"][0]["hooks"][0]["command"].startswith("bash "), d["hooks"]
' "$SETTINGS" || fail "registering the edit hook disturbed the PreCompact hook"
pass "the PreCompact hook is still registered beside it"

! grep -q '__SWARMFORGE_EDIT_HOOK__' "$SETTINGS" || fail "the edit hook placeholder was left in the written settings"
pass "no edit hook placeholder is left in the written settings"

# The provider entry merge (local_model_qwen_provider_cli.bb) rewrites the
# file; the hook must survive it. A given --context-length means the CLI
# asks Ollama nothing.
bb "$SCRIPTS/local_model_qwen_provider_cli.bb" write \
  --settings-file "$SETTINGS" --model "fixture-model:latest" \
  --endpoint-url "http://127.0.0.1:9/v1" --context-length 32768 \
  --base-url "http://127.0.0.1:9/v1" --role coder >/dev/null 2>&1 || true
edit_hook_registered || fail "the provider entry merge dropped the edit hook"
pass "the provider entry merge keeps the edit hook"

# The hook itself, fed qwen's PostToolUse event on stdin.
event() { printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2"; }

BROKEN="$ROOT/broken.bb"
printf '(ns fixture)\n\n(defn f [x]\n  (let [y (inc x)]\n    (* y 2))\n' > "$BROKEN"
out="$(event edit "$BROKEN" | bb "$HOOK")"
python3 -c '
import json, sys
o = json.loads(sys.argv[1])["hookSpecificOutput"]
assert o["hookEventName"] == "PostToolUse", o
c = o["additionalContext"]
assert sys.argv[2] in c, c
assert "expected ) to match ( at [3,1]" in c, c
' "$out" "$BROKEN" || fail "an edit that leaves a .bb file unreadable did not get the open form's line and column: $out"
pass "an edit that leaves a Babashka file unreadable is answered with the open form's line and column"

STRAY="$ROOT/stray.edn"
printf '{:a 1\n :b [2 3)}\n' > "$STRAY"
out="$(event write_file "$STRAY" | bb "$HOOK")"
[[ "$out" == *"$STRAY"* && "$out" == *"expected: ] to match [ at [2 5]"* ]] || fail "a write that leaves an .edn file with a stray delimiter was not answered: $out"
pass "a write that leaves an EDN file with a mismatched delimiter is answered too"

GOOD="$ROOT/good.bb"
printf '#!/usr/bin/env bb\n(ns fixture (:require [clojure.string :as str]))\n(defn g [s] (str/upper-case s))\n(def r #"a(b)c")\n(def k ::str/thing)\n(def t #inst "2026-10-04")\n' > "$GOOD"
out="$(event edit "$GOOD" | bb "$HOOK")"
[[ -z "$out" ]] || fail "an edit that leaves a Babashka file readable added context: $out"
pass "an edit that leaves a Babashka file readable adds no context"

MD="$ROOT/notes.md"
printf 'An unmatched ( paren in prose.\n' > "$MD"
out="$(event edit "$MD" | bb "$HOOK")"
[[ -z "$out" ]] || fail "an edit of a Markdown file added context: $out"
pass "an edit of a file that is not Clojure source adds no context"

out="$(printf '{"tool_name":"edit","cwd":"%s","tool_input":{"file_path":"broken.bb"}}' "$ROOT" | bb "$HOOK")"
[[ "$out" == *"$BROKEN"* ]] || fail "a relative file_path was not resolved against the event's cwd: $out"
pass "a relative file_path is read from the event's cwd"

out="$(echo 'not json' | bb "$HOOK")"; st=$?
[[ -z "$out" && "$st" == 0 ]] || fail "an unreadable event did not leave the hook silent and exit 0: $out"
pass "an unreadable event leaves the hook silent"

out="$(event edit "$ROOT/missing.bb" | bb "$HOOK")"
[[ -z "$out" ]] || fail "an edit of a file that does not exist added context: $out"
pass "an event naming a missing file adds no context"
