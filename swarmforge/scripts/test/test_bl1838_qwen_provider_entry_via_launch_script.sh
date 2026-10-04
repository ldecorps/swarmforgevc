#!/usr/bin/env bash
# BL-1838 (hardening gap, mutation-found): extra_cli_model_flag - the
# --model parser both check_local_model_seat_windows (BL-1801) and this
# ticket's write_role_launch_script call now share - had NO positive-path
# test anywhere. BL-1801's own scenario 05 fixture has no local-model seat
# at all (the loop body, and so extra_cli_model_flag, never runs), and
# BL-1829's acceptance feature drives write_role_launch_script with a real
# "--model qwen2.5-coder:7b-instruct" but asserts only coreTools/
# excludeTools - never the modelProviders.openai entry BL-1838 adds. A
# hand-applied off-by-one mutant (parts_arr[j+1] -> parts_arr[j+2]) passed
# BOTH existing suites unchanged (specs/features/BL-1801-*.feature 7/7,
# specs/features/BL-1829-*.feature 3/3) while silently feeding the wrong
# --model value into the provider-entry writer. This test drives the REAL
# write_role_launch_script (the actual launch path, not a re-parse) and
# checks the written entry's :id against the seat's configured --model.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

MODEL="ista-iq3s-coder:latest"
ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"

mkdir -p "$ROOT/swarmforge/roles" "$ROOT/.swarmforge/launch" "$ROOT/.swarmforge/prompts"
: > "$ROOT/swarmforge/constitution.prompt"
: > "$ROOT/swarmforge/roles/coder.prompt"
cat > "$ROOT/swarmforge/swarmforge.conf" <<CONF
config active_backlog_max_depth -1
window coder local-model coder --model ${MODEL}
CONF

INDEX_OF_ROLE='
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
'

# Port 1 is never a live HTTP endpoint - served-window's curl fails fast,
# forcing the context-length fallback so an entry is still written (the
# no-known-window skip path is covered separately by
# test_bl1838_qwen_provider_no_known_window.sh), and the value that lands
# in the entry's :id is therefore exactly what extra_cli_model_flag parsed
# from EXTRA_CLI_ARGS - not a value this test hands the writer directly.
ZSH_SCRIPT="source '$SWARMFORGE_SH' '$ROOT'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script \"\$(index_of_role coder)\""
OUT="$(PACK_STAFFING_SKIP_GATE=1 \
  SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL="http://127.0.0.1:1/v1" \
  SWARMFORGE_OLLAMA_CONTEXT_LENGTH=65536 \
  zsh -f -c "$ZSH_SCRIPT" 2>&1)" && RC=0 || RC=$?

[[ "$RC" -eq 0 ]] || fail "write_role_launch_script exited $RC: $OUT"
pass "write_role_launch_script exits 0"

SETTINGS="$ROOT/.worktrees/coder/.qwen/settings.json"
[[ -f "$SETTINGS" ]] || fail "expected $SETTINGS to exist: $OUT"
pass "writes the coder seat's .qwen/settings.json"

ENTRY_ID="$(python3 -c '
import json
d = json.load(open("'"$SETTINGS"'"))
providers = (d.get("modelProviders") or {}).get("openai") or []
print(providers[0]["id"] if providers else "")
')"
[[ "$ENTRY_ID" == "$MODEL" ]] || fail "expected the modelProviders.openai entry's id to be the seat's configured --model ($MODEL), got: '$ENTRY_ID' (out: $OUT)"
pass "the provider entry's id is the seat's configured --model, parsed from EXTRA_CLI_ARGS by the real launch path"

WINDOW="$(python3 -c '
import json
d = json.load(open("'"$SETTINGS"'"))
providers = (d.get("modelProviders") or {}).get("openai") or []
print(providers[0]["generationConfig"]["contextWindowSize"] if providers else "")
')"
# 2026-10-04 hotfix: the launch path puts the seat behind the tool-call shim,
# so qwen is told the fallback window as declared-window lifts it - read
# from the lib, never retyped here.
EXPECTED="$(bb -e "(load-file \"$SCRIPT_DIR/../local_model_window_gate_lib.bb\") (println (local-model-window-gate-lib/declared-window 65536 true))")"
[[ "$EXPECTED" -gt 65536 ]] || fail "expected declared-window to lift 65536 behind the shim, got: '$EXPECTED'"
[[ "$WINDOW" == "$EXPECTED" ]] || fail "expected contextWindowSize $EXPECTED (the context-length fallback, lifted behind the shim), got: '$WINDOW'"
pass "the entry is budgeted to SWARMFORGE_OLLAMA_CONTEXT_LENGTH when the served window is unreachable, lifted behind the shim"

# 2026-10-04 hotfix: the seat's qwen runs on the short seat prompt.
LAUNCH="$ROOT/.swarmforge/launch/coder.sh"
SYSTEM_MD="$(sed -n "s/^export QWEN_SYSTEM_MD='\\(.*\\)'$/\\1/p" "$LAUNCH")"
[[ -n "$SYSTEM_MD" ]] || fail "the launch script exports no QWEN_SYSTEM_MD: $(cat "$LAUNCH")"
[[ "$SYSTEM_MD" == "$(cd "$(dirname "$SWARMFORGE_SH")/.." && pwd)/roles/local-model/qwen-system.md" ]] || fail "QWEN_SYSTEM_MD names $SYSTEM_MD, not the checkout's roles/local-model/qwen-system.md"
[[ -s "$SYSTEM_MD" ]] || fail "the seat prompt QWEN_SYSTEM_MD names is missing or empty: $SYSTEM_MD"
pass "the launch script points qwen at the checkout's short seat prompt"

echo "ALL PASS: BL-1838 provider entry via the real write_role_launch_script path"
