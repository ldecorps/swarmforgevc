#!/usr/bin/env bb
;; BL-464: TDD runner for pipeline_stage_lib.bb's pure functions - no
;; filesystem, no tmux, no clock. Mirrors operator_lib_test_runner.bb's own
;; shape.

(ns pipeline-stage-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "pipeline_stage_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── extract-ticket-id ─────────────────────────────────────────────────────
(assert= "extracts the leading BL-### token from a task field"
         "BL-217"
         (pipeline-stage-lib/extract-ticket-id "BL-217-inbound-email-webhook"))
(assert= "extracts the leading token from a routing note's own message text"
         "BL-434"
         (pipeline-stage-lib/extract-ticket-id "BL-434 promoted to active/ — starting now"))
(assert= "nil for text with no leading ticket id" nil (pipeline-stage-lib/extract-ticket-id "just a note, no ticket"))
(assert= "nil for nil text" nil (pipeline-stage-lib/extract-ticket-id nil))

;; BL-471: canonicalized to upper-case regardless of the header's own casing
;; - the fix for the latent case-sensitive active-set join gap.
(assert= "BL-471: a fully lower-case leading id canonicalizes to upper-case"
         "BL-447"
         (pipeline-stage-lib/extract-ticket-id "bl-447 promoted to active/ — starting now"))
(assert= "BL-471: a mixed-case leading id canonicalizes to upper-case"
         "BL-447"
         (pipeline-stage-lib/extract-ticket-id "Bl-447-some-task-name"))
(assert= "BL-471: an already-upper-case id is unaffected"
         "BL-447"
         (pipeline-stage-lib/extract-ticket-id "BL-447-some-task-name"))

;; ── ticket-id-from-headers: task (git_handoff) OR message (note) ─────────
(assert= "a git_handoff's task header wins when present"
         "BL-217"
         (pipeline-stage-lib/ticket-id-from-headers {:task "BL-217-inbound-email-webhook" :message nil}))
(assert= "a note's message header is used when there is no task header"
         "BL-434"
         (pipeline-stage-lib/ticket-id-from-headers {:task nil :message "BL-434 promoted to active/ — starting now"}))
(assert= "task wins over message when (implausibly) both are present"
         "BL-1"
         (pipeline-stage-lib/ticket-id-from-headers {:task "BL-1-thing" :message "BL-2 unrelated"}))
(assert= "nil when neither header yields a ticket id"
         nil
         (pipeline-stage-lib/ticket-id-from-headers {:task nil :message "no ticket id here"}))

;; ── reconcile-stage-map: one role per ticket, most-downstream wins ───────
(def ROLE-ORDER ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(assert= "a single role/ticket pair maps straight through"
         {"BL-1" "coder"}
         (pipeline-stage-lib/reconcile-stage-map [{:role "coder" :ticket-id "BL-1"}] ROLE-ORDER))

(assert= "distinct tickets at distinct roles all survive"
         {"BL-1" "coder" "BL-2" "cleaner"}
         (pipeline-stage-lib/reconcile-stage-map
          [{:role "coder" :ticket-id "BL-1"} {:role "cleaner" :ticket-id "BL-2"}]
          ROLE-ORDER))

(assert= "board-authoritative-stage-02/03: the SAME ticket observed at two roles resolves to the MOST DOWNSTREAM one, never two rows"
         {"BL-1" "cleaner"}
         (pipeline-stage-lib/reconcile-stage-map
          [{:role "coder" :ticket-id "BL-1"} {:role "cleaner" :ticket-id "BL-1"}]
          ROLE-ORDER))

(assert= "reconcile-stage-map is order-independent - the same result regardless of input order"
         {"BL-1" "cleaner"}
         (pipeline-stage-lib/reconcile-stage-map
          [{:role "cleaner" :ticket-id "BL-1"} {:role "coder" :ticket-id "BL-1"}]
          ROLE-ORDER))

(assert= "empty input yields an empty map" {} (pipeline-stage-lib/reconcile-stage-map [] ROLE-ORDER))

;; A role absent from role-order ranks as least-downstream (-1 in the doc
;; comment) so it must never beat a recognized role, in either arrival
;; order - the guarantee the rank fn's own comment names. In production this
;; can never actually arise (role-order is built from the very same roles
;; list role-ticket-pairs-for draws its :role values from), but the
;; guarantee is exactly what the code comment claims, so pin it directly
;; rather than leaving it proven only by construction.
(assert= "an unrecognized role never wins over a recognized one, unknown observed first"
         {"BL-1" "coder"}
         (pipeline-stage-lib/reconcile-stage-map
          [{:role "ghost-role" :ticket-id "BL-1"} {:role "coder" :ticket-id "BL-1"}]
          ROLE-ORDER))
(assert= "an unrecognized role never wins over a recognized one, unknown observed second"
         {"BL-1" "coder"}
         (pipeline-stage-lib/reconcile-stage-map
          [{:role "coder" :ticket-id "BL-1"} {:role "ghost-role" :ticket-id "BL-1"}]
          ROLE-ORDER))

;; ── filter-active: drop any ticket not in the active set ─────────────────
(assert= "drops a stale/closed ticket no longer active"
         {"BL-1" "coder"}
         (pipeline-stage-lib/filter-active {"BL-1" "coder" "BL-2" "cleaner"} #{"BL-1"}))
(assert= "keeps every ticket that IS active" {"BL-1" "coder" "BL-2" "cleaner"}
         (pipeline-stage-lib/filter-active {"BL-1" "coder" "BL-2" "cleaner"} #{"BL-1" "BL-2"}))
(assert= "empty active set drops everything" {} (pipeline-stage-lib/filter-active {"BL-1" "coder"} #{}))

;; ── BL-471 board-authoritative-stage-05: end-to-end case-robustness join ──
;; A handoff header leading with a differently-cased ticket id must still
;; survive reconcile-stage-map + filter-active against the canonical
;; (always upper-case) active set - the exact join active-ticket-ids
;; (pipeline_stage_cli.bb) performs, driven here through the full pipeline
;; rather than extract-ticket-id in isolation.
(assert= "BL-471: a lower-case header id resolves to its active (upper-case) ticket and survives the active-set join"
         {"BL-447" "coder"}
         (pipeline-stage-lib/filter-active
          (pipeline-stage-lib/reconcile-stage-map
           [{:role "coder" :ticket-id (pipeline-stage-lib/ticket-id-from-headers {:task nil :message "bl-447 starting now"})}]
           ROLE-ORDER)
          #{"BL-447"}))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "pipeline_stage_lib: ALL TESTS PASSED")
  (do (println (str "pipeline_stage_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
