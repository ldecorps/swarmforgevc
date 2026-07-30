#!/usr/bin/env bash
# BL-647: `dead-agent-events` was blind to the rotation router — under the
# DEFAULT mono-router pack it fired 6 permanent AGENT_EXITED (one per
# dormant role, which never held a session by design) on every single tick,
# 525 times against the real operator log. This is the WIRING half of the
# fix: operator_runtime.bb's tick! must resolve rotation-mode from the conf
# (swarm-identity's launch_pack -> swarmforge/packs/<pack>.conf), the active
# resident role, and the resident session, and pass all three through to
# operator-lib/dead-agent-events — never leave the pure fix unwired.
#
# cd's into the fixture before every tick: handoff-lib's target-root/
# roles-tsv-path/mono-router-active-role-path resolve via `git
# rev-parse --git-common-dir` (falling back to `git rev-parse
# --show-toplevel`, then the JVM's user.dir) in the PROCESS'S OWN cwd, not
# the project-root CLI arg operator_runtime.bb itself uses for state-dir. A
# non-git fixture with the wrong cwd would silently read the REAL repo's
# live .swarmforge/roles.tsv instead of the fixture's.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/operator_runtime_sandbox.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/packs"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"
  printf '%s' "$d"
}

# Isolates this generic tick from other sweeps exactly like the sibling
# control-lost test, and runs with cwd = the fixture root (see header) so
# every handoff-lib target-root lookup resolves to THIS fixture.
tick() {
  ( cd "$1" && \
    OPERATOR_SKIP_LAUNCH=1 SWARMFORGE_SANDBOX_SWEEP_ROOT="$1/.no-sandbox-sweep" SWARMFORGE_FIXTURE_REAP_ROOT="$1/.no-fixture-reap" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
      bb "$1/swarmforge/scripts/operator_runtime.bb" "$1" --tick-once )
}

events_text() {
  cat "$1/.swarmforge/operator/events.jsonl" 2>/dev/null
  cat "$1/.swarmforge/operator/events.inflight.jsonl" 2>/dev/null
}

# roles.tsv mirroring the real 8-row roster BL-647's evidence is built from.
write_router_roles_tsv() {
  local d="$1"
  {
    printf 'coder\tcoder\t%s/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\toff\n' "$d"
    printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\toff\n' "$d"
    printf 'cleaner\tcleaner\t%s/.worktrees/cleaner\tswarmforge-cleaner\tCleaner\tclaude\tbatch\toff\n' "$d"
    printf 'architect\tarchitect\t%s/.worktrees/architect\tswarmforge-architect\tArchitect\tclaude\ttask\toff\n' "$d"
    printf 'hardender\thardender\t%s/.worktrees/hardender\tswarmforge-hardender\tHardender\tclaude\tbatch\toff\n' "$d"
    printf 'documenter\tdocumenter\t%s/.worktrees/documenter\tswarmforge-documenter\tDocumenter\tclaude\ttask\toff\n' "$d"
    printf 'QA\tQA\t%s/.worktrees/QA\tswarmforge-QA\tQa\tclaude\ttask\toff\n' "$d"
    printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff\n' "$d"
  } > "$d/.swarmforge/roles.tsv"
}

# Marks this fixture as a `config rotation router` mono-router launch, the
# same two files real swarmforge.sh writes: swarm-identity's launch_pack
# (active-launch-config-path's first-choice resolution) and the pack conf
# itself carrying the rotation directive conf-rotation-mode actually reads.
write_router_identity() {
  local d="$1"
  printf 'launch_pack\tmono-router\n' > "$d/.swarmforge/swarm-identity"
  printf 'config rotation router\n' > "$d/swarmforge/packs/mono-router.conf"
}

# ── 1. rotation-router pack, coordinator + resident (coder) live, six
#    dormant roles — zero AGENT_EXITED. This is the exact false-positive
#    shape measured 525 times in the ticket's evidence. ─────────────────────
F1="$(make_fixture)"
write_router_roles_tsv "$F1"
write_router_identity "$F1"
printf 'coder\n' > "$F1/.swarmforge/mono-router-active-role"
SOCK1_DIR="$(mktemp -d)"; register_tmp_dir "$SOCK1_DIR"
SOCK1="$SOCK1_DIR/bl647.sock"
tmux -S "$SOCK1" new-session -d -s swarmforge-coder -n agent 2>/dev/null
tmux -S "$SOCK1" new-session -d -s swarmforge-coordinator -n agent 2>/dev/null
echo "$SOCK1" > "$F1/.swarmforge/tmux-socket"
tick "$F1" >/dev/null
check "BL-647-wire-01: rotation-router with coordinator+resident live emits zero AGENT_EXITED" \
  '[[ "$(events_text "$F1" | grep -c AGENT_EXITED)" -eq 0 ]]'
check "BL-647-wire-01: no SWARM_CONTROL_LOST misfire either (the socket IS reachable)" \
  '[[ "$(events_text "$F1")" != *"SWARM_CONTROL_LOST"* ]]'
tmux -S "$SOCK1" kill-server 2>/dev/null || true
rm -rf "$SOCK1_DIR" "$F1"

# ── 2. non-vacuity: kill the ACTUAL resident session (the pane running
#    "cleaner" this tick per the active-role marker) — exactly one
#    AGENT_EXITED, naming "cleaner", not "coder" (the row the physical
#    session happens to be named after) and not any of the other five
#    dormant roles. A fix that always returns [] passes test 1 and fails
#    this one. ─────────────────────────────────────────────────────────────
F2="$(make_fixture)"
write_router_roles_tsv "$F2"
write_router_identity "$F2"
printf 'cleaner\n' > "$F2/.swarmforge/mono-router-active-role"
echo "/nonexistent/bl647-dead.sock" > "$F2/.swarmforge/tmux-socket"
# A reachable-but-empty tmux control channel: point at a REAL socket with no
# sessions on it at all, so control IS reachable (unlike scenario control-lost)
# and every role reads simply "not live".
SOCK2_DIR="$(mktemp -d)"; register_tmp_dir "$SOCK2_DIR"
SOCK2="$SOCK2_DIR/bl647.sock"
tmux -S "$SOCK2" new-session -d -s placeholder -n agent 2>/dev/null
tmux -S "$SOCK2" kill-session -t placeholder 2>/dev/null || true
# tmux removes the server entirely once the last session is gone, so start a
# session and keep the COORDINATOR alive but never create swarmforge-coder.
tmux -S "$SOCK2" new-session -d -s swarmforge-coordinator -n agent 2>/dev/null
echo "$SOCK2" > "$F2/.swarmforge/tmux-socket"
tick "$F2" >/dev/null
check "BL-647-wire-02: dead resident session fires exactly one AGENT_EXITED" \
  '[[ "$(events_text "$F2" | grep -c AGENT_EXITED)" -eq 1 ]]'
check "BL-647-wire-02: it names the ACTIVE role (cleaner), not the home role (coder)" \
  '[[ "$(events_text "$F2")" == *'"'"'"AGENT_EXITED","subject":"cleaner"'"'"'* ]]'
check "BL-647-wire-02: it does NOT name coder" \
  '[[ "$(events_text "$F2")" != *'"'"'"AGENT_EXITED","subject":"coder"'"'"'* ]]'
check "BL-647-wire-02: no dormant role (e.g. QA) is reported exited" \
  '[[ "$(events_text "$F2")" != *'"'"'"AGENT_EXITED","subject":"QA"'"'"'* ]]'
tmux -S "$SOCK2" kill-server 2>/dev/null || true
rm -rf "$SOCK2_DIR" "$F2"

# ── 3. coordinator death under a rotation pack — one event; the coordinator
#    is never a rotation target and is always expected. ─────────────────────
F3="$(make_fixture)"
write_router_roles_tsv "$F3"
write_router_identity "$F3"
printf 'coder\n' > "$F3/.swarmforge/mono-router-active-role"
SOCK3_DIR="$(mktemp -d)"; register_tmp_dir "$SOCK3_DIR"
SOCK3="$SOCK3_DIR/bl647.sock"
tmux -S "$SOCK3" new-session -d -s swarmforge-coder -n agent 2>/dev/null
echo "$SOCK3" > "$F3/.swarmforge/tmux-socket"
tick "$F3" >/dev/null
check "BL-647-wire-03: coordinator death under rotation-router fires exactly one AGENT_EXITED" \
  '[[ "$(events_text "$F3" | grep -c AGENT_EXITED)" -eq 1 ]]'
check "BL-647-wire-03: it names the coordinator" \
  '[[ "$(events_text "$F3")" == *'"'"'"AGENT_EXITED","subject":"coordinator"'"'"'* ]]'
tmux -S "$SOCK3" kill-server 2>/dev/null || true
rm -rf "$SOCK3_DIR" "$F3"

# ── 4. non-rotation (full-forge) pack is untouched — no launch_pack, no
#    mono-router.conf, so conf-rotation-mode resolves nil and every
#    expected-but-absent role fires exactly as before this ticket, even
#    though only 2 sessions happen to be live (proves rotation-mode comes
#    from the conf, never inferred from the live-session count). ───────────
F4="$(make_fixture)"
write_router_roles_tsv "$F4"
# deliberately NOT write_router_identity — this is the plain full-forge case
SOCK4_DIR="$(mktemp -d)"; register_tmp_dir "$SOCK4_DIR"
SOCK4="$SOCK4_DIR/bl647.sock"
tmux -S "$SOCK4" new-session -d -s swarmforge-coder -n agent 2>/dev/null
tmux -S "$SOCK4" new-session -d -s swarmforge-coordinator -n agent 2>/dev/null
echo "$SOCK4" > "$F4/.swarmforge/tmux-socket"
tick "$F4" >/dev/null
check "BL-647-wire-04: full-forge with only 2 live sessions still fires all six absent roles (not treated as router)" \
  '[[ "$(events_text "$F4" | grep -c AGENT_EXITED)" -eq 6 ]]'
tmux -S "$SOCK4" kill-server 2>/dev/null || true
rm -rf "$SOCK4_DIR" "$F4"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime BL-647 rotation-liveness wiring: ALL CHECKS PASSED"
else
  echo "operator_runtime BL-647 rotation-liveness wiring: FAILURES ABOVE"
  exit 1
fi
