#!/usr/bin/env bash
# ModelFactory's production cold-apply launch seam (BL-525 Slice 1).
# model_factory_store.bb/invoke-launch-seam! execs this with the resolved
# cold-apply plan (JSON) as $1, cwd already set to the target project root.
# Generalizes failover_to_gpt.sh's proven sequence (kill_all_swarm.sh +
# ./swarm --pack <resolved>) to whatever pack the plan names, instead of a
# single hardcoded codex-mono-router. Tests substitute a stub script for
# this one via model_factory_cli.bb's --launch-seam flag; this file is never
# invoked directly by acceptance.
set -euo pipefail

PLAN_JSON="${1:?Usage: model_factory_default_launch_seam.sh '<plan-json>'}"
ROOT="${2:-$(pwd)}"
ROOT="$(cd "$ROOT" && pwd)"

PACK="$(bb -e '(require (quote [cheshire.core :as json])) (println (:pack (json/parse-string (first *command-line-args*) true)))' -- "$PLAN_JSON")"
if [[ -z "$PACK" || "$PACK" == "nil" ]]; then
  echo "model_factory_default_launch_seam: plan is missing a pack name: $PLAN_JSON" >&2
  exit 1
fi

if [[ ! -f "$ROOT/swarmforge/packs/$PACK.conf" ]]; then
  echo "model_factory_default_launch_seam: pack missing: swarmforge/packs/$PACK.conf" >&2
  exit 1
fi

bash "$ROOT/swarmforge/scripts/kill_all_swarm.sh" "$ROOT" || true
sleep 2

export SWARMFORGE_TERMINAL="${SWARMFORGE_TERMINAL:-none}"
export SWARMFORGE_SKIP_OPERATOR="${SWARMFORGE_SKIP_OPERATOR:-1}"
export SWARMFORGE_SKIP_FRONT_DESK="${SWARMFORGE_SKIP_FRONT_DESK:-1}"

LOG="$ROOT/.swarmforge/model-factory-launch.log"
mkdir -p "$ROOT/.swarmforge"
nohup env \
  SWARMFORGE_TERMINAL="$SWARMFORGE_TERMINAL" \
  SWARMFORGE_SKIP_OPERATOR="$SWARMFORGE_SKIP_OPERATOR" \
  SWARMFORGE_SKIP_FRONT_DESK="$SWARMFORGE_SKIP_FRONT_DESK" \
  "$ROOT/swarm" "$ROOT" --pack "$PACK" \
  >"$LOG" 2>&1 &
LPID=$!
echo "model_factory_default_launch_seam: launch_pid=$LPID pack=$PACK log=$LOG"

ok=0
for i in $(seq 1 60); do
  if [[ -f "$ROOT/.swarmforge/tmux-socket" ]]; then
    SOCK="$(cat "$ROOT/.swarmforge/tmux-socket")"
    if tmux -S "$SOCK" has-session -t swarmforge-coordinator 2>/dev/null; then
      echo "model_factory_default_launch_seam: coordinator up after ${i}s"
      ok=1
      break
    fi
  fi
  sleep 2
done

if [[ "$ok" != "1" ]]; then
  echo "model_factory_default_launch_seam: FAILED — session not up; tail of $LOG:" >&2
  tail -40 "$LOG" >&2 || true
  exit 2
fi

echo "model_factory_default_launch_seam: OK — pack=$PACK"
