#!/usr/bin/env bb
;; TDD runner for review_forward_evidence_gate_lib.bb (BL-806) — the send-time
;; gate that refuses a review role's forward-direction git_handoff naming
;; exactly the commit it received for the same task.

(ns review-forward-evidence-gate-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "review_forward_evidence_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-nil [msg actual] (assert= msg nil actual))

(defn assert-includes [msg haystack needle]
  (when-not (str/includes? haystack needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "review-forward-gate-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-roles! [root]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "coder\tcoder-wt\t" root "/coder\tswarmforge-coder\tCoder\tclaude\ttask\n"
             "cleaner\tcleaner-wt\t" root "/cleaner\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n"
             "architect\tarchitect-wt\t" root "/architect\tswarmforge-architect\tArchitect\tclaude\ttask\n"
             "hardender\thardender-wt\t" root "/hardender\tswarmforge-hardender\tHardener\tclaude\tbatch\n"
             "documenter\tdocumenter-wt\t" root "/documenter\tswarmforge-documenter\tDocumenter\tclaude\ttask\n"
             "QA\tQA-wt\t" root "/QA\tswarmforge-QA\tQa\tclaude\ttask\n"
             "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n")))

(defn write-in-process! [root role filename {:keys [type task commit]
                                             :or {type "git_handoff"}}]
  (let [role-info (handoff-lib/load-role-info role root)
        dir (handoff-lib/mailbox-dir role-info :in_process)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename))
          (str "id: x\nfrom: coder\nto: " role "\npriority: 50\ntype: " type "\n"
               (when (= type "git_handoff") (str "task: " task "\ncommit: " commit "\n"))
               "\nbody\n"))))

;; ── received-commit-for-task ─────────────────────────────────────────────

(let [root (mk-root)]
  (write-roles! root)
  (assert-nil "no mailbox contents -> nil (fail open)"
              (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (assert-nil "unknown sender role -> nil (fail open)"
              (review-forward-evidence-gate-lib/received-commit-for-task root "nonexistent-role" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (write-in-process! root "architect" "00_received.handoff" {:task "BL-T" :commit "aaaaaaaaaa"})
  (assert= "the matching in_process git_handoff's commit is returned"
           "aaaaaaaaaa"
           (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (write-in-process! root "architect" "00_other_task.handoff" {:task "BL-OTHER" :commit "aaaaaaaaaa"})
  (assert-nil "a different task's parcel never matches (task field equality, not any parcel present)"
              (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (write-in-process! root "architect" "00_note.handoff" {:type "note"})
  (assert-nil "a note (no task/commit header) is never a matching git_handoff"
              (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  ;; batch role, two in-process tasks: filename order picks the newest.
  (write-in-process! root "cleaner" "10_first.handoff" {:task "BL-T" :commit "1111111111"})
  (write-in-process! root "cleaner" "20_second.handoff" {:task "BL-T" :commit "2222222222"})
  (assert= "the newest (highest-sorting filename) match wins among several"
           "2222222222"
           (review-forward-evidence-gate-lib/received-commit-for-task root "cleaner" "BL-T")))

;; ── blocked?: the core truth table (BL-654 invariants 1 and 2) ──────────

(defn base-args []
  {:type "git_handoff" :sender "architect" :recipients ["hardender"]
   :task-name "BL-T" :commit "bbbbbbbbbb" :reroute-reason nil
   :received-commit "bbbbbbbbbb"})

(assert-true "review role, forward direction, same commit, no reroute -> blocked"
             (review-forward-evidence-gate-lib/blocked? (base-args)))

(assert-false "descendant (different) commit -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc")))

(assert-false "reroute_reason present -> not blocked (marked detour)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :reroute-reason "cannot act, routing onward")))

(assert-false "backward bounce (architect -> cleaner) -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :recipients ["cleaner"])))

(assert-false "non-review sender (coder) -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "coder" :recipients ["cleaner"])))

(assert-false "QA sender -> not blocked (excluded this slice)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "QA" :recipients ["coordinator"])))

(assert-false "no received-commit on file -> not blocked (fail open)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :received-commit nil)))

(assert-false "note type -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :type "note")))

(assert-false "rule_proposal type -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :type "rule_proposal")))

(assert-false "multi-recipient send -> not blocked (no single forward stage to check)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :recipients ["hardender" "documenter"])))

(assert-false "blank task-name -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :task-name "")))

(assert-false "blank commit -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "")))

;; ── refusal-message ──────────────────────────────────────────────────────

(let [msg (review-forward-evidence-gate-lib/refusal-message
           {:sender "architect" :task-name "BL-T" :commit "bbbbbbbbbb"})]
  (assert-includes "refusal names the ticket/task" msg "BL-T")
  (assert-includes "refusal names the commit" msg "bbbbbbbbbb")
  (assert-includes "refusal names the sender role" msg "architect")
  (assert-includes "refusal names Article 4.4" msg "4.4")
  (assert-includes "refusal names the reroute_reason exemption" msg "reroute_reason"))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: review_forward_evidence_gate_lib.bb"))
