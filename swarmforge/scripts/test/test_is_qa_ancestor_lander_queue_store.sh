#!/usr/bin/env bash
# BL-1872 / hotfix 2026-10-02: under BL-1871 parcel lines QA's branch moves
# onto each parcel's own line, so a parcel QA approved earlier stops being
# an ancestor of swarmforge-QA. Every lander land's replay then named a
# source the predicate could not approve, the master-main reconcile merge
# was refused by check_pipeline_code_on_main.sh, and main sat 26 commits
# ahead and 11 behind origin/main for three hours.
#
# lander_queue.bb writes QA's approved commit into
# .swarmforge/lander/queue/<id>.edn, and QA removes the entry to retract.
# Those commits are QA's approved tips beside swarmforge-QA. The rows that
# matter:
#   - a queued commit, its ancestors, and a replay whose source it is read
#     approved;
#   - approval does not spread past the queued tips;
#   - a bounce verdict still vetoes;
#   - an entry with no commit grants nothing.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREDICATE="$SCRIPT_DIR/../is_qa_ancestor.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
g() { git -C "$ROOT" -c user.email=t@t -c user.name=t "$@"; }

g init -q -b main
[[ "$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)" && pwd -P)" == "$(cd "$ROOT" && pwd -P)/.git" ]] \
  || { note "FAIL - fixture root is not its own repository"; exit 1; }
g commit -q --allow-empty -m seed
mk_commit() { # <file> <subject> -> echoes the sha
  mkdir -p "$ROOT/specs/pipeline/steps"
  printf '%s\n' "$2" > "$ROOT/specs/pipeline/steps/$1"
  g add -A
  g commit -q -m "$2"
  g rev-parse HEAD
}
BASE="$(g rev-parse HEAD)"

# QA's ref has moved on to another parcel's line.
g checkout -q -b swarmforge-QA "$BASE"
mk_commit other.js 'BL-2: another parcel QA now holds' >/dev/null

# The parcel QA approved and queued, on its own line.
g checkout -q --detach "$BASE"
PARCEL_WORK="$(mk_commit work.js 'BL-1: the parcel work')"
QUEUED="$(mk_commit qa.js 'BL-1: QA review pass evidence (NONE)')"
# A later commit on the same line that QA never queued.
AFTER_QUEUE="$(mk_commit after.js 'BL-1: a commit after the queued tip')"

# A queued tip that QA had bounced.
g checkout -q --detach "$BASE"
BOUNCED_QUEUED="$(mk_commit bounced.js 'BL-3: parcel QA bounced')"

# Unrelated pipeline code, queued by nobody.
g checkout -q --detach "$BASE"
UNRELATED="$(mk_commit unrelated.js 'pipeline code belonging to no approved parcel')"

# The lander's replay of the queued parcel onto main.
g checkout -q main
REPLAY="$(mk_commit replay.js 'BL-1: tip-pure replay onto origin/main')"

QUEUE="$ROOT/.swarmforge/lander/queue"
mkdir -p "$QUEUE"
printf '{:id "BL-1-%s", :task "BL-1", :commit "%s", :issue nil, :status :landed}\n' "${QUEUED:0:10}" "$QUEUED" > "$QUEUE/BL-1-${QUEUED:0:10}.edn"
printf '{:id "BL-3-%s", :task "BL-3", :commit "%s", :issue nil, :status :queued}\n' "${BOUNCED_QUEUED:0:10}" "$BOUNCED_QUEUED" > "$QUEUE/BL-3-${BOUNCED_QUEUED:0:10}.edn"
printf '{:id "BL-4-broken", :task "BL-4", :status :queued}\n' > "$QUEUE/BL-4-broken.edn"

mkdir -p "$ROOT/.swarmforge/land-approvals"
printf '{"at":"2026-10-02T00:00:00Z","ticket":"BL-1","commit":"%s","source":"%s"}\n' "${REPLAY:0:10}" "${QUEUED:0:10}" \
  > "$ROOT/.swarmforge/land-approvals/2026-10.jsonl"
mkdir -p "$ROOT/.swarmforge/bounces"
printf '{"at":"2026-10-02T00:01:00Z","by":"QA","commit":"%s","evidence":"x"}\n' "${BOUNCED_QUEUED:0:10}" \
  > "$ROOT/.swarmforge/bounces/2026-10.jsonl"

run_predicate() { # <sha> -> sets OUT and EXIT_CODE
  set +e
  OUT="$(cd "$ROOT" && bash "$PREDICATE" "$1" 2>&1)"
  EXIT_CODE=$?
  set -e
}

run_predicate "$QUEUED"
check "a commit QA queued for the lander is approved though swarmforge-QA moved on" '[[ $EXIT_CODE -eq 0 ]]'
check "the approval names the lander queue" '[[ "$OUT" == *"lander"* ]]'

run_predicate "$PARCEL_WORK"
check "an ancestor of a queued commit is approved" '[[ $EXIT_CODE -eq 0 ]]'

run_predicate "$REPLAY"
check "the lander replay whose source is a queued commit is approved" '[[ $EXIT_CODE -eq 0 ]]'

run_predicate "$AFTER_QUEUE"
check "a commit after the queued tip on the same line is NOT approved" '[[ $EXIT_CODE -eq 1 ]]'

run_predicate "$UNRELATED"
check "pipeline code queued by nobody is NOT approved" '[[ $EXIT_CODE -eq 1 ]]'

run_predicate "$BOUNCED_QUEUED"
check "a queued commit with a bounce verdict on file is NOT approved" '[[ $EXIT_CODE -eq 1 ]]'
check "the refusal names the bounce" '[[ "$OUT" == *"bounced:"* ]]'

# Retracting is removing the entry: the same commit reads unapproved again.
rm -f "$QUEUE/BL-1-${QUEUED:0:10}.edn"
run_predicate "$QUEUED"
check "a retracted (unqueued) commit is NOT approved" '[[ $EXIT_CODE -eq 1 ]]'

# Batch mode answers the same way.
printf '{:id "BL-1-%s", :task "BL-1", :commit "%s", :issue nil, :status :landed}\n' "${QUEUED:0:10}" "$QUEUED" > "$QUEUE/BL-1-${QUEUED:0:10}.edn"
set +e
BATCH="$(cd "$ROOT" && bash "$PREDICATE" --batch "$QUEUED" "$UNRELATED" 2>/dev/null)"
set -e
check "batch mode approves the queued commit and refuses the unrelated one" \
  '[[ "$BATCH" == "$QUEUED 0"$'"'"'\n'"'"'"$UNRELATED 1" ]]'

if [[ $fail -ne 0 ]]; then
  note "test_is_qa_ancestor_lander_queue_store.sh: FAILED"
  exit 1
fi
note "test_is_qa_ancestor_lander_queue_store.sh: ALL PASS"
