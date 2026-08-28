#!/usr/bin/env bash
# BL-1192 acceptance driver: invokes the REAL swarm_handoff.sh (never a
# reimplementation) against a real git fixture, exercising the actual
# send-time gate wiring end to end - mirrors test_swarm_handoff_sync_deliver.sh's
# own fixture conventions (fake tmux, a real roles.tsv, real mailbox skeleton).
#
# Usage: bl1192TaskScopeGateCli.sh <sender-role> <task-ticket> <foreign-ticket|NONE> <mode: real|unresolvable|batch> [evidence-only]
# Prints one JSON line: {"exitCode":N,"delivered":bool,"stderr":"..."}

set -uo pipefail

SENDER="$1"
TASK_TICKET="$2"
FOREIGN_TICKET="$3"
MODE="$4"
EVIDENCE_ONLY="${5:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/swarmforge/scripts/swarm_handoff.bb"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" config commit.gpgsign false
git -C "$ROOT" commit -q --allow-empty -m seed

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

MASTER_WT="$ROOT"
CLEANER_WT="$ROOT/.worktrees/cleaner"
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} "$CLEANER_WT/.swarmforge/handoffs/inbox/new" "$CLEANER_WT/.swarmforge/handoffs/inbox/completed"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEANER_WT"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ROOT/.worktrees/architect"
  printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$ROOT/.worktrees/documenter"
} > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == "capture-pane" ]]; then
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

record_handoff() {
  # Mirrors salvage-lib's own archive shape closely enough for
  # latest-item-handoffs to find it: a "task:"/"commit:" header pair in a
  # completed-mailbox file.
  local task="$1" commit="$2"
  cat > "$CLEANER_WT/.swarmforge/handoffs/inbox/completed/00_$(date +%s%N)_from_coder_to_cleaner_for_cleaner.handoff" <<EOF
task: ${task}
commit: ${commit}
to: cleaner
from: coder
EOF
}

CITED_SHORT=""

if [[ "$MODE" == "unresolvable" ]]; then
  # The CITED commit is real and valid (so it clears swarm_handoff.bb's own
  # universal "commit resolves" precondition) - it is the task's LAST
  # HANDOFF record that is corrupted, so last-handoff-commit's own
  # rev-list boundary lookup fails, exercising task-scope-gate-lib's own
  # fail-open path specifically.
  mkdir -p "$ROOT/backlog/active"
  printf 'id: %s\n' "$TASK_TICKET" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: own ticket work"
  record_handoff "${TASK_TICKET}-fixture" "abcdef1234abcdef1234abcdef1234abcdef1234"
  CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
elif [[ "$MODE" == "abandoned" ]]; then
  # BL-1192 D2 (architect bounce round 2): exercises the abandoned_commits
  # override end to end via the REAL swarm_handoff.sh, not only the
  # isolated bb-lib fixture (task_scope_gate_lib_test_runner.bb's own
  # "abandoned base -> no findings" scenario) - mirrors that fixture's
  # exact shape: an earlier, ALREADY-LANDED commit on origin/main is itself
  # entangled with the foreign ticket (old history, irrelevant to the
  # current rebuild); a disconnected branch attempt is the entangled tip
  # QA bounced; the rebuild returns to origin/main and records that
  # disconnected attempt as abandoned. A correct override walks from
  # origin/main and never re-discovers the old landed entanglement; the
  # send must be ACCEPTED with no findings.
  mkdir -p "$ROOT/backlog/active"
  printf 'id: %s\n' "$TASK_TICKET" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
  printf 'id: %s\n' "$FOREIGN_TICKET" > "$ROOT/backlog/active/${FOREIGN_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: earlier landed work, entangled with ${FOREIGN_TICKET}"
  ORIGIN_SHA="$(git -C "$ROOT" rev-parse HEAD)"
  git -C "$ROOT" update-ref refs/remotes/origin/main "$ORIGIN_SHA"

  git -C "$ROOT" checkout -q --orphan disconnected
  git -C "$ROOT" commit -q --allow-empty -m disconnected-root
  mkdir -p "$ROOT/backlog/active"
  printf 'id: %s\n' "$TASK_TICKET" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
  printf 'id: %s\n' "$FOREIGN_TICKET" > "$ROOT/backlog/active/${FOREIGN_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: entangled attempt on a disconnected branch"
  ABANDONED_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
  ABANDONED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
  record_handoff "${TASK_TICKET}-fixture" "$ABANDONED_COMMIT"

  git -C "$ROOT" checkout -q main
  git -C "$ROOT" reset -q --hard "$ORIGIN_SHA"
  printf 'id: %s\nabandoned_commits:\n  - %s\n' "$TASK_TICKET" "$ABANDONED_SHORT" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: tip-pure rebuild off origin/main, records abandonment"
  CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
elif [[ "$MODE" == "batch" ]]; then
  mkdir -p "$ROOT/backlog/active" "$ROOT/backlog/evidence"
  printf 'id: %s\n' "$TASK_TICKET" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: coder's own first commit"
  FIRST_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
  record_handoff "${TASK_TICKET}-fixture" "$FIRST_COMMIT"

  printf 'id: %s\n' "$FOREIGN_TICKET" > "$ROOT/backlog/active/${FOREIGN_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${FOREIGN_TICKET}-fixture: unrelated sibling ticket in the same batch turn"

  printf 'notes\n' > "$ROOT/backlog/evidence/${TASK_TICKET}-cleaner-pass.md"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: cleaner pass evidence"
  CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
else
  # The commit the handoff will cite. If a foreign ticket is named, its own
  # backlog yaml is touched in the SAME commit, tagged for the task - the
  # exact BL-596/BL-780/BL-1174 shape.
  if [[ -n "$EVIDENCE_ONLY" ]]; then
    mkdir -p "$ROOT/backlog/evidence"
    printf 'notes\n' > "$ROOT/backlog/evidence/${TASK_TICKET}-cleaner-pass.md"
    git -C "$ROOT" add -A
    git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: own evidence only"
  else
    mkdir -p "$ROOT/backlog/active"
    printf 'id: %s\n' "$TASK_TICKET" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
    if [[ "$FOREIGN_TICKET" != "NONE" ]]; then
      printf 'id: %s\n' "$FOREIGN_TICKET" > "$ROOT/backlog/active/${FOREIGN_TICKET}-fixture.yaml"
    fi
    git -C "$ROOT" add -A
    git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: own ticket work${FOREIGN_TICKET:+, entangled with ${FOREIGN_TICKET}}"
  fi
  CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
fi

DRAFT="$ROOT/draft.txt"
cat > "$DRAFT" <<EOF
type: git_handoff
to: cleaner
priority: 50
task: ${TASK_TICKET}-fixture
commit: ${CITED_SHORT}
EOF

STDERR_FILE="$ROOT/stderr.txt"
(
  cd "$ROOT"
  PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="$SENDER" \
    bb "$SWARM_HANDOFF" "$DRAFT"
) >"$ROOT/stdout.txt" 2>"$STDERR_FILE"
EXIT_CODE=$?

DELIVERED=false
if [[ -n "$(find "$CLEANER_WT/.swarmforge/handoffs/inbox/new" -type f 2>/dev/null)" ]] \
   || [[ -n "$(find "$MASTER_WT/.swarmforge/handoffs/coordinator/outbox" -type f 2>/dev/null)" ]]; then
  DELIVERED=true
fi

STDERR_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$STDERR_FILE")"

printf '{"exitCode":%s,"delivered":%s,"stderr":%s}\n' "$EXIT_CODE" "$DELIVERED" "$STDERR_ESCAPED"
