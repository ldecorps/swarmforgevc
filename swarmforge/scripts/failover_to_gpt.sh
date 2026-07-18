#!/usr/bin/env bash
# Cold-swap helper (BL-525 Slice-1 preview): Cerebras/other → GPT codex-mono-router.
# Official path: kill_all_swarm.sh + ./swarm --pack codex-mono-router.
# Secrets: OPENAI_API_KEY from env ~/.zshenv only (BL-130); never written here.
set -euo pipefail

ROOT="${1:-$(pwd)}"
ROOT="$(cd "$ROOT" && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
unset SWARMFORGE_USE_CEREBRAS OPENAI_API_BASE OPENAI_BASE_URL || true

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "failover_to_gpt: OPENAI_API_KEY missing (export or ~/.zshenv)" >&2
  exit 1
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "failover_to_gpt: codex not on PATH (npm i -g @openai/codex; npm-global on PATH)" >&2
  exit 1
fi
if [[ ! -f "$ROOT/swarmforge/packs/codex-mono-router.conf" ]]; then
  echo "failover_to_gpt: pack missing: swarmforge/packs/codex-mono-router.conf" >&2
  exit 1
fi

bash "$ROOT/swarmforge/scripts/kill_all_swarm.sh" "$ROOT" || true
sleep 2

export OPENAI_API_KEY
export SWARMFORGE_TERMINAL="${SWARMFORGE_TERMINAL:-none}"
export SWARMFORGE_SKIP_OPERATOR="${SWARMFORGE_SKIP_OPERATOR:-1}"
export SWARMFORGE_SKIP_FRONT_DESK="${SWARMFORGE_SKIP_FRONT_DESK:-1}"

LOG="$ROOT/.swarmforge/start-swarm-launch.log"
mkdir -p "$ROOT/.swarmforge"
# Headless launch returns after panels start; keep log for ensure/debug.
nohup env   OPENAI_API_KEY="$OPENAI_API_KEY"   SWARMFORGE_TERMINAL="$SWARMFORGE_TERMINAL"   SWARMFORGE_SKIP_OPERATOR="$SWARMFORGE_SKIP_OPERATOR"   SWARMFORGE_SKIP_FRONT_DESK="$SWARMFORGE_SKIP_FRONT_DESK"   "$ROOT/swarm" "$ROOT" --pack codex-mono-router   >"$LOG" 2>&1 &
LPID=$!
echo "failover_to_gpt: launch_pid=$LPID log=$LOG"

ok=0
for i in $(seq 1 60); do
  if [[ -f "$ROOT/.swarmforge/tmux-socket" ]]; then
    SOCK="$(cat "$ROOT/.swarmforge/tmux-socket")"
    if tmux -S "$SOCK" has-session -t swarmforge-coder 2>/dev/null \
      && tmux -S "$SOCK" has-session -t swarmforge-coordinator 2>/dev/null; then
      echo "failover_to_gpt: coder+coordinator up after ${i}s"
      ok=1
      break
    fi
  fi
  if ! kill -0 "$LPID" 2>/dev/null && [[ "$ok" != "1" ]]; then
    # launch process may exit after headless start — keep waiting on socket
    :
  fi
  sleep 2
done

if [[ "$ok" != "1" ]]; then
  echo "failover_to_gpt: FAILED — sessions not up; tail of $LOG:" >&2
  tail -40 "$LOG" >&2 || true
  exit 2
fi

echo "failover_to_gpt: OK — run: ./swarm ensure $ROOT"
exit 0
