#!/usr/bin/env bb
;; TDD runner for forward_evidence_lib.bb (BL-1609) - pure assertions, no
;; filesystem (sent-handoff-names-ticket-since? is IO and is covered by the
;; feature's real-fixture acceptance scenarios instead, the same split
;; qa_hold_lib_test_runner.bb draws for qa_hold_lib.bb's own reading layer).
(ns forward-evidence-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "forward_evidence_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── forward-completion-decision ──────────────────────────────────────────

(assert= "01: forwarding, no evidence, no reason -> refuse"
         :refuse
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false :reason nil}))

(assert= "02a: forwarding, evidenced, no reason -> complete-plain"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? true :reason nil}))

(assert= "02b: forwarding, not evidenced, a stated reason -> complete-with-reason"
         :complete-with-reason
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false :reason "waiting on BL-9000"}))

(assert= "a stated reason wins even when also evidenced (recorded, never silently dropped)"
         :complete-with-reason
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? true :reason "already superseded"}))

(assert= "03: a non-forwarding inbound completes plain regardless of evidence/reason"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? false :master-resident? false :evidenced? false :reason nil}))

(assert= "a non-forwarding inbound completes plain even with a reason supplied"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? false :master-resident? false :evidenced? false :reason "irrelevant"}))

(assert= "06: a master-resident role's forwarding git_handoff completes plain with no evidence"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? true :evidenced? false :reason nil}))

(assert= "a master-resident role is never gated even with a reason supplied"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? true :evidenced? false :reason "irrelevant"}))

;; ── BL-1642: qa-note-evidenced? ──────────────────────────────────────────

(assert= "07: forwarding, no git_handoff evidence, but QA note evidence, no reason -> complete-plain"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false
           :qa-note-evidenced? true :reason nil}))

(assert= "08: forwarding, no evidence of either kind, no reason -> refuse"
         :refuse
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false
           :qa-note-evidenced? false :reason nil}))

(assert= "a stated reason wins over QA note evidence too (recorded, never silently dropped)"
         :complete-with-reason
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false
           :qa-note-evidenced? true :reason "already superseded"}))

(assert= "git_handoff evidence still completes plainly when qa-note-evidenced? is false (BL-1609 unchanged)"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? true
           :qa-note-evidenced? false :reason nil}))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: forward_evidence_lib.bb"))
