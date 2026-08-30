#!/usr/bin/env bb
;; Unit coverage for reverse-roles math via handoff_lib propagation helpers.

(ns reverse-audit-handoff-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "handoff_lib.bb")))

(def fails (atom 0))
(defn pass [msg] (println "PASS:" msg))
(defn fail [msg]
  (println "FAIL:" msg)
  (swap! fails inc))

(defn write-roles! [root lines]
  (let [tsv (fs/path root ".swarmforge" "roles.tsv")]
    (fs/create-dirs (fs/parent tsv))
    (spit (str tsv) (str (str/join "\n" lines) "\n"))))

(let [root (str (fs/create-temp-dir {:prefix "rev-audit-"}))]
  (try
    (write-roles! root
                  [(str "specifier\tmaster\t" root "\ts\tSpecifier\tclaude\ttask\toff\tforward-only")
                   (str "coder\tcoder\t" root "/wt-coder\tc\tCoder\tclaude\ttask\toff\tforward-only")
                   (str "cleaner\tcleaner\t" root "/wt-cleaner\tcl\tCleaner\tclaude\tbatch\toff\tback-one")
                   (str "architect\tarchitect\t" root "/wt-architect\ta\tArchitect\tclaude\ttask\toff\tback-all")
                   (str "QA\tQA\t" root "/wt-QA\tq\tQa\tclaude\ttask\toff\tforward-only")
                   (str "coordinator\tmaster\t" root "\tco\tCoordinator\tclaude\ttask\toff\tforward-only")])

    ;; role-propagation / pack-pipeline read target-root via git — set override.
    (handoff-lib/set-project-root! root)

    (let [props (handoff-lib/role-propagation "cleaner")
          props-a (handoff-lib/role-propagation "architect")
          props-c (handoff-lib/role-propagation "coder")
          pipeline (handoff-lib/pack-pipeline-role-names root)]
      (if (= "back-one" props) (pass "role-propagation cleaner=back-one")
          (fail (str "cleaner prop=" props)))
      (if (= "back-all" props-a) (pass "role-propagation architect=back-all")
          (fail (str "architect prop=" props-a)))
      (if (= "forward-only" props-c) (pass "role-propagation coder default")
          (fail (str "coder prop=" props-c)))
      (if (= ["specifier" "coder" "cleaner" "architect" "QA"] pipeline)
        (pass "pack-pipeline excludes coordinator")
        (fail (str "pipeline=" pipeline))))

    (let [roles (handoff-lib/pack-pipeline-role-names root)
          rev (fn [sender]
                (let [idx (.indexOf roles sender)]
                  (if (neg? idx) []
                      (case (handoff-lib/role-propagation sender)
                        "back-one" (if (pos? idx) [(nth roles (dec idx))] [])
                        "back-all" (vec (take idx roles))
                        []))))]
      (if (= ["coder"] (rev "cleaner")) (pass "cleaner reverse-roles → coder")
          (fail (str "cleaner rev=" (rev "cleaner"))))
      (if (= ["specifier" "coder" "cleaner"] (rev "architect"))
        (pass "architect reverse-roles → all earlier")
        (fail (str "architect rev=" (rev "architect"))))
      (if (= [] (rev "QA")) (pass "QA forward-only → no reverse")
          (fail (str "QA rev=" (rev "QA")))))

    (if (zero? @fails)
      (do (println "ALL PASS") (System/exit 0))
      (do (println "FAILURES:" @fails) (System/exit 1)))
    (finally
      (handoff-lib/set-project-root! nil)
      (fs/delete-tree root))))
