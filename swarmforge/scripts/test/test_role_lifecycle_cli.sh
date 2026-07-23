#!/usr/bin/env bash
# BL-324: role_lifecycle.sh + role_lifecycle_cli.bb - the per-role sibling
# of BL-307's whole-swarm hibernation. Drives the REAL swarmforge.sh
# (sourced, BL-089's own ZSH_EVAL_CONTEXT guard) against an ISOLATED
# project root and an ISOLATED tmux socket (a fresh TMUX_SOCKET derived
# from that root - never the live swarm's own socket) - real session
# create/kill, a stubbed `claude` binary so nothing waits on a real model
# call. Mirrors test_resume_on_start.sh's own proven fixture shape.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ROLE_LIFECYCLE_SH="$SCRIPT_DIR/../role_lifecycle.sh"
ROLE_LIFECYCLE_CLI="$SCRIPT_DIR/../role_lifecycle_cli.bb"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   - $*"; }

# Safety net: if a scenario aborts (set -e) before reaching its own
# cleanup_root, this still tears down the CURRENT fixture's isolated tmux
# socket on exit - never leaves a real (if isolated) tmux server orphaned.
CURRENT_ROOT=""
final_cleanup() {
  [[ -n "$CURRENT_ROOT" && -d "$CURRENT_ROOT" ]] || return 0
  local sock
  sock="$(zsh -c "source '$SWARMFORGE_SH' '$CURRENT_ROOT' >/dev/null 2>&1; echo \$TMUX_SOCKET" 2>/dev/null || true)"
  [[ -n "$sock" ]] && tmux -S "$sock" kill-server 2>/dev/null || true
  rm -rf "$CURRENT_ROOT"
}
trap final_cleanup EXIT

FAKE_BIN="$(mktemp -d)"
cat > "$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_BIN/claude"

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

# Builds an isolated fixture root with the FULL 7-role standard chain
# configured (specifier/coder/cleaner/architect/hardender/documenter/QA) +
# coordinator - a real full-crew pack, matching what routing_manifest_lib's
# own standard-chain default actually names. coder/cleaner/architect/QA are
# unparked for REAL (real tmux sessions on an isolated socket) since the
# scenarios below park/unpark exactly those; specifier/hardender/documenter
# get plain roster rows only (no scenario here parks/unparks them
# specifically) - still real swarmforge.conf entries, so row-for/unpark
# would work for them too if a future scenario needs it.
mk_fixture_root() {
  local root
  root="$(mktemp -d)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts" \
           "$root/backlog/active" "$root/backlog/paused"
  touch "$root/swarmforge/constitution.prompt"
  local role
  for role in specifier coder cleaner architect hardender documenter QA; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  for role in coder cleaner architect hardender documenter QA; do
    mkdir -p "$root/.worktrees/$role/.swarmforge/handoffs/inbox/new" \
             "$root/.worktrees/$role/.swarmforge/handoffs/inbox/in_process"
  done
  mkdir -p "$root/.swarmforge/handoffs/specifier/inbox/new" "$root/.swarmforge/handoffs/specifier/inbox/in_process"
  cat > "$root/swarmforge/swarmforge.conf" <<'CONF'
window specifier claude master --model x
window coder claude coder --model x
window cleaner claude cleaner --model x
window architect claude architect --model x
window hardender claude hardender --model x
window documenter claude documenter --model x
window QA claude QA --model x
CONF
  local r
  for r in coder cleaner architect QA; do
    local row
    row="$(env -u SWARMFORGE_CONFIG bash "$ROLE_LIFECYCLE_SH" "$root" row-for "$r")"
    echo "$row" >> "$root/.swarmforge/roles.tsv"
    env -u SWARMFORGE_CONFIG -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN PATH="$FAKE_BIN:$PATH" \
      bash "$ROLE_LIFECYCLE_SH" "$root" unpark "$r" >/dev/null
  done
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\toff\n' "$root" >> "$root/.swarmforge/roles.tsv"
  printf 'hardender\thardender\t%s/.worktrees/hardender\tswarmforge-hardender\tHardender\tclaude\ttask\toff\n' "$root" >> "$root/.swarmforge/roles.tsv"
  printf 'documenter\tdocumenter\t%s/.worktrees/documenter\tswarmforge-documenter\tDocumenter\tclaude\ttask\toff\n' "$root" >> "$root/.swarmforge/roles.tsv"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff\n' "$root" >> "$root/.swarmforge/roles.tsv"
  printf '%s' "$root"
}

roles_tsv_has() { grep -qP "^$2\t" "$1/.swarmforge/roles.tsv"; }
roles_tsv_lacks() { ! grep -qP "^$2\t" "$1/.swarmforge/roles.tsv"; }
session_alive() { local root="$1" session="$2"; local sock; sock="$(roster_sock "$root")"; tmux -S "$sock" has-session -t "$session" 2>/dev/null; }
session_dead() { ! session_alive "$1" "$2"; }

write_ticket() {
  local path="$1" priority="$2" roles_line="$3"
  {
    echo "id: $(basename "$path" .yaml)"
    echo "status: todo"
    echo "priority: $priority"
    if [[ -n "$roles_line" ]]; then
      echo "roles: [$roles_line]"
    fi
  } > "$path"
}

run_shape() {
  local root="$1" ticket="$2"
  env -u SWARMFORGE_CONFIG PATH="$FAKE_BIN:$PATH" bb "$ROLE_LIFECYCLE_CLI" "$root" shape "$ticket"
}

# ── per-role-lifecycle-01: shapes the swarm to exactly the ticket's roles ──
ROOT="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT"
write_ticket "$ROOT/backlog/active/BL-900.yaml" 10 "coder, QA"
OUT="$(run_shape "$ROOT" "$ROOT/backlog/active/BL-900.yaml")"
check_01() {
  roles_tsv_has "$ROOT" coder || return 1
  roles_tsv_has "$ROOT" QA || return 1
  roles_tsv_has "$ROOT" coordinator || return 1
  # per-role-lifecycle-09: the manifest ("coder, QA") OMITS specifier -
  # warm-core must keep it alive anyway, never explicit-need alone.
  roles_tsv_has "$ROOT" specifier || return 1
  roles_tsv_lacks "$ROOT" cleaner || return 1
  roles_tsv_lacks "$ROOT" architect || return 1
  session_dead "$ROOT" swarmforge-cleaner || return 1
  session_dead "$ROOT" swarmforge-architect || return 1
  session_alive "$ROOT" swarmforge-coder || return 1
  return 0
}
if check_01; then pass "per-role-lifecycle-01/09: exactly the manifest's roles + warm core (coordinator AND specifier) stay alive, the rest are parked and their panes killed"
else fail "per-role-lifecycle-01: roster/session state did not match the expected shape ($OUT)"; fi
cleanup_root "$ROOT"

# ── per-role-lifecycle-02: a parked role comes back for a later ticket ────
ROOT="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT"
write_ticket "$ROOT/backlog/active/BL-901.yaml" 10 "coder, QA"
run_shape "$ROOT" "$ROOT/backlog/active/BL-901.yaml" >/dev/null
roles_tsv_lacks "$ROOT" architect || fail "per-role-lifecycle-02 setup: expected architect parked first"
write_ticket "$ROOT/backlog/active/BL-902.yaml" 10 "coder, architect, QA"
run_shape "$ROOT" "$ROOT/backlog/active/BL-902.yaml" >/dev/null
if roles_tsv_has "$ROOT" architect && session_alive "$ROOT" swarmforge-architect; then
  pass "per-role-lifecycle-02: a parked role is brought back up (real session) when a later ticket needs it"
else
  fail "per-role-lifecycle-02: architect was not brought back up"
fi
# ── BL-343: this same real park (BL-901's shape) + real unpark (BL-902's
#    shape) is exactly one complete park/unpark CYCLE - the event log must
#    record both, in order, with real distinct timestamps, never a fixed/
#    estimated value.
PARK_LOG="$ROOT/.swarmforge/role-lifecycle/park-cycle-log.jsonl"
check_park_cycle_log() {
  [[ -f "$PARK_LOG" ]] || return 1
  python3 -c "
import json
events = [json.loads(l) for l in open('$PARK_LOG') if l.strip()]
architect_events = [e for e in events if e['role'] == 'architect']
assert len(architect_events) == 2, f'expected exactly 2 architect events, got {len(architect_events)}: {architect_events}'
assert architect_events[0]['event'] == 'park', architect_events
assert architect_events[1]['event'] == 'unpark', architect_events
assert isinstance(architect_events[0]['atMs'], int) and architect_events[0]['atMs'] > 0
assert architect_events[1]['atMs'] >= architect_events[0]['atMs'], 'unpark must be timestamped at or after its own park'
"
}
if check_park_cycle_log; then
  pass "routing-break-even-01/02 setup: a real park then a real unpark of the same role is recorded, in order, with real timestamps"
else
  fail "routing-break-even-01/02 setup: expected the park-cycle-log to record a real park then a real unpark for architect, got: $(cat "$PARK_LOG" 2>/dev/null)"
fi
cleanup_root "$ROOT"

# ── per-role-lifecycle-03: a role holding a REAL claimed parcel is never parked ──
ROOT="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT"
printf 'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\n\nbody\n' \
  > "$ROOT/.worktrees/cleaner/.swarmforge/handoffs/inbox/in_process/00_x.handoff"
write_ticket "$ROOT/backlog/active/BL-903.yaml" 10 "coder, QA"
run_shape "$ROOT" "$ROOT/backlog/active/BL-903.yaml" >/dev/null
if roles_tsv_has "$ROOT" cleaner && session_alive "$ROOT" swarmforge-cleaner; then
  pass "per-role-lifecycle-03: a role holding a REAL claimed parcel is never parked, even though its ticket doesn't need it"
else
  fail "per-role-lifecycle-03: a busy role was parked - a real parcel would have been orphaned"
fi
cleanup_root "$ROOT"

# ── per-role-lifecycle-04: a role needed by the NEXT queued ticket is not parked ──
ROOT="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT"
write_ticket "$ROOT/backlog/active/BL-904.yaml" 10 "coder, QA"
write_ticket "$ROOT/backlog/paused/BL-905.yaml" 20 "architect, QA"
run_shape "$ROOT" "$ROOT/backlog/active/BL-904.yaml" >/dev/null
if roles_tsv_has "$ROOT" architect && session_alive "$ROOT" swarmforge-architect; then
  pass "per-role-lifecycle-04: a role the NEXT queued ticket needs is left alive, not parked and immediately re-woken"
else
  fail "per-role-lifecycle-04: architect was parked despite being needed by the next queued ticket"
fi
cleanup_root "$ROOT"

# ── per-role-lifecycle-05: a ticket with no manifest keeps the full chain alive ──
ROOT="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT"
write_ticket "$ROOT/backlog/active/BL-906.yaml" 10 ""
OUT="$(run_shape "$ROOT" "$ROOT/backlog/active/BL-906.yaml")"
if [[ "$OUT" == '{"parked":[],"unparked":[]}' ]] \
   && session_alive "$ROOT" swarmforge-coder \
   && session_alive "$ROOT" swarmforge-cleaner \
   && session_alive "$ROOT" swarmforge-architect \
   && session_alive "$ROOT" swarmforge-QA; then
  pass "per-role-lifecycle-05: a ticket with no roles: manifest parks nothing, the full chain stays alive"
else
  fail "per-role-lifecycle-05: expected no parks/unparks and every role alive, got: $OUT"
fi
cleanup_root "$ROOT"

# ── fail-loud: a role a manifest names that isn't configured for THIS pack
#    (a lean-drain-style pack missing a chain member - roster-idle?'s own
#    comment names exactly this case) - never a silent no-op ────────────────
ROOT="$(mktemp -d)"
CURRENT_ROOT="$ROOT"
mkdir -p "$ROOT/swarmforge/roles" "$ROOT/.swarmforge/launch" "$ROOT/.swarmforge/prompts" \
         "$ROOT/backlog/active" "$ROOT/backlog/paused" \
         "$ROOT/.worktrees/coder/.swarmforge/handoffs/inbox/new" "$ROOT/.worktrees/coder/.swarmforge/handoffs/inbox/in_process" \
         "$ROOT/.worktrees/QA/.swarmforge/handoffs/inbox/new" "$ROOT/.worktrees/QA/.swarmforge/handoffs/inbox/in_process"
touch "$ROOT/swarmforge/constitution.prompt"
echo "role prompt" > "$ROOT/swarmforge/roles/coder.prompt"
echo "role prompt" > "$ROOT/swarmforge/roles/QA.prompt"
printf 'window coder claude coder --model x\nwindow QA claude QA --model x\n' > "$ROOT/swarmforge/swarmforge.conf"
for r in coder QA; do
  ROW="$(env -u SWARMFORGE_CONFIG bash "$ROLE_LIFECYCLE_SH" "$ROOT" row-for "$r")"
  echo "$ROW" >> "$ROOT/.swarmforge/roles.tsv"
  env -u SWARMFORGE_CONFIG -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN PATH="$FAKE_BIN:$PATH" \
    bash "$ROLE_LIFECYCLE_SH" "$ROOT" unpark "$r" >/dev/null
done
write_ticket "$ROOT/backlog/active/BL-907.yaml" 10 "coder, QA, documenter"
set +e
OUT="$(run_shape "$ROOT" "$ROOT/backlog/active/BL-907.yaml" 2>&1)"
CODE=$?
set -e
if [[ "$CODE" -ne 0 ]] && [[ "$OUT" == *"not configured for this pack"* ]]; then
  pass "fail-loud: a manifest naming a role absent from THIS pack's own config errors instead of silently no-op'ing"
else
  fail "expected a loud error for an unconfigured role, got exit=$CODE: $OUT"
fi
cleanup_root "$ROOT"

# ── per-role-lifecycle-07/08: THE IDLE CHECK MUST BE PER-KILL, NOT
#    PER-BATCH. Recreates the architect's own real-world window ("manifest
#    validation plus a slurp of every paused ticket YAML" - a REAL number
#    of paused tickets, not a contrived delay) between the roster snapshot
#    and a given role's own kill: a role idle when surveyed claims a
#    parcel in that window and must still never be killed, its row must
#    be restored, and the parcel must never be orphaned ─────────────────
ROOT="$(mk_fixture_root)"
CURRENT_ROOT="$ROOT"
for i in $(seq 1 300); do
  write_ticket "$ROOT/backlog/paused/BL-PAD-$i.yaml" 999 "coder, QA"
done
write_ticket "$ROOT/backlog/active/BL-908.yaml" 10 "coder, QA"
INPROCESS_DIR="$ROOT/.worktrees/architect/.swarmforge/handoffs/inbox/in_process"
env -u SWARMFORGE_CONFIG PATH="$FAKE_BIN:$PATH" \
  bb "$ROLE_LIFECYCLE_CLI" "$ROOT" shape "$ROOT/backlog/active/BL-908.yaml" >/tmp/aps-role-lifecycle-race-out.txt 2>&1 &
SHAPE_PID=$!
printf 'from: coder\nto: architect\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\n\nbody\n' \
  > "$INPROCESS_DIR/00_raced_claim.handoff"
wait "$SHAPE_PID" || true
PARK_LOG_RACE="$ROOT/.swarmforge/role-lifecycle/park-cycle-log.jsonl"
if roles_tsv_has "$ROOT" architect \
   && session_alive "$ROOT" swarmforge-architect \
   && [[ -f "$INPROCESS_DIR/00_raced_claim.handoff" ]] \
   && { [[ ! -f "$PARK_LOG_RACE" ]] || ! grep -q '"role":"architect"' "$PARK_LOG_RACE"; }; then
  pass "per-role-lifecycle-07/08: a role that claims work after the batch survey but before its own kill is left alive, roster row restored, parcel never orphaned - and BL-343's own event log never records the aborted attempt as a real park"
else
  fail "expected the raced role left alive with its parcel intact, got roles.tsv-has=$(roles_tsv_has "$ROOT" architect; echo $?) session=$(session_alive "$ROOT" swarmforge-architect; echo $?) ($(cat /tmp/aps-role-lifecycle-race-out.txt 2>/dev/null))"
fi
cleanup_root "$ROOT"
rm -f /tmp/aps-role-lifecycle-race-out.txt

rm -rf "$FAKE_BIN"
echo "role_lifecycle_cli smoke: ALL CHECKS PASSED"
