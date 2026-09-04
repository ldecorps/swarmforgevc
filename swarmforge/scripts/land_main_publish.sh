#!/usr/bin/env bash
# BL-1144: land/close publish onto origin/main with lock + publish-time purity.
#
# Usage:
#   land_main_publish.sh <project-root> [--decide-only|--acquire-lock|--release-lock]
#   land_main_publish.sh <project-root> --land <task-name> <approved-commit> [<issue-ref>]
#
# Default --decide-only: fetch origin/main SHA, compare tip ancestry, print
# EDN decision from master_main_reconcile_lib (no push). Callers that push
# must acquire the land lock first, rematch if advised, then push FF-only
# (never force). Residual races rematch at most once then wait on the lock.
#
# BL-1309: --decide-only ALSO asks what the tip carries. This is the only land
# step QA.prompt makes mandatory, and it used to ask solely whether the push
# would fast-forward - never whose work rode along. `main`'s first-parent chain
# IS the QA branch, so a plain push of that tip ships every ticket ever merged
# into it, including work QA deliberately held. Verified by reflog on
# 2026-08-31: BL-1308's own land pushed BL-1300, held four commits earlier for
# a human ruling that had not been given - and BL-1308 was the ticket that
# fixed the detector this step now consults.
#
# Human ruling (2026-09-03, ticket ruling_options option 2, as REVISED by
# BL-1375's ruling): refuse only when an unlanded sibling is WITHHELD, awaiting
# approval, or its approval state cannot be read. Option 1 - refuse every
# entangled tip - was the ruling first given and is what this guard shipped
# until now; it deadlocked the land queue within hours, because when several
# APPROVED tickets share one path each refuses on the others and none can go
# first. The narrowing is read through land_step_lib.bb's own
# `blocking-siblings`, the predicate BL-1375 built and land-plan already
# decides on, so the mandatory step and the hand-run CLI cannot disagree.
#
# Exit status: 3 with ENTANGLED_SIBLING_BLOCK on refusal, 0 otherwise
# (2 stays the usage error). The refusal is an ordinary exit, never an abort:
# it must not leave the land lock held.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-}"
MODE="${2:---decide-only}"
LAND_TASK="${3:-}"
LAND_COMMIT="${4:-}"
LAND_ISSUE="${5:-}"

if [[ -z "$ROOT" || "$ROOT" == --* ]]; then
  echo "usage: land_main_publish.sh <project-root> [--decide-only|--acquire-lock|--release-lock]" >&2
  exit 2
fi
ROOT="$(cd "$ROOT" && pwd)"
LOCK_DIR="$ROOT/.swarmforge/land-main.publish.lock"
ATTEMPT="${LAND_PUBLISH_ATTEMPT:-0}"
GATE_SHA="${LAND_GATE_ORIGIN_SHA:-}"
PEER_LOCK="${LAND_PEER_HOLDS_LOCK:-0}"
REMATCH_CONFLICT="${LAND_REMATCH_CONFLICT:-0}"
REMATCHED_EDGE="${LAND_REMATCHED_AT_EDGE:-0}"

mkdir -p "$ROOT/.swarmforge"

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" >"$LOCK_DIR/pid"
    echo "LOCK_ACQUIRED"
    return 0
  fi
  echo "LOCK_HELD"
  return 1
}

release_lock() {
  rm -rf "$LOCK_DIR"
  echo "LOCK_RELEASED"
}


# ── BL-1366: the land, performed rather than described ────────────────────
#
# This script has stated the caller protocol in its own header since BL-1144 -
# "acquire the land lock first, rematch if advised, then push FF-only (never
# force). Residual races rematch at most once then wait on the lock" - and
# nothing implemented it. QA retyped the sequence after every approval, with
# the three ways it goes wrong one slip away each: a force-push (BL-1144
# forbids it), a lock left held (release_lock is `rm -rf` on a directory, so a
# land that dies between acquire and release blocks every later land), and an
# escalation pushed past (LAND_ESCALATE means the tool could not establish the
# tip is clean).
#
# It adds no new git behaviour. Every primitive already exists here or in
# land_step_cli.bb; what changes is that the sequence stops being remembered.

# Invariant 2: released on EVERY exit path, including a rejected push, an
# escalation, an unexpected error and a signal. A trap covers the paths nobody
# enumerated, which is the point - the failures that left the lock held were
# never the ones anyone listed.
LAND_LOCK_HELD=0
land_release_trap() {
  if [[ "$LAND_LOCK_HELD" == "1" ]]; then
    release_lock >/dev/null 2>&1 || true
    LAND_LOCK_HELD=0
  fi
}

land_acquire_with_deadline() {
  # Bounded, never an unbounded spin (the repo-wide guardrail for lock loops).
  local deadline=$(( $(date +%s) + ${LAND_LOCK_WAIT_SECONDS:-120} ))
  while :; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "$$" >"$LOCK_DIR/pid"
      LAND_LOCK_HELD=1
      echo "LOCK_ACQUIRED"
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "LAND_LOCK_TIMEOUT: another land has held $LOCK_DIR past the ${LAND_LOCK_WAIT_SECONDS:-120}s deadline; not waiting further and not forcing it." >&2
      return 1
    fi
    sleep "${LAND_LOCK_POLL_SECONDS:-2}"
  done
}

# Never --force, and never a retry loop around a rejected push: at most ONE
# rematch onto the current origin tip, then wait on the lock. A wrapper that
# retried a rejected push is one bad branch away from reaching for --force.
land_push_ff_only() {
  local sha="$1"
  git -C "$ROOT" push origin "$sha:refs/heads/main" 2>&1
}

run_land() {
  local task="$1" commit="$2" issue="$3"
  if [[ -z "$task" || -z "$commit" ]]; then
    echo "usage: land_main_publish.sh <project-root> --land <task-name> <approved-commit> [<issue-ref>]" >&2
    return 2
  fi

  trap land_release_trap EXIT INT TERM

  # 1. The entanglement verdict FIRST, before the lock: an escalation must not
  #    even take the lock, let alone push (invariant 3). This is QA's judgement
  #    to make, and taking it here would be the tool deciding what to land.
  local step_out step_rc=0
  step_out="$(bb "$SCRIPT_DIR/land_step_cli.bb" "$task" "$commit" "$ROOT" 2>&1)" || step_rc=$?
  printf '%s\n' "$step_out"

  local land_sha=""
  if grep -q '^LAND_ESCALATE' <<<"$step_out"; then
    echo "LAND_STOPPED: the land step escalated - main is untouched and nothing was pushed. That verdict is QA's to resolve." >&2
    return 3
  elif grep -q '^LAND_REPLAY ' <<<"$step_out"; then
    # LAND_REPLAY <branch> <new-commit>: the replayed commit is what lands.
    land_sha="$(grep '^LAND_REPLAY ' <<<"$step_out" | head -1 | awk '{print $3}')"
  elif grep -q '^LAND_CLEAN ' <<<"$step_out"; then
    land_sha="$(grep '^LAND_CLEAN ' <<<"$step_out" | head -1 | awk '{print $2}')"
  else
    echo "LAND_STOPPED: land_step_cli.bb produced no verdict this script understands (rc=$step_rc); nothing was pushed." >&2
    return 3
  fi

  if [[ -z "$land_sha" ]]; then
    echo "LAND_STOPPED: the land step named no commit to land; nothing was pushed." >&2
    return 3
  fi

  # 2. The lock, bounded.
  land_acquire_with_deadline || return 4

  # 3. Push FF-only. A rejection means origin moved under us.
  local push_out push_rc=0
  push_out="$(land_push_ff_only "$land_sha")" || push_rc=$?
  printf '%s\n' "$push_out"

  if (( push_rc != 0 )); then
    # 4. Exactly ONE rematch onto the CURRENT origin tip, then push once more.
    #    Never a second rematch and never a force: if this push is rejected
    #    too, the land stops and waits for the next attempt.
    echo "LAND_REMATCH: origin moved; rematching onto its current tip once (never twice, never --force)."
    git -C "$ROOT" fetch origin main >/dev/null 2>&1 || true
    local rematch_rc=0
    git -C "$ROOT" rebase origin/main "$land_sha" >/dev/null 2>&1 || rematch_rc=$?
    if (( rematch_rc != 0 )); then
      git -C "$ROOT" rebase --abort >/dev/null 2>&1 || true
      echo "LAND_STOPPED: the single permitted rematch conflicted; main is untouched and nothing was force-pushed." >&2
      return 5
    fi
    land_sha="$(git -C "$ROOT" rev-parse HEAD)"
    push_rc=0
    push_out="$(land_push_ff_only "$land_sha")" || push_rc=$?
    printf '%s\n' "$push_out"
    if (( push_rc != 0 )); then
      echo "LAND_STOPPED: the push was rejected again after the one permitted rematch; not rematching twice and not forcing. Re-run once the lock is free." >&2
      return 5
    fi
  fi

  echo "LAND_PUBLISHED $land_sha"

  # 5. A GH-seeded ticket closes its issue; anything else attempts no issue
  #    call at all.
  if [[ -n "$issue" ]]; then
    if [[ -f "$SCRIPT_DIR/issue_done.sh" ]]; then
      bash "$SCRIPT_DIR/issue_done.sh" "$issue" "$land_sha" || \
        echo "LAND_ISSUE_SKIPPED: issue_done.sh could not close $issue; the land itself stands." >&2
    else
      echo "LAND_ISSUE_SKIPPED: no issue_done.sh in this target." >&2
    fi
  fi

  return 0
}

case "$MODE" in
  --land) run_land "$LAND_TASK" "$LAND_COMMIT" "$LAND_ISSUE"; exit $? ;;
  --acquire-lock) acquire_lock; exit $? ;;
  --release-lock) release_lock; exit 0 ;;
  --decide-only) ;;
  *) echo "ERROR: unknown mode $MODE" >&2; exit 2 ;;
esac

git -C "$ROOT" fetch origin main 2>/dev/null || git -C "$ROOT" fetch origin 2>/dev/null || true
ORIGIN_SHA="$(git -C "$ROOT" rev-parse origin/main 2>/dev/null || true)"
TIP_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
CONTAINS=false
if [[ -n "$ORIGIN_SHA" && -n "$TIP_SHA" ]] \
  && git -C "$ROOT" merge-base --is-ancestor "$ORIGIN_SHA" "$TIP_SHA" 2>/dev/null; then
  CONTAINS=true
fi
ADVANCED=false
if [[ -n "$GATE_SHA" && -n "$ORIGIN_SHA" && "$GATE_SHA" != "$ORIGIN_SHA" ]]; then
  ADVANCED=true
fi
LOCK_FREE=true
[[ -d "$LOCK_DIR" ]] && LOCK_FREE=false

export BL1144_ORIGIN_SHA="$ORIGIN_SHA"
export BL1144_TIP_SHA="$TIP_SHA"
export BL1144_CONTAINS="$CONTAINS"
export BL1144_ADVANCED="$ADVANCED"
export BL1144_ATTEMPT="$ATTEMPT"
export BL1144_PEER_LOCK="$PEER_LOCK"
export BL1144_REMATCH_CONFLICT="$REMATCH_CONFLICT"
export BL1144_REMATCHED_EDGE="$REMATCHED_EDGE"
export BL1144_LOCK_FREE="$LOCK_FREE"
export BL1144_LIB="$SCRIPT_DIR/master_main_reconcile_lib.bb"

DECISION="$(bb -e "$(cat <<'BB'
(require '[clojure.string :as str])
(load-file (System/getenv "BL1144_LIB"))
(defn- env-bool [k] (= "true" (System/getenv k)))
(defn- env-flag1 [k] (= "1" (System/getenv k)))
(let [tip? (env-bool "BL1144_CONTAINS")
      peer? (env-flag1 "BL1144_PEER_LOCK")
      conflict? (and (not tip?) (env-flag1 "BL1144_REMATCH_CONFLICT"))
      attempt (Long/parseLong (or (System/getenv "BL1144_ATTEMPT") "0"))
      purity (master-main-reconcile-lib/publish-time-purity-action
              {:tip-contains-origin-now? tip?
               :rematch-would-conflict? conflict?
               :attempt attempt
               :max-attempts master-main-reconcile-lib/publish-rematch-max-attempts
               :peer-holds-land-lock? peer?})
      admission (master-main-reconcile-lib/land-close-publisher-admission
                 {:lock-available? (and (env-bool "BL1144_LOCK_FREE") (not peer?))
                  :already-rematched-at-edge? (env-flag1 "BL1144_REMATCHED_EDGE")})
      next (master-main-reconcile-lib/contention-publish-next
            {:purity-action purity :lock-admission admission})]
  (prn {:origin-sha (System/getenv "BL1144_ORIGIN_SHA")
        :tip-sha (System/getenv "BL1144_TIP_SHA")
        :origin-advanced-since-gate (env-bool "BL1144_ADVANCED")
        :tip-contains-origin tip?
        :purity-action purity
        :lock-admission admission
        :next next
        :tip-purity-required (master-main-reconcile-lib/tip-purity-required?)
        :max-attempts master-main-reconcile-lib/publish-rematch-max-attempts}))
BB
)")"

# ── BL-1309: does this tip carry an unlanded ticket's content? ────────────
#
# Fails OPEN on every input it cannot read - no tip sha, no detector on disk,
# a tip whose subject names no ticket, an unreadable range against
# origin/main, or a detector that errors. A land step that refused because it
# could not run its own check would be a swarm-wide outage, which is the line
# BL-806, BL-1293 and BL-1307 all already hold. Only a POSITIVE finding
# refuses.
export BL1309_LIB="$SCRIPT_DIR/land_step_lib.bb"
export BL1309_ROOT="$ROOT"
export BL1309_TIP="$TIP_SHA"

entangled_sibling_report() {
  bb -e "$(cat <<'BB'
(load-file (System/getenv "BL1309_LIB"))
(let [root (System/getenv "BL1309_ROOT")
      tip (System/getenv "BL1309_TIP")
      ;; nil - the tip's subject names no ticket - is an unknown, not a
      ;; finding: there is nothing to call the OTHER tickets siblings OF.
      task (land-step-lib/commit-ticket-id root tip)]
  (when task
    (let [{:keys [unlanded warning]} (land-step-lib/entangled-siblings root tip task)]
      ;; A warning means the walk could not be completed. Say nothing.
      (when (and (nil? warning) (seq unlanded))
        ;; BL-1375's narrowing, asked here rather than restated: an unlanded
        ;; sibling that is APPROVED rides, one that is withheld, awaiting
        ;; approval, or unreadable blocks. `blocking-siblings` is the same
        ;; predicate land-plan decides on, so the mandatory decide step and
        ;; the hand-run land_step_cli.bb cannot give different answers about
        ;; the same tip.
        (let [blockers (land-step-lib/blocking-siblings root unlanded)]
          (when (seq blockers)
            (println "ENTANGLED_SIBLING_BLOCK")
            (doseq [{:keys [ticket state reason]} blockers]
              (println (str "entangled-sibling: " ticket " (" (name state) ") "
                            reason)))
            (println (str "land-decide: refusing to advise a push of " tip
                          " - replay this ticket's own paths onto origin/main"
                          " (BL-1241) and land that commit instead"))))))))
BB
)" 2>/dev/null
}

# `|| true` on the substitution, deliberately: this script runs under
# `set -euo pipefail`, and a detector that exits non-zero must fail OPEN
# rather than abort the land step mid-flight and leave the lock held
# (Guardrails, BL-1242/BL-1252).
ENTANGLED_OUT=""
if [[ -n "$TIP_SHA" && -f "$BL1309_LIB" ]]; then
  ENTANGLED_OUT="$(entangled_sibling_report || true)"
fi
if [[ "$ENTANGLED_OUT" == *"ENTANGLED_SIBLING_BLOCK"* ]]; then
  printf '%s\n' "$ENTANGLED_OUT"
  exit 3
fi


printf '%s\n' "$DECISION"
