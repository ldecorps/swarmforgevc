#!/usr/bin/env bash
# babysitter_check.sh — one deterministic babysitterd health sweep (BL-611).
#
# Pinned CLI name (swarm lifecycle scripts and daemon_log_freshness.conf
# reference it by this exact name). The actual gathering + finding-assembly
# logic lives in babysitter_check.bb (thin I/O wrapper over the pure,
# unit-tested babysitterd_sweep_lib.bb) — this is a one-line exec shim so the
# sweep is invocable the same way the ported prototype was:
#   babysitter_check.sh <project-root> [--nudge]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bb "$SCRIPT_DIR/babysitter_check.bb" "$@"
