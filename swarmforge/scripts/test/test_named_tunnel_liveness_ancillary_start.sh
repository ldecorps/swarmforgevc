#!/usr/bin/env bash
# BL-1199: start_ancillary_services.sh's own named-tunnel liveness
# assertion. Drives the REAL, unmodified script (no stubbed bash logic
# duplicated here) with everything except the resident-spy-tunnel block
# skipped via its own documented SWARMFORGE_SKIP_* env vars, and HOME
# pointed at an empty fixture dir so the script's own unconditional
# `source "$HOME/.zshenv"` cannot pull in this machine's real Telegram/
# Cursor credentials and start something real (see this session's own
# "~/.zshenv re-exports real keys over fixture values" hazard) - the
# fixture's own launcher stub is the only named-tunnel entry point that
# ever runs. Covers scenario
# named-tunnel-liveness-asserted-not-inferred-01: the launcher exits 0 but
# the recorded pid later died, and ancillary start must not treat that
# zero exit as proof of a running tunnel.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT
EMPTY_HOME="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir EMPTY_HOME

FIXTURE_SCRIPTS="$ROOT/swarmforge/scripts"
mkdir -p "$FIXTURE_SCRIPTS" "$ROOT/.swarmforge/operator"
cp "$REAL_SCRIPTS_DIR/start_ancillary_services.sh" "$FIXTURE_SCRIPTS/"
cp "$REAL_SCRIPTS_DIR/named_tunnel_liveness_check.bb" "$FIXTURE_SCRIPTS/"
cp "$REAL_SCRIPTS_DIR/named_tunnel_liveness_lib.bb" "$FIXTURE_SCRIPTS/"
cp "$REAL_SCRIPTS_DIR/lifecycle_help_lib.sh" "$FIXTURE_SCRIPTS/" 2>/dev/null || true

RELAUNCH_COUNT_FILE="$ROOT/relaunch-count"
echo 0 > "$RELAUNCH_COUNT_FILE"

# A named tunnel is configured for the operator root (feature Background).
echo "SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble" > "$ROOT/.swarmforge/operator/named-tunnel.env"

# ── scenario 01: the launcher exited successfully, but the recorded pid ──
# is no longer alive by the time anyone re-checks - never a real
# cloudflared, never a real spawn.
DEAD_PID=99999999
echo "$DEAD_PID" > "$ROOT/.swarmforge/operator/resident-spy-cloudflared.pid"

cat > "$FIXTURE_SCRIPTS/launch_resident_spy_tunnel.sh" <<EOF
#!/usr/bin/env bash
count=\$(cat "$RELAUNCH_COUNT_FILE")
echo \$((count + 1)) > "$RELAUNCH_COUNT_FILE"
echo "$DEAD_PID" > "$ROOT/.swarmforge/operator/resident-spy-cloudflared.pid"
exit 0
EOF
chmod +x "$FIXTURE_SCRIPTS/launch_resident_spy_tunnel.sh"

run_ancillary_start() {  # sets OUT, ERR, RC
  set +e
  OUT="$(HOME="$EMPTY_HOME" \
    SWARMFORGE_SKIP_OPERATOR=1 \
    SWARMFORGE_SKIP_FRONT_DESK=1 \
    SWARMFORGE_SKIP_CURSOR_BRIDGE=1 \
    SWARMFORGE_SKIP_ONBOARDER=1 \
    SWARMFORGE_SKIP_BABYSITTERD=1 \
    SWARMFORGE_SKIP_FRESHNESS_CRON=1 \
    SWARMFORGE_SKIP_SCHEDULE_CRON=1 \
    SWARMFORGE_SKIP_TUNNEL=1 \
    bash "$FIXTURE_SCRIPTS/start_ancillary_services.sh" "$ROOT" 2>"$ROOT/stderr.txt")"
  RC=$?
  set -e
  ERR="$(cat "$ROOT/stderr.txt")"
}

run_ancillary_start

echo "$ERR" | grep -qi "bubble named tunnel" \
  || fail "01: expected the report to name the named (Bubble) tunnel specifically, got: $ERR"
echo "$ERR" | grep -qi "down" \
  || fail "01: expected the named tunnel to be reported down, got: $ERR"
echo "$ERR" | grep -qi "vscode" \
  && fail "01: the report must name the named tunnel, never the editor (vscode) tunnel: $ERR"
[[ "$(cat "$RELAUNCH_COUNT_FILE")" == "2" ]] \
  || fail "01: expected exactly one bounded relaunch attempt after the first liveness check failed (initial launch + one relaunch = 2 total launcher calls), got $(cat "$RELAUNCH_COUNT_FILE")"
pass "01: ancillary start asserts the named tunnel is live rather than trusting the launcher's exit code, names the named tunnel, and attempts exactly one bounded relaunch"

# ── regression guard: a genuinely live named tunnel is never flagged ─────
echo 0 > "$RELAUNCH_COUNT_FILE"
echo $$ > "$ROOT/.swarmforge/operator/resident-spy-cloudflared.pid"
# A different stub for this scenario: the real launch_resident_spy_tunnel.sh
# is idempotent (no-ops when the recorded pid is already live) - this stub
# mirrors that instead of unconditionally overwriting the pidfile with the
# dead pid from scenario 01 above.
cat > "$FIXTURE_SCRIPTS/launch_resident_spy_tunnel.sh" <<EOF
#!/usr/bin/env bash
count=\$(cat "$RELAUNCH_COUNT_FILE")
echo \$((count + 1)) > "$RELAUNCH_COUNT_FILE"
exit 0
EOF
chmod +x "$FIXTURE_SCRIPTS/launch_resident_spy_tunnel.sh"
run_ancillary_start
echo "$ERR" | grep -qi "bubble named tunnel" \
  && fail "regression: a genuinely live named tunnel must never be flagged, got: $ERR"
[[ "$(cat "$RELAUNCH_COUNT_FILE")" == "1" ]] \
  || fail "regression: expected exactly the one normal launch call, no relaunch, got $(cat "$RELAUNCH_COUNT_FILE")"
pass "regression: a genuinely live named tunnel passes with no relaunch and no false report"

# ── regression guard: an unconfigured root is never flagged either ───────
# BL-1199's own constraint: "A root with no named tunnel configured must
# report 'not configured', never 'down'". named_tunnel_liveness_check.bb
# exits 2 (NOT_CONFIGURED) here, distinct from exit 1 (DOWN) - this guards
# the ancillary-start call site's own branch on that exit code, not just
# the predicate: a mutant widening the DOWN branch's `== "1"` guard to also
# catch NOT_CONFIGURED's "2" (e.g. `!= "0"`) survives both scenarios above
# untouched, since scenario 01 and the live-tunnel regression never drive a
# NOT_CONFIGURED result.
rm -f "$ROOT/.swarmforge/operator/named-tunnel.env"
rm -f "$ROOT/.swarmforge/operator/resident-spy-cloudflared.pid"
echo 0 > "$RELAUNCH_COUNT_FILE"
cat > "$FIXTURE_SCRIPTS/launch_resident_spy_tunnel.sh" <<EOF
#!/usr/bin/env bash
count=\$(cat "$RELAUNCH_COUNT_FILE")
echo \$((count + 1)) > "$RELAUNCH_COUNT_FILE"
exit 0
EOF
chmod +x "$FIXTURE_SCRIPTS/launch_resident_spy_tunnel.sh"
run_ancillary_start
echo "$ERR" | grep -qi "bubble named tunnel" \
  && fail "regression: an unconfigured root must never be flagged as down, got: $ERR"
[[ "$(cat "$RELAUNCH_COUNT_FILE")" == "1" ]] \
  || fail "regression: an unconfigured root must never trigger a relaunch attempt, got $(cat "$RELAUNCH_COUNT_FILE")"
pass "regression: an unconfigured root passes with no relaunch and no false 'down' report"

echo "ALL PASS"
