#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIT_DIR="$SCRIPT_DIR/../.swarmforge/audit"
INBOX_DIR="$SCRIPT_DIR/../inbox/new"
CONF_FILE="$SCRIPT_DIR/../swarmforge.conf"

# Read per-role stall thresholds from swarmforge.conf
declare -A STALL_THRESHOLDS
STALL_THRESHOLDS[default]=$(grep -E '^config stall_threshold_minutes[[:space:]]' "$CONF_FILE" | awk '{print $3}')
while IFS= read -r line; do
  if [[ "$line" =~ ^config[[:space:]]stall_threshold_minutes\.([^[:space:]]+)[[:space:]]+([0-9]+) ]]; then
    STALL_THRESHOLDS["${match[1]}"]="${match[2]}"
  fi
done < "$CONF_FILE"

while true; do
  # Chase handoffs older than role-specific thresholds
  find "$AUDIT_DIR" -name '*.json' -mmin +1 | while read -r audit_file; do
    handoff_id=$(basename "$audit_file" .json)
    status=$(jq -r '.event' "$audit_file")

    if [[ "$status" != "completed" ]]; then
      role=$(jq -r '.role' "$audit_file")
      role_lower=$(echo "$role" | tr '[:upper:]' '[:lower:]')
      threshold=${STALL_THRESHOLDS[$role_lower]:-${STALL_THRESHOLDS[default]}}

      # Only chase if older than threshold
      age_minutes=$(( ($(date +%s) - $(date -d "$(jq -r '.timestamp' "$audit_file")" +%s)) / 60 ))
      if (( age_minutes >= threshold )); then
        echo "Chasing stalled handoff $handoff_id (role: $role, status: $status, age: $age_minutes minutes)"

        # Resend the handoff (if not already in inbox)
        if [[ ! -f "$INBOX_DIR/$handoff_id" ]]; then
          "$SCRIPT_DIR/swarm_handoff.sh" "$INBOX_DIR/$handoff_id" || true
        fi

        # Log the chase with stall context
        severity="warning"
        if (( age_minutes >= 2 * threshold )); then
          severity="critical"
        fi
        stall_context=$(jq -n \
          --arg severity "$severity" \
          --argjson threshold "$threshold" \
          --argjson age_minutes "$age_minutes" \
          '{severity: $severity, threshold_minutes: $threshold, actual_minutes: $age_minutes}')
        "$SCRIPT_DIR/handoff_audit.sh" "chased" "$handoff_id" "$role" "$(jq -n --argjson context "$stall_context" '$context')"
      fi
    fi
  done

  sleep 60
done
