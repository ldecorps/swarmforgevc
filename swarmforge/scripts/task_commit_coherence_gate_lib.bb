;; task_commit_coherence_gate_lib.bb — BL-953: refuses a git_handoff whose
;; commit POSITIVELY contradicts the ticket its task names. On 2026-08-19
;; the coder sent commit 896e1d5cb2 (subject "BL-949: concierge
;; board-wiring tests...") under task BL-935-..., 39 seconds after
;; correctly sending the same commit under BL-949; the cleaner faithfully
;; preserved the task name (PIPELINE.md step 3, correct as written) and a
;; parcel carrying zero BL-935 content reached the architect, caught only
;; by eye. BL-760's duplicate-chain guard keys on the task's OWN ticket id,
;; so one commit under two different task names reads as two unrelated
;; tickets - this gate covers the complementary axis.
;;
;; FAIL-OPEN IS ABSOLUTE (invariant 1): only a resolved contradiction
;; refuses - the commit's subject named at least one ticket id AND the
;; task's ticket is not among them, by EXACT id equality (invariant 2:
;; BL-93 never matches BL-935; ids come from pipeline-stage-lib's own
;; extractors, never a second parser). Every ambiguous shape accepts: no
;; id in the subject, an unreadable commit (the caller warns and passes),
;; a task name resolving to no ticket.
;;
;; RANGE, measured not guessed: the check reads the cited commit's OWN
;; SUBJECT only. The obvious deeper range - a merge's second-parent-side
;; subjects - was probed against the qa_e2e_procedure's own live hashes
;; and REFUSES the lawful Article 2.6 batch forward it is required to
;; accept: 8c79644444's second-parent side names {BL-935, BL-942, BL-943,
;; BL-944, BL-947}, containing neither BL-631 nor BL-945, so both of that
;; morning's legitimate sends would have been blocked. Subject-only
;; satisfies every scenario edge, both live-hash checks, catches the real
;; incident at BOTH hops (the cleaner's own merge subject named BL-949),
;; and can never go vacuous with depth. A commit whose subject names no
;; ticket passes untouched - that silence-is-not-a-mismatch posture is the
;; whole design (same as the BL-880 pointer gate).

(ns task-commit-coherence-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))

(defn commit-ticket-ids
  "Every ticket id the commit subject names, via pipeline-stage-lib's own
   BL-869 multi-id extractor (Article 2.6 batch subjects name several) -
   nil when it names none."
  [subject]
  (pipeline-stage-lib/extract-ticket-ids subject))

(defn blocked?
  "Pure decision: true ONLY for a positive, resolved contradiction - the
   commit's subject resolved to at least one ticket id, the task resolved
   to one, and the task's is not among the commit's (exact equality)."
  [{:keys [task-ticket-id commit-ticket-ids]}]
  (boolean
   (and task-ticket-id
        (seq commit-ticket-ids)
        (not (some #(= task-ticket-id %) commit-ticket-ids)))))

(defn refusal-message
  [{:keys [task-name task-ticket-id commit commit-ticket-ids]}]
  (format (str "Cannot send git_handoff for %s: commit %s belongs to %s, "
               "not to the task's ticket %s - one of the two headers is "
               "wrong (a stale field in a reused draft is the usual cause; "
               "BL-953). Fix the task: or the commit: line and re-send.")
          task-name commit (str/join "," commit-ticket-ids) task-ticket-id))

(defn warning-line
  "The scenario-04 fail-open: the commit's subject could not be read, so
   the coherence check cannot run - recorded loudly, never blocking."
  [task-ticket-id commit]
  (str "task-commit coherence check could not run for " task-ticket-id
       " (commit " commit " subject unreadable) - send allowed, unverified (BL-953)"))

;; BL-1094: the daemon's dispatch-gap auto-route cites HEAD as "current tip",
;; not "the work for this ticket". The coherence gate's stale-draft premise
;; does not apply to that one machine-generated caller. Marked via env set
;; only by handoffd/auto-route! (and its test harness) — never by loosening
;; blocked? for hand-authored drafts.

(def dispatch-gap-autoroute-env "SWARMFORGE_DISPATCH_GAP_AUTOROUTE")

(defn check-enabled?
  "Pure. False only for the daemon's own dispatch-gap auto-route (BL-1094)."
  [{:keys [dispatch-gap-autoroute?]}]
  (not dispatch-gap-autoroute?))

(defn operator-refusal-log-line
  "Names the refusing gate in the operator-facing log (BL-1094 invariant 2)."
  [stderr]
  (let [s (str stderr)]
    (cond
      (or (str/includes? s "BL-953")
          (str/includes? s "task-commit coherence")
          (str/includes? s "stale field in a reused draft"))
      (str "gate=task-commit-coherence (BL-953) reason=" (str/trim s))

      (str/includes? s "HANDOFF INVALID")
      (str "gate=handoff-validation reason=" (str/trim s))

      :else
      (str "gate=unknown reason=" (str/trim s)))))
