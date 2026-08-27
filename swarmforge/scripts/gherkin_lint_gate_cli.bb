#!/usr/bin/env bb

;; BL-515: thin CLI wrapper around gherkin_lint_gate_lib.bb, shelled by
;; gherkin_lint_gate.sh once the vendored parser has already produced a
;; clean IR - this is the "does the clean parse hide a silent wrap/phantom
;; column drop" check, never a substitute for the parser's own parse gate.
;;
;; Usage: gherkin_lint_gate_cli.bb <feature-file> <ir-json-file> <repo-root>
;; Prints one FAIL line per finding and exits 1 if any exist; prints
;; nothing and exits 0 when the feature file is clean.

(ns gherkin-lint-gate-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "gherkin_lint_gate_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: gherkin_lint_gate_cli.bb <feature-file> <ir-json-file> <repo-root>"))
  (System/exit 1))

(defn -main [& args]
  (when (not= 3 (count args))
    (usage))
  (let [[feature-file ir-file _repo-root] args
        feature-text (slurp feature-file)
        parsed-ir (json/parse-string (slurp ir-file) true)
        findings (gherkin-lint-gate-lib/lint-findings feature-text parsed-ir)]
    (if (gherkin-lint-gate-lib/clean? findings)
      (System/exit 0)
      (do
        (doseq [{:keys [line text]} (:continuation-lines findings)]
          (println (str "FAIL: " feature-file ":" line
                         ": bare continuation line - the vendored parser silently drops this "
                         "line (and any <param> on it): " text)))
        (doseq [{:keys [scenario column]} (:phantom-columns findings)]
          (println (str "FAIL: " feature-file ": scenario \"" scenario
                         "\" Examples column \"" column
                         "\" is not referenced by any step parameter")))
        (System/exit 1)))))

(apply -main *command-line-args*)
