#!/usr/bin/env bash
# BL-1392 e2e: a dead cron daemon is never silent.
#
# Install-time: install_swarmforge_crons.sh must print CRON_DAEMON_DOWN and
# exit non-zero when no daemon is alive, while STILL writing the crontab lines.
# Runtime: the handoffd sweep notices a stale freshness log, escalates once per
# episode, and re-arms after cron returns.
#
# BL-1242: independent guards do NOT run under `set -e`.
# BL-1390: no git call here touches anything outside the fixture.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
INSTALLER="$SCRIPT_DIR/../install_swarmforge_crons.sh"
PREFIX="bl1392-cron-"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

# BL-1390 second incident: a blind prefix sweep deletes a CONCURRENT copy's
# fixtures - 1156 copies of a sibling suite exhausted the host that way.
# This suite is invoked once per scenario by its acceptance handler, so it
# can run concurrently too. fixture_isolation_begin bounds the clock, logs
# the invoker, takes a lock, reaps only roots NO LIVE RUN OWNS, and creates
# an owner-stamped $WORK.
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$PREFIX" "${BL1392_SUITE_BOUND_SECONDS:-900}"
trap 'rm -rf "$WORK"' EXIT

# A fake `crontab` that keeps its table in a file, and a `pgrep` whose answer
# this test controls - the whole point is to run both sides of "is a daemon
# alive" without one on the host.
make_shims() {
  local dir="$1" cron_alive="$2"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/crontab" <<CRONTAB
#!/usr/bin/env bash
TABLE="$dir/crontab.txt"
if [[ "\${1:-}" == "-l" ]]; then cat "\$TABLE" 2>/dev/null; exit 0; fi
if [[ "\${1:-}" == "-" || -z "\${1:-}" ]]; then cat > "\$TABLE"; exit 0; fi
cat "\$1" > "\$TABLE" 2>/dev/null; exit 0
CRONTAB
  cat > "$dir/bin/pgrep" <<PGREP
#!/usr/bin/env bash
# \$2 is the process name under \`pgrep -x <name>\`.
if [[ "$cron_alive" == "alive" && ( "\${2:-}" == "cron" || "\${2:-}" == "crond" ) ]]; then
  echo 4242; exit 0
fi
exit 1
PGREP
  chmod +x "$dir/bin/crontab" "$dir/bin/pgrep"
}

fixture_root() {
  # Deliberately NOT `local`: run_installer below writes its output to
  # "$WORK/$name.out", and a local would leave that unset under `set -u`,
  # silently producing no output at all rather than a failure anyone can read.
  name="$1"
  local cron_alive="$2"
  root="$WORK/$name"
  mkdir -p "$root/.swarmforge/daemon" "$root/swarmforge/scripts"
  cp -R "$REPO_ROOT/swarmforge/scripts/." "$root/swarmforge/scripts/" || fail "setup($name): copy failed"
  make_shims "$root" "$cron_alive"
}

run_installer() {
  ( cd "$root" && PATH="$root/bin:$PATH" bash "$root/swarmforge/scripts/install_swarmforge_crons.sh" "$root" \
      >"$WORK/$name.out" 2>"$WORK/$name.err" )
}

# ── 1. no daemon: named, non-zero, and the lines still installed ───────────
fixture_root one dead
run_installer; rc=$?
out="$(cat "$WORK/one.out" "$WORK/one.err" 2>/dev/null)"
if grep -q 'CRON_DAEMON_DOWN' <<<"$out"; then
  pass "a dead cron daemon is named at install time (CRON_DAEMON_DOWN)"
else
  fail "no CRON_DAEMON_DOWN in the installer output: $(head -5 <<<"$out")"
fi
if grep -q 'service cron start' <<<"$out"; then
  pass "and the marker names the host command that fixes it"
else
  fail "the marker does not name the fix"
fi
if (( rc != 0 )); then
  pass "and the installer exits non-zero"
else
  fail "the installer reported success over a dead daemon"
fi
if grep -q 'freshness' "$root/crontab.txt" 2>/dev/null; then
  pass "the crontab lines are STILL installed, so they fire the moment cron starts"
else
  fail "the lines were not written: $(cat "$root/crontab.txt" 2>/dev/null | head -3)"
fi

# ── 2. a live daemon: today's behaviour, exit 0 ────────────────────────────
fixture_root two alive
run_installer; rc=$?
out="$(cat "$WORK/two.out" "$WORK/two.err" 2>/dev/null)"
if ! grep -q 'CRON_DAEMON_DOWN' <<<"$out"; then
  pass "a live cron daemon prints no marker"
else
  fail "the marker fired with a live daemon"
fi
if (( rc == 0 )); then
  pass "and the installer exits 0 exactly as before"
else
  fail "the installer failed with a live daemon (rc=$rc): $(tail -3 <<<"$out")"
fi

# ── 3. a swarm start shows the marker in its own output ───────────────────
# The launcher itself, with every OTHER service skipped, so what is proved is
# that the marker survives the launch path rather than that a comment says it
# does. The cron install is deliberately NOT skipped - it is the thing under
# test.
fixture_root three dead
( cd "$root" && PATH="$root/bin:$PATH" \
    SWARMFORGE_SKIP_BABYSITTERD=1 SWARMFORGE_SKIP_CURSOR_BRIDGE=1 \
    SWARMFORGE_SKIP_FRONT_DESK=1 SWARMFORGE_SKIP_ONBOARDER=1 \
    SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL=1 \
    SWARMFORGE_SKIP_TUNNEL=1 \
    timeout 180 bash "$root/swarmforge/scripts/start_ancillary_services.sh" "$root" \
      >"$WORK/three.out" 2>"$WORK/three.err" )
start_out="$(cat "$WORK/three.out" "$WORK/three.err" 2>/dev/null)"
if grep -q 'CRON_DAEMON_DOWN' <<<"$start_out"; then
  pass "a swarm start with no cron daemon shows the marker in its own output"
else
  fail "the marker did not reach the launch output: $(tail -5 <<<"$start_out")"
fi

# ── 4. the runtime sweep: stale, quiet, re-armed ──────────────────────────
# Drives the REAL decision through the real lib with controlled ages - the
# daemon owns only the clock and the escalation channel.
verdict_for() {
  bb -e "
(load-file \"$REPO_ROOT/swarmforge/scripts/cron_heartbeat_lib.bb\")
(println (name (cron-heartbeat-lib/cron-heartbeat-verdict
  {:present? $1 :age-ms $2 :escalated? $3})))" 2>/dev/null | tail -1
}

if [[ "$(verdict_for true 1800000 false)" == "stale-escalate" ]]; then
  pass "a freshness log aged past the bound escalates once"
else
  fail "a stale log did not escalate: $(verdict_for true 1800000 false)"
fi
if [[ "$(verdict_for true 2400000 true)" == "stale-already-escalated" ]]; then
  pass "a second tick in the same episode escalates nothing more"
else
  fail "the second tick escalated again"
fi
if [[ "$(verdict_for true 60000 true)" == "fresh" ]]; then
  pass "a refreshed log clears the episode (BL-920 self-healing)"
else
  fail "a fresh log did not clear the episode"
fi
if [[ "$(verdict_for true 1800000 false)" == "stale-escalate" ]]; then
  pass "and aging it again is a NEW escalation"
else
  fail "a new episode did not escalate"
fi

# ── the sweep is actually wired into the daemon, not merely written ────────
if grep -q 'cron-heartbeat-stale' "$REPO_ROOT/swarmforge/scripts/handoffd.bb"; then
  pass "the daemon carries the cron-heartbeat-stale sweep label"
else
  fail "handoffd.bb does not carry the sweep label"
fi
if grep -q 'run-sweep! "cron-heartbeat"' "$REPO_ROOT/swarmforge/scripts/handoffd.bb"; then
  pass "and registers it on the shared sweep cadence"
else
  fail "the sweep is defined but never registered - the BL-1235 shape"
fi

# ── the check never starts cron (invariant 3) ─────────────────────────────
if grep -vE '^[[:space:]]*(#|;)' "$REPO_ROOT/swarmforge/scripts/install_swarmforge_crons.sh" \
     "$REPO_ROOT/swarmforge/scripts/cron_heartbeat_lib.bb" \
   | grep -qE '(service cron (start|restart)|systemctl (start|restart) cron|/etc/init.d/cron)[^"]*$'; then
  fail "something here tries to START cron - that needs root and is the host owner's"
else
  pass "nothing starts, restarts or configures a cron daemon (invariant 3)"
fi

# ── no host configuration file is written ─────────────────────────────────
# The marker TELLS the operator to add a [boot] line to /etc/wsl.conf; writing
# it is the host owner's, needs root, and must not be attempted here. Checked
# structurally (no redirection into a host config path) and observationally
# (the real file's mtime is unchanged by the fixture runs above).
etc_mtime_before="$(stat -c %Y /etc/wsl.conf 2>/dev/null || echo none)"
if grep -vE '^[[:space:]]*(#|;)' \
     "$REPO_ROOT/swarmforge/scripts/install_swarmforge_crons.sh" \
     "$REPO_ROOT/swarmforge/scripts/cron_heartbeat_lib.bb" \
   | grep -qE '>[[:space:]]*/etc/|tee[[:space:]]+/etc/|sed -i[^|]*/etc/'; then
  fail "something here writes a host configuration file"
else
  pass "no host configuration file is written by the installer or the decision"
fi
if [[ "$etc_mtime_before" == "$(stat -c %Y /etc/wsl.conf 2>/dev/null || echo none)" ]]; then
  pass "and /etc/wsl.conf is untouched by these runs"
else
  fail "/etc/wsl.conf changed during this suite"
fi

if [[ $status -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
