#!/usr/bin/env bash
# BL-728: handoffd.bb must parse under Babashka streaming eval so every
# one-shot CLI flag is reachable. BL-611 productization (9bc8de790) once
# under-closed deliver! by one ')', producing "EOF while reading" and
# blocking --poll-once and siblings entirely.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"

assert_no_parse_error() {
  local flag="$1"
  local out rc
  set +e
  out="$(SWARMFORGE_ALLOW_TMP_DAEMON=1 bb "$HANDOFFD" "$ROOT" "$flag" 2>&1)"
  rc=$?
  set -e
  grep -q 'EOF while reading' <<< "$out" && fail "$flag: Babashka parse failure (unbalanced deliver!?): $out"
  grep -q 'Phase: *parse' <<< "$out" && fail "$flag: Babashka parse phase error: $out"
  [[ "$rc" -eq 0 ]] || fail "$flag: expected exit 0, got rc=$rc: $out"
}

for flag in --poll-once --startup-notify-only --print-preferred-rotate-target \
            --sweep-once --chase-sweep-once; do
  assert_no_parse_error "$flag"
  pass "handoffd.bb reaches -main with $flag (no streaming-eval parse failure)"
done

echo "ALL PASS"
