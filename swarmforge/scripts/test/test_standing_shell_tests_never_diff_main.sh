#!/usr/bin/env bash
# BL-1624: a standing shell test that asserts on `git diff main` (or
# `origin/main`) is a parcel-time premise frozen into a manifest row - true
# only while its own parcel is unlanded, and red forever after (BL-1388's
# test_bl1388_land_step_guard_fixture.sh, thirteen days unnoticed, since no
# role's lane runs the shell manifest). This census reads every `standing`
# row of suite-manifest.tsv and refuses loud on any file that still asserts
# a diff against main outside a comment line.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/suite-manifest.tsv"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

count=0
offenders=()
while IFS=$'\t' read -r file lane _date _reason; do
  [[ "$lane" == "standing" ]] || continue
  count=$((count + 1))
  path="$SCRIPT_DIR/$file"
  [[ -f "$path" ]] || continue
  # Strip shell (#) and Babashka (;;) comment lines before matching, or a
  # prose mention of "git diff main" (this file's own header, for one) would
  # misread as the assertion it describes.
  if grep -vE '^[[:space:]]*(#|;;)' "$path" | grep -qE 'git diff[[:space:]]+(main|origin/main)'; then
    offenders+=("$file")
  fi
done < <(grep -vE '^[[:space:]]*#' "$MANIFEST")

if (( ${#offenders[@]} == 0 )); then
  pass "no standing test asserts a diff against main/origin-main (population: $count)"
else
  fail "standing test(s) asserting a diff against main (population: $count): ${offenders[*]}"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
