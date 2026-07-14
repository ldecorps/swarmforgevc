#!/usr/bin/env bash
# Reproduces the bug: roles with pending inbox/new items after a session
# restart are never re-notified because the daemon only fires notify! during
# outbox delivery, not at startup.
#
# After the fix, running handoffd.bb with --startup-notify-only should:
# - scan each role's inbox/new/
# - call tmux send-keys for every role that has at least one pending item
# - exit immediately (no poll loop)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture ──────────────────────────────────────────────────────────────────
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"

mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

# Two roles: coder has a pending item; specifier has none.
CODER_WT="$ROOT/.worktrees/coder"
SPEC_WT="$ROOT"   # specifier uses master = project root

printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$SPEC_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"

mkdir -p "$CODER_WT/.swarmforge/handoffs/inbox/new"
printf 'type: git_handoff\nto: coder\npriority: 50\ntask: BL-020\n' \
  > "$CODER_WT/.swarmforge/handoffs/inbox/new/50_test_pending.handoff"

# specifier inbox/new is absent (no pending items)

# ── fake tmux that records send-keys calls ────────────────────────────────────
FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
NOTIFY_LOG="$ROOT/tmux-calls.log"
export NOTIFY_LOG

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$NOTIFY_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# ── run startup-notify-only ───────────────────────────────────────────────────
PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --startup-notify-only

# ── assertions ───────────────────────────────────────────────────────────────
[[ -f "$NOTIFY_LOG" ]] || fail "tmux was never called (no notify log)"

if grep -q "swarmforge-coder" "$NOTIFY_LOG"; then
  pass "coder was notified at startup"
else
  fail "coder was NOT notified (pending item ignored)"
fi

if grep -q "swarmforge-specifier" "$NOTIFY_LOG"; then
  fail "specifier was notified despite empty inbox"
else
  pass "specifier was not notified (correct: no pending items)"
fi
