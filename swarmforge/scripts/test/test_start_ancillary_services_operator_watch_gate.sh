#!/usr/bin/env bash
# BL-993: start_ancillary_services.sh now launches the always-on operator-
# runtime watch (launch_operator_runtime_supervisor.sh) right after
# start_operator_runtime.sh, gated by the SAME SWARMFORGE_SKIP_OPERATOR flag
# - "a swarm run with the runtime disabled has nothing here to watch"
# (start_ancillary_services.sh comment). Nothing exercised either half of
# that: that the watch launches when the runtime does, and that it is
# skipped right along with it. Mirrors
# test_start_ancillary_services_cursor_bridge_gate.sh's own fixture shape -
# a copy of the REAL script with a FAKE launcher standing in (the real
# launcher's own startup mechanics are covered by
# test_bl993_watch_survives_runtime_death.sh and the acceptance suite).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

HOME_EMPTY="$(mktemp -d)"
register_tmp_dir "$HOME_EMPTY"
: > "$HOME_EMPTY/.zshenv"

# Every ancillary except operator is skipped so this test exercises only
# the gate under test.
SKIP_ENV=(
  SWARMFORGE_SKIP_FRONT_DESK=1
  SWARMFORGE_SKIP_CURSOR_BRIDGE=1
  SWARMFORGE_SKIP_ONBOARDER=1
  SWARMFORGE_SKIP_BABYSITTERD=1
  SWARMFORGE_SKIP_FRESHNESS_CRON=1
  SWARMFORGE_SKIP_TUNNEL=1
  SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL=1
)

make_fixture() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/scripts"
  cp "$SRC/start_ancillary_services.sh" "$d/swarmforge/scripts/"
  cat > "$d/swarmforge/scripts/start_operator_runtime.sh" <<EOF
#!/usr/bin/env bash
echo "\$\$" > "$d/runtime-started.marker"
exit 0
EOF
  chmod +x "$d/swarmforge/scripts/start_operator_runtime.sh"
  cat > "$d/swarmforge/scripts/launch_operator_runtime_supervisor.sh" <<EOF
#!/usr/bin/env bash
echo "\$\$" > "$d/watch-started.marker"
exit 0
EOF
  chmod +x "$d/swarmforge/scripts/launch_operator_runtime_supervisor.sh"
  printf '%s' "$d"
}

run_isolated() {
  local root=$1; shift
  env -i HOME="$HOME_EMPTY" PATH="$PATH" "${SKIP_ENV[@]}" "$@" \
    bash "$root/swarmforge/scripts/start_ancillary_services.sh" "$root" >/dev/null 2>&1
}

# ── not skipped: both the runtime and its watch start ───────────────────
F="$(make_fixture)"
run_isolated "$F"
check "operator runtime started when not skipped" '[[ -f "$F/runtime-started.marker" ]]'
check "operator watch started when not skipped" '[[ -f "$F/watch-started.marker" ]]'

# ── SWARMFORGE_SKIP_OPERATOR=1: NEITHER starts ──────────────────────────
F="$(make_fixture)"
run_isolated "$F" SWARMFORGE_SKIP_OPERATOR=1
check "operator runtime NOT started when SWARMFORGE_SKIP_OPERATOR=1" '[[ ! -f "$F/runtime-started.marker" ]]'
check "operator watch NOT started when SWARMFORGE_SKIP_OPERATOR=1" '[[ ! -f "$F/watch-started.marker" ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "ALL PASS: test_start_ancillary_services_operator_watch_gate.sh"
else
  echo "FAIL: one or more checks failed" >&2
  exit 1
fi
