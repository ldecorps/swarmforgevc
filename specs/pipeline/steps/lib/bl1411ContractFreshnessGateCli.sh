#!/usr/bin/env bash
# BL-1411 acceptance driver: invokes the REAL swarm_handoff.sh (never a
# reimplementation) against a real git fixture with TWO checkouts sharing
# one repo - the shared "master" root (where `main` lives and advances)
# and a separate `coder` worktree holding the sender's own branch, exactly
# the shape a real amendment-while-holding scenario needs (main must be
# able to move independently of the branch the parcel was built on).
# Mirrors bl1192TaskScopeGateCli.sh/bl1240UnregisteredTestGateCli.sh's own
# fixture conventions (fake tmux, a real roles.tsv, real mailbox skeleton).
#
# Usage: bl1411ContractFreshnessGateCli.sh <mode: unchanged|amended|own-header-rewrite|merged-first|path-absent>
# Prints one JSON line: {"exitCode":N,"delivered":bool,"stderr":"...","stdout":"..."}

set -uo pipefail

MODE="$1"
TASK_TICKET="BL-9001"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SWARM_HANDOFF="$REPO_ROOT/swarmforge/scripts/swarm_handoff.bb"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

g() { git -C "$ROOT" -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"; }

g init -q -b main

FEATURE_REL="specs/features/${TASK_TICKET}-fixture.feature"
mkdir -p "$ROOT/$(dirname "$FEATURE_REL")" "$ROOT/backlog/active"
printf 'id: %s\nacceptance: %s\n' "$TASK_TICKET" "$FEATURE_REL" \
  > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"

if [[ "$MODE" != "path-absent" ]]; then
  # path-absent's whole point: the ticket YAML lands on main declaring the
  # path, but main never creates the file at it - the sender creates it
  # THEMSELVES as part of their own first commit below, so the OTHER gate
  # that checks "does the declared path exist at the CITED commit"
  # (BL-761/BL-314's own acceptance-pointer check) is satisfied and this
  # scenario isolates THIS gate's "path absent on main" not-evaluated case
  # specifically, rather than tripping that earlier, different gate.
  cat > "$ROOT/$FEATURE_REL" <<'EOF'
Feature: fixture
  Scenario: one
    Given a
EOF
fi
g add -A
g commit -q -m "${TASK_TICKET}-fixture: base"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

MASTER_WT="$ROOT"
CODER_WT="$ROOT/.worktrees/coder"
CLEANER_WT="$ROOT/.worktrees/cleaner"
g worktree add -q -b sender "$CODER_WT" main
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} \
         "$CLEANER_WT/.swarmforge/handoffs/inbox/new" "$CLEANER_WT/.swarmforge/handoffs/inbox/completed"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEANER_WT"
} > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/tmux"
chmod +x "$FAKE_BIN/tmux"

gc() { git -C "$CODER_WT" -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"; }

# The sender's own work, on the "sender" branch, in the coder worktree.
printf 'sender work\n' > "$CODER_WT/sender-work.txt"
if [[ "$MODE" == "path-absent" ]]; then
  mkdir -p "$CODER_WT/$(dirname "$FEATURE_REL")"
  cat > "$CODER_WT/$FEATURE_REL" <<'EOF'
Feature: fixture
  Scenario: one
    Given a
EOF
fi
gc add -A
gc commit -q -m "${TASK_TICKET}-fixture: sender's own work"

case "$MODE" in
  unchanged|path-absent)
    : # main is never touched again after the sender branched.
    ;;
  amended)
    cat > "$ROOT/$FEATURE_REL" <<'EOF'
Feature: fixture
  Scenario: one
    Given a
  Scenario: two (amendment)
    Given b
EOF
    g add -- "$FEATURE_REL"
    g commit -q -m "amend ${TASK_TICKET} scenario"
    ;;
  own-header-rewrite)
    # The sender rewrites its OWN copy of the feature file - main is
    # untouched. This must never trip the gate (it never reads the parcel
    # tip at all, only main/origin-main against the sender's base).
    cat > "$CODER_WT/$FEATURE_REL" <<'EOF'
Feature: fixture (mutation-stamp header rewritten by the sender)
  Scenario: one
    Given a
EOF
    gc add -A
    gc commit -q -m "${TASK_TICKET}-fixture: sender's own header rewrite"
    ;;
  merged-first)
    cat > "$ROOT/$FEATURE_REL" <<'EOF'
Feature: fixture
  Scenario: one
    Given a
  Scenario: two (amendment)
    Given b
EOF
    g add -- "$FEATURE_REL"
    g commit -q -m "amend ${TASK_TICKET} scenario"
    gc merge -q main --no-edit
    ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac

CITED_SHORT="$(gc rev-parse --short=10 HEAD)"

DRAFT="$ROOT/draft.txt"
cat > "$DRAFT" <<EOF
type: git_handoff
to: cleaner
priority: 50
task: ${TASK_TICKET}-fixture
commit: ${CITED_SHORT}
EOF

# Same self-audit double-invocation handling as the sibling gate drivers
# (bl1192/bl1240): the FIRST valid call for a given draft fingerprint
# consumes the Article 2.3 challenge and never reaches the gate chain.
send_once() {
  (
    cd "$CODER_WT"
    PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="coder" bb "$SWARM_HANDOFF" "$DRAFT"
  ) >"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
}

send_once
EXIT_CODE=$?
if grep -q 'AUDIT_REQUIRED' "$ROOT/stdout.txt" "$ROOT/stderr.txt"; then
  send_once
  EXIT_CODE=$?
fi

DELIVERED=false
if [[ -n "$(find "$CLEANER_WT/.swarmforge/handoffs/inbox/new" -type f 2>/dev/null)" ]] \
   || [[ -n "$(find "$MASTER_WT/.swarmforge/handoffs/coordinator/outbox" -type f 2>/dev/null)" ]]; then
  DELIVERED=true
fi

STDERR_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$ROOT/stderr.txt")"
STDOUT_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$ROOT/stdout.txt")"
printf '{"exitCode":%s,"delivered":%s,"stderr":%s,"stdout":%s}\n' "$EXIT_CODE" "$DELIVERED" "$STDERR_ESCAPED" "$STDOUT_ESCAPED"
