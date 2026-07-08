#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF_FILE="$SCRIPT_DIR/../swarmforge.conf"

# Read per-role stall thresholds from swarmforge.conf
declare -A STALL_THRESHOLDS
STALL_THRESHOLDS[default]=$(grep -E '^config stall_threshold_minutes[[:space:]]' "$CONF_FILE" | awk '{print $3}')
while IFS= read -r line; do
  if [[ "$line" =~ ^config[[:space:]]stall_threshold_minutes\.([^[:space:]]+)[[:space:]]+([0-9]+) ]]; then
    STALL_THRESHOLDS["${match[1]}"]="${match[2]}"
  fi
done < "$CONF_FILE"

# Resilience check: verify background chaser is running
CHASER_PID=$(pgrep -f "swarmforge/scripts/inbox_chaser.sh" || true)
if [[ -z "$CHASER_PID" ]]; then
  echo "CRITICAL: Background inbox chaser is NOT running. Handoffs will stall." >&2
  echo "Start it with: swarmforge/scripts/inbox_chaser.sh &" >&2
fi

# Check for stalled handoffs (older than role-specific thresholds)
AUDIT_DIR="$SCRIPT_DIR/../.swarmforge/audit"
STALLED=$(find "$AUDIT_DIR" -name '*.json' -mmin +1 -exec jq -r --argjson thresholds "$(jq -n '$STALL_THRESHOLDS' --argjson STALL_THRESHOLDS "$(declare -p STALL_THRESHOLDS | jq -R 'fromjson? | .STALL_THRESHOLDS')")" '{
  handoff_id: .handoff_id,
  role: .role,
  event: .event,
  age_minutes: (((now - (.timestamp | fromdate)) / 60) | floor),
  threshold: (($thresholds[.role | ascii_downcase] // $thresholds["default"]) | tonumber)
} | select(.event != "completed" and .age_minutes >= .threshold) | "\(.handoff_id) \(.role) \(.event) \(.age_minutes) \(.threshold)"' {} + 2>/dev/null || true)

if [[ -n "$STALLED" ]]; then
  echo "WARNING: Stalled handoffs detected:" >&2
  echo "$STALLED" | while read -r handoff_id role event age_minutes threshold; do
    severity="warning"
    if (( age_minutes >= 2 * threshold )); then
      severity="critical"
    fi
    echo "  - $handoff_id ($role): $event for $age_minutes minutes (threshold: $threshold, severity: $severity)" >&2
  done
fi

exec bb "$SCRIPT_DIR/ready_for_next.bb" "$@"
