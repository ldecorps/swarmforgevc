#!/usr/bin/env bb
;; BL-337 hardening: standing_rule_violations_files.bb's rule-source-files
;; had zero test coverage of any kind, despite already having fixed one
;; real bug (the old duplicated ".prompt"-only filter silently dropped the
;; numbered .md constitution articles - see the lib's own header comment).
;; This is the file-DISCOVERY layer the whole ticket's "generalize, do not
;; hardcode two ticket ids" mandate depends on: a silent gap here means
;; whole FILES never get scanned, the exact "zero violations" trap the
;; ticket itself warns about, one layer below the text-parsing this
;; project already tests thoroughly. Real fs against a temp fixture dir,
;; matching ticket_status_lib_test_runner.bb's own convention.
(ns standing-rule-violations-files-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "standing_rule_violations_files.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "standing-rule-violations-files-test-"})))

(defn touch! [dir filename]
  (fs/create-dirs dir)
  (spit (str (fs/path dir filename)) "content"))

(defn names [paths]
  (set (map fs/file-name paths)))

;; ── articles dir: BOTH numbered .md articles AND project-wide .prompt files ──

(let [root (mk-tmp)
      articles (fs/path root "swarmforge" "constitution" "articles")]
  (touch! articles "01_roles.md")
  (touch! articles "engineering.prompt")
  (touch! articles "README.txt") ;; not a rule-carrying extension - must be excluded
  (assert= "rule-source-files: articles dir contributes both .md and .prompt files, never a third extension"
           #{"01_roles.md" "engineering.prompt"}
           (names (standing-rule-violations-files/rule-source-files root))))

;; ── roles dir: ONLY .prompt files, never .md (roles/ has no numbered articles) ──

(let [root (mk-tmp)
      roles (fs/path root "swarmforge" "roles")]
  (touch! roles "architect.prompt")
  (touch! roles "notes.md") ;; roles/ is .prompt-only by this project's own convention
  (assert= "rule-source-files: roles dir contributes only .prompt files, .md is NOT a role-prompt extension"
           #{"architect.prompt"}
           (names (standing-rule-violations-files/rule-source-files root))))

;; ── both dirs combined: neither list silently swallows the other's files ──

(let [root (mk-tmp)
      articles (fs/path root "swarmforge" "constitution" "articles")
      roles (fs/path root "swarmforge" "roles")]
  (touch! articles "02_handoffs.md")
  (touch! articles "workflow.prompt")
  (touch! roles "hardender.prompt")
  (assert= "rule-source-files: articles and roles files are BOTH present in the combined result"
           #{"02_handoffs.md" "workflow.prompt" "hardender.prompt"}
           (names (standing-rule-violations-files/rule-source-files root))))

;; ── missing directories never crash, they just contribute nothing ──

(let [root (mk-tmp)
      roles (fs/path root "swarmforge" "roles")]
  ;; articles dir intentionally never created
  (touch! roles "coder.prompt")
  (assert= "rule-source-files: a missing articles dir contributes zero files, not a crash"
           #{"coder.prompt"}
           (names (standing-rule-violations-files/rule-source-files root))))

(let [root (mk-tmp)]
  ;; neither dir created at all
  (assert= "rule-source-files: both dirs missing returns an empty list, not a crash"
           []
           (standing-rule-violations-files/rule-source-files root)))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "standing_rule_violations_files: ALL TESTS PASSED"))
