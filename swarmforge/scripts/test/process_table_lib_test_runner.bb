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
               (>= (process-table-lib/age-ms! self-pid) 0))
  (assert-true "list-processes! never returns a blank-cmdline entry"
               (not-any? (fn [{:keys [cmdline]}] (str/blank? cmdline)) procs)))

;; list-pids! is the enumeration list-processes! itself is built on - covered
;; only indirectly (via list-processes!) before this pass. Assert it actually
;; sees this JVM, on both the /proc and ProcessHandle branches.
(let [pids (process-table-lib/list-pids!)
      self-pid (.pid (java.lang.ProcessHandle/current))]
  (assert-true "list-pids! returns a non-empty vector" (seq pids))
  (assert-true "list-pids! includes this process's own pid" (some #{self-pid} pids)))

;; A pid that (almost certainly) does not exist on this host must degrade
;; gracefully everywhere - never throw, never a stack trace surfaced up
;; through an orphan-reaper sweep that is iterating live candidate pids one
;; of which may have exited between enumeration and inspection.
(let [dead-pid 999999999]
  (assert= "cmdline! for a nonexistent pid is the empty string, not a throw"
           "" (process-table-lib/cmdline! dead-pid))
  (assert= "age-ms! for a nonexistent pid is 0, not a throw"
           0 (process-table-lib/age-ms! dead-pid))
  (assert-true "cwd! for a nonexistent pid never throws (nil or blank)"
               (let [v (process-table-lib/cwd! dead-pid)] (or (nil? v) (str/blank? v)))))

;; cwd! for THIS process is best-effort by its own docstring (procfs on
;; Linux/WSL, `lsof` on Darwin - absent when lsof is not resolvable on
;; PATH), so only assert the contract it actually promises: never throws,
;; and whatever it returns is either nil or a real, non-blank string -
;; never an exception object, an empty non-nil value, or a relative path.
(let [self-pid (.pid (java.lang.ProcessHandle/current))
      cwd (process-table-lib/cwd! self-pid)]
  (assert-true "cwd! for self is nil or a non-blank absolute path"
               (or (nil? cwd) (and (not (str/blank? cwd)) (str/starts-with? cwd "/")))))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "process_table_lib_test_runner: ALL CHECKS PASSED"))
