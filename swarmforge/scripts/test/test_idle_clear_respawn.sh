#!/usr/bin/env bash
# BL-089: per-role idle-boundary context-clear opt-in flag. Covers the
# idle-clear-01..04 acceptance scenarios end to end through the real
# done_with_current_task.bb -> ready_for_next_task.bb chain, faking tmux so
# no real session/pane is needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# BL-998: every dispatch path used here is bound below, to the fixture
# worktree's own copy. Nothing in this file may reach the real scripts dir.

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# BL-998: the receive/completion helpers resolve their OWN root - the .sh
# wrappers cd to their own dirname and the .bb dispatchers hand off to those
# wrappers by name. Correct in production, where every worktree carries its
# own hot-synced swarmforge/scripts/ copy; fatal here, because dispatching
# the REAL repo's copy would cd out of the fixture and resolve THIS checkout
# - testing live swarm state instead of the fixture, and claiming real
# parcels out of real mailboxes while doing it. Give the fixture its own
# copy and dispatch through that.
source "$SCRIPT_DIR/lib/install_scripts.sh"

# BL-1238 architect bounce D1: ready_for_next_task.sh carries shebang
# #!/usr/bin/env zsh, and this test reaches it indirectly via
# done_with_current_task.bb's `process/exec` (not a direct `zsh -f -c`
# invocation this file could add -f to itself). zsh sources ~/.zshenv
# unconditionally even for a non-interactive shebang run, so on a host
# whose ~/.zshenv prepends a real tool directory onto $PATH (e.g.
# ~/.local/bin with a real tmux binary), that re-prepend lands ahead of
# this test's own $FAKE_BIN and the REAL tmux runs instead of the fixture
# fake - the same documented hazard test_bl1069_tmux_server_version.sh's
# own header comment names ("~/.zshenv re-exports real credentials over
# fixture values"). zsh honours ZDOTDIR from the inherited environment
# even via shebang, so pointing it at an empty directory with no .zshenv
# is the equivalent of `zsh -f` for this indirect invocation shape.
ZDOTDIR="$(mktemp -d)"
export ZDOTDIR

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$ZDOTDIR"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

ONROLE_WT="$ROOT/.worktrees/onrole"
OFFROLE_WT="$ROOT/.worktrees/offrole"
git -C "$ROOT" worktree add -q -b onrole "$ONROLE_WT"
install_scripts "$ONROLE_WT"
READY_TASK="$ONROLE_WT/swarmforge/scripts/ready_for_next_task.sh"
ONROLE_DONE_TASK="$ONROLE_WT/swarmforge/scripts/done_with_current_task.bb"
git -C "$ROOT" worktree add -q -b offrole "$OFFROLE_WT"
install_scripts "$OFFROLE_WT"
OFFROLE_DONE_TASK="$OFFROLE_WT/swarmforge/scripts/done_with_current_task.bb"

# BL-1238 required_wiring: ready_for_next_batch.bb carries its OWN copy of
# the same gate (batch roles - cleaner, hardener - never touch
# ready_for_next_task.bb), and nothing else in this repo proves it fires -
# scenarios 05/06 below are that proof.
BATCHONROLE_WT="$ROOT/.worktrees/batchonrole"
BATCHOFFROLE_WT="$ROOT/.worktrees/batchoffrole"
git -C "$ROOT" worktree add -q -b batchonrole "$BATCHONROLE_WT"
install_scripts "$BATCHONROLE_WT"
BATCHONROLE_DONE_BATCH="$BATCHONROLE_WT/swarmforge/scripts/done_with_current_batch.bb"
git -C "$ROOT" worktree add -q -b batchoffrole "$BATCHOFFROLE_WT"
install_scripts "$BATCHOFFROLE_WT"
BATCHOFFROLE_DONE_BATCH="$BATCHOFFROLE_WT/swarmforge/scripts/done_with_current_batch.bb"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge/launch"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
echo "onrole launch" > "$ROOT/.swarmforge/launch/onrole.sh"
echo "offrole launch" > "$ROOT/.swarmforge/launch/offrole.sh"
echo "batchonrole launch" > "$ROOT/.swarmforge/launch/batchonrole.sh"
echo "batchoffrole launch" > "$ROOT/.swarmforge/launch/batchoffrole.sh"

printf 'onrole\tonrole\t%s\tswarmforge-onrole\tOnrole\tclaude\ttask\ton\n' "$ONROLE_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'offrole\toffrole\t%s\tswarmforge-offrole\tOffrole\tclaude\ttask\toff\n' "$OFFROLE_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"
printf 'batchonrole\tbatchonrole\t%s\tswarmforge-batchonrole\tBatchonrole\tclaude\tbatch\ton\n' "$BATCHONROLE_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"
printf 'batchoffrole\tbatchoffrole\t%s\tswarmforge-batchoffrole\tBatchoffrole\tclaude\tbatch\toff\n' "$BATCHOFFROLE_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
: > "$TMUX_LOG"
export TMUX_LOG
# BL-1238: idle_clear_fullness_cli.bb reads this role's own pane via
# $TMUX_PANE (the process runs inside its own pane in production) and a
# real `capture-pane -p -t "$TMUX_PANE" -S -400` call - faked here to
# return a full 400-line window, so this file's existing scenarios (which
# predate the fullness gate and assert on opt-in alone) still observe the
# "well past threshold" case, matching qa_e2e_procedure step 1's own setup.
export TMUX_PANE="%1"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
if [[ "$1 $2" == "-S" ]]; then :; fi
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == "display-message" ]]; then
    echo "%1"
    exit 0
  fi
  if [[ "${!i}" == "capture-pane" ]]; then
    for j in $(seq 1 400); do echo "line $j"; done
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

queue_task() {
  # BL-610: commit must resolve to a real object now that dequeue re-checks
  # it - $COMMIT is ROOT's own init commit, not a placeholder.
  local dir="$1" name="$2"
  mkdir -p "$dir"
  printf 'id: %s\nfrom: specifier\nto: %s\npriority: 50\ntype: git_handoff\ntask: BL-089-test\ncommit: %s\n\npayload\n' \
    "$name" "$(basename "$(dirname "$dir")")" "$COMMIT" > "$dir/50_${name}.handoff"
}

queue_batch() {
  # A single-item batch under in_process/batch_<name>/ - the shape
  # done_with_current_batch.bb requires (handoff-lib/batch-dirs only
  # recognizes a directory whose name starts with "batch_").
  local dir="$1" name="$2"
  local batch_dir="$dir/batch_${name}"
  mkdir -p "$batch_dir"
  printf 'id: %s\nfrom: specifier\nto: %s\npriority: 50\ntype: git_handoff\ntask: BL-089-test\ncommit: %s\n\npayload\n' \
    "$name" "$(basename "$(dirname "$dir")")" "$COMMIT" > "$batch_dir/50_${name}.handoff"
}

# ── 1: enabled role, no queued work -> clears (respawns) at the idle boundary ──
INBOX="$ONROLE_WT/.swarmforge/handoffs/inbox"
mkdir -p "$INBOX/new" "$INBOX/in_process" "$INBOX/completed"
queue_task "$INBOX/in_process" "item1"

OUT="$(cd "$ONROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=onrole bb "$ONROLE_DONE_TASK")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "01: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" || fail "01: expected a respawn-pane call for the enabled role, log: $(cat "$TMUX_LOG")"
grep -q "onrole.sh" "$TMUX_LOG" || fail "01: expected the respawn to reference onrole's own launch script"
pass "01: enabled role clears (respawns) at the idle boundary once queue is empty"

# ── 2: enabled role, queued work remains -> hands out next item, no clear ──
: > "$TMUX_LOG"
queue_task "$INBOX/in_process" "item2"
queue_task "$INBOX/new" "item3"

OUT="$(cd "$ONROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=onrole bb "$ONROLE_DONE_TASK")"
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
OUT="$(cd "$OFFROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=offrole bb "$OFFROLE_DONE_TASK")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "04: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "04: disabled role must never clear, log: $(cat "$TMUX_LOG")"
pass "04: role without the idle-clear token is untouched at the idle boundary"

# ── 5: batch-mode enabled role, no queued work -> clears at the idle
#       boundary via ready_for_next_batch.bb's OWN copy of the gate ──────
BATCH_ON_INBOX="$BATCHONROLE_WT/.swarmforge/handoffs/inbox"
mkdir -p "$BATCH_ON_INBOX/new" "$BATCH_ON_INBOX/in_process" "$BATCH_ON_INBOX/completed"
queue_batch "$BATCH_ON_INBOX/in_process" "item5"

: > "$TMUX_LOG"
OUT="$(cd "$BATCHONROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=batchonrole bb "$BATCHONROLE_DONE_BATCH")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "05: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" || fail "05: expected a respawn-pane call for the enabled batch role, log: $(cat "$TMUX_LOG")"
grep -q "batchonrole.sh" "$TMUX_LOG" || fail "05: expected the respawn to reference batchonrole's own launch script"
pass "05: batch-mode enabled role clears (respawns) at the idle boundary via ready_for_next_batch.bb's own gate (BL-1238 required_wiring)"

# ── 6: batch-mode disabled role -> untouched, no clear, even at the idle
#       boundary ──────────────────────────────────────────────────────────
BATCH_OFF_INBOX="$BATCHOFFROLE_WT/.swarmforge/handoffs/inbox"
mkdir -p "$BATCH_OFF_INBOX/new" "$BATCH_OFF_INBOX/in_process" "$BATCH_OFF_INBOX/completed"
queue_batch "$BATCH_OFF_INBOX/in_process" "item6"

: > "$TMUX_LOG"
OUT="$(cd "$BATCHOFFROLE_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=batchoffrole bb "$BATCHOFFROLE_DONE_BATCH")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "06: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "06: disabled batch role must never clear, log: $(cat "$TMUX_LOG")"
pass "06: batch-mode role without the idle-clear token is untouched at the idle boundary"

echo "ALL PASS"
