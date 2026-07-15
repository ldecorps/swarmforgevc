#!/usr/bin/env bash
# BL-381 QA bounce: launches the onboarding negotiation relay's live poll
# trigger for ONE provisioned target, supervised by
# negotiation_relay_supervisor.bb with bounded restart - mirrors
# launch_front_desk.sh's own idempotent guard + *_LAUNCH_DRYRUN mode. Run
# once per target, after provisioning (provision-onboarding-telegram-
# channel.js) and posting the proposal (relay-onboarding-negotiation-
# telegram.js ... post-proposal) - the same "one manual step, then it runs
# itself" posture BL-380's own provisioning step already established.
#
# Usage: launch_negotiation_relay.sh <target-repo-path> <host-secrets-file-path>
#
# Env:
#   TELEGRAM_PRINCIPAL_USER_ID    required (operator-provided, BL-379 guard)
#   NEGOTIATION_RELAY_LAUNCH_DRYRUN=1   print the assembled supervisor command, start nothing
set -euo pipefail

TARGET_REPO_PATH="${1:?usage: launch_negotiation_relay.sh <target-repo-path> <host-secrets-file-path>}"
HOST_SECRETS_FILE_PATH="${2:?usage: launch_negotiation_relay.sh <target-repo-path> <host-secrets-file-path>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARM_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OP_DIR="$TARGET_REPO_PATH/.swarmforge/operator"
SUPERVISOR_BB="$SCRIPT_DIR/negotiation_relay_supervisor.bb"
PID_FILE="$OP_DIR/negotiation-relay-supervisor.pid"
LOG="$OP_DIR/negotiation-relay-supervisor.log"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

RELAY_ENTRYPOINT="$SWARM_REPO_ROOT/extension/out/tools/relay-onboarding-negotiation-telegram.js"

mkdir -p "$OP_DIR"

if [[ "${NEGOTIATION_RELAY_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_negotiation_relay target=%s\n' "$TARGET_REPO_PATH"
  printf 'DRYRUN supervisor cmd: bb %s %s %s %s\n' "$SUPERVISOR_BB" "$SWARM_REPO_ROOT" "$TARGET_REPO_PATH" "$HOST_SECRETS_FILE_PATH"
  printf 'DRYRUN relay cmd: node %s %s %s poll-loop\n' "$RELAY_ENTRYPOINT" "$TARGET_REPO_PATH" "$HOST_SECRETS_FILE_PATH"
  printf 'DRYRUN relay env: TELEGRAM_PRINCIPAL_USER_ID\n'
  exit 0
fi

: "${TELEGRAM_PRINCIPAL_USER_ID:?TELEGRAM_PRINCIPAL_USER_ID is not set}"

# A missing compiled entrypoint is a hard error here (matches
# launch_front_desk.sh's own posture) - fail loudly now rather than
# spawning `node <missing-file>` and leaving the supervisor to loop through
# its own bounded-restart cap against a failure that will never self-resolve.
if [[ ! -f "$RELAY_ENTRYPOINT" ]]; then
  echo "launch_negotiation_relay: relay entrypoint not found: $RELAY_ENTRYPOINT (run npm run compile in extension/)" >&2
  exit 1
fi

# ── idempotent: already running -> do nothing (mirrors launch_front_desk.sh's
#    own pid-alive guard). ──────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(< "$PID_FILE")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "launch_negotiation_relay: supervisor already running (pid $existing_pid) for $TARGET_REPO_PATH; not double-launching" >&2
    exit 0
  fi
fi

rm -f "$OP_DIR/negotiation-relay-supervisor.stop"

TELEGRAM_PRINCIPAL_USER_ID="$TELEGRAM_PRINCIPAL_USER_ID" nohup bb "$SUPERVISOR_BB" "$SWARM_REPO_ROOT" "$TARGET_REPO_PATH" "$HOST_SECRETS_FILE_PATH" >> "$LOG" 2>&1 &

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$PID_FILE" ]]; then
    pid="$(< "$PID_FILE")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1; break
    fi
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "launch_negotiation_relay: supervisor failed to claim its own pid file under $OP_DIR" >&2
  exit 1
fi

echo "Started negotiation-relay supervisor (pid $(< "$PID_FILE")) for $TARGET_REPO_PATH."
