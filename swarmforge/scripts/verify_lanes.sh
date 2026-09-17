#!/usr/bin/env bash
# BL-1618: one script holds the per-role verification lane table, prints
# the plan for a role, and runs exactly that plan sequentially - the
# mechanism behind the "each role has to be more careful about which tests
# to run" directive (2026-09-17), replacing five prompts' own prose lane
# sets with one place that cannot drift from what actually runs.
#
# Usage:
#   verify_lanes.sh [role] [--plan]
#   verify_lanes.sh --plan              # role from $SWARMFORGE_ROLE
#   verify_lanes.sh cleaner --plan       # print cleaner's plan, run nothing
#   verify_lanes.sh cleaner              # run cleaner's plan
#
# role defaults to $SWARMFORGE_ROLE; an @-seat (coder@2) maps to its stage
# (coder). An unknown role/stage is REFUSED (exit 2), never run-everything.
#
# Lane table (FIRM, human ruling A, 2026-09-17):
#   coder                       - compile, unit, properties, acceptance-own
#   cleaner/architect/documenter - compile,
#                                  unit only if the parcel's own commits
#                                    (since the received commit, or
#                                    origin/main with none) touch
#                                    extension/src or extension/test,
#                                  properties only if they touch a
#                                    *.property.test.js file,
#                                  acceptance-own
#   hardender                   - compile, unit, mutation, acceptance-own
#   QA                          - compile, unit, changed-path, properties,
#                                  acceptance-own
#
# The plan is printed byte-for-byte as the sequence executed (invariant 1) -
# PLAN and RUN share the one `plan_for_role` function, never two lists.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXTENSION_DIR="$ROOT/extension"

# ── argument parsing ────────────────────────────────────────────────────
PLAN_ONLY=0
ROLE_ARG=""
for arg in "$@"; do
  if [[ "$arg" == "--plan" ]]; then
    PLAN_ONLY=1
  elif [[ -z "$ROLE_ARG" ]]; then
    ROLE_ARG="$arg"
  fi
done

RAW_ROLE="${ROLE_ARG:-${SWARMFORGE_ROLE:-}}"
if [[ -z "$RAW_ROLE" ]]; then
  echo "verify_lanes: no role given and SWARMFORGE_ROLE is unset" >&2
  exit 2
fi
# BL-982: an @-seat (coder@2) names the STAGE it belongs to, never a
# distinct lane set of its own.
STAGE="${RAW_ROLE%%@*}"

case "$STAGE" in
  coder|cleaner|architect|hardender|documenter|QA) ;;
  *)
    echo "verify_lanes: unknown role '${RAW_ROLE}' (stage '${STAGE}') - refusing rather than running everything" >&2
    exit 2
    ;;
esac

# ── changed-path facts (cleaner/architect/documenter's conditional lanes) ─
# Reuses review_forward_evidence_gate_lib.bb's own received-commit-for-task
# (BL-806, BL-1612's batch fix) - the SAME resolution the send-time gates
# use, never a second "what did this role receive" reader. The current
# in_process parcel's own task names which ticket to ask about; no parcel
# (a note, or nothing at all) falls back to origin/main, same as the
# ticket's own direction.
current_in_process_task() {
  local inbox f
  inbox="$(bb "$SCRIPT_DIR/mailbox_dir.bb" "$ROOT" "$STAGE" in_process 2>/dev/null || true)"
  [[ -n "$inbox" && -d "$inbox" ]] || return 0
  f="$(find "$inbox" -name '*.handoff' -type f 2>/dev/null | sort | tail -1)"
  [[ -n "$f" ]] || return 0
  grep -E '^task:' "$f" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '\r'
}

received_commit_for_task() {
  local task="$1"
  [[ -n "$task" ]] || return 0
  bb -e "(load-file \"$SCRIPT_DIR/review_forward_evidence_gate_lib.bb\")
(println (or (review-forward-evidence-gate-lib/received-commit-for-task \"$ROOT\" \"$STAGE\" \"$task\") \"\"))" 2>/dev/null || true
}

CURRENT_TASK="$(current_in_process_task || true)"
RECEIVED_COMMIT="$(received_commit_for_task "$CURRENT_TASK" || true)"
DIFF_BASE="${RECEIVED_COMMIT:-origin/main}"

CHANGED_PATHS="$(git -C "$ROOT" diff --name-only "$DIFF_BASE"...HEAD 2>/dev/null || true)"

touches_extension_code() {
  printf '%s\n' "$CHANGED_PATHS" | grep -qE '^extension/(src|test)/'
}

touches_property_test() {
  printf '%s\n' "$CHANGED_PATHS" | grep -qE '\.property\.test\.js$'
}

# ── the ticket's own single acceptance feature file ─────────────────────
ticket_yaml_for_task() {
  local task="$1" id
  [[ -n "$task" ]] || return 0
  id="$(printf '%s' "$task" | grep -oE '^[A-Za-z]+-[0-9]+' | head -1)"
  [[ -n "$id" ]] || return 0
  find "$ROOT/backlog/active" "$ROOT/backlog/paused" -maxdepth 1 -iname "${id}-*.yaml" -type f 2>/dev/null | head -1
}

acceptance_feature_for_task() {
  local yaml
  yaml="$(ticket_yaml_for_task "$1" || true)"
  [[ -n "$yaml" ]] || return 0
  grep -E '^acceptance:' "$yaml" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '\r'
}

ACCEPTANCE_FEATURE="$(acceptance_feature_for_task "$CURRENT_TASK" || true)"

# ── the one lane table (PLAN and RUN share this - invariant 1) ──────────
plan_for_role() {
  local stage="$1"
  case "$stage" in
    coder)
      printf 'compile\nunit\nproperties\nacceptance-own\n'
      ;;
    cleaner|architect|documenter)
      printf 'compile\n'
      touches_extension_code && printf 'unit\n'
      touches_property_test && printf 'properties\n'
      printf 'acceptance-own\n'
      ;;
    hardender)
      printf 'compile\nunit\nmutation\nacceptance-own\n'
      ;;
    QA)
      printf 'compile\nunit\nchanged-path\nproperties\nacceptance-own\n'
      ;;
  esac
}

# ── lane -> command ───────────────────────────────────────────────────────
run_acceptance_cmd() {
  if command -v run_acceptance.sh >/dev/null 2>&1; then
    printf 'run_acceptance.sh\n'
  else
    printf '%s\n' "$ROOT/specs/pipeline/scripts/run_acceptance.sh"
  fi
}

run_lane() {
  local lane="$1"
  case "$lane" in
    compile)
      (cd "$EXTENSION_DIR" && npm run compile)
      ;;
    unit)
      (cd "$EXTENSION_DIR" && npm test)
      ;;
    properties)
      (cd "$EXTENSION_DIR" && npm run test:properties)
      ;;
    mutation)
      (cd "$EXTENSION_DIR" && npm run mutation)
      ;;
    changed-path)
      # Article 4.5: no dedicated automated selector exists yet (day-one
      # tooling is manifest grep + judgment) - this lane surfaces the
      # production paths changed so QA applies the gate's own manual
      # process; it never picks or runs a specific test itself, and never
      # fails on its own (BL-1618 constraints: no change to Article 4.5).
      local changed
      changed="$(printf '%s\n' "$CHANGED_PATHS" | grep -vE '^(docs/|backlog/|.*/generated/)' || true)"
      if [[ -n "$changed" ]]; then
        echo "changed-path (Article 4.5) - production paths changed since ${DIFF_BASE}:"
        printf '%s\n' "$changed" | sed 's/^/  /'
      else
        echo "changed-path (Article 4.5) - no production path changed since ${DIFF_BASE}"
      fi
      ;;
    acceptance-own)
      if [[ -z "$ACCEPTANCE_FEATURE" ]]; then
        echo "verify_lanes: acceptance-own - no acceptance: feature found for task '${CURRENT_TASK}' - skipping" >&2
      else
        "$(run_acceptance_cmd)" "$ACCEPTANCE_FEATURE"
      fi
      ;;
    *)
      echo "verify_lanes: unknown lane '${lane}'" >&2
      return 2
      ;;
  esac
}

# ── PLAN mode ─────────────────────────────────────────────────────────────
PLAN="$(plan_for_role "$STAGE")"

if (( PLAN_ONLY == 1 )); then
  printf '%s' "$PLAN"
  exit 0
fi

# ── RUN mode: sequential, stop at the first failed lane ──────────────────
echo "verify_lanes: role=${RAW_ROLE} (stage=${STAGE}) plan:"
printf '%s\n' "$PLAN" | sed 's/^/  - /'

while IFS= read -r lane; do
  [[ -n "$lane" ]] || continue
  echo "verify_lanes: running ${lane}"
  if ! run_lane "$lane"; then
    echo "verify_lanes: FAILED at lane '${lane}'" >&2
    exit 1
  fi
done <<< "$PLAN"

echo "verify_lanes: all lanes passed for ${RAW_ROLE}"
