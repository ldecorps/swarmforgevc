#!/usr/bin/env bash
# BL-154: swarm_handoff sync delivery when SWARMFORGE_SKIP_DAEMON=1 — parcel
# lands in inbox/new and tmux notify runs without handoffd.

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
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

MASTER_WT="$ROOT"
CODER_WT="$ROOT/.worktrees/coder"
# BL-128: coordinator is master-resident, so it gets its own <role> mailbox
# subdirectory rather than the old flat shared one.
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} "$CODER_WT/.swarmforge/handoffs/inbox/new"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" >> "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
BEFORE_STDOUT_FILE="$ROOT/before-stdout.txt"
AFTER_STDOUT_FILE="$ROOT/after-stdout.txt"
CAPTURE_COUNT_FILE="$ROOT/capture-count"
export CALL_LOG BEFORE_STDOUT_FILE AFTER_STDOUT_FILE CAPTURE_COUNT_FILE

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "capture-pane" ]]; then
    count="$(cat "$CAPTURE_COUNT_FILE" 2>/dev/null || echo 0)"
    echo $((count + 1)) > "$CAPTURE_COUNT_FILE"
    if [[ "$count" == "0" ]]; then
      cat "$BEFORE_STDOUT_FILE" 2>/dev/null
    else
      cat "$AFTER_STDOUT_FILE" 2>/dev/null
    fi
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
message: sync deliver test
EOF

echo '❯ ' > "$BEFORE_STDOUT_FILE"
echo '❯ ' > "$AFTER_STDOUT_FILE"

(
  cd "$ROOT"
  export SWARMFORGE_ROLE=coordinator
  export SWARMFORGE_SKIP_DAEMON=1
  PATH="$FAKE_BIN:$PATH" bb "$SWARM_HANDOFF" "$DRAFT"
) | tee "$ROOT/out.txt"

grep -q "HANDOFF DELIVERED:" "$ROOT/out.txt" || fail "expected HANDOFF DELIVERED output"
outbox_count="$(find "$MASTER_WT/.swarmforge/handoffs/coordinator/outbox" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$outbox_count" == "0" ]] || fail "outbox must be empty after sync deliver"
find "$CODER_WT/.swarmforge/handoffs/inbox/new" -name '*_for_coder.handoff' -print -quit | grep -q . \
  || fail "parcel missing from coder inbox/new"
find "$MASTER_WT/.swarmforge/handoffs/coordinator/sent" -name '*.handoff' -print -quit | grep -q . \
  || fail "parcel not archived to sender sent/"
grep -q -- '-l' "$CALL_LOG" || fail "expected literal send-keys wake"
! pgrep -f "handoffd.bb.*$ROOT" >/dev/null 2>&1 || fail "handoffd must not be running"

pass "sync deliver moves parcel and wakes pane without daemon"

# ── 02: busy resident pane → parcel lands, wake skipped (BL-135 sync path) ───
ROOT2="$(mktemp -d)"
git -C "$ROOT2" init -q
git -C "$ROOT2" config user.email "test@test"
git -C "$ROOT2" config user.name "test"
SOCK2="$ROOT2/fake.sock"
touch "$SOCK2"
mkdir -p "$ROOT2/.swarmforge"
echo "$SOCK2" > "$ROOT2/.swarmforge/tmux-socket"
MASTER_WT2="$ROOT2"
CODER_WT2="$ROOT2/.worktrees/coder"
mkdir -p "$MASTER_WT2/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} "$CODER_WT2/.swarmforge/handoffs/inbox/new"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT2" > "$ROOT2/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT2" >> "$ROOT2/.swarmforge/roles.tsv"

CALL_LOG2="$ROOT2/tmux-calls.log"
BEFORE_STDOUT_FILE2="$ROOT2/before-stdout.txt"
AFTER_STDOUT_FILE2="$ROOT2/after-stdout.txt"
CAPTURE_COUNT_FILE2="$ROOT2/capture-count"
export CALL_LOG="$CALL_LOG2" BEFORE_STDOUT_FILE="$BEFORE_STDOUT_FILE2" AFTER_STDOUT_FILE="$AFTER_STDOUT_FILE2" CAPTURE_COUNT_FILE="$CAPTURE_COUNT_FILE2"

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "capture-pane" ]]; then
    count="$(cat "$CAPTURE_COUNT_FILE" 2>/dev/null || echo 0)"
    echo $((count + 1)) > "$CAPTURE_COUNT_FILE"
    if [[ "$count" == "0" ]]; then
      cat "$BEFORE_STDOUT_FILE" 2>/dev/null
    else
      cat "$AFTER_STDOUT_FILE" 2>/dev/null
    fi
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

DRAFT2="$ROOT2/draft.handoff"
cat > "$DRAFT2" <<'EOF'
type: note
to: coder
priority: 50
message: sync deliver busy skip test
EOF

cat > "$BEFORE_STDOUT_FILE2" <<'EOF'
● Running 1 shell command · 1m 20s…
· Generating… (5m 49s · ↓ 9.6k tokens)
❯ 
EOF
echo '❯ ' > "$AFTER_STDOUT_FILE2"

(
  cd "$ROOT2"
  export SWARMFORGE_ROLE=coordinator
  export SWARMFORGE_SKIP_DAEMON=1
  PATH="$FAKE_BIN:$PATH" bb "$SWARM_HANDOFF" "$DRAFT2"
) > "$ROOT2/out2.txt"

grep -q "HANDOFF DELIVERED:" "$ROOT2/out2.txt" || fail "02: expected HANDOFF DELIVERED output"
find "$CODER_WT2/.swarmforge/handoffs/inbox/new" -name '*_for_coder.handoff' -print -quit | grep -q . \
  || fail "02: parcel missing from coder inbox/new"
! grep -q -- '-l' "$CALL_LOG2" || fail "02: must not send wake literal while pane is busy"

pass "sync deliver skips tmux wake when resident pane is mid-turn"

rm -rf "$ROOT2"

echo "ALL PASS"
