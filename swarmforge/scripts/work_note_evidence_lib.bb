;; work_note_evidence_lib.bb — BL-1422 pure decision core.
;;
;; done_with_current_task.bb executes its -main as a side effect of being
;; loaded (like every done_with_current*/ready_for_next* entry script in
;; this family), so nothing may load-file it from a test or property runner
;; without also running its real mailbox logic. The two decisions that
;; actually need proving here are pulled out into this small, side-effect-
;; free sibling instead - the same "keep the lib pure, orchestration impure"
;; split BL-654 already established for provider_auth_observe_lib.bb.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "work_note_evidence_lib.bb")))
;; and referred to as work-note-evidence-lib/foo.

(ns work-note-evidence-lib
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "chase_sweep_lib.bb")))

(defn work-note-ticket-id-from-message
  "BL-1422 invariant 2: Work-note recognition is chase-sweep-lib's ONE
   dispatch-trail parser (BL-1223) - no second regex. :task is always nil
   here, exactly as the ticket's own direction calls for: a note never
   carries a task header (that field is git_handoff-only), so this reads
   only the message's own verb-first Spec/Work form, never a task field
   that could not exist on the file this is called for."
  [message]
  (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message message}))

(defn work-note-completion-decision
  "BL-1422 invariants 1 and 3, extended by BL-1614's fourth input (the
   table is EXTENDED, never rewritten - BL-1422's own three clauses are
   untouched below), as one pure decision table given what the caller has
   already determined:
     ticket-id      - work-note-ticket-id-from-message's result for the
                       in_process item's own message header (nil for
                       anything that is not a Work/Spec dispatch note,
                       INCLUDING every git_handoff - it never has a
                       message header at all).
     evidenced?     - a commit naming ticket-id on the role's branch, or a
                       sent git_handoff naming it, since the item's dequeue.
     reason         - the --no-work reason argv already vetted non-blank,
                       or nil for a plain invocation.
     active-on-main? - BL-1614: is ticket-id in backlog/active on the
                       freshest of main/origin-main right now (nil when
                       neither ref resolves - unreadable behaves exactly
                       like false, today's behaviour, never a refusal of
                       its own)?
   Returns :complete-plain | :complete-with-reason | :refuse-active-on-main
   | :refuse.

   Invariant 3 falls out of the FIRST clause alone: a nil ticket-id (every
   non-Work note, every git_handoff) always completes plainly, regardless
   of evidenced?/reason/active-on-main? - the gate never engages for them,
   which is exactly \"completes exactly as today.\" BL-1614's own
   invariant is the SECOND clause: a stated reason on a ticket genuinely
   active on main is refused, never silently recorded - a Work note is
   never completed with a no-work reason while its ticket sits in
   backlog/active on main. BL-1422's invariant 1 is the remaining three
   clauses, unchanged: a stated reason on a ticket NOT active on main (or
   on an unreadable ref) always completes-with-reason (recorded, never
   silent); evidence with no reason completes plainly (no reason to
   record); neither refuses."
  [ticket-id evidenced? reason active-on-main?]
  (cond
    (nil? ticket-id) :complete-plain
    (and (some? reason) active-on-main?) :refuse-active-on-main
    (some? reason) :complete-with-reason
    evidenced? :complete-plain
    :else :refuse))
