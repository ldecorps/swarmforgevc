#!/usr/bin/env bb
;; Smoke tests for process_table_lib.bb (cross-platform process enumeration).
(ns process-table-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "process_table_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (assert= msg true (boolean actual)))

(let [os (str/lower-case (or (System/getProperty "os.name") ""))]
  (if (str/includes? os "mac")
    (assert= "Darwin has no /proc" false (process-table-lib/procfs-available?))
    (when (fs/directory? "/proc")
      (assert= "Linux/WSL reports procfs available" true (process-table-lib/procfs-available?)))))

(let [procs (process-table-lib/list-processes!)
      self-pid (.pid (java.lang.ProcessHandle/current))
      self-cmd (process-table-lib/cmdline! self-pid)]
  (assert-true "list-processes! returns a non-empty vector" (seq procs))
  (assert-true "self cmdline is non-blank" (not (str/blank? self-cmd)))
  (assert-true "age-ms! for self is non-negative"
               (>= (process-table-lib/age-ms! self-pid) 0)))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "process_table_lib_test_runner: ALL CHECKS PASSED"))
