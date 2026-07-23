#!/usr/bin/env bash
# BL-231: the one genuine end-to-end proof that compliance_battery.bb's
# scripted checks correctly interpret REAL helper-script side effects (not
# just hand-built fixtures, which compliance_battery_test_runner.bb already
# covers exhaustively). Drives the real swarm_handoff.bb (sync deliver,
# fake tmux - mirrors test_swarm_handoff_sync_deliver.sh's own proven
# fixture), ready_for_next.bb, done_with_current.bb, gherkin_lint_gate.sh,
# and run_acceptance.sh against real fixtures in a scratch root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BATTERY="$SCRIPT_DIR/../compliance_battery.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"
READY_FOR_NEXT="$SCRIPT_DIR/../ready_for_next.bb"
DONE_WITH_CURRENT="$SCRIPT_DIR/../done_with_current.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" commit -q --allow-empty -m init

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

MASTER_WT="$ROOT"
CODER_WT="$ROOT/.worktrees/coder"
mkdir -p "$MASTER_WT/.swarmforge/handoffs/specifier/"{outbox/tmp,sent} "$CODER_WT/.swarmforge/handoffs/inbox/new"
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\toff\n' "$MASTER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\toff\n' "$CODER_WT" >> "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
STDOUT_FILE="$ROOT/pane-stdout.txt"
export CALL_LOG STDOUT_FILE
echo '❯ ' > "$STDOUT_FILE"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "capture-pane" ]]; then
    cat "$STDOUT_FILE" 2>/dev/null
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# ── send-handoff: compliant path (real swarm_handoff.sh sync delivery) ───
DRAFT="$ROOT/draft.handoff"
cat > "$DRAFT" <<'EOF'
type: note
to: coder
priority: 50
message: compliance battery test parcel
EOF

(
  cd "$MASTER_WT"
  export SWARMFORGE_ROLE=specifier
  export SWARMFORGE_SKIP_DAEMON=1
  PATH="$FAKE_BIN:$PATH" bb "$SWARM_HANDOFF" "$DRAFT"
) >/dev/null

RESULT="$(bb "$BATTERY" check send-handoff "$ROOT" specifier coder)"
echo "$RESULT" | grep -q '"status":"pass"' \
  || fail "send-handoff (compliant): expected pass, got: $RESULT"
pass "send-handoff: a real swarm_handoff.sh sync delivery is recorded pass"

# ── send-handoff: violating path (direct inbox/new write) ───────────────
CLEANER_WT="$ROOT/.worktrees/cleaner"
mkdir -p "$CLEANER_WT/.swarmforge/handoffs/inbox/new"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\ttask\toff\n' "$CLEANER_WT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'id: bypass\nfrom: coder\nto: cleaner\npriority: 50\ntype: note\nmessage: direct write, bypassing swarm_handoff.sh\ncreated_at: 2026-07-10T00:00:00Z\n\nbypass\n' \
  > "$CLEANER_WT/.swarmforge/handoffs/inbox/new/50_bypass_for_cleaner.handoff"

RESULT="$(bb "$BATTERY" check send-handoff "$ROOT" coder cleaner)"
echo "$RESULT" | grep -q '"status":"fail"' \
  || fail "send-handoff (violating): expected fail, got: $RESULT"
echo "$RESULT" | grep -q "bypassed swarm_handoff.sh" \
  || fail "send-handoff (violating): expected a reason naming the bypass, got: $RESULT"
pass "send-handoff: a direct inbox/new write (no swarm_handoff.sh) is recorded fail with a reason"

# ── receive / complete: real ready_for_next.sh + done_with_current.sh ───
TASK_INBOX="$CODER_WT/.swarmforge/handoffs/inbox/new"
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
printf 'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-231-battery-test\ncommit: %s\n\npayload\n' "$COMMIT" \
  > "$TASK_INBOX/50_task1.handoff"

(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_FOR_NEXT" >/dev/null)

RESULT="$(bb "$BATTERY" check receive "$CODER_WT")"
echo "$RESULT" | grep -q '"status":"pass"' \
  || fail "receive: expected pass after a real ready_for_next.sh dequeue, got: $RESULT"
pass "receive: a real ready_for_next.sh dequeue (dequeued_at stamped) is recorded pass"

(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$DONE_WITH_CURRENT" >/dev/null)

RESULT="$(bb "$BATTERY" check complete "$CODER_WT")"
echo "$RESULT" | grep -q '"status":"pass"' \
  || fail "complete: expected pass after a real done_with_current.sh completion, got: $RESULT"
pass "complete: a real done_with_current.sh completion (completed_at stamped) is recorded pass"

# ── gate specifier: real gherkin_lint_gate.sh against a real feature file ─
RESULT="$(bb "$BATTERY" gate specifier "$REPO_ROOT/specs/features/BL-226-remove-dead-promote-in-ready-for-next.feature" "$REPO_ROOT")"
echo "$RESULT" | grep -q '"status":"pass"' \
  || fail "gate specifier (clean feature file): expected pass, got: $RESULT"
pass "gate specifier: a real, lint-clean feature file is recorded pass"

BAD_FEATURE="$ROOT/bad.feature"
printf 'this is not valid gherkin at all {{{\n' > "$BAD_FEATURE"
RESULT="$(bb "$BATTERY" gate specifier "$BAD_FEATURE" "$REPO_ROOT")"
echo "$RESULT" | grep -q '"status":"fail"' \
  || fail "gate specifier (malformed feature file): expected fail, got: $RESULT"
pass "gate specifier: a malformed feature file is recorded fail"

# ── gate qa: real run_acceptance.sh against a real, passing feature ─────
RESULT="$(bb "$BATTERY" gate qa "$REPO_ROOT" "$REPO_ROOT/specs/features/BL-226-remove-dead-promote-in-ready-for-next.feature" approve)"
echo "$RESULT" | grep -q '"status":"pass"' \
  || fail "gate qa (correct approve verdict): expected pass, got: $RESULT"
pass "gate qa: claiming approve for a real, passing acceptance run is recorded pass"

RESULT="$(bb "$BATTERY" gate qa "$REPO_ROOT" "$REPO_ROOT/specs/features/BL-226-remove-dead-promote-in-ready-for-next.feature" reject)"
echo "$RESULT" | grep -q '"status":"fail"' \
  || fail "gate qa (wrong reject verdict on a passing run): expected fail, got: $RESULT"
pass "gate qa: claiming reject for a real, passing acceptance run is recorded fail (wrong verdict)"

echo "ALL PASS"
