;; BL-678: batch-mode claim-progress sidecar — the "live owner" half of
;; BL-648's source near-miss (2026-07-25 16:28-16:50): a cleaner BATCH claim
;; wrote no progress record, so the coordinator, chasing an apparently-
;; stalled parcel, nearly forwarded a duplicate. BL-648 fixed the dead-owner
;; half at launch/relaunch (orphan_claim_lib.bb); this fixes the live-owner
;; half mid-run.
;;
;; Deliberately separate from BL-528's .claim-progress.json (claim_progress_
;; lib.bb): that sidecar drives a task-mode idle/reclaim ESCALATION ladder
;; (nudge -> bounce -> halt) and answers "is the owner alive/working". This
;; sidecar assumes a LIVE owner throughout and only ever answers "is it
;; progressing" - it never becomes a liveness oracle, never bounces, never
;; halts, and is never itself capable of re-forwarding or re-delivering a
;; parcel (BL-678 invariant 2): the only observable action past this
;; namespace is a coordinator-facing SURFACE note when progress goes stale.
;;
;; Sidecar shape: {:ownerRole str :parcelId str :claimAtMs long
;;                  :lastProgressAtMs long :lastCommit str}
;; Written the INSTANT a batch item is claimed (never lazily initialised by
;; a later sweep tick - that gap is exactly the near-miss window this ticket
;; closes), suffix ".batch-claim-progress.json", registered in handoff_lib.
;; bb's sidecar-suffixes so the existing terminal-cleanup convention (every
;; batch completion already calls remove-sidecars-of!) retires it for free.

(ns batch-claim-progress-lib
  (:require [clojure.string :as str]))

(def sidecar-suffix ".batch-claim-progress.json")

(defn sidecar-path [in-process-file-path]
  (str in-process-file-path sidecar-suffix))

(def default-stale-threshold-ms
  "No visible progress for this long before a batch claim is surfaced as
   suspect. Amendable via swarmforge.conf (see chase_sweep_lib.bb's
   parse-batch-claim-progress-stale-threshold-ms)."
  (* 20 60 1000))

(defn make-batch-claim-progress
  "Sidecar written the instant a batch item is claimed (invariant 1) - not
   lazily initialised by a later sweep tick."
  [owner-role parcel-id commit-10 now-ms]
  {:ownerRole (str owner-role)
   :parcelId (str parcel-id)
   :claimAtMs now-ms
   :lastProgressAtMs now-ms
   :lastCommit (or commit-10 "")})

(defn advanced?
  "True when current-commit-10 differs from the sidecar's own last-recorded
   commit and is non-blank - the same 'HEAD moved' signal BL-528 uses,
   applied here only to refresh last-progress, never to reset an escalation
   counter (there is none)."
  [progress current-commit-10]
  (let [current (str current-commit-10)
        last (str (:lastCommit progress))]
    (boolean (and (not (str/blank? current))
                  (not= current last)))))

(defn mark-progress
  "Refresh the last-progress instant and recorded commit."
  [progress commit-10 now-ms]
  (assoc progress
         :lastProgressAtMs now-ms
         :lastCommit (or commit-10 (:lastCommit progress))))

(defn progress-age-ms
  "Age of the sidecar's own last-progress instant (falling back to its
   claim instant when absent), floored at 0 for a nil/malformed progress."
  [progress now-ms]
  (if (nil? progress)
    0
    (max 0 (- now-ms (long (or (:lastProgressAtMs progress) (:claimAtMs progress) now-ms))))))

(defn fresh?
  "True when the sidecar's last-progress instant is within staleness-
   threshold-ms of now. A nil progress (no sidecar yet, or already retired)
   is never 'fresh' by this predicate - callers gate on it separately (see
   decide-batch-claim-observation, which treats nil as :silent, not stale)."
  [progress now-ms staleness-threshold-ms]
  (and (some? progress)
       (< (progress-age-ms progress now-ms) staleness-threshold-ms)))

(defn decide-batch-claim-observation
  "Pure. This function is not capable of re-forwarding or re-delivering
   anything (invariant 2 is satisfied structurally, not by a runtime check):
   it only ever returns one of two labels for the caller to act on.
   :silent        - fresh progress, or no sidecar at all (nothing to say).
   :stale-suspect - progress has gone stale past the threshold; the caller
                    surfaces a named note to the coordinator and nothing
                    else - the parcel itself is never touched here."
  [progress now-ms staleness-threshold-ms]
  (if (or (nil? progress) (fresh? progress now-ms staleness-threshold-ms))
    :silent
    :stale-suspect))

