#!/usr/bin/env bash
# BL-657: structural checks — harness scrub wiring + wait_for_ready diagnosis.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# shellcheck disable=SC1091
source "$ROOT/swarmforge/scripts/harness_env_scrub.sh"

export CLAUDE_CODE_CHILD_SESSION=poison
export CLAUDECODE=poison
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
scrub_harness_env
[[ -z "${CLAUDE_CODE_CHILD_SESSION+x}" ]] || fail "CLAUDE_CODE_CHILD_SESSION still set after scrub"
[[ -z "${CLAUDECODE+x}" ]] || fail "CLAUDECODE still set after scrub"
[[ "${CLAUDE_CODE_MAX_OUTPUT_TOKENS}" == "64000" ]] || fail "MAX_OUTPUT_TOKENS was scrubbed (must keep)"
pass "01: scrub_harness_env strips child-session markers and keeps max tokens"

SOCK_DIR="$(mktemp -d)"
SOCK="$SOCK_DIR/bl657.sock"
cleanup() { tmux -S "$SOCK" kill-server 2>/dev/null || true; rm -rf "$SOCK_DIR"; }
trap cleanup EXIT

# Start a server WITH poison in the environment, then scrub via tmux API.
export CLAUDE_CODE_CHILD_SESSION=still-poison
tmux -S "$SOCK" new-session -d -s bl657probe "sleep 30"
# Confirm poison landed on the server before scrub.
if ! tmux -S "$SOCK" show-environment -g | grep -q 'CLAUDE_CODE_CHILD_SESSION=still-poison'; then
  # Some tmux builds do not copy all client env into global -g; still exercise scrub.
  tmux -S "$SOCK" set-environment -g CLAUDE_CODE_CHILD_SESSION still-poison
fi
scrub_tmux_harness_env "$SOCK"
if tmux -S "$SOCK" show-environment -g 2>/dev/null | grep -q 'CLAUDE_CODE_CHILD_SESSION='; then
  fail "02: scrub_tmux_harness_env left CLAUDE_CODE_CHILD_SESSION on the server"
fi
pass "02: scrub_tmux_harness_env clears markers on a live tmux server"

START="$ROOT/start-swarm.sh"
grep -q 'source .*harness_env_scrub.sh' "$START" || fail "03: start-swarm.sh must source harness_env_scrub.sh"
grep -q 'scrub_harness_env' "$START" || fail "03: start-swarm.sh must call scrub_harness_env"
grep -q 'report_ready_failure' "$START" || fail "03: start-swarm.sh must define report_ready_failure"
grep -q 'start-swarm-fail-diag.txt' "$START" || fail "03: failure diagnosis must name a diag path"
grep -q 'BL-657 failure window' "$START" || fail "03: wait_for_ready must wait past the 1-3s death window"
pass "03: start-swarm.sh wires scrub + diagnosable wait_for_ready"

SWARM="$ROOT/swarmforge/scripts/swarmforge.sh"
grep -q 'source .*harness_env_scrub.sh' "$SWARM" || fail "04: swarmforge.sh must source harness_env_scrub.sh"
grep -q 'scrub_harness_env' "$SWARM" || fail "04: swarmforge.sh must call scrub_harness_env before tmux probe"
grep -q 'scrub_tmux_harness_env' "$SWARM" || fail "04: swarmforge.sh must scrub tmux global env"
pass "04: swarmforge.sh scrubs before and after server contact"

echo "ALL PASS: test_harness_env_scrub_bl657.sh"
