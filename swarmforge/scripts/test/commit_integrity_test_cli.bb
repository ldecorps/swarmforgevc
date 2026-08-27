#!/usr/bin/env bb
;; BL-419 acceptance test seam: drives the REAL commit_integrity_lib.bb's
;; commit-with-integrity! against a REAL git fixture repo, with REAL
;; add/rev-parse/show throughout and only `commit!` wrapped - for the
;; leading N attempts, the wrapper commits CORRUPTED content (simulating a
;; concurrent writer's commit landing in the stage-to-commit window and
;; clobbering this path) instead of the caller's real staged content, then
;; restores the working tree so the next real `git add` finds a genuine
;; diff to re-stage. This reproduces the ticket's actual symptom - "git
;; show of the new commit reads content that was never staged" -
;; deterministically, with real git commands throughout, no real
;; concurrency and no faked observation (verify-mismatch is a genuine
;; content diff at every step).
;;
;; Usage: commit_integrity_test_cli.bb <project-root> <message> <path>
;; Env:
;;   COMMIT_INTEGRITY_TEST_CORRUPT_COMMITS   how many of the LEADING real
;;     commits land with corrupted content instead of the caller's actual
;;     staged content. Default 0 (every commit is genuine - no mismatch
;;     ever occurs).
;;
;; Prints one JSON line: the raw commit-with-integrity! result plus
;; {"addCalls": N, "commitCalls": N}. No real sleep is ever taken between
;; retries.

(ns commit-integrity-test-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "commit_integrity_lib.bb")))

(def project-root (nth *command-line-args* 0))
(def message (nth *command-line-args* 1))
(def path (nth *command-line-args* 2))

(def corrupt-commits
  (or (some-> (System/getenv "COMMIT_INTEGRITY_TEST_CORRUPT_COMMITS") parse-long) 0))

(def add-calls (atom 0))
(def commit-calls (atom 0))

(defn add! [root paths]
  (swap! add-calls inc)
  (commit-integrity-lib/default-add! root paths))

(defn commit! [root msg paths]
  (swap! commit-calls inc)
  (if (<= @commit-calls corrupt-commits)
    ;; Simulate a concurrent writer's commit clobbering this exact path:
    ;; genuinely commit WRONG content, then restore the working tree to
    ;; the caller's real content so the next real `git add` sees an actual
    ;; diff to re-stage.
    (let [abs (str (fs/path root (first paths)))
          real-content (slurp abs)]
      ;; The corruption suffix must be UNIQUE per attempt - an identical
      ;; suffix on a second corrupted attempt would stage content
      ;; byte-identical to what's already at HEAD from the first corrupted
      ;; commit, so `git commit` would see nothing to commit and fail with
      ;; :commit-failed instead of producing the next genuinely-mismatched
      ;; commit this fixture means to simulate.
      (spit abs (str real-content "CORRUPTED-BY-CONCURRENT-WRITER-" @commit-calls))
      (commit-integrity-lib/default-add! root paths)
      (let [res (commit-integrity-lib/default-commit! root msg paths)]
        (spit abs real-content)
        res))
    (commit-integrity-lib/default-commit! root msg paths)))

(def result
  (commit-integrity-lib/commit-with-integrity!
   {:project-root project-root
    :paths [path]
    :message message
    :add-fn! add!
    :commit-fn! commit!
    :retry-delay-fn! (fn [_attempt] nil)}))

(println
 (json/generate-string
  (assoc result :addCalls @add-calls :commitCalls @commit-calls)))

;; Mirrors the production CLI's own exit-code contract (commit_integrity_cli.bb):
;; never exit 0 on a dropped edit, so an acceptance step can assert on the
;; real subprocess result the same way it would against production.
(when-not (:success result)
  (System/exit 1))
