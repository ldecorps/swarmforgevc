#!/usr/bin/env bash
# BL-368 layer 2: "Every relaunch path must REFUSE to start a role whose
# previous claude process is still alive, regardless of what tmux says."
# Proves create_role_session's own pid guard directly, with a REAL live
# process backing a REAL heartbeat file (never a mocked pid-alive check) -
# and proves the guard's effect through role_lifecycle.sh unpark, the same
# relaunch path a human/Operator would actually invoke.
set -euo pipefail
# Disables job-control monitor mode: without this, bash's async "done"
# notification for the backgrounded LIVE_PID process below can print
# mid-script and leak into an UNRELATED LATER command substitution's
# captured stdout (e.g. corrupting `ROOT2="$(mk_fixture_root)"` with a
# stray job-control line) - a real, if obscure, bash interaction, not a
# fixture logic bug.
set +m

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
SWARMFORGE_SH="$SRC/swarmforge.sh"
ROLE_LIFECYCLE_SH="$SRC/role_lifecycle.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

FAKE_BIN="$(mktemp -d)"
cat > "$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_BIN/claude"

mk_fixture_root() {
  local root; root="$(mktemp -d)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts" \
           "$root/.swarmforge/heartbeat" \
           "$root/backlog/active" "$root/backlog/paused" \
           "$root/.worktrees/coder/.swarmforge/handoffs/inbox/new" "$root/.worktrees/coder/.swarmforge/handoffs/inbox/in_process"
  touch "$root/swarmforge/constitution.prompt"
  echo "role prompt" > "$root/swarmforge/roles/coder.prompt"
  printf 'window coder claude coder --model x\n' > "$root/swarmforge/swarmforge.conf"
  printf '%s' "$root"
}

roster_sock() {
  local root="$1"
  zsh -c "source '$SWARMFORGE_SH' '$root' >/dev/null 2>&1; echo \$TMUX_SOCKET"
}

cleanup_root() {
  local root="$1"
  local sock
  sock="$(roster_sock "$root" 2>/dev/null || true)"
  [[ -n "$sock" ]] && tmux -S "$sock" kill-server 2>/dev/null || true
  rm -rf "$root"
}

session_alive() { local root="$1" session="$2"; local sock; sock="$(roster_sock "$root")"; tmux -S "$sock" has-session -t "$session" 2>/dev/null; }

write_heartbeat() {
  local root="$1" pid="$2"
  cat > "$root/.swarmforge/heartbeat/coder.yaml" <<HB
role: coder
pid: $pid
last_beat: "2026-07-14T00:00:00Z"
last_tool: Bash
phase: entry
in_flight: false
beat_count: 1
HB
}

CURRENT_ROOT=""
final_cleanup() { [[ -n "$CURRENT_ROOT" && -d "$CURRENT_ROOT" ]] && cleanup_root "$CURRENT_ROOT" || true; }
trap final_cleanup EXIT

# ── 1. a REAL live process's pid in the heartbeat -> unpark REFUSES ────────
ROOT="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT"
sleep 100 &
LIVE_PID=$!
write_heartbeat "$ROOT" "$LIVE_PID"
set +e
OUT="$(env -u SWARMFORGE_CONFIG -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN PATH="$FAKE_BIN:$PATH" \
  bash "$ROLE_LIFECYCLE_SH" "$ROOT" unpark coder 2>&1)"
CODE=$?
set -e
# kill only (no wait/disown) - a killed-but-unreaped child becomes a
# zombie for the remainder of THIS script's life, which is harmless (one
# process-table slot, auto-reaped when this script exits); avoiding wait
# here sidesteps a real bash job-control interaction that otherwise leaks
# an async notification into an unrelated later command substitution.
kill "$LIVE_PID" 2>/dev/null || true
check "pid-guard-01: unpark refuses (nonzero exit) when the role's heartbeat pid is a REAL live process" '[[ "$CODE" -ne 0 ]]'
check "pid-guard-01: the refusal names the reason" '[[ "$OUT" == *"still alive"* ]]'
check "pid-guard-01: no session was created for the still-alive role" '! session_alive "$ROOT" swarmforge-coder'
cleanup_root "$ROOT"
CURRENT_ROOT=""

# ── 2. a genuinely dead pid in the heartbeat -> unpark proceeds normally ───
# A hardcoded, implausibly large pid (well beyond any real pid_max) rather
# than spawning+killing a real process - deterministic (no reap-timing
# race, no job-control interaction) while still exercising the REAL kill
# -0 liveness check against a genuinely nonexistent process, never a
# mocked/stubbed check.
ROOT2="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT2"
IMPLAUSIBLE_PID=999999999
if kill -0 "$IMPLAUSIBLE_PID" 2>/dev/null; then
  note "SKIP - pid-guard-02: pid $IMPLAUSIBLE_PID unexpectedly exists on this system (fixture assumption invalid here)"
else
  write_heartbeat "$ROOT2" "$IMPLAUSIBLE_PID"
  env -u SWARMFORGE_CONFIG -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN PATH="$FAKE_BIN:$PATH" \
    bash "$ROLE_LIFECYCLE_SH" "$ROOT2" unpark coder >/dev/null
  check "pid-guard-02: unpark proceeds normally when the heartbeat's pid is genuinely dead" 'session_alive "$ROOT2" swarmforge-coder'
fi
cleanup_root "$ROOT2"
CURRENT_ROOT=""

# ── 3. no heartbeat file at all -> unpark proceeds normally (unchanged from
#    before this ticket - the guard never fabricates a refusal from nothing) ──
ROOT3="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT3"
env -u SWARMFORGE_CONFIG -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN PATH="$FAKE_BIN:$PATH" \
  bash "$ROLE_LIFECYCLE_SH" "$ROOT3" unpark coder >/dev/null
check "pid-guard-03: no heartbeat file at all is not treated as alive - unpark proceeds normally" 'session_alive "$ROOT3" swarmforge-coder'
cleanup_root "$ROOT3"
CURRENT_ROOT=""

rm -rf "$FAKE_BIN"

if [[ "$fail" -eq 0 ]]; then
  echo "swarmforge pid-guard smoke: ALL CHECKS PASSED"
else
  echo "swarmforge pid-guard smoke: FAILURES ABOVE"
  exit 1
fi
