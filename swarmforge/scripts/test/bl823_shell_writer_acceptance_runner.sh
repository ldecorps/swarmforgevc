#!/usr/bin/env bash
# BL-823 acceptance glue: drives the REAL availability_ledger_lib.sh shell
# functions (never a hand-rolled reimplementation) for the scenarios that
# exercise the shell write side - the ungraceful-stop close at start, and
# "a ledger write failure never blocks the operation" for the stop/start
# operations.
#
# Usage:
#   bl823_shell_writer_acceptance_runner.sh start-with-close <root> <start-ts> [heartbeat-file]
#   bl823_shell_writer_acceptance_runner.sh never-blocks <root> <operation>
#     operation: control-pause | swarm-stop | swarm-start
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../availability_ledger_lib.sh"

MODE="${1:?Usage: bl823_shell_writer_acceptance_runner.sh <mode> <root> ...}"
ROOT="${2:?root required}"

case "$MODE" in
  start-with-close)
    START_TS="${3:?start ts required}"
    HEARTBEAT_FILE="${4:-$ROOT/.swarmforge/daemon/handoffd.heartbeat}"
    availability_close_ungraceful_stop "$ROOT" "$HEARTBEAT_FILE"
    availability_record "$ROOT" "start" "swarm-stop" "start-swarm.sh" "$START_TS"
    echo "OK"
    ;;
  never-blocks)
    OPERATION="${3:?operation required}"
    # A directory sitting at the exact ledger file path simulates a real,
    # unmocked write failure (EISDIR) - never chmod (engineering rule).
    MONTH="$(date -u +%Y-%m)"
    BLOCKED_FILE="$(availability_ledger_file "$ROOT" "$MONTH")"
    mkdir -p "$BLOCKED_FILE"
    case "$OPERATION" in
      swarm-stop)
        availability_record "$ROOT" "stop" "swarm-stop" "kill_pipeline_swarm.sh"
        ;;
      swarm-start)
        availability_close_ungraceful_stop "$ROOT" "$ROOT/.swarmforge/daemon/handoffd.heartbeat"
        availability_record "$ROOT" "start" "swarm-stop" "start-swarm.sh"
        ;;
      *)
        echo "unrecognized operation: $OPERATION" >&2
        exit 2
        ;;
    esac
    echo "OK"
    ;;
  *)
    echo "unrecognized mode: $MODE" >&2
    exit 2
    ;;
esac
