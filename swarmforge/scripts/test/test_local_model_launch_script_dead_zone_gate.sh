#!/usr/bin/env bash
# Hotfix 2026-10-03: write_role_launch_script runs BL-1840's dead-zone gate
# for a local-model seat, not only check_local_model_seat_windows on a full
# ./swarm launch. The coder seat was swapped to iq3 by regenerating its
# launch script alone; its 49152-token window compacts at 16152 tokens, so
# qwen compacted on every turn for 1.5 hours. A refused window leaves the
# previous script byte-identical; the override writes it with a warning; a
# window outside the dead zone, or one the gate cannot learn, is written.
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

LAUNCH="$ROOT/.swarmforge/launch/coder.sh"
OLD_SCRIPT='# the previous launch script'

INDEX_OF_ROLE='
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
'
ZSH_SCRIPT="source '$SWARMFORGE_SH' '$ROOT'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script \"\$(index_of_role coder)\""

# Port 1 is never a live endpoint: the served window comes from
# SWARMFORGE_OLLAMA_CONTEXT_LENGTH, or is unknown when that is unset.
generate() {
  local window="$1" override="$2"
  printf '%s\n' "$OLD_SCRIPT" > "$LAUNCH"
  OUT="$(env -u SWARMFORGE_OLLAMA_CONTEXT_LENGTH -u SWARMFORGE_LOCAL_WINDOW_OVERRIDE \
    PACK_STAFFING_SKIP_GATE=1 \
    SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL="http://127.0.0.1:1/v1" \
    ${window:+SWARMFORGE_OLLAMA_CONTEXT_LENGTH=$window} \
    ${override:+SWARMFORGE_LOCAL_WINDOW_OVERRIDE=$override} \
    zsh -f -c "$ZSH_SCRIPT" 2>&1)" && RC=0 || RC=$?
}

old_script_kept() { [[ "$(cat "$LAUNCH")" == "$OLD_SCRIPT" ]]; }

# ── 01: a dead-zone window refuses the script and leaves the old one ──────
generate 49152 ""
[[ "$RC" -ne 0 ]] || fail "dead zone: expected a non-zero exit, got 0: $OUT"
echo "$OUT" | grep -F "REFUSE: local-model launch refused: coder (${MODEL})'s 49152-token window compacts at 16152 tokens" >/dev/null \
  || fail "dead zone: the refusal does not name the window and its trigger: $OUT"
old_script_kept || fail "dead zone: the previous launch script was overwritten"
pass "a 49152-token window (compacts at 16152) is refused and the previous script stands"

# ── 02: the override writes it, with a warning ────────────────────────────
generate 49152 1
[[ "$RC" -eq 0 ]] || fail "override: expected exit 0, got $RC: $OUT"
echo "$OUT" | grep -F "WARN: SWARMFORGE_LOCAL_WINDOW_OVERRIDE=1 let coder (${MODEL}) start in qwen's compaction dead zone" >/dev/null \
  || fail "override: no warning naming the override: $OUT"
old_script_kept && fail "override: the launch script was not rewritten"
grep -F "qwen --auth-type openai" "$LAUNCH" >/dev/null || fail "override: the rewritten script does not start qwen"
pass "SWARMFORGE_LOCAL_WINDOW_OVERRIDE=1 writes the script with a warning"

# ── 03: a window outside the dead zone is written silently ────────────────
for window in 32768 65536; do
  generate "$window" ""
  [[ "$RC" -eq 0 ]] || fail "window $window: expected exit 0, got $RC: $OUT"
  echo "$OUT" | grep -E "REFUSE:|WARN: SWARMFORGE_LOCAL_WINDOW_OVERRIDE" >/dev/null \
    && fail "window $window: refused or warned: $OUT"
  old_script_kept && fail "window $window: the launch script was not rewritten"
done
pass "32768 and 65536 (outside the dead zone) are written"

# ── 04: a window the gate cannot learn is never refused ───────────────────
generate "" ""
[[ "$RC" -eq 0 ]] || fail "unknown window: expected exit 0, got $RC: $OUT"
old_script_kept && fail "unknown window: the launch script was not rewritten"
pass "an unknown window is written (the gate never refuses what it cannot learn)"

echo "ALL PASS: local-model launch script dead-zone gate"
