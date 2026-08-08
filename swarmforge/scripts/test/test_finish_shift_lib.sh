#!/usr/bin/env bash
# BL-762: lifecycle_matrix.sh + finish_shift_lib.sh — the bedtime verb's
# shared keep-vs-kill table and stop/verify logic. Uses real fake `sleep`
# processes + scratch pidfile roots (this directory's established
# convention — see test_stop_ancillary_services_onboarder_dual_clear.sh)
# for babysitterd/onboarder/front-desk/operator-runtime/tunnels' pidfile
# checks, and the SWARMFORGE_SURVIVOR_PS_FILE seam
# (stack_survivor_scan.sh's own convention) for the ps-pattern checks
# (babysitterd, operator-runtime) so this test never depends on — or is
# confused by — this machine's own real process table.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
PASS=0
FAIL=0

# BL-801: tmp_cleanup.sh's own EXIT trap expands
# "${__SWARMFORGE_TMP_DIRS_TO_CLEAN[@]}" unguarded, which bash 3.2 (this
# project's target — see engineering.prompt's Test Speed And Isolation
# rule) treats as an unbound-variable error under `set -u` when the array
# has never received an entry — confirmed by direct repro: sourcing this
# file alone under `set -euo pipefail` with zero register_tmp_dir calls
# fails at the trap, not at any test assertion. Registering a real root
# immediately, before any subshell in this file can exit, keeps the array
# non-empty from the first line onward and sidesteps it. This is a
# workaround IN THIS FILE, not a fix — the landmine is in the shared
# library and out of BL-762's scope; see backlog/evidence/BL-762-coder-pass.md.
ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"

pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

CLEAN_PS="$(mktemp)"
echo "  1 init" > "$CLEAN_PS"

# ── 01: lifecycle_matrix stop/keep sets match the ticket's matrix ──────────
(
  source "$SRC/lifecycle_matrix.sh"
  stop_fs="$(lifecycle_matrix_stop_set finish-shift | tr '\n' ' ')"
  keep_fs="$(lifecycle_matrix_keep_set finish-shift | tr '\n' ' ')"
  stop_ss="$(lifecycle_matrix_stop_set stop-swarm | tr '\n' ' ')"
  keep_ss="$(lifecycle_matrix_keep_set stop-swarm | tr '\n' ' ')"
  echo "stop_fs=[$stop_fs] keep_fs=[$keep_fs] stop_ss=[$stop_ss] keep_ss=[$keep_ss]"
) > /tmp/bl762-01.out 2>&1
if grep -q 'stop_fs=\[babysitterd front-desk onboarder operator-runtime \]' /tmp/bl762-01.out 2>/dev/null; then
  fail "01a: finish-shift stop-set must not include front-desk: $(cat /tmp/bl762-01.out)"
elif grep -qE 'stop_fs=\[babysitterd onboarder operator-runtime \]' /tmp/bl762-01.out; then
  pass "01a: finish-shift stops exactly babysitterd/onboarder/operator-runtime"
else
  fail "01a: unexpected finish-shift stop-set: $(cat /tmp/bl762-01.out)"
fi
if grep -qE 'keep_fs=\[front-desk tunnels \]' /tmp/bl762-01.out; then
  pass "01b: finish-shift keeps exactly front-desk/tunnels"
else
  fail "01b: unexpected finish-shift keep-set: $(cat /tmp/bl762-01.out)"
fi
if grep -qE 'stop_ss=\[babysitterd front-desk onboarder operator-runtime tunnels \]' /tmp/bl762-01.out \
  && grep -qE 'keep_ss=\[\]' /tmp/bl762-01.out; then
  pass "01c: stop-swarm stops everything, keeps nothing"
else
  fail "01c: unexpected stop-swarm sets: $(cat /tmp/bl762-01.out)"
fi

# ── 02: lifecycle_matrix_validate — EXHAUSTIVE coverage of invariant 1 ─────
# "Every component the stack can stop is classified by each lifecycle verb
# explicitly; a component that is neither in the stop set nor the keep set
# of a verb is an error, never a default." The (component, verb) domain is
# small and finite (5 x 2 = 10 cells) — exhaustive removal of each cell in
# turn is a stronger, fully-deterministic encoding of this invariant than a
# sampled/generated property would be, and this repo wires no property-test
# framework for plain bash (Startup Tools names only TypeScript/Babashka/
# APS as covered gates) - see backlog/evidence/BL-762-coder-pass.md.
(
  source "$SRC/lifecycle_matrix.sh"
  if lifecycle_matrix_validate >/tmp/bl762-02-intact.out 2>&1; then
    echo "INTACT_VALID"
  else
    echo "INTACT_INVALID: $(cat /tmp/bl762-02-intact.out)"
  fi
)
intact_result="$(
  source "$SRC/lifecycle_matrix.sh"
  if lifecycle_matrix_validate >/dev/null 2>&1; then echo OK; else echo FAIL; fi
)"
if [[ "$intact_result" == "OK" ]]; then
  pass "02a: the shipped matrix validates clean"
else
  fail "02a: the shipped matrix should validate clean, got: $intact_result"
fi

exhaustive_ok=1
for component in babysitterd front-desk onboarder operator-runtime tunnels; do
  for verb in finish-shift stop-swarm; do
    result="$(
      source "$SRC/lifecycle_matrix.sh"
      # Remove exactly the entry for this (component, verb) cell.
      filtered=()
      for entry in "${LIFECYCLE_MATRIX_ENTRIES[@]}"; do
        [[ "$entry" == "${component}:${verb}:"* ]] || filtered+=("$entry")
      done
      LIFECYCLE_MATRIX_ENTRIES=("${filtered[@]}")
      if lifecycle_matrix_validate >/tmp/bl762-02-missing.out 2>&1; then
        echo "SHOULD_HAVE_FAILED"
      else
        if grep -q "\"$component\"" /tmp/bl762-02-missing.out && grep -q "\"$verb\"" /tmp/bl762-02-missing.out; then
          echo "CORRECTLY_FAILED"
        else
          echo "FAILED_WRONG_MESSAGE: $(cat /tmp/bl762-02-missing.out)"
        fi
      fi
    )"
    if [[ "$result" != "CORRECTLY_FAILED" ]]; then
      echo "  cell ${component}:${verb} -> $result" >&2
      exhaustive_ok=0
    fi
  done
done
if [[ "$exhaustive_ok" -eq 1 ]]; then
  pass "02b: removing ANY of the 10 (component,verb) cells is a loud, correctly-attributed failure"
else
  fail "02b: at least one missing-classification cell was not caught loudly"
fi

# ── 03: invariant 2 — finish-shift's keep-set never overlaps the ──────────
#    seat-reviving component list
(
  source "$SRC/lifecycle_matrix.sh"
  keep_fs="$(lifecycle_matrix_keep_set finish-shift)"
  overlap=0
  for seat_revivor in "${LIFECYCLE_SEAT_REVIVING_COMPONENTS[@]}"; do
    if grep -qx "$seat_revivor" <<< "$keep_fs"; then
      overlap=1
    fi
  done
  echo "overlap=$overlap"
) > /tmp/bl762-03.out
if grep -q 'overlap=0' /tmp/bl762-03.out; then
  pass "03: finish-shift's keep-set has empty intersection with seat-reviving components"
else
  fail "03: finish-shift keeps a component that can revive a stopped seat: $(cat /tmp/bl762-03.out)"
fi

# ── 04-08: finish_shift_stop_ancillaries + finish_shift_verify end to end ──
OP_DIR="$ROOT/.swarmforge/operator"
BB_DIR="$ROOT/.swarmforge/babysitterd"
mkdir -p "$OP_DIR" "$BB_DIR"

start_fixture() {
  sleep 300 & BB_PID=$!
  sleep 300 & FD_PID=$!
  sleep 300 & OB_PID=$!
  sleep 300 & OR_PID=$!
  sleep 300 & TN_PID=$!
  echo "$BB_PID" > "$BB_DIR/babysitterd.pid"
  echo "$FD_PID" > "$OP_DIR/front-desk-supervisor.pid"
  echo "$OB_PID" > "$OP_DIR/onboarder-supervisor.pid"
  echo "$OR_PID" > "$OP_DIR/runtime.pid"
  echo "$TN_PID" > "$OP_DIR/resident-spy-cloudflared.pid"
}

# 04: stop-set components are actually stopped; keep-set stays up.
start_fixture
(
  export SWARMFORGE_SURVIVOR_PS_FILE="$CLEAN_PS"
  source "$SRC/finish_shift_lib.sh"
  finish_shift_stop_ancillaries "$ROOT" >/dev/null
)
ok=1
kill -0 "$BB_PID" 2>/dev/null && ok=0
kill -0 "$OB_PID" 2>/dev/null && ok=0
kill -0 "$OR_PID" 2>/dev/null && ok=0
kill -0 "$FD_PID" 2>/dev/null || ok=0
kill -0 "$TN_PID" 2>/dev/null || ok=0
if [[ "$ok" -eq 1 ]]; then
  pass "04: finish_shift_stop_ancillaries stops babysitterd/onboarder/operator-runtime, leaves front-desk/tunnels up"
else
  fail "04: unexpected component states after finish_shift_stop_ancillaries"
fi
kill "$FD_PID" "$TN_PID" 2>/dev/null || true

# 05: full stop+verify cycle reports clean when everything behaves.
start_fixture
result="$(
  export SWARMFORGE_SURVIVOR_PS_FILE="$CLEAN_PS"
  source "$SRC/finish_shift_lib.sh"
  finish_shift_keep_snapshot "$ROOT"
  before="$finish_shift_keep_running"
  finish_shift_stop_ancillaries "$ROOT" >/dev/null
  if finish_shift_verify "$ROOT" "$before"; then
    echo "PROBLEM survivors=[$finish_shift_verify_survivors] unexpected=[$finish_shift_verify_unexpectedly_stopped]"
  else
    echo "CLEAN"
  fi
)"
if [[ "$result" == "CLEAN" ]]; then
  pass "05: finish_shift_verify reports clean after a normal bedtime run"
else
  fail "05: expected CLEAN, got: $result"
fi
kill "$FD_PID" "$TN_PID" 2>/dev/null || true

# 06: idempotent — running again on an already-bedtime-stopped root is
#     still clean (BL-762 idempotent-05, "bedtime has already been run once").
result="$(
  export SWARMFORGE_SURVIVOR_PS_FILE="$CLEAN_PS"
  source "$SRC/finish_shift_lib.sh"
  finish_shift_keep_snapshot "$ROOT"
  before="$finish_shift_keep_running"
  finish_shift_stop_ancillaries "$ROOT" >/dev/null
  if finish_shift_verify "$ROOT" "$before"; then
    echo "PROBLEM survivors=[$finish_shift_verify_survivors] unexpected=[$finish_shift_verify_unexpectedly_stopped]"
  else
    echo "CLEAN"
  fi
)"
if [[ "$result" == "CLEAN" ]]; then
  pass "06: re-running finish-shift on an already-bedtime-stopped root stays clean"
else
  fail "06: expected CLEAN on re-run, got: $result"
fi
kill "$FD_PID" "$TN_PID" 2>/dev/null || true

# 07: idempotent — running on a FULLY stopped root (nothing running at all,
#     including front-desk/tunnels) succeeds ("the swarm is already stopped").
EMPTY_ROOT="$(mktemp -d)"
register_tmp_dir "$EMPTY_ROOT"
mkdir -p "$EMPTY_ROOT/.swarmforge/operator" "$EMPTY_ROOT/.swarmforge/babysitterd"
result="$(
  export SWARMFORGE_SURVIVOR_PS_FILE="$CLEAN_PS"
  source "$SRC/finish_shift_lib.sh"
  finish_shift_keep_snapshot "$EMPTY_ROOT"
  before="$finish_shift_keep_running"
  finish_shift_stop_ancillaries "$EMPTY_ROOT" >/dev/null
  if finish_shift_verify "$EMPTY_ROOT" "$before"; then
    echo "PROBLEM survivors=[$finish_shift_verify_survivors] unexpected=[$finish_shift_verify_unexpectedly_stopped]"
  else
    echo "CLEAN"
  fi
)"
if [[ "$result" == "CLEAN" ]]; then
  pass "07: finish-shift against an already-fully-stopped root succeeds without forcing anything up"
else
  fail "07: expected CLEAN against a fully-stopped root, got: $result"
fi

# 08: a kept component dying unexpectedly is caught (never silently allowed).
start_fixture
kill "$OB_PID" "$OR_PID" "$BB_PID" 2>/dev/null || true # not part of this check
result="$(
  export SWARMFORGE_SURVIVOR_PS_FILE="$CLEAN_PS"
  source "$SRC/finish_shift_lib.sh"
  finish_shift_keep_snapshot "$ROOT"
  before="$finish_shift_keep_running"
  kill -9 "$FD_PID" 2>/dev/null || true
  wait "$FD_PID" 2>/dev/null || true
  finish_shift_stop_ancillaries "$ROOT" >/dev/null
  if finish_shift_verify "$ROOT" "$before"; then
    echo "PROBLEM unexpected=[$finish_shift_verify_unexpectedly_stopped]"
  else
    echo "CLEAN"
  fi
)"
if [[ "$result" == "PROBLEM unexpected=[front-desk]" ]]; then
  pass "08: a kept component dying unexpectedly is caught, never silently accepted"
else
  fail "08: expected front-desk flagged as unexpectedly stopped, got: $result"
fi
kill "$TN_PID" 2>/dev/null || true

# Belt-and-suspenders: kill every fixture PID this file may have spawned
# across all sections, even ones already stopped by the code under test
# (kill on a dead PID is a harmless no-op here) — so a partial failure
# earlier in the file (which would exit before reaching a later section's
# own explicit kill) never leaks a live `sleep 300` past this script's exit.
kill "$BB_PID" "$FD_PID" "$OB_PID" "$OR_PID" "$TN_PID" 2>/dev/null || true

rm -f "$CLEAN_PS"

echo ""
echo "BL-762 finish_shift_lib results: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
