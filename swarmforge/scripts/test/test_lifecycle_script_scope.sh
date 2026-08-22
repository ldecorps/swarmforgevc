#!/usr/bin/env bash
# BL-637: lifecycle script names state their scope; stop path verifies survivors.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SCRIPTS="$ROOT/swarmforge/scripts"
# BL-872: registers every mktemp path below with the shared EXIT trap
# (lib/tmp_cleanup.sh) so a failing assertion (set -euo pipefail exiting
# before that section's own trailing rm) still gets it cleaned up.
source "$SCRIPTS/test/lib/tmp_cleanup.sh"
PASS=0
FAIL=0

pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

# ── 01: --help scope tokens ────────────────────────────────────────────────
check_help_scope() {
  local entry="$1" expect="$2" out
  if [[ "$entry" == /* || "$entry" == ./* ]]; then
    out="$(bash "$ROOT/${entry#./}" --help 2>&1)" || true
  else
    out="$(bash "$SCRIPTS/$entry" --help 2>&1)" || true
  fi
  if [[ "$out" == *"$expect"* ]]; then
    pass "01: $entry --help states $expect"
  else
    fail "01: $entry --help missing '$expect'; got: $out"
  fi
}

check_help_scope "kill_all_swarm.sh" "pipeline-only"
check_help_scope "./swarm-kill" "pipeline-only"
check_help_scope "./stop-swarm.sh" "full stack"
check_help_scope "./start-swarm.sh" "full stack"
check_help_scope "kill_pipeline_swarm.sh" "pipeline-only"

# ── 02: legacy shim still reaches real kill + writes audit ────────────────
FIX="$(mktemp -d /tmp/bl637-kill.XXXXXX)"
register_tmp_dir "$FIX"
mkdir -p "$FIX/.swarmforge/daemon"
# Dry path: run --help via shim proves delegation; for audit, invoke real body
# against empty fixture (idempotent).
bash "$SCRIPTS/kill_all_swarm.sh" "$FIX" >/tmp/bl637-shim.out 2>/tmp/bl637-shim.err || true
if [[ -f "$FIX/.swarmforge/daemon/kill-all-audit.log" ]] \
  && grep -q 'kill_all_swarm SUCCESS' "$FIX/.swarmforge/daemon/kill-all-audit.log"; then
  pass "02: kill_all_swarm.sh shim writes kill-all-audit.log SUCCESS"
else
  fail "02: shim did not write audit SUCCESS; err=$(cat /tmp/bl637-shim.err 2>/dev/null); out=$(cat /tmp/bl637-shim.out 2>/dev/null)"
fi
if grep -q 'pipeline-only' /tmp/bl637-shim.err; then
  pass "02b: shim prints pipeline-only pointer on stderr"
else
  fail "02b: shim stderr missing pipeline-only pointer: $(cat /tmp/bl637-shim.err)"
fi
rm -rf "$FIX"

# ── 03: every start_*/launch_* --help names a stop entry point ─────────────
PAIR_FAIL=0
for f in "$SCRIPTS"/start_*.sh "$SCRIPTS"/launch_*.sh; do
  base="$(basename "$f")"
  out="$(bash "$f" --help 2>&1)" || true
  if ! grep -qiE 'stop|kill_pipeline|swarm-kill|stop-swarm|stop_' <<<"$out"; then
    echo "FAIL: 03: $base --help does not name a stop entry point: $out" >&2
    PAIR_FAIL=1
    FAIL=$((FAIL + 1))
  fi
done
if [[ "$PAIR_FAIL" -eq 0 ]]; then
  pass "03: every start_*/launch_* --help names a stop entry point"
fi

# ── 04/05: survivor scan refuses clean slate ───────────────────────────────
source "$SCRIPTS/stack_survivor_scan.sh"

PS_BB="$(mktemp /tmp/bl637-ps-bb.XXXXXX)"
register_tmp_dir "$PS_BB"
cat > "$PS_BB" <<'EOF'
  1 init
1234 bash ./.swarmforge/operator/babysitterd.sh /tmp/proj
EOF
export SWARMFORGE_SURVIVOR_PS_FILE="$PS_BB"
stack_survivor_lines=""; stack_survivor_names=""
if stack_survivor_scan && [[ "$stack_survivor_names" == *babysitterd* ]]; then
  pass "04a: scan names surviving babysitterd"
else
  fail "04a: scan missed babysitterd; names='$stack_survivor_names' lines='$stack_survivor_lines'"
fi
rm -f "$PS_BB"

PS_OP="$(mktemp /tmp/bl637-ps-op.XXXXXX)"
register_tmp_dir "$PS_OP"
cat > "$PS_OP" <<'EOF'
  1 init
5678 claude --dangerously-skip-permissions --remote-control Operator --model x
EOF
export SWARMFORGE_SURVIVOR_PS_FILE="$PS_OP"
stack_survivor_lines=""; stack_survivor_names=""
if stack_survivor_scan && [[ "$stack_survivor_names" == *Operator* ]]; then
  pass "05a: scan names surviving Operator agent"
else
  fail "05a: scan missed Operator; names='$stack_survivor_names' lines='$stack_survivor_lines'"
fi
rm -f "$PS_OP"

# Self-match trap: a line that looks like our grep must not invent survivors
# when the only "match" would be the scanner itself — fixture has no real
# babysitterd/Operator besides a decoy mentioning the needle in a comment-like argv.
PS_NONE="$(mktemp /tmp/bl637-ps-none.XXXXXX)"
register_tmp_dir "$PS_NONE"
cat > "$PS_NONE" <<'EOF'
  1 init
9999 sleep 3600
EOF
export SWARMFORGE_SURVIVOR_PS_FILE="$PS_NONE"
stack_survivor_lines=""; stack_survivor_names=""
if stack_survivor_scan; then
  fail "04b: empty fixture should not report survivors: $stack_survivor_lines"
else
  pass "04b: empty fixture reports no survivors"
fi
rm -f "$PS_NONE"
unset SWARMFORGE_SURVIVOR_PS_FILE

# End-to-end stop-swarm with injected survivor snapshot (BL-746): every
# scenario below drives the REAL repo-root stop-swarm.sh, never a
# reimplementation of its refuse-gate branching. stop-swarm.sh resolves its
# three helpers relative to its own location (SCRIPT_DIR), so a byte-
# identical runtime copy in the fixture root IS invoking the script itself.
STOP_FIX="$(mktemp -d /tmp/bl637-stop.XXXXXX)"
register_tmp_dir "$STOP_FIX"
mkdir -p "$STOP_FIX/swarmforge/scripts" "$STOP_FIX/.swarmforge/daemon"
cp "$ROOT/stop-swarm.sh" "$STOP_FIX/stop-swarm.sh"
cp "$SCRIPTS/stack_survivor_scan.sh" "$STOP_FIX/swarmforge/scripts/"
# stop-swarm.sh runs the ancillary helper UNGUARDED under `set -e` - the
# stub must always exit 0.
cat > "$STOP_FIX/swarmforge/scripts/stop_ancillary_services.sh" <<'EOF'
#!/usr/bin/env bash
echo "stub stop_ancillary ok"
EOF
write_kill_stub() {
  cat > "$STOP_FIX/swarmforge/scripts/kill_pipeline_swarm.sh" <<EOF
#!/usr/bin/env bash
echo "stub kill_pipeline ok"
exit $1
EOF
}
write_kill_stub 0
chmod +x "$STOP_FIX/stop-swarm.sh" "$STOP_FIX/swarmforge/scripts/"*.sh

PS_LIVE="$(mktemp /tmp/bl637-ps-live.XXXXXX)"
register_tmp_dir "$PS_LIVE"
export SWARMFORGE_SURVIVOR_PS_FILE="$PS_LIVE"

# Runs the real fixture stop-swarm.sh, capturing combined stdout+stderr and
# exit status without tripping `set -e` (the assignment is the condition of
# this `if`, one of set -e's own documented exemptions).
run_stop_fix() {
  if BL746_OUT="$(bash "$STOP_FIX/stop-swarm.sh" "$STOP_FIX" 2>&1)"; then
    BL746_RC=0
  else
    BL746_RC=$?
  fi
}

cat > "$PS_LIVE" <<'EOF'
  1 init
4242 bash /tmp/x/.swarmforge/operator/babysitterd.sh /tmp/x
EOF
run_stop_fix
if [[ "$BL746_RC" -ne 0 && "$BL746_OUT" == *REFUSE* && "$BL746_OUT" == *babysitterd* \
      && "$BL746_OUT" != *"full stack SUCCESS"* ]]; then
  pass "04: stop path refuses clean slate and names babysitterd"
else
  fail "04: stop refuse babysitterd failed rc=$BL746_RC: $BL746_OUT"
fi

cat > "$PS_LIVE" <<'EOF'
  1 init
4243 claude --remote-control Operator --model x
EOF
run_stop_fix
if [[ "$BL746_RC" -ne 0 && "$BL746_OUT" == *REFUSE* && "$BL746_OUT" == *Operator* \
      && "$BL746_OUT" != *"full stack SUCCESS"* ]]; then
  pass "05: stop path refuses clean slate and names Operator"
else
  fail "05: stop refuse Operator failed rc=$BL746_RC: $BL746_OUT"
fi

# Clean fixture, pipeline kill succeeds → the real script's own literal
# success line (BL-746's headline defect: the old suite asserted its own
# reimplementation's wording, "SUCCESS — clean slate", never the real one).
cat > "$PS_LIVE" <<'EOF'
  1 init
EOF
run_stop_fix
if [[ "$BL746_RC" -eq 0 && "$BL746_OUT" == *"full stack SUCCESS — no known survivors"* ]]; then
  pass "04c: clean fixture reports the real script's literal success line"
else
  fail "04c: clean fixture failed rc=$BL746_RC: $BL746_OUT"
fi

# BL-746: kill_rc refuse path — no survivors, but the pipeline kill itself
# exited non-zero. Previously untested by any suite.
write_kill_stub 7
run_stop_fix
if [[ "$BL746_RC" -eq 7 && "$BL746_OUT" == *"REFUSE: pipeline stop exited 7"* \
      && "$BL746_OUT" != *"full stack SUCCESS"* ]]; then
  pass "06: stop path refuses a clean report when the pipeline kill exited non-zero"
else
  fail "06: kill_rc refuse failed rc=$BL746_RC: $BL746_OUT"
fi

rm -f "$PS_LIVE"
rm -rf "$STOP_FIX"
unset SWARMFORGE_SURVIVOR_PS_FILE

echo ""
echo "BL-637 results: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
