#!/usr/bin/env bash
# Mailbox-only: handoffd copies outbox → inbox/new without tmux send-keys.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

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

CODER_WT="$ROOT"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tmaster\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"

mkdir -p "$ROOT/.swarmforge/handoffs/"{outbox/tmp,sent,inbox/new}

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$CALL_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

DRAFT="$ROOT/draft.handoff"
cat > "$DRAFT" <<'EOF'
type: note
to: coder
priority: 50
message: mailbox only probe
EOF

(
  cd "$ROOT"
  export SWARMFORGE_ROLE=coordinator
  export SWARMFORGE_MAILBOX_ONLY=1
  export SWARMFORGE_SKIP_SYNC_INJECT=1
  unset SWARMFORGE_SKIP_DAEMON
  PATH="$FAKE_BIN:$PATH" bb "$SWARM_HANDOFF" "$DRAFT"
) | tee "$ROOT/out.txt"

grep -q "HANDOFF QUEUED (mailbox only" "$ROOT/out.txt" || fail "expected mailbox-only queue message"
outbox_count="$(find "$ROOT/.swarmforge/handoffs/outbox" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$outbox_count" -ge 1 ]] || fail "parcel must remain in outbox for daemon"

SWARMFORGE_MAILBOX_ONLY=1 PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --poll-once

find "$ROOT/.swarmforge/handoffs/inbox/new" -name '*_for_coder.handoff' -print -quit | grep -q . \
  || fail "parcel missing from coder inbox/new"
find "$ROOT/.swarmforge/handoffs/sent" -name '*.handoff' -print -quit | grep -q . \
  || fail "outbox parcel not archived to sent/"
! grep -q -- '-l' "$CALL_LOG" 2>/dev/null || fail "mailbox-only must not call tmux literal send-keys"
grep -q "delivered-mailbox-only" "$ROOT/.swarmforge/daemon/handoffd.log" || fail "daemon must log delivered-mailbox-only"

pass "mailbox-only delivery without tmux inject"
echo "ALL PASS"
