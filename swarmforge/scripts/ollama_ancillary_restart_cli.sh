#!/usr/bin/env bash
# BL-1711: the one shell-callable entry point for
# ollama_ancillary_lib.sh's ollama_ancillary_restart_if_crashed - used by
# handoffd.bb (bb) once per sweep tick. Prints exactly what that function
# prints (nothing, or one RESTARTED/ESCALATED line) and exits with its
# own exit code.
#
# Usage: ollama_ancillary_restart_cli.sh <project-root> <binary>
#          <models-dir> <context-length> <wait-seconds>
#          <poll-interval-seconds> <log-path>
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ollama_ancillary_lib.sh
source "$SCRIPT_DIR/ollama_ancillary_lib.sh"

ollama_ancillary_restart_if_crashed "$@"
