#!/usr/bin/env bash
# Start operator runtime, Telegram front desk, babysitterd, and remote tunnels.
#
# Best-effort: a failed ancillary must never abort an otherwise successful swarm
# launch. Pair with `./swarm ensure` for idempotent repair.
#
# Usage: start_ancillary_services.sh [repo-root]
#
# Env (same as swarmforge.sh):
#   SWARMFORGE_SKIP_OPERATOR=1
#   SWARMFORGE_SKIP_FRONT_DESK=1
#   SWARMFORGE_SKIP_CURSOR_BRIDGE=1
#   SWARMFORGE_SKIP_ONBOARDER=1
#   SWARMFORGE_SKIP_BABYSITTERD=1
#   SWARMFORGE_SKIP_FRESHNESS_CRON=1
#   SWARMFORGE_SKIP_TUNNEL=1
#   SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL=1
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lifecycle_help_lib.sh"
  print_lifecycle_help "start_ancillary_services.sh" "lifecycle start entry point."
  exit 0
fi


ROOT="$(cd "${1:-.}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$ROOT/.swarmforge/swarm.env" ]]; then
  # shellcheck disable=SC1090
  source "$ROOT/.swarmforge/swarm.env"
fi

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
for env_file in \
  "$ROOT/.swarmforge/perplexity.env" \
  "$ROOT/.swarmforge/telegram.env" \
  "$ROOT/.swarmforge/qwen.env" \
  "$ROOT/.swarmforge/openrouter.env"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
done

export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ "${SWARMFORGE_SKIP_OPERATOR:-}" == "1" ]]; then
  echo "Skipping operator runtime (SWARMFORGE_SKIP_OPERATOR=1)."
else
  echo "Starting operator runtime..."
  if ! bash "$SCRIPT_DIR/start_operator_runtime.sh" "$ROOT"; then
    echo "WARN: operator runtime failed to start; run './swarm ensure' after fixing." >&2
  fi
  # BL-993: the always-on watch - nothing else notices a crashed operator
  # runtime until a human runs `./swarm ensure`. Same SKIP gate as the
  # runtime itself; a swarm run with the runtime disabled has nothing here
  # to watch.
  echo "Starting operator runtime watch..."
  if ! bash "$SCRIPT_DIR/launch_operator_runtime_supervisor.sh" "$ROOT"; then
    echo "WARN: operator runtime watch failed to start; re-run launch_operator_runtime_supervisor.sh after fixing." >&2
  fi
fi

if [[ "${SWARMFORGE_SKIP_FRONT_DESK:-}" == "1" ]]; then
  echo "Skipping Telegram front desk (SWARMFORGE_SKIP_FRONT_DESK=1)."
elif [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" && -n "${TELEGRAM_PRINCIPAL_USER_ID:-}" ]]; then
  echo "Starting Telegram front desk (bridge + bot)..."
  if ! bash "$SCRIPT_DIR/launch_front_desk.sh" "$ROOT"; then
    echo "WARN: front desk failed to start; run './swarm ensure' after fixing." >&2
  fi
else
  echo "Telegram front desk skipped (set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID)."
fi

# BL-763: Cursor Remote (start_cursor_bridge.sh) is deliberately NOT in
# LIFECYCLE_COMPONENTS / stop_ancillary_services.sh's stop set — it stays up
# across an ancillary stop; only an explicit stop_cursor_bridge.sh (or
# ./swarm-kill) tears it down. Same credential shape start_cursor_bridge.sh
# itself requires (CURSOR_BRIDGE_BOT_TOKEN or TELEGRAM_BOT_TOKEN, plus chat
# id + principal user id) so this gate never starts something that script
# would immediately refuse.
if [[ "${SWARMFORGE_SKIP_CURSOR_BRIDGE:-}" == "1" ]]; then
  echo "Skipping Cursor Remote bridge (SWARMFORGE_SKIP_CURSOR_BRIDGE=1)."
elif [[ -n "${CURSOR_BRIDGE_BOT_TOKEN:-}${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" && -n "${TELEGRAM_PRINCIPAL_USER_ID:-}" ]]; then
  echo "Starting Cursor Remote bridge..."
  if ! bash "$SCRIPT_DIR/start_cursor_bridge.sh" "$ROOT"; then
    echo "WARN: cursor bridge failed to start; run './swarm ensure' after fixing." >&2
  fi
else
  echo "Cursor Remote bridge skipped (set CURSOR_BRIDGE_BOT_TOKEN or TELEGRAM_BOT_TOKEN, plus TELEGRAM_CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID)."
fi

if [[ "${SWARMFORGE_SKIP_ONBOARDER:-}" == "1" ]]; then
  echo "Skipping onboarder (SWARMFORGE_SKIP_ONBOARDER=1)."
elif [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "Starting onboarder (Onboarding topic reconcile)..."
  if ! bash "$SCRIPT_DIR/launch_onboarder.sh" "$ROOT"; then
    echo "WARN: onboarder failed to start; run './swarm ensure' after fixing." >&2
  fi
else
  echo "Onboarder skipped (set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)."
fi

if [[ "${SWARMFORGE_SKIP_BABYSITTERD:-}" == "1" ]]; then
  echo "Skipping babysitterd (SWARMFORGE_SKIP_BABYSITTERD=1)."
else
  echo "Starting babysitterd..."
  if ! bash "$SCRIPT_DIR/start_babysitterd.sh" "$ROOT"; then
    echo "WARN: babysitterd failed to start; run './swarm ensure' after fixing." >&2
  fi
fi

if [[ "${SWARMFORGE_SKIP_FRESHNESS_CRON:-}" == "1" && "${SWARMFORGE_SKIP_SCHEDULE_CRON:-}" == "1" ]]; then
  echo "Skipping swarmforge cron install (SWARMFORGE_SKIP_FRESHNESS_CRON=1 and SWARMFORGE_SKIP_SCHEDULE_CRON=1)."
elif [[ "${SWARMFORGE_SKIP_FRESHNESS_CRON:-}" == "1" ]]; then
  echo "Installing schedule cron only (SWARMFORGE_SKIP_FRESHNESS_CRON=1)..."
  if ! bash "$SCRIPT_DIR/install_shift_schedule_cron.sh" "$ROOT"; then
    echo "WARN: schedule cron install failed for $ROOT" >&2
  fi
else
  echo "Installing swarmforge crons (freshness + schedule when configured)..."
  if ! bash "$SCRIPT_DIR/install_swarmforge_crons.sh" "$ROOT"; then
    echo "WARN: swarmforge cron install failed; freshness/schedule may be unwatched until fixed — run: bash $SCRIPT_DIR/install_swarmforge_crons.sh $ROOT" >&2
  fi
fi

if [[ "${SWARMFORGE_SKIP_TUNNEL:-}" == "1" ]]; then
  echo "Skipping vscode tunnel (SWARMFORGE_SKIP_TUNNEL=1)."
elif [[ -f "$SCRIPT_DIR/operator_tunnel.sh" ]]; then
  bash "$SCRIPT_DIR/operator_tunnel.sh" ensure "$ROOT" || \
    echo "WARN: vscode tunnel ensure failed." >&2
fi

if [[ "${SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL:-}" == "1" ]]; then
  :
elif [[ -f "$SCRIPT_DIR/launch_resident_spy_tunnel.sh" ]]; then
  bash "$SCRIPT_DIR/launch_resident_spy_tunnel.sh" "$ROOT" || \
    echo "WARN: resident spy tunnel launch failed." >&2
  # BL-1199: a zero exit from the launcher above is not the end of the
  # story - the 2026-08-27 incident's own recorded pid had already died by
  # the time anyone looked. Re-read the recorded pid and confirm the named
  # tunnel is actually alive, via the SAME predicate swarm_status.bb's own
  # "bubble-cloudflared" row uses (named_tunnel_liveness_check.bb), never a
  # second hand-rolled check. A root with no named tunnel configured
  # (NOT_CONFIGURED, exit 2) is not a fault - nothing further to do. A
  # dead named tunnel (DOWN, exit 1) gets ONE bounded relaunch attempt -
  # launch_resident_spy_tunnel.sh is already idempotent (prints
  # "already running pid=" and exits when the pid is live), so calling it
  # again is safe - then a final, loud report naming the NAMED tunnel
  # specifically, never the editor tunnel, if it is still down.
  if [[ -f "$SCRIPT_DIR/named_tunnel_liveness_check.bb" ]] && command -v bb >/dev/null 2>&1; then
    NAMED_TUNNEL_RC=0
    bb "$SCRIPT_DIR/named_tunnel_liveness_check.bb" "$ROOT" >/dev/null 2>&1 || NAMED_TUNNEL_RC=$?
    if [[ "$NAMED_TUNNEL_RC" == "1" ]]; then
      echo "WARN: Bubble named tunnel reported UP by the launcher but is not alive; attempting one relaunch..." >&2
      bash "$SCRIPT_DIR/launch_resident_spy_tunnel.sh" "$ROOT" || true
      NAMED_TUNNEL_RC=0
      bb "$SCRIPT_DIR/named_tunnel_liveness_check.bb" "$ROOT" >/dev/null 2>&1 || NAMED_TUNNEL_RC=$?
      if [[ "$NAMED_TUNNEL_RC" == "1" ]]; then
        echo "WARN: Bubble named tunnel (resident-spy-cloudflared) is DOWN after one relaunch attempt — run: bash $SCRIPT_DIR/launch_resident_spy_tunnel.sh $ROOT" >&2
      fi
    fi
  fi
fi
