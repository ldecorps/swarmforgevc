#!/usr/bin/env bash
# BL-1414 property encoding (BL-654 invariants), quantifying over the
# REAL announce_transition_only (freshness_announce_lib.sh) and the REAL
# checker (daemon_log_freshness_check.sh) - never a reimplementation.
#
# Invariant 1 (suppression is announce-only): P1 runs the real checker over
# a random-length run of consecutive violation ticks and asserts the
# durable incident log gains exactly one record per tick, regardless of how
# many of those ticks were suppressed for announcing.
#
# Invariants 2 and 3 (first tick of a transition is never suppressed; the
# decision is durable state, never process memory) are proven TOGETHER by
# P2: every announce_transition_only call runs in its own `env -i sh -c`
# subprocess - no shared shell, no inherited env, nothing but the state
# file on disk connects one call to the next, which is the strongest
# available proof that "every cron tick is a fresh process" does not
# matter to the decision. For a random sequence of violation/fresh ticks,
# P2 asserts: the first violation tick after a fresh-or-never state always
# decides "announce"; a repeat violation tick (digest window pinned huge so
# it never elapses) always decides "suppress"; the first fresh tick after a
# violation always decides "recovered <secs>"; a repeat fresh tick always
# decides "none".
#
# Usage: bash bl1414_freshness_announce_digest_property_runner.sh
# Env: PROPERTY_RUNS (default 200)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
LIB="$SRC/freshness_announce_lib.sh"
CHECKER="$SRC/daemon_log_freshness_check.sh"
CONF="$SCRIPT_DIR/fixtures/daemon_log_freshness.fixture.conf"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

RUNS="${PROPERTY_RUNS:-200}"
FAILURES=0
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }

# Seeded LCG (same shape as bl888's own bash property runner).
SEED=1414
gen_int() {
  local n="$1"
  SEED=$(( (SEED * 1103515245 + 12345) % 2147483648 ))
  GEN_INT=$(( (SEED / 65536) % n ))
}

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/daemon" "$d/.swarmforge/babysitterd"
  printf '%s' "$d"
}

# ── P1 (invariant 1): the incident log gains one record per tick, however
#    many of those ticks were suppressed for announcing. ───────────────────
run_checker_tick() {
  local root=$1 now=$2 digest=$3
  FRESHNESS_ROOT="$root" \
  FRESHNESS_CONF="$CONF" \
  FRESHNESS_NOW_EPOCH="$now" \
  FRESHNESS_INCIDENT_FILE="$root/.swarmforge/daemon/freshness-incidents.log" \
  FRESHNESS_COOL_OFF_SECS=100000 \
  FRESHNESS_ANNOUNCE_DIGEST_SECS="$digest" \
  FRESHNESS_LOAD=1 FRESHNESS_CORES=1 \
  FRESHNESS_ANNOUNCE_CMD="printf '%s\n' \"\$1\" >> \"$root/announces.log\"" \
  FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$root/kills.log\"" \
  FRESHNESS_START_CMD="printf '%s %s\n' \"\$1\" \"\$2\" >> \"$root/starts.log\"" \
  /bin/sh "$CHECKER" >/dev/null
}

p1_case() {
  local root now stale_ts fresh_ts n_ticks incident_lines
  root="$(make_root)"
  now=1700000000
  # A fixed, always-stale timestamp: every tick this loop runs sees the
  # SAME violation (age only grows), and COOL_OFF is pinned huge above so
  # every tick after the first lands in the escalate branch, never a real
  # restart (which would rotate the log away and change what is measured).
  stale_ts="$(date -u -d "@$((now - 5000))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r $((now - 5000)) +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s heartbeat\n' "$stale_ts" > "$root/.swarmforge/daemon/handoffd.log"

  gen_int 5
  n_ticks=$((GEN_INT + 2)) # 2..6 ticks
  local t=$now
  local i=0
  while (( i < n_ticks )); do
    gen_int 400
    t=$((t + GEN_INT + 1)) # random 1..400s gap, always forward
    # babysitterd's own heartbeat is refreshed to the CURRENT tick every
    # time, so only handoffd (fixed at now-5000, age only growing) is ever
    # in violation - isolating the count this property asserts on.
    fresh_ts="$(date -u -d "@$t" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
      || date -u -r "$t" +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s heartbeat\n' "$fresh_ts" > "$root/.swarmforge/babysitterd/babysitterd.log"
    run_checker_tick "$root" "$t" 100000000
    i=$((i + 1))
  done

  incident_lines=$(wc -l < "$root/.swarmforge/daemon/freshness-incidents.log" | tr -d ' ')
  if [[ "$incident_lines" -ne "$n_ticks" ]]; then
    fail "seed=$SEED P1: expected $n_ticks incident records for $n_ticks ticks, got $incident_lines"
  fi
  if [[ "$n_ticks" -gt 1 ]]; then
    local announce_lines=0
    [[ -f "$root/announces.log" ]] && announce_lines=$(wc -l < "$root/announces.log" | tr -d ' ')
    if [[ "$announce_lines" -ge "$n_ticks" ]]; then
      fail "seed=$SEED P1: $n_ticks ticks with a digest window that never elapses must suppress at least one announce, got $announce_lines announce(s)"
    fi
  fi
}

# ── P2 (invariants 2 and 3): first-tick-never-suppressed, decided from
#    durable state alone across genuinely separate processes. ─────────────
call_transition() {
  # $1=root $2=now $3=digest $4=daemon $5=reason $6=action
  env -i PATH="$PATH" sh -c '
    . "$1"
    announce_transition_only "$2" "$3" "$4" "$5" "$6" "$7"
  ' _ "$LIB" "$1" "$2" "$3" "$4" "$5" "$6"
}

p2_case() {
  local root daemon reason now digest in_violation n_ticks i tick decision
  root="$(make_root)"
  gen_int 1000
  daemon="d$GEN_INT"
  reason="stale-heartbeat"
  now=1700000000
  digest=100000000 # pinned huge - never elapses in this property
  in_violation=0
  gen_int 6
  n_ticks=$((GEN_INT + 2)) # 2..7 ticks
  i=0
  while (( i < n_ticks )); do
    gen_int 200
    now=$((now + GEN_INT + 1))
    gen_int 2
    tick="$GEN_INT" # 0=fresh 1=violation
    if [[ "$tick" -eq 1 ]]; then
      decision="$(call_transition "$root" "$now" "$digest" "$daemon" "$reason" "restart")"
      if [[ "$in_violation" -eq 0 ]]; then
        [[ "$decision" == "announce" ]] || fail "seed=$SEED P2 daemon=$daemon: first violation tick must announce, got '$decision'"
        in_violation=1
      else
        [[ "$decision" == "suppress" ]] || fail "seed=$SEED P2 daemon=$daemon: repeat violation tick (digest never elapses) must suppress, got '$decision'"
      fi
    else
      decision="$(call_transition "$root" "$now" "$digest" "$daemon" "$reason" "fresh")"
      if [[ "$in_violation" -eq 1 ]]; then
        [[ "$decision" == recovered\ * ]] || fail "seed=$SEED P2 daemon=$daemon: first fresh tick after violation must recover, got '$decision'"
        in_violation=0
      else
        [[ "$decision" == "none" ]] || fail "seed=$SEED P2 daemon=$daemon: repeat fresh tick must be none, got '$decision'"
      fi
    fi
    i=$((i + 1))
  done
}

i=0
while (( i < RUNS )); do
  p1_case
  p2_case
  i=$((i + 1))
done

echo "  P1/P2 ran $RUNS case(s) each"
if (( FAILURES > 0 )); then
  echo "bl1414_freshness_announce_digest_property: $FAILURES FAILURE(S)" >&2
  exit 1
fi
echo "bl1414_freshness_announce_digest_property: ALL PROPERTIES HOLD ($RUNS runs)"
