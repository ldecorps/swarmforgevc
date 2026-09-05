#!/bin/sh
# BL-1413: probes heartbeat_age_secs (daemon_log_freshness_check.sh) in
# isolation, without running the rest of the checker (conf loading, restart/
# announce dispatch) - the real script has no include-guard, so sourcing it
# whole would execute its main loop. Extracts the CURRENT function bodies at
# run time (never a stale hand-copied duplicate) via a plain awk range, since
# neither function nests a brace on its own line.
#
# Usage: NOW=<epoch> bl1413_heartbeat_age_probe.sh <checker-script> <log-path>
# Prints "<age> <reason>" exactly as heartbeat_age_secs does.
set -eu

CHECKER=$1
LOG_PATH=$2
: "${NOW:?bl1413_heartbeat_age_probe.sh needs NOW}"

PROBE_SRC=$(mktemp)
trap 'rm -f "$PROBE_SRC"' EXIT

{
  printf 'NOW=%s\n' "$NOW"
  printf 'SENTINEL_AGE=999999999\n'
  awk '/^iso_to_epoch\(\) \{/,/^}$/' "$CHECKER"
  awk '/^heartbeat_age_secs\(\) \{/,/^}$/' "$CHECKER"
  printf 'heartbeat_age_secs "%s"\n' "$LOG_PATH"
} > "$PROBE_SRC"

/bin/sh "$PROBE_SRC"
