#!/usr/bin/env bb
;; BL-1541 scenario 03: the shared helper's own contract, isolated from any
;; real swarm_handoff.bb call. Drives the REAL send-through-audit! against a
;; fake two-call thunk - the first call always answers the challenge and
;; queues nothing, the second reports whatever this harness's caller asked
;; for and queues the parcel count that implies. Prints three lines the step
;; handler parses; never re-implements the helper's own logic here.
;;
;; Usage: bb bl1541_send_through_audit_contract_harness.bb <second-report> <queued-count>

(require '[babashka.fs :as fs])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "lib" "send_through_audit.bb")))

(def second-report (first *command-line-args*))
(def queued-count (Long/parseLong (second *command-line-args*)))

(def calls (atom 0))
(def queue (atom []))

(defn- invoke! []
  (swap! calls inc)
  (if (= @calls 1)
    "AUDIT_REQUIRED"
    (do (dotimes [_ queued-count] (swap! queue conj {:parcel true}))
        second-report)))

(def result (send-through-audit-lib/send-through-audit! invoke!))

(println (str "RESULT=" result))
(println (str "CALLS=" @calls))
(println (str "QUEUED=" (count @queue)))
