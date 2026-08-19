#!/usr/bin/env bb
;; TDD runner for task_commit_coherence_gate_lib.bb (BL-953) - the send-time
;; gate that refuses a git_handoff whose commit POSITIVELY contradicts its
;; task ticket. Fail-open is absolute (invariant 1): only a resolved
;; contradiction refuses; every ambiguous shape accepts.

(ns task-commit-coherence-gate-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "task_commit_coherence_gate_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── blocked?: the truth table ────────────────────────────────────────────

(assert-true "incident: commit names BL-949, task ticket BL-935 -> blocked"
             (task-commit-coherence-gate-lib/blocked?
              {:task-ticket-id "BL-935" :commit-ticket-ids ["BL-949"]}))

(assert-false "match: commit names BL-949, task ticket BL-949 -> not blocked"
              (task-commit-coherence-gate-lib/blocked?
               {:task-ticket-id "BL-949" :commit-ticket-ids ["BL-949"]}))

(assert-false "fail open: commit names NO ticket at all -> not blocked (nil ids)"
              (task-commit-coherence-gate-lib/blocked?
               {:task-ticket-id "BL-935" :commit-ticket-ids nil}))

(assert-false "fail open: commit names NO ticket at all -> not blocked (empty ids)"
              (task-commit-coherence-gate-lib/blocked?
               {:task-ticket-id "BL-935" :commit-ticket-ids []}))

(assert-false "Article 2.6 batch: commit names BL-631 and BL-945, task BL-945 -> not blocked"
              (task-commit-coherence-gate-lib/blocked?
               {:task-ticket-id "BL-945" :commit-ticket-ids ["BL-631" "BL-945"]}))

(assert-false "fail open: task name resolves to no ticket id -> not blocked"
              (task-commit-coherence-gate-lib/blocked?
               {:task-ticket-id nil :commit-ticket-ids ["BL-949"]}))

;; invariant 2: exact id equality, never prefix/substring
(assert-true "BL-93 in the commit never matches task BL-935 -> blocked"
             (task-commit-coherence-gate-lib/blocked?
              {:task-ticket-id "BL-935" :commit-ticket-ids ["BL-93"]}))
(assert-true "BL-935 in the commit never matches task BL-93 -> blocked"
             (task-commit-coherence-gate-lib/blocked?
              {:task-ticket-id "BL-93" :commit-ticket-ids ["BL-935"]}))
(assert-true "BL-95 in the commit never matches task BL-953 -> blocked"
             (task-commit-coherence-gate-lib/blocked?
              {:task-ticket-id "BL-953" :commit-ticket-ids ["BL-95"]}))

;; case-insensitive id canonicalization rides extract-ticket-ids upstream;
;; the decision itself compares what it is handed exactly.

;; ── refusal-message: names both tickets (scenario 02) ────────────────────

(let [msg (task-commit-coherence-gate-lib/refusal-message
           {:task-name "BL-935-cap-the-vitest-fork-pool" :task-ticket-id "BL-935"
            :commit "896e1d5cb2" :commit-ticket-ids ["BL-949"]})]
  (assert-includes "refusal names the task's ticket" msg "BL-935")
  (assert-includes "refusal names the commit's ticket" msg "BL-949")
  (assert-includes "refusal names the commit" msg "896e1d5cb2"))

;; ── warning-line: the unreadable-subject fail-open (scenario 04) ─────────

(let [line (task-commit-coherence-gate-lib/warning-line "BL-935" "896e1d5cb2")]
  (assert-includes "warning names the check" line "coherence")
  (assert-includes "warning names the commit" line "896e1d5cb2"))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: task_commit_coherence_gate_lib.bb"))
