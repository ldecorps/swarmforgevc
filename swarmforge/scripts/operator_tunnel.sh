#!/usr/bin/env bash
# Operator remote-access tunnel supervisor (Microsoft VS Code `code tunnel`).
#
# Keeps a phone-reachable vscode.dev tunnel into THIS WSL box alive so the swarm
# can be observed (tmux attach) and bounced (./swarm ensure) even when the
# SwarmForge Remote Control relay or the Cursor extension host is down. This is
# the RESILIENT recovery channel: it rides a different transport than the RC
# relay and a different process than the extension host, so it survives their
# failure. Maintained by the always-alive operator runtime (operator_runtime.bb),
# NOT a transient session — that is the whole point (see operator-is-external).
#
# Usage: operator_tunnel.sh <ensure|status|stop> <project-root>
#
#   ensure   idempotent: if the tunnel is already up, do nothing; if it died and
#            we are authenticated, relaunch it headless; publish tunnel.status.json.
#   status   print the current tunnel.status.json (or a not-yet-written default).
#   stop     kill the tunnel process this box launched.
#
# FIRST-TIME AUTH IS INTERACTIVE and cannot be done by the daemon — a human must
# complete the GitHub device login once:
#
#     .swarmforge/operator/vscode-cli/code tunnel user login --provider github \
#         --cli-data-dir .swarmforge/operator/vscode-cli/data
#
# then drop the sentinel so the daemon may take over:
#
#     touch .swarmforge/operator/tunnel.authed
#
# After that, `ensure` relaunches the tunnel headlessly forever using the cached
# credentials. If auth is later revoked, `ensure` detects it, removes the
# sentinel, and reports state=auth_lost instead of respawn-looping.
#
# Env:
#   SWARMFORGE_SKIP_TUNNEL=1   force the tunnel off (ensure becomes a no-op)
#   OPERATOR_TUNNEL_CLI=<path> override the code CLI binary
#   OPERATOR_TUNNEL_NAME=<n>   override the tunnel machine name (default swarmforge-ops)
set -euo pipefail

CMD="${1:?usage: operator_tunnel.sh <ensure|status|stop> <project-root>}"
ROOT="${2:?usage: operator_tunnel.sh <ensure|status|stop> <project-root>}"

OP_DIR="$ROOT/.swarmforge/operator"
CLI="${OPERATOR_TUNNEL_CLI:-$OP_DIR/vscode-cli/code}"
DATA_DIR="$OP_DIR/vscode-cli/data"
NAME="${OPERATOR_TUNNEL_NAME:-swarmforge-ops}"
PID_FILE="$OP_DIR/tunnel.pid"
LOG="$OP_DIR/tunnel.log"
AUTHED="$OP_DIR/tunnel.authed"
STATUS_FILE="$OP_DIR/tunnel.status.json"

mkdir -p "$OP_DIR"

now_iso() { date -u '+%Y-%m-%dT%H:%M:%S.%NZ'; }

# JSON-escape a value (URLs have no quotes/backslashes in practice, but be safe).
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

write_status() { # state url
  local state="$1" url="${2:-}"
  printf '{"state":"%s","name":"%s","url":"%s","updated_at":"%s"}\n' \
    "$(json_escape "$state")" "$(json_escape "$NAME")" "$(json_escape "$url")" "$(now_iso)" \
    > "$STATUS_FILE"
}

tunnel_pid() { [[ -f "$PID_FILE" ]] && cat "$PID_FILE" 2>/dev/null || true; }

alive() {
  local pid; pid="$(tunnel_pid)"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

# Last vscode.dev tunnel URL the CLI printed to the log, if any.
extract_url() {
  [[ -f "$LOG" ]] || return 0
  grep -oE 'https://vscode\.dev/tunnel/[A-Za-z0-9._~-]+(/[A-Za-z0-9._~%/-]*)?' "$LOG" 2>/dev/null | tail -1 || true
}

# Did the CLI just ask for an interactive device login? (auth missing/revoked)
needs_auth_in_log() {
  [[ -f "$LOG" ]] || return 1
  tail -40 "$LOG" 2>/dev/null | grep -qiE 'github\.com/login/device|to grant access|please log ?in|device code'
}

case "$CMD" in
  status)
    if [[ -f "$STATUS_FILE" ]]; then cat "$STATUS_FILE"; else write_status "unknown" ""; cat "$STATUS_FILE"; fi
    ;;

  stop)
    pid="$(tunnel_pid)"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    write_status "stopped" ""
    ;;

  ensure)
    if [[ "${SWARMFORGE_SKIP_TUNNEL:-}" == "1" ]]; then
      write_status "disabled" ""; exit 0
    fi
    if [[ ! -x "$CLI" ]]; then
      write_status "missing_cli" ""; exit 0
    fi
    if alive; then
      write_status "running" "$(extract_url)"; exit 0
    fi
    # Not running. Only the daemon-safe (headless) path proceeds; first auth is a
    # human step that drops the sentinel.
    if [[ ! -f "$AUTHED" ]]; then
      write_status "needs_auth" ""; exit 0
    fi
    # Authenticated but down -> relaunch headless, detached from this shell.
    mkdir -p "$DATA_DIR"
    nohup "$CLI" tunnel --accept-server-license-terms --name "$NAME" \
      --cli-data-dir "$DATA_DIR" >> "$LOG" 2>&1 &
    echo $! > "$PID_FILE"
    # Give it a moment to either register or reveal that auth was revoked.
    sleep 2
    if needs_auth_in_log; then
      local_pid="$(tunnel_pid)"
      [[ "$local_pid" =~ ^[0-9]+$ ]] && kill -TERM "$local_pid" 2>/dev/null || true
      rm -f "$PID_FILE" "$AUTHED"   # force re-bootstrap; stop respawn-looping
      write_status "auth_lost" ""; exit 0
    fi
    write_status "running" "$(extract_url)"
    ;;

  *)
    echo "usage: operator_tunnel.sh <ensure|status|stop> <project-root>" >&2
    exit 1
    ;;
esac
