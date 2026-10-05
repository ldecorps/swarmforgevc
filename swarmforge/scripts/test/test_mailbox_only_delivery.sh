#!/usr/bin/env bash
# Mailbox-only: handoffd copies outbox → inbox/new without tmux send-keys.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
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

# BL-128: coordinator and coder are both master-resident here, so each gets
# its own <role> mailbox subdirectory rather than one shared tree.
mkdir -p "$ROOT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} \
         "$ROOT/.swarmforge/handoffs/coder/inbox/new"

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
outbox_count="$(find "$ROOT/.swarmforge/handoffs/coordinator/outbox" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$outbox_count" -ge 1 ]] || fail "parcel must remain in outbox for daemon"

SWARMFORGE_MAILBOX_ONLY=1 PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --poll-once

find "$ROOT/.swarmforge/handoffs/coder/inbox/new" -name '*_for_coder.handoff' -print -quit | grep . >/dev/null \
  || fail "parcel missing from coder inbox/new"
find "$ROOT/.swarmforge/handoffs/coordinator/sent" -name '*.handoff' -print -quit | grep . >/dev/null \
  || fail "outbox parcel not archived to sent/"
! grep -q -- '-l' "$CALL_LOG" 2>/dev/null || fail "mailbox-only must not call tmux literal send-keys"
grep -q "delivered-mailbox-only" "$ROOT/.swarmforge/daemon/handoffd.log" || fail "daemon must log delivered-mailbox-only"

pass "mailbox-only delivery without tmux inject"

# 2026-10-05: a recipient written in the wrong case is sent under the
# roster's spelling (the iq3 coder kept drafting `to: qa`); an unknown one is
# still refused.
printf 'QA\tmaster\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
mkdir -p "$ROOT/.swarmforge/handoffs/QA/inbox/new"
cat > "$DRAFT" <<'EOF'
type: note
to: qa
priority: 50
message: case probe
EOF
(
  cd "$ROOT"
  export SWARMFORGE_ROLE=coordinator SWARMFORGE_MAILBOX_ONLY=1 SWARMFORGE_SKIP_SYNC_INJECT=1
  PATH="$FAKE_BIN:$PATH" bb "$SWARM_HANDOFF" "$DRAFT"
) > "$ROOT/out-case.txt" 2>&1 || fail "a lowercase recipient was refused: $(cat "$ROOT/out-case.txt")"
grep -q "HANDOFF QUEUED" "$ROOT/out-case.txt" || fail "a lowercase recipient was not queued: $(cat "$ROOT/out-case.txt")"
case_parcel="$(grep -l "^message: case probe" "$ROOT/.swarmforge/handoffs/coordinator/outbox/"*.handoff)"
grep -qx "to: QA" "$case_parcel" || fail "the queued parcel does not name the roster's spelling QA: $(cat "$case_parcel")"
pass "a recipient in the wrong case is queued under the roster's spelling"

cat > "$DRAFT" <<'EOF'
type: note
to: nobody
priority: 50
message: unknown probe
EOF
rc=0
(
  cd "$ROOT"
  export SWARMFORGE_ROLE=coordinator SWARMFORGE_MAILBOX_ONLY=1 SWARMFORGE_SKIP_SYNC_INJECT=1
  PATH="$FAKE_BIN:$PATH" bb "$SWARM_HANDOFF" "$DRAFT"
) > "$ROOT/out-unknown.txt" 2>&1 || rc=$?
[[ $rc -ne 0 ]] && grep -q "Unknown recipient role 'nobody'" "$ROOT/out-unknown.txt" \
  || fail "an unknown recipient was not refused: $(cat "$ROOT/out-unknown.txt")"
pass "an unknown recipient is still refused"
echo "ALL PASS"
