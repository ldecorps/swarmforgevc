#!/usr/bin/env bash
# BL-1535: the chase's should-rotate-resident? gate must refuse to rotate
# the resident away from a role that holds a real in_process parcel while
# that role is WORKING (pane footer busy, a live process descended from
# the resident pane, or a fresh standing self-audit challenge), for any
# target OTHER than that role itself. An idle holder still yields, and a
# working signal with no held parcel never pins the router.
#
# Drives the REAL swarmforge/scripts/handoffd.bb attempt-resident-rotate!
# (the exact function the daemon's chase sweep calls) against an isolated
# fixture git repo, fake tmux on PATH, and real child processes standing
# in for "a command launched from the resident pane" - same fixture
# pattern test_rotate_to_role_stuck_parcel_gate.sh uses for the sibling
# BL-805 gate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HANDOFFD_BB="$REAL_SCRIPTS_DIR/handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fake_tmux() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/tmux" <<'TMUX'
#!/usr/bin/env bash
fmt=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-F" ]]; then
    fmt="$arg"
  fi
  prev="$arg"
done
if [[ " $* " == *" list-panes "* ]]; then
  if [[ "$fmt" == *"pane_start_command"* ]]; then
    if [[ -n "${LIVE_ROLE:-}" ]]; then
      echo "zsh '/fake/.swarmforge/launch/${LIVE_ROLE}.sh'"
    fi
    exit 0
  elif [[ "$fmt" == *"pane_pid"* ]]; then
    echo "${PANE_PID:-}"
    exit 0
  fi
fi
if [[ " $* " == *" capture-pane "* ]]; then
  # Idle footer always - no busy-spinner marker in the output.
  echo ""
  exit 0
fi
echo "$*" >> "$TMUX_LOG"
exit 0
TMUX
  chmod +x "$bin_dir/tmux"
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
IDLE_PANE_PID=""
WORKING_PANE_PID=""
# kill_tree: killing a pid alone leaves its own children (e.g.
# WORKING_PANE_PID's inner `sleep 300`) orphaned and running for their full
# duration - harmless standalone, but when this script's stdout is a PIPE
# (as under Node's child_process.spawnSync, the acceptance harness's own
# caller) an orphan that inherited the fd holds the pipe's write end open,
# so the reader blocks for the full 300s past this script's own exit even
# though `time` on the direct child alone reports done immediately. Kill
# the whole descendant tree, not just the named pid.
kill_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  kill_tree "$IDLE_PANE_PID"
  kill_tree "$WORKING_PANE_PID"
  rm -rf "$ROOT"
}
trap cleanup EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

HARD_WT="$ROOT/wt-hardender"
SPEC_WT="$ROOT/wt-specifier"
mkdir -p "$HARD_WT/.swarmforge/handoffs/inbox/new" \
         "$HARD_WT/.swarmforge/handoffs/inbox/in_process" \
         "$SPEC_WT/.swarmforge/handoffs/inbox/new" \
         "$SPEC_WT/.swarmforge/handoffs/inbox/in_process" \
         "$ROOT/.swarmforge/launch"

printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardener\tclaude\tbatch\n' "$HARD_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$SPEC_WT" >> "$ROOT/.swarmforge/roles.tsv"

mkdir -p "$ROOT/swarmforge"
printf 'config rotation router\n' > "$ROOT/swarmforge/swarmforge.conf"

touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"

printf '#!/bin/sh\nexit 0\n' > "$ROOT/.swarmforge/launch/hardender.sh"
chmod +x "$ROOT/.swarmforge/launch/hardender.sh"
printf '#!/bin/sh\nexit 0\n' > "$ROOT/.swarmforge/launch/specifier.sh"
chmod +x "$ROOT/.swarmforge/launch/specifier.sh"

FAKE_BIN="$ROOT/bin"
make_fake_tmux "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
touch "$TMUX_LOG"

# specifier's inbox/new already holds a parcel so rotate-resident-to!'s
# wait-for-delivery! returns immediately instead of polling 30s, whenever a
# scenario below actually reaches a real respawn.
printf 'id: fwd\nfrom: coordinator\nto: specifier\npriority: 50\ntype: note\ntask: BL-000\n\nsteering\n' \
  > "$SPEC_WT/.swarmforge/handoffs/inbox/new/00_fwd.handoff"

queue_hardender_parcel() {
  local name="$1"
  printf 'id: %s\nfrom: architect\nto: hardender\npriority: 50\ntype: git_handoff\ntask: BL-%s\ncommit: aaaaaaaaaa\n\nmerge_and_process architect aaaaaaaaaa\n' \
    "$name" "$name" > "$HARD_WT/.swarmforge/handoffs/inbox/in_process/00_${name}.handoff"
}

clear_hardender_parcels() {
  rm -f "$HARD_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
}

audit_dir_for_role() {
  local role="$1"
  local sha
  sha="$(printf '%s' "$role" | shasum -a 256 | awk '{print $1}')"
  echo "$ROOT/.swarmforge/handoffs/audit_pending/$sha"
}

write_audit_challenge() {
  local role="$1" age_ms="$2"
  local dir
  dir="$(audit_dir_for_role "$role")"
  mkdir -p "$dir"
  echo '{:candidate {} :created-at "now"}' > "$dir/challenge.edn"
  # Backdate the file's mtime by age_ms so freshness comparisons are exact,
  # never flaky against real wall-clock drift during the test run.
  local age_s=$(( age_ms / 1000 ))
  local epoch
  epoch="$(( $(date +%s) - age_s ))"
  touch -d "@${epoch}" "$dir/challenge.edn" 2>/dev/null || touch -t "$(date -r "$epoch" +%Y%m%d%H%M.%S 2>/dev/null)" "$dir/challenge.edn" 2>/dev/null || true
}

clear_audit_challenges() {
  rm -rf "$ROOT/.swarmforge/handoffs/audit_pending"
}

run_attempt_rotate() {
  local target="$1"
  SWARMFORGE_ALLOW_TMP_DAEMON=1 PATH="$FAKE_BIN:$PATH" \
    LIVE_ROLE="${LIVE_ROLE:-}" PANE_PID="${PANE_PID:-}" \
    bb -e "
(load-file \"$HANDOFFD_BB\")
(println (@#'handoffd/attempt-resident-rotate! \"$ROOT/fake.sock\" \"$target\"))
" -- "$ROOT"
}

telemetry_file() {
  find "$ROOT/.swarmforge/telemetry" -name 'chaser-*.jsonl' 2>/dev/null | head -1
}

echo "hardender" > "$ROOT/.swarmforge/mono-router-active-role"

# Spawn the two fixture process trees standing in for the resident pane:
# IDLE - a leaf process, "process tree holds only its shell"; WORKING - a
# bash whose child is "a command launched from the resident pane" still
# running (the fixture pattern the ticket's qa_e2e_procedure names).
# Explicit </dev/null and >/dev/null 2>&1: these must never inherit this
# script's own stdio - see kill_tree's comment above on the pipe-blocking
# hazard an inherited fd on a long sleep creates for a piped caller.
bash -c 'sleep 300' </dev/null >/dev/null 2>&1 &
IDLE_PANE_PID=$!
disown "$IDLE_PANE_PID" 2>/dev/null || true
bash -c 'sleep 300 & wait' </dev/null >/dev/null 2>&1 &
WORKING_PANE_PID=$!
disown "$WORKING_PANE_PID" 2>/dev/null || true

# The resident pane's LIVE identity (independent of the active-role marker,
# BL-927) always agrees with the marker in this fixture - every scenario
# below is about the departing-mid-parcel gate, not live/marker divergence
# (that is BL-927's own fixture). A blank LIVE_ROLE would make
# departing-role-blocking-handoff fail OPEN (unreadable identity -> no
# blocking-file at all), which would silently defeat every scenario here.
LIVE_ROLE="hardender"

# ── 01a: working holder (live descended process) refuses for a different target ──
PANE_PID="$WORKING_PANE_PID"
queue_hardender_parcel case1a
: > "$TMUX_LOG"
OUT="$(run_attempt_rotate specifier 2>&1)"
echo "$OUT" | grep -q ":ok false" || fail "01a: expected refusal, got: $OUT"
echo "$OUT" | grep -q "departing-mid-parcel" || fail "01a: expected :reason departing-mid-parcel, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "01a: pane must NOT be respawned on refusal, log: $(cat "$TMUX_LOG")"
TFILE="$(telemetry_file)"
[[ -n "$TFILE" ]] || fail "01a: expected a chaser telemetry file to exist"
grep -q '"type":"departing-mid-parcel"' "$TFILE" || fail "01a: telemetry missing departing-mid-parcel row: $(cat "$TFILE")"
grep -q '"role":"hardender"' "$TFILE" || fail "01a: telemetry row must name hardender: $(cat "$TFILE")"
grep -q '"signal":"live-descendant-process"' "$TFILE" || fail "01a: telemetry row must name the working signal: $(cat "$TFILE")"
pass "01a: a working holder (live descended process) is not rotated away for a different target"
clear_hardender_parcels
rm -f "$ROOT/.swarmforge/telemetry"/chaser-*.jsonl
echo "hardender" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 01b: working holder (fresh standing audit challenge) refuses ─────────
PANE_PID="$IDLE_PANE_PID"
queue_hardender_parcel case1b
write_audit_challenge hardender 1000
: > "$TMUX_LOG"
OUT="$(run_attempt_rotate specifier 2>&1)"
echo "$OUT" | grep -q ":ok false" || fail "01b: expected refusal, got: $OUT"
echo "$OUT" | grep -q "departing-mid-parcel" || fail "01b: expected :reason departing-mid-parcel, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "01b: pane must NOT be respawned on refusal, log: $(cat "$TMUX_LOG")"
TFILE="$(telemetry_file)"
[[ -n "$TFILE" ]] || fail "01b: expected a chaser telemetry file to exist"
grep -q '"signal":"fresh-audit-challenge"' "$TFILE" || fail "01b: telemetry row must name the fresh-audit-challenge signal: $(cat "$TFILE")"
pass "01b: a working holder (fresh standing audit challenge) is not rotated away for a different target"
clear_hardender_parcels
clear_audit_challenges
rm -f "$ROOT/.swarmforge/telemetry"/chaser-*.jsonl
echo "hardender" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 02: an idle holder still yields to dependency mail ────────────────────
PANE_PID="$IDLE_PANE_PID"
queue_hardender_parcel case2
: > "$TMUX_LOG"
OUT="$(run_attempt_rotate specifier 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "02: expected the idle holder to yield (respawn-pane), log: $(cat "$TMUX_LOG")"
pass "02: an idle holder (no live command, no fresh challenge) still yields to dependency mail"
clear_hardender_parcels
echo "hardender" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 03: a stale challenge alone does not hold the resident ───────────────
PANE_PID="$IDLE_PANE_PID"
queue_hardender_parcel case3
write_audit_challenge hardender 3600000
: > "$TMUX_LOG"
OUT="$(run_attempt_rotate specifier 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "03: expected a stale challenge to not hold the resident (respawn-pane), log: $(cat "$TMUX_LOG")"
pass "03: a stale challenge alone does not hold the resident"
clear_hardender_parcels
clear_audit_challenges
echo "hardender" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 04: rotating into the role that owns the parcel is never a displacement ──
# BL-926's same-role exception is handled by the target check inside the new
# :departing-mid-parcel branch itself (not a new branch) - the gate may
# still land on the pre-existing :already-active (marker and live identity
# both already name hardender) rather than a physical respawn; either way
# is "not a displacement", so the assertion is the ABSENCE of the new
# refusal, not the presence of a respawn.
PANE_PID="$WORKING_PANE_PID"
queue_hardender_parcel case4
: > "$TMUX_LOG"
OUT="$(run_attempt_rotate hardender 2>&1)"
echo "$OUT" | grep -q "departing-mid-parcel" \
  && fail "04: rotating into the parcel's own owner must never read as departing-mid-parcel, got: $OUT"
pass "04: rotating into the role that owns the parcel is never a displacement"
clear_hardender_parcels
echo "hardender" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 05: a working signal with no held parcel never pins the router ───────
PANE_PID="$WORKING_PANE_PID"
clear_hardender_parcels
: > "$TMUX_LOG"
OUT="$(run_attempt_rotate specifier 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" \
  || fail "05: a working signal with no held parcel must not refuse (respawn-pane), log: $(cat "$TMUX_LOG")"
pass "05: a working signal with no held parcel never pins the router"
echo "hardender" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 06: a standing pack (every role its own pane) is untouched ───────────
# The resident-rotation concept, and this gate with it, only exists under
# `config rotation router` - a standing pack's own resolution must still
# read non-router so the daemon's chase never reaches attempt-resident-
# rotate! at all (mirrors BL-931's own pack gate, unaffected by this
# ticket).
STANDING_CONF="config rotation classic
"
OUT="$(bb -e "
(load-file \"$REAL_SCRIPTS_DIR/mono_router_lib.bb\")
(println (mono-router-lib/conf-rotation-router? \"$STANDING_CONF\"))
")"
[[ "$(echo "$OUT" | tr -d '[:space:]')" == "false" ]] \
  || fail "06: expected a standing-pack conf to resolve non-router, got: $OUT"
pass "06: a standing pack's own topology resolution stays non-router - chase never reaches this gate"

echo "test_chase_departing_mid_parcel_gate: ALL CHECKS PASSED"
