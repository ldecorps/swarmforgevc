#!/usr/bin/env bash
# BL-1133: babysitterd pulses heartbeat at process start, tick start, and
# tick end — never only after babysitter_check returns.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
DAEMON="$SRC/babysitterd.sh"
CHECKER="$SRC/daemon_log_freshness_check.sh"
CONF="$SRC/daemon_log_freshness.conf"
HB_RE='[[:space:]]heartbeat([[:space:]]|$)'

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

STRAY_PIDS=()
TEMP_DIRS=()
cleanup() {
  local pid d
  for pid in "${STRAY_PIDS[@]+"${STRAY_PIDS[@]}"}"; do
    [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
  done
  for d in "${TEMP_DIRS[@]+"${TEMP_DIRS[@]}"}"; do
    [[ -n "$d" ]] && rm -rf "$d" 2>/dev/null || true
  done
}
trap cleanup EXIT

track_dir() {
  TEMP_DIRS+=("$1")
  printf '%s' "$1"
}

make_root() {
  local d
  d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/handoffs/failed" "$d/backlog/active" \
    "$d/.swarmforge/daemon" "$d/.swarmforge/babysitterd"
  track_dir "$d"
}

# Disposable daemon copy whose SCRIPT_DIR resolves to a stub check that
# marks progress and can sleep — proves pulse order against a real tick(),
# not a parallel reimplementation.
make_stub_daemon() {
  local fix sleep_s
  sleep_s="${1:-0}"
  fix="$(mktemp -d)"
  cp "$DAEMON" "$fix/babysitterd.sh"
  cat > "$fix/babysitter_check.sh" <<EOF
#!/usr/bin/env bash
printf 'CHECK_MARK\\n'
sleep ${sleep_s}
EOF
  chmod +x "$fix/babysitter_check.sh"
  track_dir "$fix"
}

ts_at() {
  local epoch="$1"
  date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r "$epoch" +%Y-%m-%dT%H:%M:%SZ
}

run_checker() {
  local root="$1" now="$2"
  FRESHNESS_ROOT="$root" \
  FRESHNESS_CONF="$CONF" \
  FRESHNESS_NOW_EPOCH="$now" \
  FRESHNESS_INCIDENT_FILE="$root/.swarmforge/daemon/freshness-incidents.log" \
  FRESHNESS_COOL_OFF_SECS=300 \
  FRESHNESS_LOAD=1 \
  FRESHNESS_CORES=1 \
  FRESHNESS_ANNOUNCE_CMD="printf '%s\\n' \"\$1\" >> \"$root/announces.log\"" \
  FRESHNESS_KILL_CMD="printf '%s\\n' \"\$1\" >> \"$root/kills.log\"" \
  FRESHNESS_START_CMD="printf '%s %s\\n' \"\$1\" \"\$2\" >> \"$root/starts.log\"" \
  /bin/sh "$CHECKER"
}

# ── 01: --tick-once pulses BEFORE and AFTER the check ─────────────────────
FIX="$(make_stub_daemon 0)"
ROOT="$(make_root)"
bash "$FIX/babysitterd.sh" "$ROOT" --tick-once >/dev/null
LOG="$ROOT/.swarmforge/babysitterd/babysitterd.log"
[[ -f "$LOG" ]] || fail "01: expected log"
HB="$(grep -cE "$HB_RE" "$LOG" || true)"
[[ "$HB" -eq 2 ]] || fail "01: expected 2 heartbeats (start+end); got $HB"
# Order: heartbeat, CHECK_MARK, heartbeat
awk '
  /heartbeat/ { hb++ }
  /CHECK_MARK/ {
    if (hb < 1) { print "check before start pulse"; exit 1 }
    saw=1
  }
  END {
    if (!saw) { print "missing CHECK_MARK"; exit 1 }
    if (hb < 2) { print "missing end pulse"; exit 1 }
  }
' "$LOG" || fail "01: pulse order wrong in $(cat "$LOG")"
pass "01: --tick-once pulses heartbeat before and after check"

# ── 02: cold start pulses before the first check finishes ─────────────────
FIX="$(make_stub_daemon 3)"
ROOT="$(make_root)"
BABYSITTERD_INTERVAL_S=60 bash "$FIX/babysitterd.sh" "$ROOT" >/dev/null 2>&1 &
PID=$!
STRAY_PIDS+=("$PID")
LOG="$ROOT/.swarmforge/babysitterd/babysitterd.log"
saw_hb_before_check=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if [[ -f "$LOG" ]] && grep -qE "$HB_RE" "$LOG"; then
    if ! grep -q 'CHECK_MARK' "$LOG" 2>/dev/null; then
      saw_hb_before_check=1
      break
    fi
    # Cold + tick-start pulses both land before CHECK_MARK; if mark already
    # present, require a heartbeat line before it in file order.
    if awk '/heartbeat/{h=1} /CHECK_MARK/{exit !h}' "$LOG"; then
      saw_hb_before_check=1
      break
    fi
  fi
  sleep 0.2
done
if [[ "$saw_hb_before_check" -ne 1 ]]; then
  fail "02: no heartbeat before first check finished; log=$(cat "$LOG" 2>/dev/null || true)"
fi
kill -KILL "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
pass "02: cold start / tick-start pulse lands before first check finishes"

# ── 03: mid-check sample with start pulse stays under 600s age ────────────
ROOT="$(make_root)"
NOW=1700000000
# Tick-start pulse at NOW-300; check still in flight (no end pulse yet).
# Threshold is 600 — without a start pulse the previous end would already
# be stale once a gather overruns.
printf '%s heartbeat\n' "$(ts_at $((NOW - 300)))" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf '%s heartbeat\n' "$(ts_at "$NOW")" > "$ROOT/.swarmforge/daemon/handoffd.log"
run_checker "$ROOT" "$NOW"
[[ ! -f "$ROOT/kills.log" ]] || fail "03: mid-check start pulse must not kill babysitterd"
[[ ! -f "$ROOT/announces.log" ]] \
  || ! grep -q 'daemon=babysitterd' "$ROOT/announces.log" \
  || fail "03: mid-check must not announce babysitterd stale"
pass "03: mid-check sample with start pulse stays under babysitterd threshold"

# ── 04: wedged mute log still trips stale-heartbeat (BL-675 preserved) ────
ROOT="$(make_root)"
NOW=1700000000
printf '%s heartbeat\n' "$(ts_at $((NOW - 900)))" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
printf '%s heartbeat\n' "$(ts_at "$NOW")" > "$ROOT/.swarmforge/daemon/handoffd.log"
sleep 120 &
FAKE=$!
STRAY_PIDS+=("$FAKE")
echo "$FAKE" > "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
run_checker "$ROOT" "$NOW"
kill "$FAKE" 2>/dev/null || true
grep -q 'reason=stale-heartbeat' "$ROOT/.swarmforge/daemon/freshness-incidents.log" \
  || fail "04: expected stale-heartbeat incident; got $(cat "$ROOT/.swarmforge/daemon/freshness-incidents.log" 2>/dev/null)"
grep -q 'daemon=babysitterd' "$ROOT/.swarmforge/daemon/freshness-incidents.log" \
  || fail "04: incident must name babysitterd"
pass "04: wedged mute babysitterd still trips stale-heartbeat"

# ── 05: pulse helper is content-free; live path calls it start+end ────────
grep -q 'pulse_heartbeat()' "$DAEMON" || fail "05: pulse_heartbeat helper missing"
# Helper body is only a printf of a heartbeat line (no git).
HELPER_BODY="$(awk '/^pulse_heartbeat\(\)/,/^}/' "$DAEMON")"
printf '%s\n' "$HELPER_BODY" | grep -q 'printf.*heartbeat' \
  || fail "05: pulse_heartbeat must printf a heartbeat line"
printf '%s\n' "$HELPER_BODY" | grep -qiE 'git |index|worktree|add |commit' \
  && fail "05: pulse_heartbeat must not touch git"
# tick() calls pulse before AND after babysitter_check
TICK_BODY="$(awk '/^tick\(\)/,/^}/' "$DAEMON")"
ORDER="$(printf '%s\n' "$TICK_BODY" | grep -nE 'pulse_heartbeat|babysitter_check' | cut -d: -f2-)"
printf '%s\n' "$ORDER" | head -n1 | grep -q pulse_heartbeat \
  || fail "05: tick must pulse before babysitter_check; order=$ORDER"
printf '%s\n' "$ORDER" | tail -n1 | grep -q pulse_heartbeat \
  || fail "05: tick must pulse after babysitter_check; order=$ORDER"
# Cold-start pulse is a TOP-LEVEL pulse_heartbeat call before `while true`
# (outside tick/helpers). Counting any pulse_heartbeat line before while is
# wrong: tick()'s pulses also sit above while, so deleting only the cold-start
# call still left "last pulse_heartbeat < while" true (survivor probe 2026-08-25).
awk '
  /^[a-zA-Z_][a-zA-Z0-9_]*\(\)/ { in_fn=1 }
  in_fn && /^}/ { in_fn=0; next }
  in_fn { next }
  /^[[:space:]]*pulse_heartbeat[[:space:]]*$/ { found=1 }
  /while true/ { exit }
  END { exit found ? 0 : 1 }
' "$DAEMON" || fail "05: top-level cold-start pulse_heartbeat must appear before while true"
pass "05: live path wires start-of-process + start/end-of-tick pulses"

# ── 06: cold path lands TWO heartbeats before first CHECK_MARK ────────────
# Isolates cold-start from tick-start: --tick-once only needs one pre-check
# pulse; the forever path must pulse cold-start then tick-start before check.
FIX="$(make_stub_daemon 2)"
ROOT="$(make_root)"
BABYSITTERD_INTERVAL_S=60 bash "$FIX/babysitterd.sh" "$ROOT" >/dev/null 2>&1 &
PID=$!
STRAY_PIDS+=("$PID")
LOG="$ROOT/.swarmforge/babysitterd/babysitterd.log"
pre_check_hb=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if [[ -f "$LOG" ]] && grep -q 'CHECK_MARK' "$LOG" 2>/dev/null; then
    pre_check_hb="$(awk '/CHECK_MARK/{exit} /heartbeat/{c++} END{print c+0}' "$LOG")"
    break
  fi
  sleep 0.2
done
kill -KILL "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
[[ "$pre_check_hb" -ge 2 ]] \
  || fail "06: cold path needs ≥2 heartbeats before first check (cold+tick-start); got $pre_check_hb log=$(cat "$LOG" 2>/dev/null || true)"
pass "06: cold path pulses cold-start and tick-start before first check"

echo "ALL PASS"
