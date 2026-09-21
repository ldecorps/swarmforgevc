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
# BL-1647: FD_PID is THIS (parent) shell's own child - kill and wait for it
# HERE, never inside a `$( ... )` command substitution subshell, which owns
# no child processes of its own and whose `wait $FD_PID` returns at once
# (not-a-child), leaving FD_PID a zombie until the parent is scheduled to
# reap it via SIGCHLD - a race `kill -0` alone cannot see (BL-1647's own
# `_finish_shift_pid_is_zombie` check closes that gap too, belt-and-braces).
start_fixture
kill "$OB_PID" "$OR_PID" "$BB_PID" 2>/dev/null || true # not part of this check
BEFORE_08="$(
  export SWARMFORGE_SURVIVOR_PS_FILE="$CLEAN_PS"
  source "$SRC/finish_shift_lib.sh"
  finish_shift_keep_snapshot "$ROOT"
  echo "$finish_shift_keep_running"
)"
kill -9 "$FD_PID" 2>/dev/null || true
wait "$FD_PID" 2>/dev/null || true
result="$(
  export SWARMFORGE_SURVIVOR_PS_FILE="$CLEAN_PS"
  source "$SRC/finish_shift_lib.sh"
  finish_shift_stop_ancillaries "$ROOT" >/dev/null
  if finish_shift_verify "$ROOT" "$BEFORE_08"; then
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

# ── 09 (BL-1647): a pidfile naming a zombie is not a live component ─────────
# A reliable zombie needs its DIRECT parent to never reap it for a known
# window - bash itself is unsuitable here (confirmed live: bash services a
# just-killed background child's job-control status opportunistically
# between commands even with no explicit `wait`, so both a `kill` inside a
# `$(...)` finishing in ~0.2s and a dedicated `bash -c` parent blocked in a
# plain 2s `sleep` failed to leave an externally observable zombie in this
# environment). Python has no such implicit reaping: a forked child that is
# killed and never passed to os.waitpid() stays a zombie until the parent
# explicitly reaps it or exits - the parent below deliberately sleeps 3s
# first, so the zombie window is fully deterministic.
Z_HELPER_OUT="$(mktemp)"
python3 -c '
import os, signal, time
pid = os.fork()
if pid == 0:
    time.sleep(300)
    os._exit(0)
else:
    os.kill(pid, signal.SIGKILL)
    print(pid, flush=True)
    time.sleep(3)
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
' > "$Z_HELPER_OUT" &
Z_HELPER_PID=$!
Z_PID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [[ -s "$Z_HELPER_OUT" ]]; then
    Z_PID="$(tr -d '[:space:]' < "$Z_HELPER_OUT")"
    break
  fi
  sleep 0.05
done
echo "$Z_PID" > "$OP_DIR/front-desk-supervisor.pid"
zombie_seen=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  stat="$(ps -o stat= -p "$Z_PID" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$stat" == Z* ]]; then
    zombie_seen=1
    break
  fi
  sleep 0.1
done
if [[ "$zombie_seen" -eq 1 ]]; then
  result09="$(
    source "$SRC/finish_shift_lib.sh"
    finish_shift_component_running "$ROOT" front-desk && echo running || echo stopped
  )"
  if [[ "$result09" == "stopped" ]]; then
    pass "09: a pidfile naming a zombie reads as not running (front-desk)"
  else
    fail "09: expected stopped for a zombie-owned pidfile, got: $result09"
  fi
else
  fail "09: could not reproduce a zombie for $Z_PID (environment cannot verify this case)"
fi
wait "$Z_HELPER_PID" 2>/dev/null || true
rm -f "$Z_HELPER_OUT"

# ── 10 (BL-1647 hardening): _finish_shift_pid_is_zombie tolerates a
#    leading-whitespace `ps -o stat=` reading, never just a bare "Z" match.
#    Stock macOS (BSD) ps can right-justify a single-column value with
#    leading whitespace even with the header suppressed - the same reason
#    specs/pipeline/scripts/reap_stale_tmp_roots.js's own isZombiePid
#    matches `/^\s*Z/` rather than a bare prefix. This host's Linux ps
#    happens to emit no padding for a lone `-o stat=` column, so cases 08
#    and 09 above (which use the real ps binary) cannot exercise a padded
#    reading either way - a stubbed `ps` is the only way to pin this on
#    any one host. No fixture root, no background process: cheap and
#    load-insensitive.
ps() {
  if [[ "$1" == "-o" && "$2" == "stat=" ]]; then
    printf '  Z+\n'
  else
    command ps "$@"
  fi
}
(
  source "$SRC/finish_shift_lib.sh"
  if _finish_shift_pid_is_zombie 1; then
    exit 0
  else
    exit 1
  fi
)
STATUS10=$?
unset -f ps
if [[ "$STATUS10" -eq 0 ]]; then
  pass "10: _finish_shift_pid_is_zombie tolerates leading whitespace in ps -o stat= output"
else
  fail "10: expected a leading-whitespace 'Z+' reading to be detected as a zombie"
fi

# ── BL-1640: a sleep loops the ceremony CLI to done, and never hangs ──────
REPO_ROOT_BL1640="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REAL_CLI="$REPO_ROOT_BL1640/extension/out/tools/night-closing-ceremony-run.js"

make_bl1640_root() {  # make_bl1640_root <dir>
  local root="$1"
  mkdir -p "$root/.swarmforge/daemon" "$root/.swarmforge/lean/ceremony" \
           "$root/.swarmforge/handoffs/inbox/new" "$root/swarmforge" "$root/docs/briefings"
  printf 'config closure_stop_local 06:00\nconfig closing_drain_budget_minutes 1\nconfig closing_briefing_budget_minutes 1\n' \
    > "$root/swarmforge/swarmforge.conf"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$root" \
    > "$root/.swarmforge/roles.tsv"
  git init -q -b main "$root" >/dev/null 2>&1
  git -C "$root" config user.email t@t >/dev/null 2>&1
  git -C "$root" config user.name t >/dev/null 2>&1
  git -C "$root" config commit.gpgsign false >/dev/null 2>&1
  ( cd "$root" && git add -A >/dev/null 2>&1 && git commit -qm seed >/dev/null 2>&1 )
  printf '2026-09-04T09:00:00Z\n' > "$root/.swarmforge/shift-started"
}

# ── 11: a normal sleep (no in-flight work) loops the real CLI to done ─────
if [[ -f "$REAL_CLI" ]]; then
  ROOT11="$(mktemp -d)"
  register_tmp_dir "$ROOT11"
  make_bl1640_root "$ROOT11"
  # No sent.json yet: the loop must tick past freeze and drain-to-briefing on
  # its own first, genuinely exercising multiple iterations - a background
  # writer then deposits it a beat later (well inside the 1+1 minute
  # budgets), simulating the documenter sending the briefing between ticks,
  # never a real multi-minute wait.
  today="$(date +%Y-%m-%d)"
  ( sleep 0.3; mkdir -p "$ROOT11/docs/briefings"; printf '["%s.md"]' "$today" > "$ROOT11/docs/briefings/.sent.json" ) &
  BG_SENDER11=$!
  (
    source "$SRC/finish_shift_lib.sh"
    FINISH_SHIFT_CEREMONY_CLI="$REAL_CLI" FINISH_SHIFT_CEREMONY_TICK_SECONDS=0 \
      finish_shift_run_closing_ceremony "$ROOT11"
  ) > /tmp/bl1640-11.out 2>&1
  STATUS11=$?
  wait "$BG_SENDER11" 2>/dev/null || true
  phase11="$(node -e '
    const fs = require("fs");
    try {
      const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(s.phase || "");
    } catch { process.stdout.write(""); }
  ' "$ROOT11/.swarmforge/daemon/closing-ceremony-state.json" 2>/dev/null)"
  if [[ "$STATUS11" -eq 0 && "$phase11" == "done" ]]; then
    pass "11: a sleep with no in-flight work loops the ceremony to phase done in one call"
  else
    fail "11: expected phase done after one finish_shift_run_closing_ceremony call, got '$phase11' (status=$STATUS11): $(cat /tmp/bl1640-11.out)"
  fi
else
  echo "SKIP: 11 requires the compiled ceremony CLI ($REAL_CLI) - run npm run compile from extension/" >&2
fi

# ── 12: bedtime never hangs - a ceremony that never reports done still returns ──
ROOT12="$(mktemp -d)"
register_tmp_dir "$ROOT12"
mkdir -p "$ROOT12/.swarmforge/daemon"
FAKE_CLI="$ROOT12/fake-ceremony-cli.js"
# Always reports a hardDeadlineMs already far in the past, so the ceiling
# (hardDeadlineMs + grace) is already behind "now" on the very first tick -
# the loop must stop on tick one rather than sleeping through the grace
# window in real wall-clock time.
cat > "$FAKE_CLI" <<'EOF'
process.stdout.write(JSON.stringify({
  gateMode: 'sleep:finish-shift',
  advanced: true,
  state: { phase: 'frozen', hardDeadlineMs: Date.now() - 10 * 60 * 1000 },
  actions: [],
}) + '\n');
EOF
(
  source "$SRC/finish_shift_lib.sh"
  FINISH_SHIFT_CEREMONY_CLI="$FAKE_CLI" FINISH_SHIFT_CEREMONY_TICK_SECONDS=0 \
    finish_shift_run_closing_ceremony "$ROOT12"
) > /tmp/bl1640-12.out 2>&1
STATUS12=$?
if [[ "$STATUS12" -eq 0 ]] && grep -q 'overran its budgets' /tmp/bl1640-12.out; then
  pass "12: a ceremony that never reports done is stopped at the ceiling and the overrun is said out loud"
else
  fail "12: expected an overrun message and a zero exit, got status=$STATUS12: $(cat /tmp/bl1640-12.out)"
fi

# ── 13: an uncompiled/absent CLI still skips quietly (unchanged behaviour) ──
ROOT13="$(mktemp -d)"
register_tmp_dir "$ROOT13"
(
  source "$SRC/finish_shift_lib.sh"
  FINISH_SHIFT_CEREMONY_CLI="$ROOT13/does-not-exist.js" finish_shift_run_closing_ceremony "$ROOT13"
) > /tmp/bl1640-13.out 2>&1
STATUS13=$?
if [[ "$STATUS13" -eq 0 ]] && grep -q 'not compiled' /tmp/bl1640-13.out; then
  pass "13: a missing/uncompiled CLI still skips the ceremony quietly, never a bedtime failure"
else
  fail "13: expected a quiet skip for a missing CLI, got status=$STATUS13: $(cat /tmp/bl1640-13.out)"
fi

# ── 14: the sleep loop decision helper agrees with sleepLoopDecision's own contract ──
if [[ -f "$REPO_ROOT_BL1640/extension/out/quality/nightClosingCeremonyLive.js" ]]; then
  (
    source "$SRC/finish_shift_lib.sh"
    repo_root="$(_finish_shift_ceremony_repo_root)"
    d_wait="$(_finish_shift_sleep_loop_decision "frozen" 1000 1000000000000 "$repo_root")"
    d_done="$(_finish_shift_sleep_loop_decision "done" 999999999999999 1 "$repo_root")"
    d_overran="$(_finish_shift_sleep_loop_decision "frozen" 999999999999999 1 "$repo_root")"
    echo "wait=$d_wait done=$d_done overran=$d_overran"
    [[ "$d_wait" == "wait" && "$d_done" == "done" && "$d_overran" == "overran" ]]
  ) > /tmp/bl1640-14.out 2>&1
  STATUS14=$?
  if [[ "$STATUS14" -eq 0 ]]; then
    pass "14: _finish_shift_sleep_loop_decision agrees with sleepLoopDecision's wait/done/overran contract"
  else
    fail "14: decision helper disagreed: $(cat /tmp/bl1640-14.out)"
  fi
else
  echo "SKIP: 14 requires the compiled quality module - run npm run compile from extension/" >&2
fi

rm -f /tmp/bl1640-11.out /tmp/bl1640-12.out /tmp/bl1640-13.out /tmp/bl1640-14.out

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
