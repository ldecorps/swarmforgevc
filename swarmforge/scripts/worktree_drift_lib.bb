;; BL-1195: pre-turn guard - a role's own worktree can hold tracked-file
;; content that silently diverges from that worktree's own HEAD, with no
;; commit anywhere that authored the change (2026-08-27 incident: the coder
;; found swarmforge/scripts/handoff_inject_lib.bb, handoffd.bb, and
;; briefing_email_lib.bb reverted to pre-BL-1191/pre-BL-1184 content,
;; uncommitted, discovered only because the coder happened to notice before
;; doing any work). The mechanism is unknown (BL-373's launcher-cp guard
;; already covers this exact file set, so it is not that); this guard ships
;; regardless of root cause, per the ticket's own deliverable 2.
;;
;; Pure decision logic only - ready_for_next.bb wires this to real git
;; (`git diff --name-only HEAD`, tracked-only by construction - a brand-new
;; untracked in-progress file never appears here, a different and
;; legitimate shape this guard does not touch) and the same in-progress-task
;; signal BL-1084's own peek-candidate-task-names already gathers.
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "worktree_drift_lib.bb")))
;; and referred to as worktree-drift-lib/foo.

(ns worktree-drift-lib
  (:require [clojure.string :as str]))

;; BL-1195 scenario 02: "that edit belongs to the role's own in-progress
;; task" is not judged file-by-file (this guard has no way to know which
;; files a task WILL touch in advance, and guessing would either false-flag
;; genuine WIP or blind itself to real drift) - it is judged at the
;; coarser, actually-knowable granularity the acceptance scenarios
;; themselves state: whether an in-progress task exists AT ALL. A role with
;; no in-progress task has no legitimate reason to have modified anything
;; (scenario 01); a role resuming one is presumed to own everything it
;; currently has modified (scenario 02) - the SAME "resume, do not
;; re-litigate" posture BL-1084's own peek-candidate-task-names already
;; takes toward an in-process parcel.
(defn unexplained-drift
  "modified-paths: tracked paths whose current working-tree content differs
   from the worktree's own HEAD (a plain `git diff --name-only HEAD`).
   has-in-progress-task?: whether the role already holds (or is about to
   resume) a task - true exempts every currently-modified path as that
   task's own presumed WIP; false means none of them can be explained.
   Returns the sorted, deduplicated set of unexplained drift paths - empty
   when there is none."
  [{:keys [modified-paths has-in-progress-task?]}]
  (if has-in-progress-task?
    (sorted-set)
    (into (sorted-set) (remove str/blank?) (or modified-paths []))))

(defn drift-detected? [drift]
  (boolean (seq drift)))

;; BL-1195 constraint: "Never auto-discard drifted content — preserve
;; (stash or equivalent)" - this guard only ever REPORTS and instructs; it
;; does not stash on the caller's behalf (a stash is a repo-wide mutation
;; this pure/report-only guard should never perform silently as a side
;; effect of merely being asked "is this clean?").
(defn drift-report
  "Refusal text naming every drifted path and the required next step
   (preserve via stash, never discard). `paths` must be non-empty - callers
   only invoke this once drift-detected? is already true."
  [paths]
  (str "WORKTREE_DRIFT_DETECTED: tracked content in this worktree differs from "
       "its own HEAD with no in-progress task to explain it - this may be the "
       "same \"silent revert, no authoring commit\" shape as BL-1195's own "
       "incident. Preserve it, never discard or forward it:\n"
       "  git stash push -u -m \"worktree-drift-$(date -u +%Y%m%dT%H%M%SZ)\"\n"
       "Drifted path(s):\n"
       (str/join "\n" (map #(str "  - " %) paths))))
