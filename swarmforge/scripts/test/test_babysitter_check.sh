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

echo "ALL PASS"
