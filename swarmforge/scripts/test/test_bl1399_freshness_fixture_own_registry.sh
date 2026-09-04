#!/usr/bin/env bash
# BL-1399: the freshness watchdog's property fixture supplies its OWN
# required-daemon registry through the seam the guard already reads.
#
# daemon_log_freshness_check.sh runs daemon_log_freshness_registry_guard.sh
# first (BL-784), which fails closed when a daemon in the REQUIRED list has no
# conf row. The fixture pins a one-row conf on purpose; left to itself the
# guard read the LIVE required list, found babysitterd with no row, and
# refused - three bl1012 properties red on main with nothing wrong in the
# watchdog, the guard or the conf.
#
# The guard must keep biting. Every check below drives the REAL checker and
# the REAL guard; none of them greps a label.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SCRIPTS="$REPO_ROOT/swarmforge/scripts"
CHECKER="$SCRIPTS/daemon_log_freshness_check.sh"
LIVE_REQUIRED="$SCRIPTS/daemon_log_freshness_required.conf"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1399-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1399_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

NOW=1700000000
NOW_ISO="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$NOW" +%Y-%m-%dT%H:%M:%SZ)"

# A fixture root shaped exactly like the property fixture's: its own conf, its
# own registry, and a healthy row per supervisor the guard's second arm will
# find - DERIVED from the same glob the guard walks, never listed here.
make_root() {  # make_root <name> <required-name>...
  root="$WORK/$1"; shift
  mkdir -p "$root/.swarmforge/daemon"
  {
    printf 'handoffd|120|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh\n'
    for s in "$SCRIPTS"/*_supervisor.bb; do
      [ -f "$s" ] || continue
      b="$(basename "$s" .bb)"
      printf '%s|600|.swarmforge/daemon/%s.log|.swarmforge/daemon/%s.pid|noop.sh\n' "$b" "$b" "$b"
      printf '%s heartbeat\n' "$NOW_ISO" > "$root/.swarmforge/daemon/$b.log"
    done
  } > "$root/freshness.conf"
  printf '%s\n' "$@" > "$root/freshness_required.conf"
  printf '%s heartbeat\n' "$NOW_ISO" > "$root/.swarmforge/daemon/handoffd.log"
}

run_checker() {  # run_checker <root> [required-path]
  local r="$1" req="${2:-$1/freshness_required.conf}"
  FRESHNESS_ROOT="$r" \
  FRESHNESS_CONF="$r/freshness.conf" \
  FRESHNESS_REQUIRED="$req" \
  FRESHNESS_NOW_EPOCH="$NOW" \
  FRESHNESS_INCIDENT_FILE="$r/.swarmforge/daemon/freshness-incidents.log" \
  FRESHNESS_ANNOUNCE_CMD="printf '%s\n' \"\$1\" >> '$r/announces.log'" \
  FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> '$r/kills.log'" \
  FRESHNESS_START_CMD="printf '%s %s\n' \"\$1\" \"\$2\" >> '$r/starts.log'" \
    timeout 120 /bin/sh "$CHECKER" 2>&1
}

# ── 1. the checker runs green against the fixture's own registry ─────────
make_root green handoffd
out="$(run_checker "$WORK/green")"; rc=$?
if (( rc == 0 )); then
  pass "the checker exits zero against the fixture's own registry"
else
  fail "the checker refused a self-consistent fixture (rc=$rc): $(tail -2 <<<"$out")"
fi

# ── 1b. and it read the FIXTURE's registry, not the live one ─────────────
# The live list names daemons this one-row conf does not carry, so a run that
# consulted it could not have passed. Asserted from the live file rather than
# from a name written here, so it stays true as that list grows.
live_only=""
while IFS= read -r n; do
  [[ -z "$n" || "$n" == \#* ]] && continue
  grep -qE "^$n\|" "$WORK/green/freshness.conf" || live_only+="$n "
done < "$LIVE_REQUIRED"
if [[ -n "$live_only" && $rc -eq 0 ]]; then
  pass "the guard read the fixture's registry, not the live one (live-only daemons: ${live_only% })"
else
  fail "the live list adds nothing the fixture conf lacks, so check 1 proves nothing"
fi

# ── 2. a fixture registry naming a daemon the conf lacks is refused ──────
make_root bites handoffd babysitterd
out="$(run_checker "$WORK/bites")"; rc=$?
if (( rc != 0 )) && grep -q 'babysitterd' <<<"$out" && grep -q 'FRESHNESS_REGISTRY_GUARD' <<<"$out"; then
  pass "a fixture registry naming a daemon the conf lacks is refused, naming babysitterd"
else
  fail "the guard did not bite on the fixture's own registry (rc=$rc): $(tail -2 <<<"$out")"
fi

# ── 3. the guard itself is untouched: the LIVE list still refuses ────────
# qa_e2e item 2, run rather than asserted: point the fixture at the live
# required list and the guard must refuse exactly as it did before this parcel.
out="$(run_checker "$WORK/green" "$LIVE_REQUIRED")"; rc=$?
if (( rc != 0 )) && grep -q 'FRESHNESS_REGISTRY_GUARD' <<<"$out"; then
  pass "with the live required list the guard still refuses (BL-784 untouched)"
else
  fail "the live required list no longer refuses a one-row conf (rc=$rc): $(tail -2 <<<"$out")"
fi

# ── 4. no live conf or registry file was written by any of this ──────────
if git -C "$REPO_ROOT" diff --quiet -- swarmforge/scripts/daemon_log_freshness.conf \
     swarmforge/scripts/daemon_log_freshness_required.conf \
     swarmforge/scripts/daemon_log_freshness_registry_guard.sh \
     swarmforge/scripts/daemon_log_freshness_check.sh; then
  pass "the live conf, registry, guard and checker are unmodified"
else
  fail "this parcel modified a live freshness file"
fi

# ── 4b. the supervisor rows are DERIVED, and that arm still bites ───────
# The amendment's qa_e2e 2b. The guard's second arm walks the live scripts dir
# with no seam, so the fixture cannot hide a supervisor from it: drop one row
# from the fixture's own conf (never the live file) and the guard must refuse,
# naming that supervisor.
make_root derived handoffd
victim="$(grep -oE '^[a-z_]+_supervisor\|' "$WORK/derived/freshness.conf" | head -1 | tr -d '|')"
if [[ -n "$victim" ]]; then
  grep -v "^$victim|" "$WORK/derived/freshness.conf" > "$WORK/derived/freshness.conf.tmp"
  mv "$WORK/derived/freshness.conf.tmp" "$WORK/derived/freshness.conf"
  out="$(run_checker "$WORK/derived")"; rc=$?
  if (( rc != 0 )) && grep -q "$victim" <<<"$out"; then
    pass "dropping a derived supervisor row makes the guard refuse, naming that supervisor"
  else
    fail "the second arm did not bite for the dropped $victim (rc=$rc): $(tail -2 <<<"$out")"
  fi
else
  fail "the fixture conf carries no supervisor row, so the derivation is not happening"
fi

# ── 4c. and the row set IS the live glob, computed at test time ──────────
make_root rowset handoffd
conf_rows="$(grep -oE '^[a-z_]+_supervisor\|' "$WORK/rowset/freshness.conf" | tr -d '|' | sort | tr '\n' ' ')"
glob_rows="$(for s in "$SCRIPTS"/*_supervisor.bb; do [ -f "$s" ] && basename "$s" .bb; done | sort | tr '\n' ' ')"
if [[ "$conf_rows" == "$glob_rows" && -n "$glob_rows" ]]; then
  pass "the fixture's supervisor rows equal the live glob's basenames at test time"
else
  fail "the rows are not the live glob: conf[$conf_rows] glob[$glob_rows]"
fi

# ── 5. the property test itself is green ────────────────────────────────
if ( cd "$REPO_ROOT/extension" && timeout 600 npx vitest run --config vitest.properties.config.mjs \
       test/bl1012FreshnessSelfInflictedIncidents.property.test.js >"$WORK/bl1012.log" 2>&1 ); then
  pass "bl1012FreshnessSelfInflictedIncidents is green"
else
  fail "the watchdog property test is still red: $(tail -3 "$WORK/bl1012.log")"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
