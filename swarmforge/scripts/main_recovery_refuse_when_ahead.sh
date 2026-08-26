#!/usr/bin/env bash
# BL-1124: recovery gate — refuse reset-to-origin/main when local is ahead.
# Usage: main_recovery_refuse_when_ahead.sh [repo-root]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=property_suite_shared_repo_guard.sh
source "$SCRIPT_DIR/property_suite_shared_repo_guard.sh"
ROOT="${1:-$(git rev-parse --show-toplevel)}"
bl1124_refuse_reset_when_ahead "$ROOT"
