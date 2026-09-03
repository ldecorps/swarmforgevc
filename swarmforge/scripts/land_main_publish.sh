#!/usr/bin/env bash
# BL-1144: land/close publish onto origin/main with lock + publish-time purity.
#
# Usage:
#   land_main_publish.sh <project-root> [--decide-only|--acquire-lock|--release-lock]
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
# Human ruling (2026-09-03, ticket ruling_options option 1): refuse EVERY
# entangled tip. No withheld-vs-ordinary judgment is made here - the rule has
# no predicate to get wrong, and the remedy it forces (BL-1241's tip-pure
# replay) already exists and is already run by hand today.
#
# Exit status: 3 with ENTANGLED_SIBLING_BLOCK on refusal, 0 otherwise
# (2 stays the usage error). The refusal is an ordinary exit, never an abort:
# it must not leave the land lock held.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-}"
MODE="${2:---decide-only}"

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

case "$MODE" in
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
        (println "ENTANGLED_SIBLING_BLOCK")
        (doseq [sibling (sort unlanded)]
          (println (str "entangled-sibling: " sibling
                        " has content on this tip that is not on origin/main")))
        (println (str "land-decide: refusing to advise a push of " tip
                      " - replay this ticket's own paths onto origin/main"
                      " (BL-1241) and land that commit instead"))))))
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
