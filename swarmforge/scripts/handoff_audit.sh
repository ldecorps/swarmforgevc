#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIT_DIR="$SCRIPT_DIR/../.swarmforge/audit"
CONF_FILE="$SCRIPT_DIR/../swarmforge.conf"
mkdir -p "$AUDIT_DIR"

# Read per-role stall thresholds from swarmforge.conf
declare -A STALL_THRESHOLDS
STALL_THRESHOLDS[default]=$(grep -E '^config stall_threshold_minutes[[:space:]]' "$CONF_FILE" | awk '{print $3}')
while IFS= read -r line; do
  if [[ "$line" =~ ^config[[:space:]]stall_threshold_minutes\.([^[:space:]]+)[[:space:]]+([0-9]+) ]]; then
    STALL_THRESHOLDS["${match[1]}"]="${match[2]}"
  fi
done < "$CONF_FILE"

# Usage: handoff_audit.sh <event> <handoff_id> <role> [extra_json]
# Events: created, received, completed, chased, dead-letter
event="$1"
handoff_id="$2"
role="$3"
extra="${4:-{}}"

timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
role_lower=$(echo "$role" | tr '[:upper:]' '[:lower:]')
threshold=${STALL_THRESHOLDS[$role_lower]:-${STALL_THRESHOLDS[default]}}

# Add stall_context for chased/dead-letter events
if [[ "$event" == "chased" || "$event" == "dead-letter" ]]; then
  if [[ -f "$AUDIT_DIR/$handoff_id.json" ]]; then
    age_minutes=$(( ($(date +%s) - $(date -d "$(jq -r '.timestamp' "$AUDIT_DIR/$handoff_id.json")" +%s)) / 60 ))
  else
    age_minutes=0
  fi
  severity="warning"
  if (( age_minutes >= 2 * threshold )); then
    severity="critical"
  fi
  stall_context=$(jq -n \
    --arg severity "$severity" \
    --argjson threshold "$threshold" \
    --argjson age_minutes "$age_minutes" \
    '{severity: $severity, threshold_minutes: $threshold, actual_minutes: $age_minutes}')
  extra=$(jq -n --argjson extra "$extra" --argjson stall_context "$stall_context" '$extra + {stall_context: $stall_context}')
fi

entry=$(jq -n \
  --arg event "$event" \
  --arg handoff_id "$handoff_id" \
  --arg role "$role" \
  --arg timestamp "$timestamp" \
  --argjson extra "$extra" \
  '{event: $event, handoff_id: $handoff_id, role: $role, timestamp: $timestamp, extra: $extra}')

echo "$entry" >> "$AUDIT_DIR/$handoff_id.json"
