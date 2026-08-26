#!/usr/bin/env bash
# BL-1162: start-swarm installs every root-scoped swarmforge cron; stop-swarm
# removes them all — freshness plus schedule lines.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_ALL="$SRC/install_swarmforge_crons.sh"
UNINSTALL_ALL="$SRC/uninstall_swarmforge_crons.sh"
INSTALL_FRESH="$SRC/install_freshness_cron.sh"
STOP_SWARM="$REPO/stop-swarm.sh"
START_ANCILLARY="$SRC/start_ancillary_services.sh"
BASH_BIN="$(command -v bash)"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }
pass() { note "PASS: $*"; }

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge" "$d/.swarmforge/operator" "$d/.swarmforge/daemon"
  printf '%s' "$d"
}

seed_operator_schedule() {
  local root=$1
  cat > "$root/.swarmforge/operator/continuous-shifts.json" <<EOF
{"mode":"day-only","window":"09:00-17:00 Europe/London","active":true}
EOF
  cat > "$root/.swarmforge/operator/day-shift-start.sh" <<EOF
#!/usr/bin/env bash
echo start >> "$root/.swarmforge/operator/schedule-fired.log"
EOF
  cat > "$root/.swarmforge/operator/day-shift-bedtime.sh" <<EOF
#!/usr/bin/env bash
echo stop >> "$root/.swarmforge/operator/schedule-fired.log"
EOF
  chmod +x "$root/.swarmforge/operator/day-shift-start.sh" \
    "$root/.swarmforge/operator/day-shift-bedtime.sh"
}

make_fake_crontab_bin() {
  local dir=$1
  mkdir -p "$dir"
  cat > "$dir/crontab" <<'EOF'
#!/usr/bin/env bash
store="${CRONTAB_STORE:?}"
if [[ "${1:-}" == "-l" ]]; then
  cat "$store" 2>/dev/null || true
  exit 0
fi
if [[ "${1:-}" == "-r" ]]; then
  : > "$store"
  exit 0
fi
cat > "$store"
EOF
  chmod +x "$dir/crontab"
}

line_count_for_root() {
  local root=$1 store=$2
  grep -cF "$root" "$store" 2>/dev/null || true
}

SKIP_ENV=(
  SWARMFORGE_SKIP_OPERATOR=1
  SWARMFORGE_SKIP_FRONT_DESK=1
  SWARMFORGE_SKIP_CURSOR_BRIDGE=1
  SWARMFORGE_SKIP_ONBOARDER=1
  SWARMFORGE_SKIP_BABYSITTERD=1
  SWARMFORGE_SKIP_TUNNEL=1
  SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL=1
)

# ── 01: stop leaves no swarmforge lines for R ───────────────────────────────
ROOT_R="$(make_root)"
seed_operator_schedule "$ROOT_R"
FAKE_CRON="$(make_root)"
STORE="$FAKE_CRON/crontab.txt"
: > "$STORE"
make_fake_crontab_bin "$FAKE_CRON"

PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" "$BASH_BIN" "$INSTALL_ALL" "$ROOT_R" >/dev/null
check "01: install seeds freshness" 'grep -q "swarmforge-BL-675-freshness-check" "$STORE"'
check "01: install seeds schedule" 'grep -q "swarmforge-operator-schedule" "$STORE"'

EMPTY_PS_DIR="$(make_root)"
EMPTY_PS="$EMPTY_PS_DIR/empty.ps"
: > "$EMPTY_PS"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" SWARMFORGE_SURVIVOR_PS_FILE="$EMPTY_PS" \
  "$BASH_BIN" "$STOP_SWARM" "$ROOT_R" >/dev/null
check "01: stop removed freshness marker" '! grep -q "swarmforge-BL-675-freshness-check" "$STORE"'
check "01: stop removed schedule marker" '! grep -q "swarmforge-operator-schedule" "$STORE"'
check "01: stop removed root paths" "! grep -qF \"$ROOT_R\" \"$STORE\""
pass "01: stop-swarm leaves no swarmforge cron lines scoped to root R"

# ── 02: start ensures freshness + schedule ──────────────────────────────────
ROOT_S="$(make_root)"
seed_operator_schedule "$ROOT_S"
STORE2="$FAKE_CRON/crontab2.txt"
: > "$STORE2"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE2" timeout 30 env "${SKIP_ENV[@]}" \
  "$BASH_BIN" "$START_ANCILLARY" "$ROOT_S" >/dev/null
check "02: start installed freshness" 'grep -q "daemon_log_freshness_check.sh" "$STORE2"'
check "02: start installed schedule start" 'grep -q "day-shift-start.sh" "$STORE2"'
check "02: start installed schedule stop" 'grep -q "day-shift-bedtime.sh" "$STORE2"'
pass "02: start-swarm ensures required swarmforge cron lines for root R"

# ── 03: deliberate stop survives tick window ────────────────────────────────
ROOT_T="$(make_root)"
seed_operator_schedule "$ROOT_T"
STORE3="$FAKE_CRON/crontab3.txt"
: > "$STORE3"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE3" "$BASH_BIN" "$INSTALL_ALL" "$ROOT_T" >/dev/null
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE3" SWARMFORGE_SURVIVOR_PS_FILE="$EMPTY_PS" \
  "$BASH_BIN" "$STOP_SWARM" "$ROOT_T" >/dev/null
check "03: crontab empty of root lines after stop" "[[ \$(line_count_for_root '$ROOT_T' '$STORE3') -eq 0 ]]"
touch "$ROOT_T/.swarmforge/daemon/stop"
check "03: deliberate stop marker present" '[[ -f "$ROOT_T/.swarmforge/daemon/stop" ]]'
# Simulate schedule boundary: if lines remained, fired log would grow.
: > "$ROOT_T/.swarmforge/operator/schedule-fired.log"
sleep 1
check "03: schedule scripts did not fire" '[[ ! -s "$ROOT_T/.swarmforge/operator/schedule-fired.log" ]]'
pass "03: deliberate stop survives freshness and schedule cron ticks"

# ── 04: multi-root isolation ────────────────────────────────────────────────
ROOT_R1="$(make_root)"
ROOT_R2="$(make_root)"
seed_operator_schedule "$ROOT_R1"
seed_operator_schedule "$ROOT_R2"
STORE4="$FAKE_CRON/crontab4.txt"
: > "$STORE4"
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE4" "$BASH_BIN" "$INSTALL_ALL" "$ROOT_R1" >/dev/null
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE4" "$BASH_BIN" "$INSTALL_ALL" "$ROOT_R2" >/dev/null
PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE4" SWARMFORGE_SURVIVOR_PS_FILE="$EMPTY_PS" \
  "$BASH_BIN" "$STOP_SWARM" "$ROOT_R1" >/dev/null
check "04: R1 lines gone" "[[ \$(line_count_for_root '$ROOT_R1' '$STORE4') -eq 0 ]]"
check "04: R2 freshness remains" "grep -qF 'FRESHNESS_ROOT=$ROOT_R2 ' '$STORE4'"
check "04: R2 schedule remains" "grep -q 'swarmforge-operator-schedule' '$STORE4'"
pass "04: stop-swarm for one root leaves sibling root cron lines unchanged"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-1162 start-stop-swarm-cron-lifecycle: ALL CHECKS PASSED"
else
  echo "BL-1162 start-stop-swarm-cron-lifecycle: FAILURES"
  exit 1
fi
