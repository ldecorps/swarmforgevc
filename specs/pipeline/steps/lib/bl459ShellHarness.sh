#!/usr/bin/env bash
# BL-459 tempdir-cleanup-trap-01: a minimal demonstration shell harness that
# sources the REAL shared lib/tmp_cleanup.sh (never a hand-rolled substitute
# for the actual mechanism the 26 real test harnesses now use) and creates
# one temp root under it. Usage: bl459ShellHarness.sh <clean|failing>
# Prints the created root's path to stdout before exiting.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../swarmforge/scripts/test/lib" && pwd)/tmp_cleanup.sh"

MODE="${1:?usage: bl459ShellHarness.sh <clean|failing>}"

d="$(mktemp -d)"
register_tmp_dir "$d"
echo "$d"

if [[ "$MODE" == "failing" ]]; then
  false
fi
