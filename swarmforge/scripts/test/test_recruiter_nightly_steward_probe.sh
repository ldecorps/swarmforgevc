#!/usr/bin/env bash
# BL-1701: recruiter_nightly.sh's steward-probe hook. Sources the script
# for its function definitions only (main()'s own top-level flow is
# guarded behind a direct-execution check - see that script's own BL-1701
# comment), then calls local_pack_aider_live/run_steward_probe directly
# against isolated fixture roots - never a real Hugging Face candidate
# pass, never a real model.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_root() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge" "$d/backlog/evidence"
  printf '%s' "$d"
}

# ── 1: no local pack, no model configured -> stands down quietly, no scorecard ─
ROOT1="$(make_root)"
LOG1="$ROOT1/nightly.log"
LOG="$LOG1" ROOT="$ROOT1" bash -c "
set -uo pipefail
source '$SRC/recruiter_nightly.sh'
run_steward_probe
" >/tmp/bl1701-t1.out 2>&1
check "1: no model configured logs 'no probe configured'" \
  "grep -q 'no probe configured' '$LOG1'"
check "1: no scorecard written" \
  "[ -z \"\$(ls -A '$ROOT1/backlog/evidence' 2>/dev/null)\" ]"

# ── 2: a local pack's aider seat is live -> stands down, even WITH a model configured ─
ROOT2="$(make_root)"
mkdir -p "$ROOT2/.swarmforge/tmux"
SOCK2="$ROOT2/.swarmforge/tmux/probe.sock"
tmux -S "$SOCK2" new-session -d -s fake-aider-session "sleep 300"
printf 'coder\tcoder\t%s\tfake-aider-session\tCoder\taider\ttask\n' "$ROOT2" > "$ROOT2/.swarmforge/roles.tsv"
LOG2="$ROOT2/nightly.log"
LOG="$LOG2" ROOT="$ROOT2" STEWARD_PROBE_MODELS="stand-in-test" bash -c "
set -uo pipefail
source '$SRC/recruiter_nightly.sh'
run_steward_probe
" >/tmp/bl1701-t2.out 2>&1
check "2: a live local-pack aider seat stands down the probe" \
  "grep -q \"stood down - a local pack's aider seat is live\" '$LOG2'"
check "2: no scorecard written while a local pack is live" \
  "[ -z \"\$(ls -A '$ROOT2/backlog/evidence' 2>/dev/null)\" ]"
tmux -S "$SOCK2" kill-server >/dev/null 2>&1 || true

# ── 3: a NON-aider seat's tmux session is live -> the probe still runs ──
ROOT3="$(make_root)"
mkdir -p "$ROOT3/.swarmforge/tmux"
SOCK3="$ROOT3/.swarmforge/tmux/probe.sock"
tmux -S "$SOCK3" new-session -d -s fake-claude-session "sleep 300"
printf 'coder\tcoder\t%s\tfake-claude-session\tCoder\tclaude\ttask\n' "$ROOT3" > "$ROOT3/.swarmforge/roles.tsv"
LOG3="$ROOT3/nightly.log"
LOG="$LOG3" ROOT="$ROOT3" STEWARD_PROBE_MODELS="stand-in-test" STEWARD_PROBE_STAND_IN="solve" timeout 90 bash -c "
set -uo pipefail
source '$SRC/recruiter_nightly.sh'
run_steward_probe
" >/tmp/bl1701-t3.out 2>&1
check "3: a non-aider live seat never stands the probe down" \
  "grep -q 'steward probe: running for stand-in-test' '$LOG3'"
check "3: a summary was written for the configured model" \
  "ls '$ROOT3/backlog/evidence'/*.md >/dev/null 2>&1"
tmux -S "$SOCK3" kill-server >/dev/null 2>&1 || true

rm -f /tmp/bl1701-t1.out /tmp/bl1701-t2.out /tmp/bl1701-t3.out

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
else
  exit 1
fi
