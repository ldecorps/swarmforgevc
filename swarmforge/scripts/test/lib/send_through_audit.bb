;; BL-1541: since the two-call self-audit (44d2d42591, 2026-08-30), the FIRST
;; invocation of a git_handoff draft's byte-identical fingerprint is answered
;; with the self-audit challenge - AUDIT_REQUIRED / HANDOFF_NOT_QUEUED, exit
;; 0, nothing queued - and only an identical SECOND invocation queues. A
;; property runner that shells the real swarm_handoff.bb once and asserts the
;; queue is asserting against a challenge, not a send.
;;
;; This is the one answer shared by every runner under this directory that
;; drafts a git_handoff and shells swarm_handoff.bb: invoke the byte-identical
;; draft twice and take only the second call's result. The first call's
;; result is discarded outright - a runner's queue assertion must still read
;; the mailbox (or the second call's own output), never the first call's exit
;; code, which is 0 whether or not anything queued.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path script-dir "lib" "send_through_audit.bb")))
;; and referred to as send-through-audit-lib/send-through-audit!.

(ns send-through-audit-lib)

(defn send-through-audit!
  "Calls the zero-arg `invoke` thunk twice - one real swarm_handoff
   invocation per call, against a byte-identical draft - and returns only
   the second call's result. `invoke` must not mutate the draft between
   calls; an edited draft re-challenges instead of queueing (BL-1306)."
  [invoke]
  (invoke)
  (invoke))
