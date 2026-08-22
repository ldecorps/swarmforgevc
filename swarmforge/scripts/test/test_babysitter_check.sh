#!/usr/bin/env bash
# Shell integration test for babysitter_check.sh/.bb (BL-611): the thin
# gatherer + CLI over babysitterd_sweep_lib.bb's pure core. Fakes tmux/ps/
# pgrep on PATH (same idiom as test_babysitter_nudge_resident.sh) and a
# meminfo file via the BABYSITTER_MEMINFO_PATH env seam — no real tmux, no
# real system processes, no real /proc read.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_SH="$SCRIPT_DIR/../babysitter_check.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

cat > "$FAKE_BIN/pgrep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_BIN/pgrep"

make_root() {
  local d
  d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/handoffs/failed" "$d/backlog/active"
  printf 'MemAvailable:    8000000 kB\n' > "$d/meminfo"
  # BL-631: babysitter_check.bb's pipeline-code-on-main check fails closed
  # (UNAVAILABLE) whenever it can't resolve a swarmforge-QA ref - correct in
  # production, but every root here was previously git-independent, so it
  # never resolved and "OK all checks green" (scenarios A, E) could never
  # pass. Same minimal git fixture shape as
  # bl631BabysitterDetectsPipelineCodeOnMainSteps.js's own mkFixtureRepo():
  # one commit, main and swarmforge-QA both pointing at it (nothing ahead of
  # QA, so the check reads clean rather than merely available).
  git -C "$d" -c user.email=t@t -c user.name=t init -q -b main
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  git -C "$d" -c user.email=t@t -c user.name=t branch swarmforge-QA
  printf "$d"
}

run_check() {
  local root="$1"; shift
  PATH="$FAKE_BIN:$PATH" BABYSITTER_MEMINFO_PATH="$root/meminfo" \
    bash "$CHECK_SH" "$root" "$@"
}

# ── A: fully green snapshot — quiet ─────────────────────────────────────────
ROOT="$(make_root)"
OUT="$(run_check "$ROOT")"
grep -q "OK all checks green" <<< "$OUT" || fail "A: expected all-clear line; got: $OUT"
pass "A: fully green snapshot prints OK all checks green"
rm -rf "$ROOT"

# ── B: dead-letter box non-empty — CRIT finding, no nudge ───────────────────
ROOT="$(make_root)"
touch "$ROOT/.swarmforge/handoffs/failed/stray.handoff"
OUT="$(run_check "$ROOT")"
grep -q "CRIT \[failed-box\]" <<< "$OUT" || fail "B: expected failed-box CRIT; got: $OUT"
pass "B: non-empty dead-letter box raises a CRIT finding"
rm -rf "$ROOT"

# ── C: --nudge on a CRIT finding delivers via the verified nudge path ───────
ROOT="$(make_root)"
touch "$ROOT/.swarmforge/handoffs/failed/stray.handoff"
SOCK="$ROOT/fake.sock"; touch "$SOCK"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
COORD_WT="$ROOT/.worktrees/coordinator"
mkdir -p "$COORD_WT"
printf 'coordinator\tcoordinator\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$COORD_WT" \
  > "$ROOT/.swarmforge/roles.tsv"

CALL_LOG="$ROOT/tmux-calls.log"
export CALL_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "has-session" ]]; then
    exit 1
  fi
  if [[ "$arg" == "capture-pane" ]]; then
    printf '❯ \n'
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

OUT="$(run_check "$ROOT" --nudge)"
grep -q "CRIT \[failed-box\]" <<< "$OUT" || fail "C: expected failed-box CRIT in output; got: $OUT"
grep -q "^.*NUDGED coordinator" <<< "$OUT" || fail "C: expected a NUDGED line; got: $OUT"
grep -q -- 'C-m' "$CALL_LOG" || fail "C: expected a verified submit (C-m) in tmux call log"
[[ -f "$ROOT/.swarmforge/babysitterd/nudge-dedup.json" ]] || fail "C: expected nudge-dedup.json to be persisted"
pass "C: a CRIT finding is delivered via the verified nudge path (--nudge)"
rm -rf "$ROOT"

# ── D: --nudge with no swarm running — NUDGE-SKIP, no keystrokes sent ──────
ROOT="$(make_root)"
touch "$ROOT/.swarmforge/handoffs/failed/stray.handoff"
CALL_LOG="$ROOT/tmux-calls.log"
export CALL_LOG
# Same fake tmux binary stays on PATH but no socket file exists, so
# read_tmux_socket (both in babysitter_check.bb and nudge-resident!) finds
# nothing to call at all.
rm -f "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
exit 1
TMUX
chmod +x "$FAKE_BIN/tmux"
OUT="$(run_check "$ROOT" --nudge)"
grep -q "NUDGE-SKIP" <<< "$OUT" || fail "D: expected NUDGE-SKIP; got: $OUT"
[[ ! -s "$CALL_LOG" ]] || fail "D: expected no tmux calls at all when no swarm is running; log: $(cat "$CALL_LOG")"
pass "D: no swarm running skips the nudge and logs NUDGE-SKIP with zero keystrokes"
rm -rf "$ROOT"

# ── E: pane process gather works on a BSD-style ps (rejects --ppid) ────────
ROOT="$(make_root)"
SOCK="$ROOT/fake.sock"; touch "$SOCK"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
mkdir -p "$ROOT/.worktrees/coder"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" \
  > "$ROOT/.swarmforge/roles.tsv"

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "has-session" ]]; then exit 0; fi
  if [[ "$arg" == "list-panes" ]]; then echo "222"; exit 0; fi
  if [[ "$arg" == "capture-pane" ]]; then printf '%%\n'; exit 0; fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# BSD ps (macOS): rejects --ppid outright, but supports -eo pid=,ppid=,args=.
cat > "$FAKE_BIN/ps" <<'PS'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "--ppid" ]]; then
    echo "ps: illegal option -- -" >&2
    exit 1
  fi
done
cat <<'ROWS'
  111     1 /sbin/launchd
  222   111 /bin/bash pane-shell
  333   222 claude --remote-control fake
ROWS
PS
chmod +x "$FAKE_BIN/ps"

OUT="$(run_check "$ROOT")"
grep -q "CRIT \[proc-coder\]" <<< "$OUT" && fail "E: expected no half-launch CRIT for coder; got: $OUT"
grep -q "UNAVAILABLE \[proc-gather-coder\]" <<< "$OUT" && fail "E: expected no gather-unavailable line when ps succeeded via BSD syntax; got: $OUT"
grep -q "OK all checks green" <<< "$OUT" || fail "E: expected a fully green sweep once the BSD-syntax ps gather finds the live claude process; got: $OUT"
pass "E: pane process gather correctly finds a live claude process via BSD-syntax ps (no --ppid)"
rm -rf "$ROOT"

# ── F: ps gather fails entirely — reported unavailable, never cry-wolf CRIT ─
ROOT="$(make_root)"
SOCK="$ROOT/fake.sock"; touch "$SOCK"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
mkdir -p "$ROOT/.worktrees/coder"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" \
  > "$ROOT/.swarmforge/roles.tsv"

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "has-session" ]]; then exit 0; fi
  if [[ "$arg" == "list-panes" ]]; then echo "222"; exit 0; fi
  if [[ "$arg" == "capture-pane" ]]; then printf '%%\n'; exit 0; fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

cat > "$FAKE_BIN/ps" <<'PS'
#!/usr/bin/env bash
echo "ps: broken in this fixture" >&2
exit 1
PS
chmod +x "$FAKE_BIN/ps"

OUT="$(run_check "$ROOT")"
grep -q "CRIT \[proc-coder\]" <<< "$OUT" && fail "F: expected NO half-launch CRIT from a failed ps gather (cry-wolf); got: $OUT"
grep -q "UNAVAILABLE \[proc-gather-coder\]" <<< "$OUT" || fail "F: expected the process gather to be reported UNAVAILABLE; got: $OUT"
grep -q "^OK all checks green" <<< "$OUT" && fail "F: a failed gather must never be silently folded into the all-clear OK line; got: $OUT"
pass "F: a failed ps gather reports UNAVAILABLE, never a cry-wolf CRIT or a silent OK"
rm -rf "$ROOT"

# ── G: memory floor falls back to vm_stat when no meminfo facility exists ──
ROOT="$(make_root)"
cat > "$FAKE_BIN/vm_stat" <<'VMSTAT'
#!/usr/bin/env bash
cat <<'OUT'
Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                                 100.
Pages active:                            640194.
Pages inactive:                             100.
Pages speculative:                            0.
Pages wired down:                        471968.
OUT
VMSTAT
chmod +x "$FAKE_BIN/vm_stat"
# BABYSITTER_MEMINFO_PATH points at a nonexistent fixture (not merely unset)
# so this is deterministic on a Linux host where a real /proc/meminfo exists
# too — the seam always wins over the literal default when set, per
# meminfo-path's existing "env var or /proc/meminfo" contract.
G_OUT="$(PATH="$FAKE_BIN:$PATH" BABYSITTER_MEMINFO_PATH="$ROOT/no-such-meminfo" bash "$CHECK_SH" "$ROOT")"
grep -q "CRIT \[memory\]" <<< "$G_OUT" || fail "G: expected a memory CRIT via vm_stat fallback (200 low pages); got: $G_OUT"
pass "G: memory floor check falls back to vm_stat when no proc-meminfo-style facility exists"
rm -f "$FAKE_BIN/vm_stat"
rm -rf "$ROOT"

# ── H: every memory facility absent — UNAVAILABLE, never CRIT or silent OK ──
ROOT="$(make_root)"
# Shadow (not strip) a real vm_stat: a failing stub earlier on PATH always
# wins the lookup without also removing unrelated tools (dirname, mkdir, ...)
# that happen to live in the same system directory as the real vm_stat.
cat > "$FAKE_BIN/vm_stat" <<'VMSTAT'
#!/usr/bin/env bash
exit 1
VMSTAT
chmod +x "$FAKE_BIN/vm_stat"
H_OUT="$(PATH="$FAKE_BIN:$PATH" BABYSITTER_MEMINFO_PATH="$ROOT/no-such-meminfo" bash "$CHECK_SH" "$ROOT")"
grep -q "UNAVAILABLE \[memory\]" <<< "$H_OUT" || fail "H: expected memory check UNAVAILABLE when every facility is absent; got: $H_OUT"
grep -q "CRIT \[memory\]" <<< "$H_OUT" && fail "H: expected no fabricated memory CRIT when every facility is absent; got: $H_OUT"
grep -q "^OK all checks green" <<< "$H_OUT" && fail "H: a failed memory gather must never be silently folded into OK; got: $H_OUT"
pass "H: memory floor check reports UNAVAILABLE (never CRIT/OK) when every memory facility is absent"
rm -f "$FAKE_BIN/vm_stat"
rm -rf "$ROOT"

# ── I: vm_stat exits 0 but its output is malformed (missing an expected page
# count line) — UNAVAILABLE, never a crash and never a fabricated CRIT/OK.
# BL-802's parse-vm-stat-available-mb only yields a reading when page size AND
# every page count it needs parse; this proves a present-but-unparseable
# facility degrades exactly like an absent one, not a Long/parseLong crash on
# nil that would take the whole sweep down.
ROOT="$(make_root)"
cat > "$FAKE_BIN/vm_stat" <<'VMSTAT'
#!/usr/bin/env bash
cat <<'OUT'
Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages active:                            640194.
Pages wired down:                        471968.
OUT
VMSTAT
chmod +x "$FAKE_BIN/vm_stat"
I_OUT="$(PATH="$FAKE_BIN:$PATH" BABYSITTER_MEMINFO_PATH="$ROOT/no-such-meminfo" bash "$CHECK_SH" "$ROOT")"
grep -q "UNAVAILABLE \[memory\]" <<< "$I_OUT" || fail "I: expected memory check UNAVAILABLE when vm_stat output is malformed; got: $I_OUT"
grep -q "CRIT \[memory\]" <<< "$I_OUT" && fail "I: expected no fabricated memory CRIT from malformed vm_stat output; got: $I_OUT"
grep -q "^OK all checks green" <<< "$I_OUT" && fail "I: a malformed vm_stat gather must never be silently folded into OK; got: $I_OUT"
pass "I: memory floor check reports UNAVAILABLE (never a crash, CRIT, or silent OK) when vm_stat's own output is malformed"
rm -f "$FAKE_BIN/vm_stat"
rm -rf "$ROOT"

# ── J: BL-1017 wiring — a standing role's vanished session is recreated,
# not merely alerted about. This is the required_wiring check itself: the
# lib's :repair decision must be CONSUMED by the live sweep caller (a repair
# nobody executes is the BL-419 shape this ticket names), so this asserts on
# the actual tmux calls babysitter_check.bb issues, not merely on the pure
# decision function's return value (already covered by
# babysitterd_sweep_lib_test_runner.bb/the acceptance feature).
ROOT="$(make_root)"
SOCK="$ROOT/fake.sock"; touch "$SOCK"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
mkdir -p "$ROOT/.worktrees/coder" "$ROOT/.swarmforge/launch"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" \
  > "$ROOT/.swarmforge/roles.tsv"
printf '#!/usr/bin/env zsh\necho fake-launch\n' > "$ROOT/.swarmforge/launch/coder.sh"

CALL_LOG="$ROOT/tmux-calls.log"
export CALL_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "has-session" ]]; then exit 1; fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

J_OUT="$(run_check "$ROOT")"
grep -q "CRIT \[pane-coder\]" <<< "$J_OUT" || fail "J: expected the missing-session CRIT to still be emitted; got: $J_OUT"
grep -q "REPAIR \[repaired\] swarmforge-coder" <<< "$J_OUT" || fail "J: expected a REPAIR line for coder; got: $J_OUT"
grep -q -- 'new-session -d -s swarmforge-coder' <<< "$(cat "$CALL_LOG")" || fail "J: expected a tmux new-session call for the vanished session; log: $(cat "$CALL_LOG")"
# BL-1018: a VANISHED session is created WITH its launch command and never
# respawned into - the create-then-respawn-into-it sequence is the shape that
# took the whole pack tmux server down on 2026-08-21. The launch script must
# still get running, so assert it rides the create rather than a second call.
grep -q -- "new-session -d -s swarmforge-coder .*coder.sh" <<< "$(cat "$CALL_LOG")" || fail "J: expected the create to carry the role's launch script; log: $(cat "$CALL_LOG")"
grep -q -- 'respawn-pane' <<< "$(cat "$CALL_LOG")" && fail "J (BL-1018): a missing session must never be respawned into; log: $(cat "$CALL_LOG")"
[[ -f "$ROOT/.swarmforge/babysitterd/session-repairs.json" ]] || fail "J: expected the repair budget to be persisted to session-repairs.json"
grep -q '"attempts":1' <<< "$(cat "$ROOT/.swarmforge/babysitterd/session-repairs.json")" || fail "J: expected the persisted repair state to record 1 attempt; got: $(cat "$ROOT/.swarmforge/babysitterd/session-repairs.json")"
pass "J: a vanished standing role's session is recreated by the live sweep (repair decision consumed, not merely returned)"
rm -rf "$ROOT"

# ── K: BL-1017 bound — a role already repaired inside the cooldown window
# gets no second tmux new-session/respawn-pane call, only the CRIT. This is
# the live-wiring half of invariant 2 (session-repair-allowed? is unit-
# tested in isolation by babysitterd_sweep_lib_test_runner.bb; this proves
# the gatherer actually threads last-repair-ms/repair-attempts through to it
# rather than always passing a fresh/empty state).
ROOT="$(make_root)"
SOCK="$ROOT/fake.sock"; touch "$SOCK"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
mkdir -p "$ROOT/.worktrees/coder" "$ROOT/.swarmforge/launch" "$ROOT/.swarmforge/babysitterd"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" \
  > "$ROOT/.swarmforge/roles.tsv"
printf '#!/usr/bin/env zsh\necho fake-launch\n' > "$ROOT/.swarmforge/launch/coder.sh"
NOW_MS="$(($(date +%s) * 1000))"
printf '{"coder":{"attempts":1,"last-ms":%s}}' "$NOW_MS" > "$ROOT/.swarmforge/babysitterd/session-repairs.json"

CALL_LOG="$ROOT/tmux-calls.log"
export CALL_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "has-session" ]]; then exit 1; fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

K_OUT="$(run_check "$ROOT")"
grep -q "CRIT \[pane-coder\]" <<< "$K_OUT" || fail "K: expected the missing-session CRIT even inside the cooldown; got: $K_OUT"
grep -q "REPAIR" <<< "$K_OUT" && fail "K: expected NO repair line inside the cooldown window; got: $K_OUT"
grep -q -- 'new-session' <<< "$(cat "$CALL_LOG")" && fail "K: expected no tmux new-session call inside the cooldown window; log: $(cat "$CALL_LOG")"
pass "K: a role already repaired inside the cooldown window is not repaired again by the live sweep"
rm -rf "$ROOT"

echo "ALL PASS"
