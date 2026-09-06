#!/usr/bin/env bb
;; BL-1424: the IO/argv-only entry point check_test_file_registration.sh
;; delegates to - never a second implementation of the decision, which
;; lives entirely in unregistered_test_gate_lib.bb's findings-for-staged-
;; commit (shared, unchanged, with BL-1240's own git_handoff path). Same
;; shape as task_scope_gate_cli.bb: resolve the repo root, call the lib,
;; print OK or the refusal, exit 0 or 1.
;;
;; Usage: check_test_file_registration_cli.bb [repo-root]
;;   repo-root defaults to `git rev-parse --show-toplevel`, seamed as an
;;   explicit arg so a fixture never depends on the checker's own cwd.
;;
;;   Exit 0, "OK": no staged addition under swarmforge/scripts/test/ lacks a
;;     row in the STAGED suite-manifest.tsv (or nothing to judge, or the
;;     lib's own fail-open fired - printed as a WARNING to stderr first,
;;     never silently swallowed).
;;   Exit 1: the refusal message, naming every offending file and the row
;;     it needs.

(ns check-test-file-registration-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "unregistered_test_gate_lib.bb")))

(defn- resolve-repo-root [explicit]
  (or explicit
      (let [res (process/sh ["git" "rev-parse" "--show-toplevel"])]
        (when (zero? (:exit res)) (str/trim (:out res))))))

(defn -main [& args]
  (let [[repo-root-arg] args
        project-root (resolve-repo-root repo-root-arg)]
    (if-not project-root
      (do
        (binding [*out* *err*]
          (println "check_test_file_registration: WARNING - could not resolve the repo root."))
        (println "OK")
        (System/exit 0))
      (let [result (unregistered-test-gate-lib/findings-for-staged-commit {:root project-root})]
        (if-let [warning (:warning result)]
          (do
            (binding [*out* *err*] (println (str "check_test_file_registration: WARNING - " warning)))
            (println "OK")
            (System/exit 0))
          (if (unregistered-test-gate-lib/blocked? result)
            (do
              (println (unregistered-test-gate-lib/staged-commit-refusal-message
                        {:findings (:findings result)}))
              (System/exit 1))
            (do (println "OK") (System/exit 0))))))))

(apply -main *command-line-args*)
