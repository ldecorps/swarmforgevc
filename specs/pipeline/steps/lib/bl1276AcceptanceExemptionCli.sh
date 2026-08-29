#!/usr/bin/env bash
# BL-1276 acceptance driver: invokes the REAL swarm_handoff.bb against a real
# git fixture, so an acceptance or refusal observed here is the actual
# send-time gate - never a unit-level approximation of it. Mirrors
# bl1192TaskScopeGateCli.sh's own fixture conventions (fake tmux, a real
# roles.tsv, a real mailbox skeleton), because this ticket changes exactly one
# predicate inside the gate that driver already exercises.
#
# Usage: bl1276AcceptanceExemptionCli.sh <task-ticket> <declaration|NONE> <changed-path> <ticket-mode>
#   declaration: "acceptance: <path>" or "retires: <path>" or NONE - the
#                ticket's own declaration of a path belonging to another ticket
#   ticket-mode: landed          - the ticket is committed on main with the declared value
#                working-copy    - main carries the declared value; an UNCOMMITTED
#                                  working copy declares <changed-path> instead
#                unresolvable    - the ticket exists on no ref and in no working tree
#                landed-unmerged - the declaration is landed on main ONLY, and the
#                                  cited commit sits on a sender branch that has
#                                  never merged it (qa_e2e step 4)
# Prints one JSON line: {"exitCode":N,"delivered":bool,"stderr":"..."}

set -uo pipefail

TASK_TICKET="$1"
DECLARED="$2"
CHANGED_PATH="$3"
TICKET_MODE="$4"

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
} > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

write_ticket() {
  # $1 = "acceptance: <path>" | "retires: <path>" | NONE
  # Written in each field's REAL yaml shape - acceptance: a single scalar,
  # retires: a list - so the fixture exercises the accessor as it is actually
  # fed, not a normalised stand-in.
  local declaration="$1"
  local field="${declaration%%:*}"
  local value="${declaration#*: }"
  mkdir -p "$ROOT/backlog/active"
  {
    printf 'id: %s\n' "$TASK_TICKET"
    printf 'title: "fixture"\n'
    if [[ "$declaration" != "NONE" ]]; then
      if [[ "$field" == "retires" ]]; then
        printf 'retires:\n  - %s\n' "$value"
      else
        printf 'acceptance: %s\n' "$value"
      fi
    fi
    printf 'status: todo\n'
  } > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
}

# The ticket's landed declaration, committed on main BEFORE the cited commit,
# so the gate reads it from the ref exactly as it does in the live swarm.
if [[ "$TICKET_MODE" != "unresolvable" ]]; then
  write_ticket "$DECLARED"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "seed: land the ${TASK_TICKET} ticket"
fi

# qa_e2e step 4: the sender's branch never merges the landed declaration, so a
# gate reading the sender's own tree would see no declaration at all.
if [[ "$TICKET_MODE" == "landed-unmerged" ]]; then
  git -C "$ROOT" checkout -q -b sender-branch
  rm -f "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -q -m "sender branch: forked before the declaration landed"
fi

# The commit the handoff cites: tagged for the task, touching the path under
# test. Nothing else changes in it.
mkdir -p "$(dirname "$ROOT/$CHANGED_PATH")"
printf 'contents for %s\n' "$CHANGED_PATH" > "$ROOT/$CHANGED_PATH"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: work touching ${CHANGED_PATH}"
CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

# Scenario 02: the sender's UNCOMMITTED working copy claims a different
# contract than the one that landed. The gate must ignore it.
if [[ "$TICKET_MODE" == "working-copy" ]]; then
  write_ticket "acceptance: $CHANGED_PATH"
fi

# Scenario 03: no ticket anywhere - not on a ref, not in the working tree.
if [[ "$TICKET_MODE" == "unresolvable" ]]; then
  rm -f "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"
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
  PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="coder" \
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
