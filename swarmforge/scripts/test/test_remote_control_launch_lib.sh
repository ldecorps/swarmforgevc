#!/usr/bin/env bash
# BL-1218: `config remote_control off` must decide the LAUNCHED flag, not
# just the auto-inject default. Today it only governs injection, so a window
# line that names --remote-control itself launches a remote session under an
# explicit off - and both swarmforge.conf and packs/full-forge.conf name the
# flag on every Claude window line, which is exactly where a human would set
# the config.
#
# The rows that gate this ticket are the ones where the window line NAMES the
# flag: an omits-row passes identically before and after.
#
# Run under BOTH bash and zsh: swarmforge.sh is zsh and sources this lib,
# while the suite runs bash. A word-splitting difference between the two
# would be invisible in one of them (BL-801's shape).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../remote_control_launch_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# shellcheck disable=SC1090
source "$LIB"

CLAUDE_CLI='--model claude-sonnet-5 --dangerously-skip-permissions --effort medium'
NAMED_CLI="$CLAUDE_CLI --remote-control SwarmForge-Coder"
SESSION='SwarmForge-Coder'

check() {
  local label="$1" expected="$2" actual="$3"
  [[ "$expected" == "$actual" ]] \
    || fail "$label\n  expected: [$expected]\n  actual:   [$actual]"
  pass "$label"
}

# ── config off: the flag goes, whether or not the line named it ─────────────
check "01 an explicit flag is removed under config off" \
  "$CLAUDE_CLI" \
  "$(resolve_remote_control_cli claude 0 "$SESSION" "$NAMED_CLI")"

check "02 a line that never named a flag is unchanged under config off" \
  "$CLAUDE_CLI" \
  "$(resolve_remote_control_cli claude 0 "$SESSION" "$CLAUDE_CLI")"

check "03 a line whose ONLY content was the flag becomes empty under config off" \
  "" \
  "$(resolve_remote_control_cli claude 0 "$SESSION" "--remote-control $SESSION")"

check "04 a bare flag with no session name is removed too" \
  "$CLAUDE_CLI" \
  "$(resolve_remote_control_cli claude 0 "$SESSION" "$CLAUDE_CLI --remote-control")"

check "05 a flag in the MIDDLE of the line is removed without eating its neighbours" \
  "--model claude-sonnet-5 --effort medium" \
  "$(resolve_remote_control_cli claude 0 "$SESSION" "--model claude-sonnet-5 --remote-control $SESSION --effort medium")"

# ── config on: byte-for-byte what it is today ──────────────────────────────
check "06 an explicit flag is left exactly where the window line put it under config on" \
  "$NAMED_CLI" \
  "$(resolve_remote_control_cli claude 1 "$SESSION" "$NAMED_CLI")"

check "07 an absent flag is auto-injected under config on, appended as today" \
  "$CLAUDE_CLI --remote-control $SESSION" \
  "$(resolve_remote_control_cli claude 1 "$SESSION" "$CLAUDE_CLI")"

# Today's inject is `extra_cli+=" --remote-control ..."`, so an EMPTY
# extra_cli has always produced a leading space. Byte-for-byte means byte-
# for-byte, including that.
check "08 injecting into an empty cli keeps today's leading space" \
  " --remote-control $SESSION" \
  "$(resolve_remote_control_cli claude 1 "$SESSION" "")"

check "09 a flag named with a DIFFERENT session name is left alone under config on" \
  "$CLAUDE_CLI --remote-control Some-Other-Name" \
  "$(resolve_remote_control_cli claude 1 "$SESSION" "$CLAUDE_CLI --remote-control Some-Other-Name")"

# ── non-Claude seats are untouched in both directions ──────────────────────
check "10 a non-Claude seat gets no flag under config on" \
  "--model gpt-5" \
  "$(resolve_remote_control_cli codex 1 "$SESSION" "--model gpt-5")"

check "11 a non-Claude seat is not rewritten under config off either" \
  "--model gpt-5 --remote-control $SESSION" \
  "$(resolve_remote_control_cli codex 0 "$SESSION" "--model gpt-5 --remote-control $SESSION")"

echo "ALL PASS: remote_control_launch_lib.sh"
