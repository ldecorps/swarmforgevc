#!/usr/bin/env bash
# BL-1192 acceptance driver: invokes the REAL swarm_handoff.sh (never a
# reimplementation) against a real git fixture with a real origin/main
# ref, exercising the actual send-time gate wiring end to end - mirrors
# test_swarm_handoff_sync_deliver.sh's own fixture conventions (fake tmux,
# a real roles.tsv, real mailbox skeleton).
#
# Usage: bl1192TaskScopeGateCli.sh <sender-role> <task-ticket> <foreign-ticket|NONE> <origin: real|unreadable> [evidence-only]
# Prints one JSON line: {"exitCode":N,"delivered":bool,"stderr":"..."}

set -uo pipefail

SENDER="$1"
TASK_TICKET="$2"
FOREIGN_TICKET="$3"
ORIGIN_MODE="$4"
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
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} "$CLEANER_WT/.swarmforge/handoffs/inbox/new"
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

# The commit the handoff will cite. If a foreign ticket is named, its own
# backlog yaml is touched too - the exact BL-596/BL-780/BL-1174 shape.
if [[ -n "$EVIDENCE_ONLY" ]]; then
  mkdir -p "$ROOT/backlog/evidence"
  printf 'notes\n' > "$ROOT/backlog/evidence/${TASK_TICKET}-cleaner-pass.md"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: own evidence only"
else
  mkdir -p "$ROOT/backlog/active"
  printf 'id: %s\n' "$TASK_TICKET" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: own ticket work"
  if [[ "$FOREIGN_TICKET" != "NONE" ]]; then
    printf 'id: %s\n' "$FOREIGN_TICKET" > "$ROOT/backlog/active/${FOREIGN_TICKET}-fixture.yaml"
    git -C "$ROOT" add -A
    git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: entangled with ${FOREIGN_TICKET}"
  fi
fi

CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

if [[ "$ORIGIN_MODE" == "real" ]]; then
  git -C "$ROOT" update-ref refs/remotes/origin/main "$(git -C "$ROOT" rev-parse HEAD~1 2>/dev/null || git -C "$ROOT" rev-parse HEAD)"
fi
# ORIGIN_MODE == unreadable: no origin/main ref at all.

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
