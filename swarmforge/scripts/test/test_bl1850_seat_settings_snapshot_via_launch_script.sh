#!/usr/bin/env bash
# BL-1850: every local-model seat's generated launch script records the
# settings the seat starts with, before qwen starts; a seat of any other
# agent records nothing. Drives the REAL write_role_launch_script (the
# actual launch path, as test_bl1838_qwen_provider_entry_via_launch_script.sh
# does), then runs the snapshot line exactly as the launch script wrote it,
# with HOME pointed into the fixture so qwen's user settings are the
# fixture's, never the operator's ~/.qwen.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
REAL_SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

MODEL="ista-iq3s-coder:latest"
ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"

mkdir -p "$ROOT/swarmforge/roles" "$ROOT/.swarmforge/launch" "$ROOT/.swarmforge/prompts" "$ROOT/home"
: > "$ROOT/swarmforge/constitution.prompt"
: > "$ROOT/swarmforge/roles/coder.prompt"
: > "$ROOT/swarmforge/roles/cleaner.prompt"
cat > "$ROOT/swarmforge/swarmforge.conf" <<CONF
config active_backlog_max_depth -1
window coder local-model coder --model ${MODEL}
window cleaner claude cleaner
CONF

INDEX_OF_ROLE='
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
'

# Port 1 is never a live endpoint: the qwen provider write falls back to the
# configured context length, and the snapshot records Ollama as unknown.
ZSH_SCRIPT="source '$SWARMFORGE_SH' '$ROOT'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script \"\$(index_of_role coder)\"; write_role_launch_script \"\$(index_of_role cleaner)\""
OUT="$(PACK_STAFFING_SKIP_GATE=1 \
  SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL="http://127.0.0.1:1/v1" \
  SWARMFORGE_OLLAMA_CONTEXT_LENGTH=49152 \
  zsh -f -c "$ZSH_SCRIPT" 2>&1)" && RC=0 || RC=$?
[[ "$RC" -eq 0 ]] || fail "write_role_launch_script exited $RC: $OUT"

CODER_LAUNCH="$ROOT/.swarmforge/launch/coder.sh"
CLEANER_LAUNCH="$ROOT/.swarmforge/launch/cleaner.sh"
[[ -f "$CODER_LAUNCH" && -f "$CLEANER_LAUNCH" ]] || fail "expected both launch scripts: $OUT"

SNAP_LINE_NO="$(grep -n 'local_seat_settings_snapshot_cli.bb' "$CODER_LAUNCH" | head -1 | cut -d: -f1)"
[[ -n "$SNAP_LINE_NO" ]] || fail "the local-model seat's launch script has no settings snapshot line"
pass "a local-model seat's launch script records its settings"

QWEN_LINE_NO="$(grep -nE '(^|[ /])qwen( |$)' "$CODER_LAUNCH" | grep -v 'local_seat_settings_snapshot' | head -1 | cut -d: -f1)"
[[ -n "$QWEN_LINE_NO" ]] || fail "the local-model seat's launch script never starts qwen:\n$(cat "$CODER_LAUNCH")"
(( SNAP_LINE_NO < QWEN_LINE_NO )) || fail "the snapshot (line $SNAP_LINE_NO) must run before qwen starts (line $QWEN_LINE_NO)"
pass "the snapshot runs before qwen starts"

grep -q 'local_seat_settings_snapshot_cli.bb' "$CLEANER_LAUNCH" && fail "a claude seat's launch script must not record local-model settings"
pass "a seat of any other agent records nothing"

SNAP_LINE="$(sed -n "${SNAP_LINE_NO}p" "$CODER_LAUNCH")"
[[ "$SNAP_LINE" == *"--seat 'coder'"* && "$SNAP_LINE" == *"--model '$MODEL'"* && "$SNAP_LINE" == *"|| true"* ]] \
  || fail "the snapshot line names the seat, its --model, and never holds the start: $SNAP_LINE"
pass "the snapshot line names the seat and its model, and ends in || true"

# Run the line as written. Its scripts dir is the seat worktree's own copy.
mkdir -p "$ROOT/.worktrees/coder/swarmforge/scripts"
cp "$REAL_SCRIPTS/local_seat_settings_snapshot_cli.bb" "$REAL_SCRIPTS/local_seat_settings_snapshot_lib.bb" \
  "$ROOT/.worktrees/coder/swarmforge/scripts/"
START="$(date +%s)"
HOME="$ROOT/home" zsh -f -c "$SNAP_LINE" || fail "the snapshot line failed"
ELAPSED=$(( $(date +%s) - START ))
(( ELAPSED <= 3 )) || fail "the snapshot took ${ELAPSED}s, more than 3"
RECORD="$ROOT/.swarmforge/local-agent/seat-settings/coder.jsonl"
[[ "$(wc -l < "$RECORD" | tr -d ' ')" == "1" ]] || fail "expected one row in $RECORD"
python3 - "$RECORD" <<'PY' || fail "the row is not what the start had"
import json, sys
row = json.loads(open(sys.argv[1]).readline())
assert row["seat"] == "coder", row
assert row["model"] == "ista-iq3s-coder:latest", row
assert row["ollama"] == "unknown", row
assert len(row["fingerprint"]) == 64, row
PY
pass "running the line appends one row within 3 seconds, with Ollama unknown when it does not answer"

echo "ALL PASS: test_bl1850_seat_settings_snapshot_via_launch_script.sh"
