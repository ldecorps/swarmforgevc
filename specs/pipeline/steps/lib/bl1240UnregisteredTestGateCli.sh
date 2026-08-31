#!/usr/bin/env bash
# BL-1240 acceptance driver: invokes the REAL swarm_handoff.sh (never a
# reimplementation) against a real git fixture, so the refusal observed is the
# actual send path with the actual gate wired into it. Mirrors
# bl1192TaskScopeGateCli.sh's fixture conventions (fake tmux, a real
# roles.tsv, a real mailbox skeleton) - the same send path, a different gate.
#
# Scenario 04 needs no handoff at all: `validate` runs the REAL
# suite_inventory_cli.bb over a fixture tree, which is what "the manifest is
# validated" means.
#
# Usage: bl1240UnregisteredTestGateCli.sh <mode: unregistered|registered|clean|validate>
# Prints one JSON line: {"exitCode":N,"delivered":bool,"stderr":"...","stdout":"..."}

set -uo pipefail

MODE="$1"
TASK_TICKET="BL-9240"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SWARM_HANDOFF="$REPO_ROOT/swarmforge/scripts/swarm_handoff.bb"
INVENTORY_CLI="$REPO_ROOT/swarmforge/scripts/test/suite_inventory_cli.bb"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

TEST_DIR="$ROOT/swarmforge/scripts/test"
MANIFEST="$TEST_DIR/suite-manifest.tsv"
mkdir -p "$TEST_DIR"

# ── scenario 04: validation only, no parcel ───────────────────────────────
if [[ "$MODE" == "validate" ]]; then
  printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_DIR/test_bl9240_real.sh"
  {
    printf 'test_bl9240_real.sh\tstanding\t\t\n'
    # A row whose first column is a ticket id, not a file: it registers
    # nothing while looking like a registration - the shape that let
    # test_bl780_rotation_actionability_ordering.sh sit unregistered.
    printf 'BL-9240\tstanding\t\t\n'
  } > "$MANIFEST"
  bb "$INVENTORY_CLI" "$TEST_DIR" >"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
  EXIT_CODE=$?
  STDERR_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$ROOT/stderr.txt")"
  STDOUT_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$ROOT/stdout.txt")"
  printf '{"exitCode":%s,"delivered":false,"stderr":%s,"stdout":%s}\n' "$EXIT_CODE" "$STDERR_ESCAPED" "$STDOUT_ESCAPED"
  exit 0
fi

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" config commit.gpgsign false

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

MASTER_WT="$ROOT"
CLEANER_WT="$ROOT/.worktrees/cleaner"
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} \
         "$CLEANER_WT/.swarmforge/handoffs/inbox/new" "$CLEANER_WT/.swarmforge/handoffs/inbox/completed"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEANER_WT"
} > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/tmux"
chmod +x "$FAKE_BIN/tmux"

mkdir -p "$ROOT/backlog/active"
printf 'id: %s\n' "$TASK_TICKET" > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml"

# Someone ELSE's unregistered test file, already in the tree before this
# parcel exists. Scenario 03 turns on it: this parcel must not be refused for
# drift it did not create.
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_DIR/test_bl9999_someone_elses.sh"
printf 'test_bl9240_placeholder.sh\tstanding\t\t\n' > "$MANIFEST"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_DIR/test_bl9240_placeholder.sh"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "BL-9999-fixture: an earlier parcel leaves a test file unregistered"

case "$MODE" in
  unregistered)
    printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_DIR/test_bl9240_new.sh"
    ;;
  registered)
    printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_DIR/test_bl9240_new.sh"
    printf 'test_bl9240_new.sh\tstanding\t\t\n' >> "$MANIFEST"
    ;;
  clean)
    mkdir -p "$ROOT/docs/how-to"
    printf 'notes\n' > "$ROOT/docs/how-to/${TASK_TICKET}-a-doc.md"
    ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac

git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: this parcel's own work"
CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

DRAFT="$ROOT/draft.txt"
cat > "$DRAFT" <<EOF
type: git_handoff
to: cleaner
priority: 50
task: ${TASK_TICKET}-fixture
commit: ${CITED_SHORT}
EOF

# The self-audit challenge (Article 2.3) consumes the FIRST valid invocation
# of any given git_handoff draft: it prints AUDIT_REQUIRED / HANDOFF_NOT_QUEUED
# and returns before the send-path gate chain is reached, so a single call
# would never exercise the unregistered-test gate at all. A real agent answers
# the challenge by re-invoking with an identical draft, and that is what this
# driver does - the SECOND call is the one whose verdict is reported. If the
# challenge is not raised (nothing else in the chain refused first), the first
# call already carries the verdict and stands.
send_once() {
  (
    cd "$ROOT"
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
