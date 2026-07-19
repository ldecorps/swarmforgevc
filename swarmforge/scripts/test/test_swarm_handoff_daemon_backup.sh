#!/usr/bin/env bash
# BL-155: when sync tmux inject fails and daemon is enabled, handoff stays in
# outbox for handoffd backup delivery (no hard error).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge/daemon"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

CODER_WT="$ROOT/.worktrees/coder"
mkdir -p "$CODER_WT/.swarmforge/handoffs/"{outbox/tmp,sent,inbox/new}
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" >> "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
export CALL_LOG

# capture-pane always shows pending wake text — sync inject never confirms
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "capture-pane" ]]; then
    echo '❯ You have new handoff mail. If idle, run ready_for_next.sh.'
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

DRAFT="$ROOT/draft.handoff"
cat > "$DRAFT" <<'EOF'
type: note
to: coder
priority: 50
message: daemon backup test
EOF

(
  cd "$ROOT"
  export SWARMFORGE_ROLE=coordinator
  unset SWARMFORGE_SKIP_DAEMON
  PATH="$FAKE_BIN:$PATH" bb "$SWARM_HANDOFF" "$DRAFT"
) | tee "$ROOT/out.txt"

grep -q "HANDOFF QUEUED (daemon backup will deliver):" "$ROOT/out.txt" \
  || fail "expected daemon backup queue message"
outbox_count="$(find "$ROOT/.swarmforge/handoffs/outbox" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$outbox_count" -ge 1 ]] || fail "parcel must remain in outbox for daemon backup"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --poll-once

find "$CODER_WT/.swarmforge/handoffs/inbox/new" -name '*_for_coder.handoff' -print -quit | grep -q . \
  || fail "daemon must deliver parcel to coder inbox/new"
find "$ROOT/.swarmforge/handoffs/sent" -name '*.handoff' -print -quit | grep -q . \
  || fail "daemon must archive outbox parcel to sent/"
outbox_after="$(find "$ROOT/.swarmforge/handoffs/outbox" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$outbox_after" == "0" ]] || fail "outbox must be empty after daemon delivery"

pass "sync failure queues outbox; handoffd delivers backup"
echo "ALL PASS"
