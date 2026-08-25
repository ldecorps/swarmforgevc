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

bb <<'EOF'
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
EOF
