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
  local done_line="$2"
  local out rc log_file
  set +e
  out="$(SWARMFORGE_ALLOW_TMP_DAEMON=1 bb "$HANDOFFD" "$ROOT" "$flag" 2>&1)"
  rc=$?
  set -e
  log_file="$ROOT/.swarmforge/daemon/handoffd.log"
  grep -q 'EOF while reading' <<< "$out" && fail "$flag: Babashka parse failure (unbalanced deliver!?): $out"
  grep -q 'Phase: *parse' <<< "$out" && fail "$flag: Babashka parse phase error: $out"
  [[ "$rc" -eq 0 ]] || fail "$flag: expected exit 0, got rc=$rc: $out"
  if [[ -n "$done_line" ]]; then
    [[ -f "$log_file" ]] || fail "$flag: expected daemon log at $log_file"
    grep -q "$done_line" "$log_file" || fail "$flag: expected log line '$done_line'; log: $(cat "$log_file")"
  fi
}

assert_no_parse_error --poll-once "poll-once done"
pass "handoffd.bb reaches -main with --poll-once (no streaming-eval parse failure)"

assert_no_parse_error --startup-notify-only "startup-notify-only done"
pass "handoffd.bb reaches -main with --startup-notify-only (no streaming-eval parse failure)"

assert_no_parse_error --print-preferred-rotate-target ""
pass "handoffd.bb reaches -main with --print-preferred-rotate-target (no streaming-eval parse failure)"

assert_no_parse_error --sweep-once "sweep-once done"
pass "handoffd.bb reaches -main with --sweep-once (no streaming-eval parse failure)"

assert_no_parse_error --chase-sweep-once "chase-sweep-once done"
pass "handoffd.bb reaches -main with --chase-sweep-once (no streaming-eval parse failure)"

assert_no_parse_error --reconcile-sweep-once "reconcile-sweep-once done"
pass "handoffd.bb reaches -main with --reconcile-sweep-once (no streaming-eval parse failure)"

echo "ALL PASS"
