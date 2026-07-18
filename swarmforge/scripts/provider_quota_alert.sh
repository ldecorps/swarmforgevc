#!/usr/bin/env bash
# Reusable SwarmForge provider-quota alert (Telegram OPERATOR topic).
# Thin wrapper around provider_quota_alert.bb — same channel as disk-space alerts.
#
# Usage:
#   ./swarmforge/scripts/provider_quota_alert.sh <project-root> [--dry-run]
#   PROVIDER_QUOTA_FORCE_RESULT='{"openai":{"status":"dry"}}' \
#     ./swarmforge/scripts/provider_quota_alert.sh <project-root>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bb "$SCRIPT_DIR/provider_quota_alert.bb" "$@"
