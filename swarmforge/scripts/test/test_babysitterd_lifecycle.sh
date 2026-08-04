#!/usr/bin/env bash
# Lifecycle test for babysitterd.sh + start_babysitterd.sh (BL-611).
# Covers acceptance scenarios lifecycle-start-stop-01 and
# double-start-refused-02. No real tmux/roles needed — babysitter_check.sh
# gracefully degrades to "OK all checks green" with no roles.tsv/socket.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
START="$SRC/start_babysitterd.sh"
DAEMON="$SRC/babysitterd.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

STRAY_PIDS=()
cleanup() {
  local pid
  for pid in "${STRAY_PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

make_root() {
  local d
  d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/handoffs/failed" "$d/backlog/active"
  printf "$d"
}

wait_for_pidfile() {
  local pidfile="$1" i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    [[ -f "$pidfile" ]] && return 0
    sleep 0.2
  done
  return 1
}

# start_babysitterd.sh's own confirmation loop is a bounded 1s (5 x 0.2s) —
# occasionally too tight under the process-creation load of a back-to-back
# test run. Re-invoking is safe: the script checks the pidfile first and is
# a no-op ("already running") if the prior attempt actually landed.
start_with_retry() {
  local path_override="$1" root="$2" out i
  for i in 1 2 3; do
    out="$(PATH="$path_override" bash "$START" "$root" 2>&1)"
    grep -qE "started|already running" <<< "$out" && { printf '%s' "$out"; return 0; }
    sleep 0.3
  done
  printf '%s' "$out"
  return 1
}

# ── 01: start brings babysitterd up with a live pidfile; stop cleans it up ──
ROOT="$(make_root)"
OUT="$(bash "$START" "$ROOT")"
grep -q "started" <<< "$OUT" || fail "01: expected a start confirmation; got: $OUT"
PIDFILE="$ROOT/.swarmforge/babysitterd/babysitterd.pid"
wait_for_pidfile "$PIDFILE" || fail "01: pidfile never appeared"
PID="$(cat "$PIDFILE")"
kill -0 "$PID" 2>/dev/null || fail "01: pid in pidfile is not alive"
STRAY_PIDS+=("$PID")
pass "01a: start_babysitterd.sh brings babysitterd up with a live pidfile"

# Stop (mirrors stop_ancillary_services.sh's signal_pid_file: TERM, brief
# wait, KILL if still alive, then remove the pidfile regardless).
kill -TERM "$PID" 2>/dev/null || true
sleep 0.5
kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
rm -f "$PIDFILE"
sleep 0.2
kill -0 "$PID" 2>/dev/null && fail "01b: babysitterd process still alive after stop"
[[ ! -f "$PIDFILE" ]] || fail "01b: pidfile still present after stop"
pass "01b: stop terminates babysitterd and removes its pidfile"
rm -rf "$ROOT"

# ── 02: a second start is refused while the pidfile is live ────────────────
ROOT="$(make_root)"
bash "$START" "$ROOT" >/dev/null
PIDFILE="$ROOT/.swarmforge/babysitterd/babysitterd.pid"
wait_for_pidfile "$PIDFILE" || fail "02: pidfile never appeared on first start"
FIRST_PID="$(cat "$PIDFILE")"
STRAY_PIDS+=("$FIRST_PID")

OUT2="$(bash "$START" "$ROOT")"
grep -qi "already running" <<< "$OUT2" || fail "02: expected refusal message; got: $OUT2"
SECOND_PID_CHECK="$(cat "$PIDFILE")"
[[ "$SECOND_PID_CHECK" == "$FIRST_PID" ]] || fail "02: pidfile changed — a second daemon was started"
kill -0 "$FIRST_PID" 2>/dev/null || fail "02: original babysitterd process is no longer running"
pass "02: a second start is refused while the pidfile is live; original process untouched"

kill -KILL "$FIRST_PID" 2>/dev/null || true
rm -rf "$ROOT"

# ── heartbeat: --tick-once appends exactly one heartbeat line, no daemonizing ─
ROOT="$(make_root)"
bash "$DAEMON" "$ROOT" --tick-once >/dev/null
LOG="$ROOT/.swarmforge/babysitterd/babysitterd.log"
[[ -f "$LOG" ]] || fail "tick-once: expected a log file"
HB="$(grep -cE '[[:space:]]heartbeat([[:space:]]|$)' "$LOG" || true)"
[[ "$HB" -eq 1 ]] || fail "tick-once: expected exactly one heartbeat line; got $HB"
[[ ! -f "$ROOT/.swarmforge/babysitterd/babysitterd.pid" ]] || fail "tick-once: must not write a pidfile (not daemonizing)"
bash "$DAEMON" "$ROOT" --tick-once >/dev/null
bash "$DAEMON" "$ROOT" --tick-once >/dev/null
HB3="$(grep -cE '[[:space:]]heartbeat([[:space:]]|$)' "$LOG" || true)"
[[ "$HB3" -eq 3 ]] || fail "tick-once: three invocations should yield three heartbeat lines; got $HB3"
pass "tick-once: emits one heartbeat line per invocation without daemonizing"
rm -rf "$ROOT"

# ── BL-802-01: start succeeds when setsid is NOT resolvable on PATH ────────
# Symlink-farm just the specific tools start_babysitterd.sh/babysitterd.sh/
# freshness_stop_marker_lib.sh actually shell out to (never setsid) into one
# synthetic dir, so this is deterministic on both Linux (setsid usually
# co-located with core tools like bash/mkdir under /usr/bin) and macOS
# (setsid simply absent) — unlike stripping whole PATH directories, which on
# a merged-usr Linux host would also remove bash/mkdir/sleep and break the
# scenario for the wrong reason. A resolve-by-name curated list (`command -v`
# per tool, no subprocess-per-file scan) keeps this fast: whole-PATH-tree
# symlinking measured ~6-20s here and produced a flaky next scenario under
# the resulting load; this is sub-second.
NO_SETSID_BIN="$(mktemp -d)"
for _t in bash sh env mkdir cat sleep date wc tail mv touch rm nohup cp ls \
          basename dirname grep sed awk cut head xargs find chmod stat \
          readlink hostname uname tr sort mktemp ps pgrep true false git; do
  _resolved="$(command -v "$_t" 2>/dev/null)" || continue
  [[ -n "$_resolved" ]] || continue
  ln -sf "$_resolved" "$NO_SETSID_BIN/$_t" 2>/dev/null
done
ROOT="$(make_root)"
OUT="$(start_with_retry "$NO_SETSID_BIN" "$ROOT")" || fail "BL-802-01: expected a start confirmation without setsid on PATH; got: $OUT"
PIDFILE="$ROOT/.swarmforge/babysitterd/babysitterd.pid"
wait_for_pidfile "$PIDFILE" || fail "BL-802-01: pidfile never appeared without setsid on PATH"
PID="$(cat "$PIDFILE")"
kill -0 "$PID" 2>/dev/null || fail "BL-802-01: pid in pidfile is not alive (no setsid on PATH)"
STRAY_PIDS+=("$PID")
pass "BL-802-01: start_babysitterd.sh succeeds with a live, outlived daemon when setsid is absent from PATH"
kill -TERM "$PID" 2>/dev/null || true
sleep 0.3
kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
rm -rf "$ROOT" "$NO_SETSID_BIN"

# ── BL-802-02: start still succeeds with a setsid stub on PATH (Linux parity) ─
ROOT="$(make_root)"
SETSID_STUB_BIN="$(mktemp -d)"
cat > "$SETSID_STUB_BIN/setsid" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
chmod +x "$SETSID_STUB_BIN/setsid"
OUT="$(start_with_retry "$SETSID_STUB_BIN:$PATH" "$ROOT")" || fail "BL-802-02: expected a start confirmation with a setsid stub on PATH; got: $OUT"
PIDFILE="$ROOT/.swarmforge/babysitterd/babysitterd.pid"
wait_for_pidfile "$PIDFILE" || fail "BL-802-02: pidfile never appeared with a setsid stub on PATH"
PID="$(cat "$PIDFILE")"
kill -0 "$PID" 2>/dev/null || fail "BL-802-02: pid in pidfile is not alive (setsid stub on PATH)"
STRAY_PIDS+=("$PID")
pass "BL-802-02: start_babysitterd.sh succeeds identically when a setsid stub is present (Linux parity)"
kill -TERM "$PID" 2>/dev/null || true
sleep 0.3
kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
rm -rf "$ROOT" "$SETSID_STUB_BIN"

echo "ALL PASS"
