#!/usr/bin/env bb
;; BL-724: CLI for shell-test discovery over a git repo root.
;; Usage: shell_test_discovery_cli.bb <repo-root>
(ns shell-test-discovery-cli
  (:require [babashka.fs :as fs]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "shell_test_discovery_lib.bb")))
(load-file (str (fs/path script-dir "suite_inventory_lib.bb")))

(defn -main [& args]
  (when-not (first args)
    (binding [*out* *err*] (println "Usage: shell_test_discovery_cli.bb <repo-root>"))
    (System/exit 2))
  (let [root (str (fs/canonicalize (first args)))
        test-dir (str (fs/path root "swarmforge" "scripts" "test"))
        manifest (fs/path test-dir suite-inventory-lib/manifest-name)]
    (when-not (fs/exists? manifest)
      (binding [*out* *err*]
        (println (str "shell_test_discovery: no suite-manifest.tsv under " test-dir)))
      (System/exit 2))
    (let [tracked (shell-test-discovery-lib/tracked-shell-tests root)
          untracked (shell-test-discovery-lib/untracked-shell-tests root)
          rows (suite-inventory-lib/parse-manifest (slurp (str manifest)))
          problems (shell-test-discovery-lib/check-discovery tracked untracked rows)
          excluded-n (count (filter (fn [r]
                                      (and (= "excluded" (:lane r))
                                           (shell-test-discovery-lib/shell-test-name? (:file r))))
                                    rows))]
      (if (seq problems)
        (do (binding [*out* *err*]
              (doseq [p problems] (println (str "FAIL: " p))))
            (println (str "shell_test_discovery: " (count problems) " problem(s)"))
            (System/exit 1))
        (println (str "shell_test_discovery: ok - " (count tracked)
                      " tracked shell test(s), " excluded-n " excluded"))))))

(apply -main *command-line-args*)
