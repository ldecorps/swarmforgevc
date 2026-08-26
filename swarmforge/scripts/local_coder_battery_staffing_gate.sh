#!/usr/bin/env bash
# BL-1127: staffing gate for the production local forge pack.
# Sourced or exec'd by start-swarm-ollama-qwen.sh. Exit 0 only when a cited
# pass battery evidence path exists (or LOCAL_CODER_BATTERY_SKIP_GATE=1).
set -euo pipefail

ROOT="${1:-}"
if [[ -z "$ROOT" ]]; then
  echo "usage: local_coder_battery_staffing_gate.sh <project-root>" >&2
  exit 2
fi

if [[ "${LOCAL_CODER_BATTERY_SKIP_GATE:-}" == "1" ]]; then
  echo "WARNING: LOCAL_CODER_BATTERY_SKIP_GATE=1 — staffing without battery pass" >&2
  exit 0
fi

EVIDENCE_DIR="${LOCAL_CODER_BATTERY_EVIDENCE_DIR:-$ROOT/backlog/evidence}"
EVIDENCE_PATH="${LOCAL_CODER_BATTERY_EVIDENCE_PATH:-}"

if [[ -z "$EVIDENCE_PATH" ]]; then
  if [[ -d "$EVIDENCE_DIR" ]]; then
    # Newest dated BL-1127 battery artifact (lexical stamp in basename).
    EVIDENCE_PATH="$(
      ls -1 "$EVIDENCE_DIR"/BL-1127-coder-battery-*.md 2>/dev/null | sort | tail -1 || true
    )"
  fi
fi

if [[ -z "${EVIDENCE_PATH}" || ! -f "$EVIDENCE_PATH" ]]; then
  echo "ERROR: no BL-1127 coder battery evidence (pass required to staff local forge)." >&2
  echo "Run: bash swarmforge/scripts/local_coder_battery.sh" >&2
  echo "Or set LOCAL_CODER_BATTERY_EVIDENCE_PATH to a pass artifact." >&2
  exit 1
fi

# Prefer steward eligibility helper when bb is available; else parse artifact.
if command -v bb >/dev/null 2>&1; then
  RESULT_LINE="$(grep -E '^- result:' "$EVIDENCE_PATH" | head -1 || true)"
  RESULT_VAL="$(printf '%s' "$RESULT_LINE" | sed -E 's/^- result:[[:space:]]*//')"
  LIB="$ROOT/swarmforge/scripts/model_steward_lib.bb"
  OUT="$(bb -e "
(load-file \"$LIB\")
(def e {:result \"$RESULT_VAL\" :path \"$EVIDENCE_PATH\"})
(def out (model-steward-lib/bl1127CoderBatteryEligibility e))
(println (str \"ELIGIBLE=\" (:eligible? out)))
(println (str \"EVIDENCE_PATH=\" (:evidence_path out)))
" 2>/dev/null || true)"
  if printf '%s' "$OUT" | grep -q 'ELIGIBLE=true'; then
    echo "BL-1127 staffing gate: pass ($EVIDENCE_PATH)"
    exit 0
  fi
  echo "ERROR: BL-1127 staffing gate refused — coder ineligible for local forge." >&2
  echo "Evidence: $EVIDENCE_PATH" >&2
  echo "$OUT" >&2
  exit 1
fi

if grep -qE '^- result:[[:space:]]*pass[[:space:]]*$' "$EVIDENCE_PATH"; then
  echo "BL-1127 staffing gate: pass ($EVIDENCE_PATH)"
  exit 0
fi

echo "ERROR: BL-1127 staffing gate refused — evidence is not a pass result." >&2
echo "Evidence: $EVIDENCE_PATH" >&2
exit 1
