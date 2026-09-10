#!/usr/bin/env bash
# BL-1494: a note carrying wake: defer must be delivered like any other
# note, but must produce zero tmux injections at the delivery hop, and the
# delivery must be logged deliver-notify-skip-deferred. An ordinary note
# (no wake header) is unaffected and still wakes its recipient exactly once.
#
# Covers acceptance scenarios BL-1494 deferred-note-no-wake-01/02/05. Modeled
# on test_handoffd_per_recipient_delivery.sh's own fixture: a fake tmux
# binary on PATH logs every real invocation instead of touching a live
# session, so "tmux injections are counted, not performed" (the feature's
# own Background line). A single wake sends the C-m/C-j submit pair
# (handoffd.bb's send-submit!) plus whatever agent_runtime_inject_lib.bb
# issues before it, so "one injection" is counted as one "send-keys ... C-m"
# line - the one call that happens exactly once per wake, never twice.
#
# Scenario 05 (the field is note-only) is a separate, lighter fixture at the
# bottom: a bare git repo + roles.tsv, no fake tmux needed since the draft
# is refused before ever reaching delivery.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

run_scenario() {
  local label="$1" wake_line="$2"

  local ROOT
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: intentional throwaway test root

  local DAEMON_PID=""
  cleanup() {
    [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
    rm -rf "$ROOT"
  }
  trap cleanup RETURN

  local SOCK="$ROOT/fake.sock"
  touch "$SOCK"
  mkdir -p "$ROOT/.swarmforge"
  echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" \
    > "$ROOT/.swarmforge/roles.tsv"
  printf 'cleaner\tmaster\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT" \
    >> "$ROOT/.swarmforge/roles.tsv"

  local CLEANER_INBOX_NEW="$ROOT/.swarmforge/handoffs/cleaner/inbox/new"
  local COORDINATOR_OUTBOX="$ROOT/.swarmforge/handoffs/coordinator/outbox"
  mkdir -p "$COORDINATOR_OUTBOX"

  {
    printf 'id: %s\n' "00_20260910T000001Z_000001_from_coordinator_to_cleaner"
    printf 'from: coordinator\nto: cleaner\npriority: 10\ntype: note\n'
    printf 'message: %s\n' "$label"
    [[ -n "$wake_line" ]] && printf '%s\n' "$wake_line"
    printf 'created_at: 2026-09-10T00:00:00Z\n\n%s\n' "$label"
  } > "$COORDINATOR_OUTBOX/00_20260910T000001Z_000001_from_coordinator_to_cleaner.handoff"

  # ── fake tmux so notify! succeeds without a real session, calls logged ──
  local FAKE_BIN="$ROOT/bin"
  mkdir -p "$FAKE_BIN"
  local NOTIFY_LOG="$ROOT/tmux-calls.log"
  export NOTIFY_LOG
  cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$NOTIFY_LOG"
exit 0
TMUX
  chmod +x "$FAKE_BIN/tmux"

  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
  DAEMON_PID=$!

  local remaining=1
  for _ in $(seq 1 40); do
    remaining="$(find "$COORDINATOR_OUTBOX" -maxdepth 1 -name '*.handoff' | wc -l | tr -d ' ')"
    [[ "$remaining" == "0" ]] && break
    sleep 0.25
  done
  mkdir -p "$ROOT/.swarmforge/daemon"
  touch "$ROOT/.swarmforge/daemon/stop"
  wait "$DAEMON_PID" 2>/dev/null || true
  [[ "$remaining" == "0" ]] || fail "$label: daemon did not drain the outbox (remaining: $remaining)"

  local COPIES
  COPIES="$(find "$CLEANER_INBOX_NEW" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$COPIES" == "1" ]] || fail "$label: expected exactly 1 delivered copy in cleaner's inbox/new, found $COPIES"

  local INJECTIONS=0
  [[ -f "$NOTIFY_LOG" ]] && INJECTIONS="$(grep -c 'send-keys .* C-m$' "$NOTIFY_LOG" || true)"

  local LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
  echo "$label injections=$INJECTIONS"

  if [[ -n "$wake_line" ]]; then
    [[ "$INJECTIONS" == "0" ]] \
      || fail "01: expected zero injections for a deferred note, got $INJECTIONS"
    grep -q "deliver-notify-skip-deferred" "$LOG_FILE" \
      || fail "01: expected the daemon log to name this delivery deliver-notify-skip-deferred"
    grep -q "^wake: defer\$" "$CLEANER_INBOX_NEW"/*.handoff \
      || fail "01: delivered copy lost its wake: defer header"
    pass "01: delivering a deferred note lands it in the inbox and injects nothing"
  else
    [[ "$INJECTIONS" == "1" ]] \
      || fail "02: expected exactly one injection for an ordinary note, got $INJECTIONS"
    pass "02: an ordinary note still wakes its role"
  fi
}

run_scenario "deferred-note" "wake: defer"
run_scenario "ordinary-note" ""

# ── 05: the field is note-only - a git_handoff draft carrying wake: defer
#         is refused as an unknown header, never accepted as a per-type
#         "not allowed" mismatch (feature scenario 05) ─────────────────────
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

scenario_05() {
  local ROOT
  ROOT="$(mktemp -d)"

  git -C "$ROOT" init -q
  git -C "$ROOT" config user.email "test@test"
  git -C "$ROOT" config user.name "test"
  echo x > "$ROOT/f.txt"
  git -C "$ROOT" add f.txt
  git -C "$ROOT" commit -q -m "seed"
  local COMMIT
  COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

  mkdir -p "$ROOT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent,inbox/in_process} \
           "$ROOT/.worktrees/coder/.swarmforge/handoffs/inbox/new"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"

  local DRAFT="$ROOT/draft.handoff"
  cat > "$DRAFT" <<EOF
type: git_handoff
to: coder
priority: 50
task: bl1494-scenario-05-probe
commit: $COMMIT
wake: defer
EOF

  local OUT STATUS
  OUT="$(cd "$ROOT" && SWARMFORGE_ROLE=coordinator SWARMFORGE_SKIP_DAEMON=1 bb "$SWARM_HANDOFF" "$DRAFT" 2>&1)" && STATUS=0 || STATUS=$?

  rm -rf "$ROOT"

  [[ "$STATUS" == "2" ]] || fail "05: expected exit 2 (HANDOFF INVALID) for a git_handoff carrying wake: defer, got $STATUS:\n$OUT"
  echo "$OUT" | grep -qE "Header 'wake' is refused as an unknown header" \
    || fail "05: expected the wake header refused as unknown, got:\n$OUT"
  pass "05: the field is note-only - a git_handoff draft carrying wake: defer is refused as an unknown header"
}

scenario_05
