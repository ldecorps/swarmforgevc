#!/usr/bin/env bash
# BL-2071 acceptance driver: invokes the REAL swarm_handoff.sh and the REAL
# local_seat_phase_cli.bb (never a reimplementation) against a real git
# fixture, so the refusal observed is the actual send/pass path with the
# actual gate wired into it. Mirrors bl1240UnregisteredTestGateCli.sh's
# fixture conventions (fake tmux, a real roles.tsv, a real mailbox
# skeleton) - the same send path, a different gate, plus the local-seat
# phase CLI's own `pass` subcommand (BL-2071 invariant 2's second caller).
#
# cli.js is SYMLINKED into the fixture (a single file, never the whole
# specs/ tree) rather than reimplemented there: the acceptance-running
# machinery (cli.js, generate.js, runnerAdapter.js, the real steps/index.js)
# is this checkout's own stable tool, never part of the fixture ticket's
# "project" - see local_seat_acceptance_gate_lib.bb's header. Node resolves
# a symlinked entry file's __dirname via realpath, so cli.js's own sibling
# requires (generate.js, runtime.js, the real steps/index.js) all resolve
# to THIS checkout regardless (confirmed empirically: a generated test's own
# `location:` field under a symlinked cli.js still names this checkout's
# real specs/pipeline/generated/, never the fixture root).
#
# The fixture ticket's acceptance: declaration must still be a PATH THAT
# EXISTS IN THE FIXTURE'S OWN GIT TREE AT THE CITED COMMIT - the EARLIER,
# unrelated acceptance-pointer gate (BL-880, armed at every PRE-QA
# git_handoff hop) runs `git cat-file -e <commit>:<path>` on it, which
# cannot walk INTO a symlinked directory (git stores a symlink as a leaf
# blob, never a tree) and refuses first if the declaration is an absolute
# host path. So the TWO fixture feature files are real, committed COPIES
# at specs/pipeline/test/fixtures/ inside the fixture root (never
# symlinked) - only cli.js itself is a symlink.
#
# Usage: bl2071LocalSeatAcceptanceGateCli.sh <action> <state> [markerA] [markerB]
#   action=send, state=pass|fail|no-handler|cloud
#     Builds the fixture, sends a git_handoff for BL-9071-fixture from a
#     local-model seat (state != cloud) or a cloud seat (state == cloud),
#     and reports the send's outcome.
#   action=phase-pass, state=fail
#     Builds the fixture (pass-pair feature, marker B set to fail) and runs
#     `local_seat_phase_cli.bb pass BL-9071` directly - no git_handoff at
#     all (BL-2071 scenario 02).
#   action=cell, state=local|cloud, markerA/markerB=pass|fail
#     The exhaustive-enumeration driver for the declared invariants' own
#     property tests (BL-654): the marker-pair feature with EXPLICIT marker
#     values, for either seat kind - every one of the 4 (markerA, markerB)
#     cells is reachable BY CONSTRUCTION, never by a random draw's luck
#     (BL-1062/BL-2083's own rule).
#   action=cell-phase-pass, markerA/markerB=pass|fail (state ignored)
#     Same explicit-marker fixture as `cell`, but runs
#     `local_seat_phase_cli.bb pass BL-9071` directly, local seat only (the
#     phase CLI has no cloud-seat concept) - invariant 2's second caller,
#     same cell.
# Prints one JSON line:
#   {"exitCode":N,"delivered":bool,"phase":"...","stdout":"...","stderr":"..."}

set -uo pipefail

ACTION="$1"
STATE="${2:-}"
MARKER_A_OVERRIDE="${3:-}"
MARKER_B_OVERRIDE="${4:-}"
TASK_TICKET="BL-9071"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SWARM_HANDOFF="$REPO_ROOT/swarmforge/scripts/swarm_handoff.bb"
PHASE_CLI="$REPO_ROOT/swarmforge/scripts/local_seat_phase_cli.bb"
PAIR_FEATURE="$REPO_ROOT/specs/pipeline/test/fixtures/bl2071-marker-pair.feature"
UNRESOLVED_FEATURE="$REPO_ROOT/specs/pipeline/test/fixtures/bl2071-unresolved-step.feature"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" config commit.gpgsign false

mkdir -p "$ROOT/specs/pipeline/test/fixtures"
ln -s "$REPO_ROOT/specs/pipeline/cli.js" "$ROOT/specs/pipeline/cli.js"
cp "$PAIR_FEATURE" "$ROOT/specs/pipeline/test/fixtures/bl2071-marker-pair.feature"
cp "$UNRESOLVED_FEATURE" "$ROOT/specs/pipeline/test/fixtures/bl2071-unresolved-step.feature"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

MASTER_WT="$ROOT"
CLEANER_WT="$ROOT/.worktrees/cleaner"
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent} \
         "$CLEANER_WT/.swarmforge/handoffs/inbox/new" "$CLEANER_WT/.swarmforge/handoffs/inbox/completed" \
         "$ROOT/.swarmforge/phase"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tlocal-model\ttask\n' "$ROOT"
  printf 'coder@2\tcoder2\t%s\tswarmforge-coder2\tCoder2\tclaude\ttask\n' "$ROOT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEANER_WT"
} > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/tmux"
chmod +x "$FAKE_BIN/tmux"

MARKERS="$ROOT/markers"
mkdir -p "$MARKERS"
if [[ "$ACTION" == "cell" || "$ACTION" == "cell-phase-pass" ]]; then
  echo "$MARKER_A_OVERRIDE" > "$MARKERS/A.txt"
  echo "$MARKER_B_OVERRIDE" > "$MARKERS/B.txt"
else
  echo pass > "$MARKERS/A.txt"
  case "$STATE" in
    pass) echo pass > "$MARKERS/B.txt" ;;
    fail|cloud) echo fail > "$MARKERS/B.txt" ;;
  esac
fi

mkdir -p "$ROOT/backlog/active"
if [[ "$STATE" == "no-handler" ]]; then
  ACCEPTANCE_PATH="specs/pipeline/test/fixtures/bl2071-unresolved-step.feature"
else
  ACCEPTANCE_PATH="specs/pipeline/test/fixtures/bl2071-marker-pair.feature"
fi
cat > "$ROOT/backlog/active/${TASK_TICKET}-fixture.yaml" <<EOF
id: ${TASK_TICKET}
title: fixture
acceptance: ${ACCEPTANCE_PATH}
EOF

git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "${TASK_TICKET}-fixture: this parcel's own work"
CITED_SHORT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

export SWARMFORGE_BL2071_FIXTURE_MARKER_DIR="$MARKERS"

if [[ "$ACTION" == "phase-pass" || "$ACTION" == "cell-phase-pass" ]]; then
  printf 'phase: assert\nfailed: 0\n' > "$ROOT/.swarmforge/phase/${TASK_TICKET}.md"
  (
    cd "$ROOT"
    SWARMFORGE_ROLE="coder" bb "$PHASE_CLI" pass "$TASK_TICKET"
  ) >"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
  EXIT_CODE=$?
  PHASE="$(grep '^phase:' "$ROOT/.swarmforge/phase/${TASK_TICKET}.md" | sed 's/phase: //')"
  STDERR_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$ROOT/stderr.txt")"
  STDOUT_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' < "$ROOT/stdout.txt")"
  printf '{"exitCode":%s,"delivered":false,"phase":"%s","stderr":%s,"stdout":%s}\n' \
    "$EXIT_CODE" "$PHASE" "$STDERR_ESCAPED" "$STDOUT_ESCAPED"
  exit 0
fi

DRAFT="$ROOT/draft.txt"
cat > "$DRAFT" <<EOF
type: git_handoff
to: cleaner
priority: 50
task: ${TASK_TICKET}-fixture
commit: ${CITED_SHORT}
EOF

SEAT="coder"
if [[ "$STATE" == "cloud" ]]; then
  SEAT="coder@2"
fi

# The self-audit challenge (Article 2.3) consumes the FIRST valid invocation
# of any given git_handoff draft - see bl1240UnregisteredTestGateCli.sh's own
# comment for the full rationale. The SECOND call is the one whose verdict is
# reported.
send_once() {
  (
    cd "$ROOT"
    PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="$SEAT" bb "$SWARM_HANDOFF" "$DRAFT"
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
printf '{"exitCode":%s,"delivered":%s,"phase":"","stderr":%s,"stdout":%s}\n' \
  "$EXIT_CODE" "$DELIVERED" "$STDERR_ESCAPED" "$STDOUT_ESCAPED"
