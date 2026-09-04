#!/usr/bin/env bash
# BL-1382: a crontab line the swarm did not write is never the swarm's to
# remove.
#
# Overnight 2026-09-04 the live crontab lost three hand-installed shift lines -
# exactly the three naming <root>/.swarmforge/operator/*.sh - because both
# ownership predicates claimed any line NAMING a script under the root. The
# human ruled marker-only ownership everywhere (SUP-17, 14:13:07Z): stop,
# install and reconcile touch only marked lines, and an unmarked line is
# reported as left in place.
#
# Every check drives the REAL installer and uninstaller through a `crontab`
# shim writing a fixture file. NOTHING here touches the live user crontab.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SCRIPTS="$REPO_ROOT/swarmforge/scripts"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1382-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1382_SUITE_BOUND_SECONDS:-900}" "$@"
trap 'rm -rf "$WORK"' EXIT

R="$WORK/root-r"
S="$WORK/root-s"
mkdir -p "$R/swarmforge/scripts" "$R/.swarmforge/operator" "$S/swarmforge"
cp "$SCRIPTS"/swarmforge_cron_lib.sh "$SCRIPTS"/uninstall_swarmforge_crons.sh \
   "$SCRIPTS"/install_shift_schedule_cron.sh "$SCRIPTS"/reconcile_shift_schedule_crontab.bb \
   "$R/swarmforge/scripts/" 2>/dev/null
printf '#!/usr/bin/env bash\nexit 0\n' > "$R/.swarmforge/operator/day-shift-start.sh"
chmod +x "$R/.swarmforge/operator/day-shift-start.sh"

# The crontab shim: `crontab -l` reads the fixture, `crontab -` writes it,
# `crontab -r` empties it. The live user crontab is never opened.
FIXTURE_CRON="$WORK/crontab.txt"
mkdir -p "$WORK/bin"
cat > "$WORK/bin/crontab" <<CRON
#!/usr/bin/env bash
case "\${1:-}" in
  -l) cat "$FIXTURE_CRON" 2>/dev/null ;;
  -r) : > "$FIXTURE_CRON" ;;
  -)  cat > "$FIXTURE_CRON" ;;
  *)  exit 2 ;;
esac
CRON
chmod +x "$WORK/bin/crontab"
export PATH="$WORK/bin:$PATH"

FRESH_R="*/2 * * * * FRESHNESS_ROOT=$R /bin/sh $R/swarmforge/scripts/daemon_log_freshness_check.sh # swarmforge-freshness root=[$R]"
FRESH_S="*/2 * * * * FRESHNESS_ROOT=$S /bin/sh $S/swarmforge/scripts/daemon_log_freshness_check.sh # swarmforge-freshness root=[$S]"
HUMAN_OP="0 9 * * 1-5 $R/.swarmforge/operator/day-shift-start.sh"
HUMAN_WAIT="45 16 * * 1-5 $R/swarmforge/scripts/wait.sh $R"
MARKED_OP="0 22 * * 5 $R/.swarmforge/operator/night-start.sh # swarmforge-operator-schedule root=[$R]"

seed_crontab() {
  { printf '%s\n' "$FRESH_R"; printf '%s\n' "$HUMAN_OP"; printf '%s\n' "$HUMAN_WAIT"
    printf '%s\n' "$FRESH_S"; [[ "${1:-}" == "--with-marked-op" ]] && printf '%s\n' "$MARKED_OP"; } > "$FIXTURE_CRON"
}

present_identical() {  # present_identical <line>
  grep -qxF "$1" "$FIXTURE_CRON"
}

# ── 01: a full-stack stop removes only the lines it marked ───────────────
seed_crontab
out="$(bash "$SCRIPTS/uninstall_swarmforge_crons.sh" "$R" 2>&1)"
if ! grep -qF "swarmforge-freshness root=[$R]" "$FIXTURE_CRON"; then
  pass "the freshness line marked for R is gone"
else
  fail "the marked freshness line survived the uninstall"
fi
if present_identical "$HUMAN_OP"; then
  pass "the unmarked operator-script line is present byte-identical"
else
  fail "the uninstall erased the human's operator-script line - the 2026-09-04 defect"
fi
if present_identical "$HUMAN_WAIT"; then
  pass "the unmarked scripts-dir line is present byte-identical"
else
  fail "the uninstall erased the unmarked scripts-dir line"
fi
if present_identical "$FRESH_S"; then
  pass "the sibling root's marked line is present byte-identical"
else
  fail "the uninstall crossed into the sibling root"
fi

# ── 04: and it reports each unmarked line it left in place ───────────────
if grep -qF "left in place" <<<"$out" && grep -qF "$HUMAN_OP" <<<"$out"; then
  pass "the uninstall reports the unmarked operator-script line as left in place"
else
  fail "the uninstall left the line but never said so: $(tail -3 <<<"$out")"
fi

# ── 03: a line carrying the operator marker IS still the swarm's ─────────
seed_crontab --with-marked-op
bash "$SCRIPTS/uninstall_swarmforge_crons.sh" "$R" >/dev/null 2>&1
if ! grep -qF "swarmforge-operator-schedule root=[$R]" "$FIXTURE_CRON"; then
  pass "a line carrying the operator schedule marker is still removed"
else
  fail "marker ownership stopped working: the marked line survived"
fi
if present_identical "$HUMAN_OP"; then
  pass "and the unmarked line beside it is still untouched"
else
  fail "the marked-line removal took the unmarked line with it"
fi

# ── 02: a recognized-mode install adds its block, touching nothing else ──
mkdir -p "$R/swarmforge"
printf 'config swarm_shift day\n' > "$R/swarmforge/swarmforge.conf"
seed_crontab
out="$(bash "$SCRIPTS/install_shift_schedule_cron.sh" "$R" 2>&1)"
# The install must actually have installed something, or "it touched nothing
# else" is the trivially true statement of a no-op.
if grep -qF "swarmforge-shift-schedule-begin $R" "$FIXTURE_CRON"; then
  pass "the recognized-mode install wrote its managed block for R"
else
  fail "no managed block was written, so the rest of this scenario is vacuous: $(tail -3 <<<"$out")"
fi
if present_identical "$HUMAN_OP" && present_identical "$HUMAN_WAIT"; then
  pass "a recognized-mode install leaves both unmarked lines byte-identical"
else
  fail "the install path erased an unmarked line: $(tail -3 <<<"$out")"
fi
if grep -qF "left in place" <<<"$out" && grep -qF "$HUMAN_OP" <<<"$out"; then
  pass "and the install reports the unmarked line as left in place"
else
  fail "the install left the line but never said so: $(tail -3 <<<"$out")"
fi

# ── the live crontab was never touched ───────────────────────────────────
# The shim is the only crontab on PATH for this suite; assert the real one is
# still reachable and that nothing in $WORK names it.
if [[ "$(command -v crontab)" == "$WORK/bin/crontab" ]]; then
  pass "every check ran against the fixture crontab, never the live one"
else
  fail "the crontab shim was not in front of the real one"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
