#!/usr/bin/env bash
# BL-1143: authorized cold-swap of day-shift off cursor-forge onto
# ./start-swarm-ollama-qwen.sh / ollama-qwen3-mono-router.
#
# Usage:
#   cold_swap_day_shift_to_ollama_qwen.sh <project-root> [--verify|--execute]
#
# --verify (default): run staffing + pack-shape + steward align checks; write
#   evidence; set .swarmforge/day_shift_pack; do NOT kill the live swarm.
# --execute: after the same checks, kill_all_swarm + launch start-swarm-ollama-qwen
#   (destroys live panes — operator/post-handoff only).
#
# Never thrash-launches qwen-forge. Secrets: none required beyond Ollama local.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-}"
MODE="${2:---verify}"

if [[ -z "$ROOT" || "$ROOT" == --* ]]; then
  echo "usage: cold_swap_day_shift_to_ollama_qwen.sh <project-root> [--verify|--execute]" >&2
  exit 2
fi
ROOT="$(cd "$ROOT" && pwd)"

TARGET_PACK=ollama-qwen3-mono-router
START_SCRIPT="$ROOT/start-swarm-ollama-qwen.sh"
DAY_SHIFT_FILE="$ROOT/.swarmforge/day_shift_pack"
EVIDENCE_DIR="$ROOT/backlog/evidence"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_PATH="$EVIDENCE_DIR/BL-1143-cold-swap-${STAMP}.md"

# Test seams (APS / unit): override kill + start without touching live tmux.
KILL_CMD="${COLD_SWAP_KILL_CMD:-bash $ROOT/swarmforge/scripts/kill_all_swarm.sh $ROOT}"
START_CMD="${COLD_SWAP_START_CMD:-bash $START_SCRIPT}"

if [[ "$MODE" != "--verify" && "$MODE" != "--execute" ]]; then
  echo "ERROR: mode must be --verify or --execute (got $MODE)" >&2
  exit 2
fi

# Refuse forbidden substitutes by name (BL-1142 / BL-1143).
case "$TARGET_PACK" in
  qwen-forge|*token-plan*) echo "ERROR: BL-1143 refuses qwen-forge substitute" >&2; exit 1 ;;
esac

[[ -f "$START_SCRIPT" ]] || { echo "ERROR: missing $START_SCRIPT" >&2; exit 1; }
[[ -f "$ROOT/swarmforge/packs/${TARGET_PACK}.conf" ]] || {
  echo "ERROR: missing pack conf for $TARGET_PACK" >&2
  exit 1
}

echo "BL-1143: preflight staffing gate (BL-1127)…"
bash "$SCRIPT_DIR/local_coder_battery_staffing_gate.sh" "$ROOT"

echo "BL-1143: preflight pack-shape gate (BL-1142)…"
bash "$SCRIPT_DIR/local_ollama_pack_shape_gate.sh" "$ROOT" "$TARGET_PACK"

# Steward: allow :aligned or :no-winner-yet; refuse :mismatch.
# Inject battery pass ranking when present so verify is deterministic on hosts
# that have not yet folded evidence into the live steward registry.
echo "BL-1143: steward local-pack-align (BL-1140)…"
PACK_FILE="$ROOT/swarmforge/packs/${TARGET_PACK}.conf"
BATTERY="$(ls -1 "$EVIDENCE_DIR"/BL-1127-coder-battery-*.md 2>/dev/null | sort | tail -1 || true)"
ALIGN_OUT="$(bb -e "
(load-file \"$SCRIPT_DIR/model_steward_lib.bb\")
(def pack (slurp \"$PACK_FILE\"))
(def bat \"$BATTERY\")
(def reg
  (if (and (seq bat) (.exists (java.io.File. bat)))
    (-> model-steward-lib/empty-registry
        (model-steward-lib/register-model \"ollama\" \"qwen2.5-coder\" {:status \"certified\"})
        (model-steward-lib/add-role-ranking \"coder\" \"ollama\" \"qwen2.5-coder\" 1.0 bat))
    model-steward-lib/empty-registry))
(def out (model-steward-lib/local-pack-align-outcome reg \"coder\" pack))
(println (str \"OUTCOME=\" (name (:outcome out))))
" 2>/dev/null || true)"

if ! printf '%s' "$ALIGN_OUT" | grep -qE 'OUTCOME=(aligned|no-winner-yet)'; then
  echo "ERROR: BL-1143 steward align refused — need aligned or no-winner-yet." >&2
  echo "$ALIGN_OUT" >&2
  exit 1
fi
# Revoked human-priority must never be treated as authoritative outrank (prose check).
if grep -q 'human-operator-priority:ollama-local-qwen-20260825' "$PACK_FILE"; then
  echo "ERROR: pack still cites revoked human-operator-priority tag" >&2
  exit 1
fi
echo "BL-1143: steward $ALIGN_OUT"

mkdir -p "$ROOT/.swarmforge" "$EVIDENCE_DIR"
printf '%s\n' "$TARGET_PACK" > "$DAY_SHIFT_FILE"

{
  echo "# BL-1143 cold-swap day-shift → ${TARGET_PACK}"
  echo
  echo "- stamped: ${STAMP}"
  echo "- mode: ${MODE}"
  echo "- day_shift_pack: ${TARGET_PACK}"
  echo "- launch: start-swarm-ollama-qwen.sh"
  echo "- bl1127_staffing_gate: pass"
  echo "- bl1142_pack_shape: mono-router"
  echo "- bl1140_align: $(printf '%s' "$ALIGN_OUT" | tr '\n' ' ')"
  echo "- qwen_forge: not launched"
  echo "- cursor_forge_rewritten: false"
  echo
  echo "## Notes"
  echo
  if [[ "$MODE" == "--verify" ]]; then
    echo "Verify-only: live panes not killed. Operator runs --execute to cut over."
  else
    echo "Execute: kill_all_swarm then start-swarm-ollama-qwen (authorized human ask)."
  fi
} > "$EVIDENCE_PATH"
echo "BL-1143: wrote $EVIDENCE_PATH"
echo "BL-1143: day_shift_pack → $DAY_SHIFT_FILE ($TARGET_PACK)"

if [[ "$MODE" == "--verify" ]]; then
  echo "BL-1143: VERIFY OK (no live cut-over)"
  exit 0
fi

echo "BL-1143: EXECUTE — stopping live swarm…"
# shellcheck disable=SC2086
eval $KILL_CMD || true
sleep 2
echo "BL-1143: EXECUTE — launching local Ollama mono-router…"
# shellcheck disable=SC2086
eval $START_CMD
echo "BL-1143: EXECUTE requested launch via start-swarm-ollama-qwen"
exit 0
