#!/usr/bin/env bash
# BL-372: print a process's ignored-signals mask as hex (no 0x required).
# Linux: /proc/<pid>/status SigIgn.  Darwin: sysctl kp_proc.p_sigignore
# (Monterey ps -o sigignore=/ignored= is broken — see read_proc_sigignore_darwin.c).
set -euo pipefail

pid="${1:-}"
[[ "$pid" =~ ^[0-9]+$ ]] || exit 2

proc_status="/proc/$pid/status"
if [[ -r "$proc_status" ]]; then
  awk '/^SigIgn:/{print $2; exit}' "$proc_status"
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  # Best-effort BSD/Linux without /proc: GNU or working ps.
  if mask="$(ps -o sigignore= -p "$pid" 2>/dev/null | tr -d '[:space:]')"; then
    [[ -n "$mask" ]] || exit 1
    printf '%s\n' "$mask"
    exit 0
  fi
  if mask="$(ps -o ignored= -p "$pid" 2>/dev/null | tr -d '[:space:]')"; then
    [[ -n "$mask" ]] || exit 1
    printf '%s\n' "$mask"
    exit 0
  fi
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/.bin/read_proc_sigignore_darwin"
SRC="$SCRIPT_DIR/read_proc_sigignore_darwin.c"

if [[ ! -x "$HELPER" ]]; then
  mkdir -p "$(dirname "$HELPER")"
  cc -o "$HELPER" "$SRC"
fi

exec "$HELPER" "$pid"
