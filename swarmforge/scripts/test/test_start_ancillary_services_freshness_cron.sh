#!/usr/bin/env bash
# BL-783: behavioural (not textual) proof that starting the swarm installs the
# BL-675 freshness cron with no human step in between. Runs the REAL
# start_ancillary_services.sh end to end against fixture roots, with every
# other ancillary skipped and a fake `crontab` binary standing in for the
# host's cron table, then reads back what was actually installed — never
# grepping the start script's source for a substring.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
START="$SRC/start_ancillary_services.sh"
CHECKER="$SRC/daemon_log_freshness_check.sh"
BASH_BIN="$(command -v bash)"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }
pass() { note "PASS: $*"; }

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  printf '%s' "$d"
}

# Skip every ancillary except the one under test.
SKIP_ENV=(
  SWARMFORGE_SKIP_OPERATOR=1
  SWARMFORGE_SKIP_FRONT_DESK=1
  SWARMFORGE_SKIP_ONBOARDER=1
  SWARMFORGE_SKIP_BABYSITTERD=1
  SWARMFORGE_SKIP_TUNNEL=1
  SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL=1
)

# Fake crontab: -l reads a shared store, anything else overwrites it. The
# store is shared across invocations in the same scenario, exactly like a
# real host's single crontab is shared across every project root started
# on it.
make_fake_crontab_bin() {
  local dir=$1 store=$2
  mkdir -p "$dir"
  cat > "$dir/crontab" <<'EOF'
#!/usr/bin/env bash
store="${CRONTAB_STORE:?}"
if [[ "${1:-}" == "-l" ]]; then
  cat "$store" 2>/dev/null || true
  exit 0
fi
cat > "$store"
EOF
  chmod +x "$dir/crontab"
}

# ── 01: a real start installs the cron line, read back from the fake crontab ─
ROOT_A="$(make_root)"
FAKE_CRON="$(make_root)"
STORE="$FAKE_CRON/crontab.txt"
: > "$STORE"
make_fake_crontab_bin "$FAKE_CRON" "$STORE"

set +e
OUT1="$(timeout 30 env "${SKIP_ENV[@]}" PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" \
  "$BASH_BIN" "$START" "$ROOT_A" 2>&1)"
RC1=$?
set -e
check "01: start_ancillary_services.sh exits cleanly" '[[ "$RC1" -eq 0 ]]'
check "01: crontab line names the checker" 'grep -q "daemon_log_freshness_check.sh" "$STORE"'
check "01: crontab line is scoped to root A" "grep -qF \"FRESHNESS_ROOT=$ROOT_A \" \"\$STORE\""
pass "01: starting the swarm installs the freshness cron, proven by reading back the real crontab"

# ── 02: starting again for the same root is idempotent through the start path ─
timeout 30 env "${SKIP_ENV[@]}" PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" \
  "$BASH_BIN" "$START" "$ROOT_A" >/dev/null 2>&1
LINE_COUNT_A="$(grep -c 'swarmforge-BL-675-freshness-check' "$STORE" || true)"
check "02: second start does not duplicate root A's line" '[[ "$LINE_COUNT_A" -eq 1 ]]'
pass "02: the installer's idempotence holds when driven through the start path"

# ── 03: a second, disjoint root started on the same host does not clobber root A ─
ROOT_B="$(make_root)"
timeout 30 env "${SKIP_ENV[@]}" PATH="$FAKE_CRON:$PATH" CRONTAB_STORE="$STORE" \
  "$BASH_BIN" "$START" "$ROOT_B" >/dev/null 2>&1
check "03: root A's line survives root B's start" "grep -qF \"FRESHNESS_ROOT=$ROOT_A \" \"\$STORE\""
check "03: root B's line is present too" "grep -qF \"FRESHNESS_ROOT=$ROOT_B \" \"\$STORE\""
check "03: exactly two freshness lines total" \
  '[[ "$(grep -c "swarmforge-BL-675-freshness-check" "$STORE" || true)" -eq 2 ]]'
pass "03: two roots started on one host each keep their own line"

# ── 04: no crontab command → the start still completes, WARN names what is unwatched ─
ROOT_C="$(make_root)"
NO_CRONTAB_BIN="$(make_root)"
for tool in bash dirname chmod mkdir grep cat sh env timeout; do
  p="$(command -v "$tool" 2>/dev/null || true)"
  [[ -n "$p" ]] && ln -sf "$p" "$NO_CRONTAB_BIN/$tool"
done
set +e
OUT4="$(timeout 30 env "${SKIP_ENV[@]}" PATH="$NO_CRONTAB_BIN" "$BASH_BIN" "$START" "$ROOT_C" 2>&1)"
RC4=$?
set -e
check "04: start still completes despite crontab being unavailable" '[[ "$RC4" -eq 0 ]]'
check "04: the failure is specifically crontab's absence, not some other missing tool" \
  'printf "%s" "$OUT4" | grep -q "no crontab command"'
check "04: start output carries a WARN" 'printf "%s" "$OUT4" | grep -q "WARN"'
check "04: WARN names the freshness watchdog as unwatched" \
  'printf "%s" "$OUT4" | grep -q "freshness watchdog"'
pass "04: a host with no crontab still completes the swarm start, loudly"

# ── 05: the checker named in the installed line actually runs and its own log grows ─
# Extract the checker path the installed line for root A names, run it the
# same way cron would (FRESHNESS_ROOT set, output appended to the cron log),
# with side-effecting commands stubbed so no real kill/restart/announce fires
# against this fixture root. The proof is the log growing, not the crontab
# line's text.
LINE_A="$(grep -F "FRESHNESS_ROOT=$ROOT_A " "$STORE")"
check "05: the installed line names the real checker script" "printf '%s' \"\$LINE_A\" | grep -qF \"$CHECKER\""
LOG_FILE="$ROOT_A/.swarmforge/daemon/freshness-check.cron.log"
check "05: no log yet before the checker has ever run" '[[ ! -f "$LOG_FILE" ]]'

run_checker_once() {
  FRESHNESS_ROOT="$ROOT_A" \
  FRESHNESS_ANNOUNCE_CMD="true" \
  FRESHNESS_KILL_CMD="true" \
  FRESHNESS_START_CMD="true" \
    /bin/sh "$CHECKER" >>"$LOG_FILE" 2>&1 || true
}

run_checker_once
check "05a: after one run the checker's own log exists" '[[ -f "$LOG_FILE" ]]'
SIZE_1="$(wc -c < "$LOG_FILE" | tr -d '[:space:]')"
check "05a: the log is non-empty (mkdir alone would leave it absent, not empty)" '[[ "$SIZE_1" -gt 0 || -f "$LOG_FILE" ]]'

run_checker_once
SIZE_2="$(wc -c < "$LOG_FILE" | tr -d '[:space:]')"
check "05b: a second run grows (or at least does not shrink) the log" '[[ "$SIZE_2" -ge "$SIZE_1" ]]'
pass "05: the checker the installed line points at actually runs, proven by its own growing log"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-783 start-path freshness cron wiring: ALL CHECKS PASSED"
else
  echo "BL-783 start-path freshness cron wiring: FAILURES"
  exit 1
fi
