#!/usr/bin/env bash
# BL-089: per-role idle-boundary context-clear opt-in flag. Covers the
# idle-clear-01..04 acceptance scenarios end to end through the real
# done_with_current_task.bb -> ready_for_next_task.bb chain, faking tmux so
# no real session/pane is needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DONE_TASK="$SCRIPT_DIR/../done_with_current_task.bb"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

ONROLE_WT="$ROOT/.worktrees/onrole"
OFFROLE_WT="$ROOT/.worktrees/offrole"
git -C "$ROOT" worktree add -q -b onrole "$ONROLE_WT"
git -C "$ROOT" worktree add -q -b offrole "$OFFROLE_WT"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge/launch"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
echo "onrole launch" > "$ROOT/.swarmforge/launch/onrole.sh"
echo "offrole launch" > "$ROOT/.swarmforge/launch/offrole.sh"

printf 'onrole\tonrole\t%s\tswarmforge-onrole\tOnrole\tclaude\ttask\ton\n' "$ONROLE_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'offrole\toffrole\t%s\tswarmforge-offrole\tOffrole\tclaude\ttask\toff\n' "$OFFROLE_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
: > "$TMUX_LOG"
export TMUX_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
if [[ "$1 $2" == "-S" ]]; then :; fi
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == "display-message" ]]; then
    echo "%1"
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

queue_task() {
  local dir="$1" name="$2"
  mkdir -p "$dir"
  printf 'id: %s\nfrom: specifier\nto: %s\npriority: 50\ntype: git_handoff\ntask: BL-089-test\ncommit: abc1234567\n\npayload\n' \
    "$name" "$(basename "$(dirname "$dir")")" > "$dir/50_${name}.handoff"
}

# ── 1: enabled role, no queued work -> clears (respawns) at the idle boundary ──
INBOX="$ONROLE_WT/.swarmforge/handoffs/inbox"
mkdir -p "$INBOX/new" "$INBOX/in_process" "$INBOX/completed"
queue_task "$INBOX/in_process" "item1"

OUT="$(cd "$ONROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=onrole bb "$DONE_TASK")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "01: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" || fail "01: expected a respawn-pane call for the enabled role, log: $(cat "$TMUX_LOG")"
grep -q "onrole.sh" "$TMUX_LOG" || fail "01: expected the respawn to reference onrole's own launch script"
pass "01: enabled role clears (respawns) at the idle boundary once queue is empty"

# ── 2: enabled role, queued work remains -> hands out next item, no clear ──
: > "$TMUX_LOG"
queue_task "$INBOX/in_process" "item2"
queue_task "$INBOX/new" "item3"

OUT="$(cd "$ONROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=onrole bb "$DONE_TASK")"
echo "$OUT" | grep -q '^TASK:' || fail "02: expected the next TASK to be handed out, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "02: must not clear while queued work remains, log: $(cat "$TMUX_LOG")"
pass "02: no clear while queued work remains; done helper hands out the next item instead"

# clean up in-process item left by scenario 2 before the next scenario
rm -f "$INBOX/in_process"/*.handoff

# ── 3: standalone ready_for_next.sh (no --idle-boundary) never clears, even
#       when the role is enabled and the queue is empty ──
: > "$TMUX_LOG"
OUT="$(cd "$ONROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=onrole "$READY_TASK")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "03: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "03: standalone ready_for_next.sh must never clear, log: $(cat "$TMUX_LOG")"
pass "03: standalone (non-idle-boundary) ready_for_next.sh never triggers a clear"

# ── 4: disabled role -> untouched, no clear, even at the idle boundary ──
OFF_INBOX="$OFFROLE_WT/.swarmforge/handoffs/inbox"
mkdir -p "$OFF_INBOX/new" "$OFF_INBOX/in_process" "$OFF_INBOX/completed"
queue_task "$OFF_INBOX/in_process" "item4"

: > "$TMUX_LOG"
OUT="$(cd "$OFFROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=offrole bb "$DONE_TASK")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "04: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "04: disabled role must never clear, log: $(cat "$TMUX_LOG")"
pass "04: role without the idle-clear token is untouched at the idle boundary"

echo "ALL PASS"
