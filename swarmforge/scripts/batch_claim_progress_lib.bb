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
;; BL-1076 widened the label set from two to three without widening what the
;; observer can DO - :suppressed-visible-work sends nothing at all, so
;; invariant 2 is preserved in substance even though the old wording ("only
;; ever returns one of two labels") is no longer literally true. Every label
;; this namespace can return is still inert; the caller's only escalation
;; remains that one coordinator-facing note.
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

;; BL-1076: roles whose work legitimately runs far longer than the base clock
;; before the first commit. The flat 20 minutes above surfaced a hardener
;; mid-Stryker as suspect six times in fifty minutes on 2026-08-22, while
;; `git status --porcelain` in its worktree showed live edits.
;;
;; DELIBERATELY NOT SHARED with BL-528's claim_progress_lib.bb, which grants
;; hardender the same 90 minutes from its own literal. The two answer different
;; questions - "is the owner alive and working" there, "is this claim
;; progressing" here - and may legitimately diverge. The obvious boy-scout
;; cleanup is to DRY them into one constant; that would couple a liveness
;; escalation ladder to a progress observer, so it is refused on purpose.
(def role-stale-threshold-ms
  {"hardender" (* 90 60 1000)})

(defn resolve-stale-threshold-ms
  "BL-1076. Precedence, highest first: an operator override for this role
   (`config batch_claim_progress_role_stale_threshold_minutes <role> <n>`,
   parsed by chase_sweep_lib.bb), then this namespace's built-in role entry,
   then the configured base that applies to every other role. An override the
   parser rejected is simply absent from `overrides`, so an unusable setting
   degrades to the role's own built-in tolerance rather than to the base -
   never to something tighter than the role had before."
  [role base-threshold-ms overrides]
  (or (get overrides role)
      (get role-stale-threshold-ms role)
      base-threshold-ms))

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
   every label it can return is inert, and the caller's only escalation is a
   coordinator-facing note.
   :silent                  - fresh progress, or no sidecar at all (nothing to
                              say). Sends nothing, records nothing.
   :stale-suspect           - progress has gone stale past this role's
                              threshold AND the owner shows no uncommitted
                              work; the caller surfaces a named note to the
                              coordinator and nothing else - the parcel itself
                              is never touched here.
   :suppressed-visible-work - BL-1076. Would have been :stale-suspect, but the
                              owner's worktree holds uncommitted work, so the
                              claim IS progressing by the other signal
                              available. Sends nothing; the caller LOGS it
                              (invariant 2: no suppression is silent, or a
                              permanently dirty worktree would hide the signal
                              with nothing to show for it).

   Suppression is reachable only where a note would otherwise have gone out.
   Fresh progress and a missing sidecar stay :silent even with a dirty
   worktree - there was nothing to decline to surface.

   BL-1076 retired the dirt-blind 3-arity rather than defaulting
   worktree-dirty? to false: a call site that forgot the flag would silently
   lose the gate, which is this very defect in a new place."
  [progress now-ms staleness-threshold-ms worktree-dirty?]
  (cond
    (or (nil? progress) (fresh? progress now-ms staleness-threshold-ms)) :silent
    worktree-dirty? :suppressed-visible-work
    :else :stale-suspect))

