#!/usr/bin/env bash
# BL-973 half 2: the standing suite entry point for swarmforge/scripts/test/.
#
# There was none before this. That is why a stale fixture copy-list could turn
# test_lean_ledger_bb_wiring.sh red and leave it red for days: nothing ran it,
# so nothing noticed. Three separate roles then rediscovered the same staleness
# independently, each spending a pass proving it pre-existing.
#
# The suite's membership list is suite-manifest.tsv - the SAME file the
# inventory gate checks - so a runner list and a manifest cannot drift apart
# into disagreeing about what the suite is. Rows in the "standing" lane run
# here; rows in the "excluded" lane do not, and each of those carries a date
# and a reason.
#
# Usage:
#   run_bb_suite.sh                 run every standing test
#   run_bb_suite.sh --list          print what would run, run nothing
#   run_bb_suite.sh --inventory     run only the inventory gate
#   run_bb_suite.sh <pattern>       run standing tests whose name contains it
#
# WARNING, and the reason the excluded lane exists at all: some tests in this
# tree drive real tmux. On 2026-08-22 a full sweep run from inside an agent
# pane killed all eight live swarm sessions. Run this from a DETACHED host
# shell with `env -u TMUX`, never from an agent pane.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/suite-manifest.tsv"
INVENTORY="$SCRIPT_DIR/suite_inventory_cli.bb"

mode="${1:-run}"

# The inventory gate runs FIRST and unconditionally: a suite that silently
# skips a test nobody listed is the defect this whole ticket is about, so the
# list is verified against the tree before any of it is believed.
# ... and its own chatter goes to stderr, so `--list` stdout stays exactly the
# list a caller can pipe.
if ! bb "$INVENTORY" "$SCRIPT_DIR" >&2; then
  echo "run_bb_suite: the suite inventory is out of date - fix it before trusting a run" >&2
  exit 1
fi
[[ "$mode" == "--inventory" ]] && exit 0

standing=()
while IFS=$'\t' read -r file lane _date _reason; do
  [[ -z "${file:-}" || "${file#\#}" != "$file" ]] && continue
  [[ "${lane:-}" == "standing" ]] || continue
  if [[ "$mode" != "run" && "$mode" != "--list" && "$file" != *"$mode"* ]]; then
    continue
  fi
  standing+=("$file")
done < "$MANIFEST"

# ${arr[@]+"${arr[@]}"}: stock macOS /bin/bash 3.2 raises "unbound variable"
# expanding an EMPTY array under set -u (BL-801).
if [[ "$mode" == "--list" ]]; then
  printf '%s\n' ${standing[@]+"${standing[@]}"}
  exit 0
fi

pass=0
fail=0
failed=()
for file in ${standing[@]+"${standing[@]}"}; do
  path="$SCRIPT_DIR/$file"
  [[ -f "$path" ]] || { echo "MISSING $file"; fail=$((fail + 1)); failed+=("$file"); continue; }
  if [[ "$file" == *.bb ]]; then
    runner=(bb "$path")
  else
    runner=(bash "$path")
  fi
  if "${runner[@]}" >/dev/null 2>&1; then
    pass=$((pass + 1))
  else
    echo "FAIL $file"
    fail=$((fail + 1))
    failed+=("$file")
  fi
done

echo
echo "bb suite: $pass passed, $fail failed, of ${#standing[@]} standing"
if (( fail > 0 )); then
  echo "failed:"
  printf '  %s\n' ${failed[@]+"${failed[@]}"}
  exit 1
fi
