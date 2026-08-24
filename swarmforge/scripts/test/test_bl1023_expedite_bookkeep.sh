#!/usr/bin/env bash
# BL-1023: focused fixture — run ticket not in active/ must not silent-succeed.
# Shares expedite_fixture.sh with test_expedite_cli.sh.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../expedite_cli.bb"
FIXTURE="$SCRIPT_DIR/expedite_fixture.sh"
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# Host may have a live swarm; pin a stopped probe so this fixture is about
# bookkeeping, not the live-swarm interlock (same seam test_expedite_cli uses).
PROBE_STOPPED="$TMPROOT/probe-stopped.json"
cat > "$PROBE_STOPPED" <<'JSON'
{"tmux-servers-answering":0,"handoffd":false,"handoffd-supervisor":false,"babysitterd":false,"operator":false,"role-agents":0}
JSON
export EXPEDITE_PROBE_FILE="$PROBE_STOPPED"

fails=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
check() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }

mkfix() {
  local name="$1"; shift
  bash "$FIXTURE" "$TMPROOT/$name" "$@" >/dev/null
  echo "$TMPROOT/$name"
}

run() {
  local root="$1"; shift
  EXPEDITE_STAGE_RUNNER="$root/stage-runner.sh" \
  EXPEDITE_PROBE_FILE="$PROBE_STOPPED" \
  EXPEDITE_STOP_CMD="${STOP_CMD:-./stop-swarm.sh}" \
  EXPEDITE_START_CMD="${START_CMD:-./start-swarm.sh}" \
    bb "$CLI" "$root" "$@" 2>&1
}

# ── 01: ordinary active case still closes ─────────────────────────────────
R0="$(mkfix t0 --active BL-1023)"
OUT0="$(run "$R0" BL-1023 --no-restart)"; EXIT0=$?
check "01: exit 0 when ticket starts active" "$EXIT0" "0"
check "01: the ticket reached done/" "$(ls "$R0/backlog/done/" | tr -d '\n')" "BL-1023-fixture.yaml"

# ── 02a: paused adopts then closes ────────────────────────────────────────
RP="$(mkfix tp --paused BL-1023)"
OUTP="$(run "$RP" BL-1023 --no-restart)"; EXITP=$?
check "02a: paused run ticket exits 0 when stages pass" "$EXITP" "0"
check "02a: and lands in done/ (adopted then closed)" "$(ls "$RP/backlog/done/" | tr -d '\n')" "BL-1023-fixture.yaml"
check "02a: paused/ is empty afterwards" "$(ls "$RP/backlog/paused/" | wc -l | tr -d ' ')" "0"
contains "02a: initiation names the adopt from paused" "$OUTP" "ADOPT run ticket BL-1023 from backlog/paused/"

# ── 02b: hold adopts then closes; sibling park intact ─────────────────────
RH="$(mkfix th --hold BL-1023 --active BL-590)"
OUTH="$(run "$RH" BL-1023 --no-restart)"; EXITH=$?
check "02b: hold run ticket exits 0" "$EXITH" "0"
check "02b: lands in done/" "$(ls "$RH/backlog/done/" | tr -d '\n')" "BL-1023-fixture.yaml"
check "02b: sibling still parked to hold/" "$(ls "$RH/backlog/hold/" | tr -d '\n')" "BL-590-fixture.yaml"
contains "02b: park record names the sibling" "$(cat "$RH/.swarmforge/expedite/BL-1023/park-record.json")" "BL-590"

# ── 03: decision at initiation (same adopt log as 02a) ────────────────────
contains "03: decision names ticket and folder before stages spend" "$OUTP" "ADOPT run ticket BL-1023 from backlog/paused/"
contains "03: stages still ran after the decision" "$(tr '\n' ' ' < "$RP/.swarmforge/expedite-fixture/ran.log")" "specifier"

# ── 05: dry-run mutates nothing ───────────────────────────────────────────
RD="$(mkfix td --paused BL-1023)"
OUTD="$(run "$RD" BL-1023 --no-restart --dry-run)" || true
# Dry-run must decide and leave files unmoved; stage drive may no-op or fail
# on a host without a full runner path — bookkeeping is the pin (BL-1023).
check "05: dry-run leaves ticket in paused/" "$(ls "$RD/backlog/paused/" | tr -d '\n')" "BL-1023-fixture.yaml"
check "05: dry-run writes nothing to done/" "$(ls "$RD/backlog/done/" | wc -l | tr -d ' ')" "0"
check "05: dry-run writes nothing to active/" "$(ls "$RD/backlog/active/" | wc -l | tr -d ' ')" "0"
contains "05: dry-run still decides adopt from paused" "$OUTD" "ADOPT run ticket BL-1023 from backlog/paused/"

# ── missing ticket refuses before stages ──────────────────────────────────
RM="$(mkfix tm --active BL-590)"
OUTM="$(run "$RM" BL-1023 --no-restart)"; EXITM=$?
check "missing: refuses" "$EXITM" "1"
contains "missing: refusal names the ticket" "$OUTM" "REFUSE run ticket BL-1023"
check "missing: no stage ran" "$([[ -f "$RM/.swarmforge/expedite-fixture/ran.log" ]] && echo yes || echo no)" "no"
check "missing: sibling stays in active/" "$(ls "$RM/backlog/active/" | tr -d '\n')" "BL-590-fixture.yaml"

if [[ "$fails" -eq 0 ]]; then
  echo "ALL BL-1023 FIXTURE CHECKS PASSED"
  exit 0
fi
echo "$fails FAILURE(S)"
exit 1
