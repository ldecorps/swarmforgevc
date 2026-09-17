#!/usr/bin/env bb
;; BL-1608: unit assertions for ready_for_next_task.bb's claim-task-name -
;; the shared attribution both claim-time readers (difficulty-allows-
;; claim? and apply-effort-for-task!) resolve a parcel's task through.
;; Three shapes (BL-1185's own contract): a task: header wins; a header-
;; less Work note falls back to the `Work BL-…` slug in its message; a
;; type: note with neither never invents a task header.
(ns ready-for-next-claim-task-name-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "ready_for_next_task.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when (not= true actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: true\n  actual:   " (pr-str actual)))))

(defn- tmp-handoff-file [content]
  (let [f (fs/create-temp-file {:prefix "bl1608-claim-task-name-" :suffix ".handoff"})]
    (spit (str f) content)
    (fs/path f)))

;; Shape 1: a git_handoff carries a task: header - it wins outright.
(assert= "a task: header is preferred outright"
         "BL-1608"
         (ready-for-next-task/claim-task-name
          (tmp-handoff-file "type: git_handoff\nto: coder\npriority: 00\ntask: BL-1608\ncommit: abc1234567\n\npayload\n")))

;; Shape 2: a Work note with no task: header falls back to the `Work BL-…`
;; ticket slug in its message.
(assert= "a headerless Work note falls back to the Work BL-… message slug"
         "BL-1608"
         (ready-for-next-task/claim-task-name
          (tmp-handoff-file "type: note\nto: coder\npriority: 10\nmessage: Work BL-1608: some note text\n\nWork BL-1608: some note text\n")))

;; Shape 3: a type: note naming neither a task: header nor a `Work BL-…`
;; message never invents a task header - resolves nil.
(assert= "a note naming neither a header nor a Work BL-… message resolves nil"
         nil
         (ready-for-next-task/claim-task-name
          (tmp-handoff-file "type: note\nto: coder\npriority: 10\nmessage: branch behind abc1234567: merge up\n\nbranch behind abc1234567: merge up\n")))

;; Shape 4 (hardener, BL-1608, 2026-09-16): a PRESENT but BLANK task:
;; header must fall through to the Work BL-… message, not be taken as the
;; task name. `header-field` returns "" for a present-but-empty header
;; line, and an empty string is truthy in Clojure's `or`, so the
;; `not-empty` guard is load-bearing - a mutant dropping it makes this
;; case resolve "" instead of falling through. Hand-verified via a
;; bb -e probe (not covered by any Stryker/CRAP tool, BL-638 fallback):
;; the mutated form resolved "" here where the original resolves the
;; message slug below.
(assert= "a present-but-blank task: header falls through to the Work BL-… message"
         "BL-2222-something"
         (ready-for-next-task/claim-task-name
          (tmp-handoff-file "type: note\nto: coder\npriority: 10\ntask: \nmessage: Work BL-2222-something\n\nWork BL-2222-something\n")))

;; BL-1610: current-head-commit-10 - the dequeue stamp's own source of the
;; sender's HEAD, otherwise exercised by no test at all (the acceptance
;; steps seed received_at_head directly into the fixture parcel, never
;; through this function - specs/pipeline/steps/bl1610MergeDropGate…Steps.js).
;; Cross-checked against a real git call in this same worktree, never a
;; second implementation of the same rev-parse to compare against itself.
(let [{:keys [out]} (process/sh "git" "rev-parse" "--short=10" "HEAD")]
  (assert= "current-head-commit-10 returns the real worktree HEAD, short=10"
           (str/trim out)
           (ready-for-next-task/current-head-commit-10)))
(assert-true "current-head-commit-10 is a 10-char hex string"
             (boolean (re-matches #"[0-9a-f]{10}" (ready-for-next-task/current-head-commit-10))))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ready_for_next_claim_task_name_runner: all assertions passed"))
