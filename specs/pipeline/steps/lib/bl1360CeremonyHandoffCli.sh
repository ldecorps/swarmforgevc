#!/usr/bin/env bash
# BL-1360 acceptance driver: invokes the REAL ceremony_handoff.sh - which in
# turn invokes the REAL swarm_handoff.sh - against a real git fixture, so what
# the scenarios observe is the actual send path with the actual composer
# wired into it, never the lib called in isolation. Fixture conventions follow
# bl1240UnregisteredTestGateCli.sh: a fake tmux on PATH, a real roles.tsv, a
# real mailbox skeleton, everything under one mktemp root.
#
# Modes:
#   merge-up | bookkeep   compose and SEND that ceremony; report where it landed
#   gate-refusal          a roles.tsv missing one merge-up recipient, so the
#                         send-time recipient validation refuses - the composer
#                         must pass that refusal through and deliver nothing
#   unknown               a ceremony name the composer does not define
#
# Prints one JSON line:
# {"exitCode":N,"delivered":bool,"recipients":[..],"priorities":[..],
#  "messages":[..],"dryRunDraft":"..","stdout":"..","stderr":"..."}

set -uo pipefail

MODE="${1:?usage: bl1360CeremonyHandoffCli.sh <merge-up|bookkeep|gate-refusal|unknown>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CEREMONY="$REPO_ROOT/swarmforge/scripts/ceremony_handoff.sh"

TICKET="BL-9360"
COMMIT="a1b2c3d4e5"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" config commit.gpgsign false

mkdir -p "$ROOT/.swarmforge"
touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"
mkdir -p "$ROOT/.swarmforge/handoffs/QA/outbox/tmp" "$ROOT/.swarmforge/handoffs/QA/sent"

# Every role the pipeline has a worktree for, plus the specifier - which must
# be present and reachable, so that "the specifier is not a recipient" is a
# statement about the ceremony's definition and not about a missing row.
ALL_ROLES=(coder cleaner architect hardender documenter coordinator specifier)
# gate-refusal drops one merge-up recipient from roles.tsv so the REAL
# send-time recipient validation refuses. Nothing about the composer changes.
if [[ "$MODE" == "gate-refusal" ]]; then
  KNOWN_ROLES=(coder cleaner architect documenter coordinator specifier)
else
  KNOWN_ROLES=("${ALL_ROLES[@]}")
fi

for role in "${ALL_ROLES[@]}"; do
  mkdir -p "$ROOT/.worktrees/$role/.swarmforge/handoffs/inbox/new"
done

{
  printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$ROOT/.worktrees/QA"
  for role in "${KNOWN_ROLES[@]}"; do
    printf '%s\t%s\t%s\tswarmforge-%s\t%s\tclaude\ttask\n' \
      "$role" "$role" "$ROOT/.worktrees/$role" "$role" "$role"
  done
} > "$ROOT/.swarmforge/roles.tsv"
mkdir -p "$ROOT/.worktrees/QA/.swarmforge/handoffs/inbox/new"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/tmux"
chmod +x "$FAKE_BIN/tmux"

mkdir -p "$ROOT/backlog/active"
printf 'id: %s\n' "$TICKET" > "$ROOT/backlog/active/${TICKET}-fixture.yaml"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "BL-9360-fixture: a swarm root a ceremony can be sent from"

case "$MODE" in
  merge-up|gate-refusal) NAME="merge-up" ;;
  bookkeep)              NAME="bookkeep" ;;
  unknown)               NAME="merge-sideways" ;;
  *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac

run_ceremony() {
  (
    cd "$ROOT"
    PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="QA" "$CEREMONY" "$@"
  )
}

# Composition is inspectable without sending: the dry run is captured first,
# and its own delivery (none) is asserted by the scenarios.
run_ceremony "$NAME" --ticket "$TICKET" --commit "$COMMIT" --dry-run \
  >"$ROOT/dry.txt" 2>"$ROOT/dry-err.txt"
DRY_FILES="$({ find "$ROOT/.worktrees" -path '*/inbox/new/*' -type f 2>/dev/null; \
                find "$ROOT/.worktrees/QA/.swarmforge/handoffs/outbox" -maxdepth 1 -type f 2>/dev/null; } | wc -l | tr -d ' ')"

run_ceremony "$NAME" --ticket "$TICKET" --commit "$COMMIT" \
  >"$ROOT/stdout.txt" 2>"$ROOT/stderr.txt"
EXIT_CODE=$?

# A ceremony reaches its recipients by one of two routes and the scenarios
# care about neither: a direct write into each recipient's inbox, or - when
# the daemon owns the fan-out - one queued parcel in the sender's outbox whose
# `to:` header carries the whole list. Both are counted, so "every worktree
# role is a recipient" is a claim about the ceremony rather than about which
# transport happened to be up.
DELIVERED=()
while IFS= read -r f; do
  [[ -n "$f" ]] && DELIVERED+=("$f")
done < <({ find "$ROOT/.worktrees" -path '*/inbox/new/*' -type f 2>/dev/null; \
           find "$ROOT/.worktrees/QA/.swarmforge/handoffs/outbox" -maxdepth 1 -type f 2>/dev/null; } | sort)

json_string() { bb -e '(println (cheshire.core/generate-string (slurp *in*)))'; }
json_lines() {
  # each argument is a line; emitted as a JSON array of strings
  if [[ $# -eq 0 ]]; then printf '[]'; return; fi
  printf '%s\n' "$@" | bb -e '(println (cheshire.core/generate-string (vec (remove empty? (clojure.string/split-lines (slurp *in*)))))) '
}

RECIPIENTS=()
PRIORITIES=()
MESSAGES=()
for f in ${DELIVERED[@]+"${DELIVERED[@]}"}; do
  ONE="$(sed -n 's/^recipient: //p' "$f" | head -1)"
  if [[ -n "$ONE" ]]; then
    RECIPIENTS+=("$ONE")
  else
    # a queued broadcast: the recipients are the `to:` list
    while IFS= read -r r; do
      [[ -n "$r" ]] && RECIPIENTS+=("$r")
    done < <(sed -n 's/^to: //p' "$f" | head -1 | tr ',' '\n')
  fi
  PRIORITIES+=("$(basename "$f" | cut -d_ -f1)")
  MESSAGES+=("$(sed -n 's/^message: //p' "$f" | head -1)")
done

DELIVERED_JSON=false
[[ ${#DELIVERED[@]} -gt 0 ]] && DELIVERED_JSON=true

# The ticket and commit are emitted rather than mirrored in the step handler:
# one definition of the fixture facts, so "names the ticket in full" cannot
# quietly assert a different id than the one that was sent.
printf '{"exitCode":%s,"ticket":"%s","commit":"%s","delivered":%s,"dryRunDelivered":%s,"recipients":%s,"priorities":%s,"messages":%s,"dryRunDraft":%s,"stdout":%s,"stderr":%s}\n' \
  "$EXIT_CODE" "$TICKET" "$COMMIT" \
  "$DELIVERED_JSON" \
  "$DRY_FILES" \
  "$(json_lines ${RECIPIENTS[@]+"${RECIPIENTS[@]}"})" \
  "$(json_lines ${PRIORITIES[@]+"${PRIORITIES[@]}"})" \
  "$(json_lines ${MESSAGES[@]+"${MESSAGES[@]}"})" \
  "$(json_string < "$ROOT/dry.txt")" \
  "$(json_string < "$ROOT/stdout.txt")" \
  "$(cat "$ROOT/stderr.txt" "$ROOT/dry-err.txt" | json_string)"
