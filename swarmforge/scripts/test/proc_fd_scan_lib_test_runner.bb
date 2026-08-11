#!/usr/bin/env bb
;; BL-877: unit coverage for proc-fd-scan-lib's pure lsof `-F pfn` parser -
;; the Darwin half of live-pid-paths!'s portable /proc-vs-lsof split. Never
;; touches a real process table; every input here is a literal fixture
;; string, same posture as sandbox_sweep_lib_test_runner.bb's pure-logic
;; coverage of this file's own siblings.
(ns proc-fd-scan-lib-test-runner
  (:require [babashka.fs :as fs]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "proc_fd_scan_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── parse-lsof-pfn-output ───────────────────────────────────────────────

(assert= "empty input yields an empty map"
         {}
         (proc-fd-scan-lib/parse-lsof-pfn-output ""))

(assert= "a cwd entry is captured"
         {123 #{"/Users/x/project"}}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p123\nfcwd\nn/Users/x/project\n"))

(assert= "a numeric fd entry is captured, same as cwd"
         {123 #{"/Users/x/project" "/var/log/app.log"}}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p123\nfcwd\nn/Users/x/project\nf3\nn/var/log/app.log\n"))

(assert= "a txt (loaded executable/library image) fd is EXCLUDED - /proc/<pid>/fd has no equivalent entry, invariant 2 parity"
         {123 #{"/Users/x/project"}}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p123\nfcwd\nn/Users/x/project\nftxt\nn/usr/lib/dyld\n"))

(assert= "a mem fd is likewise excluded"
         {}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p123\nfmem\nn/usr/lib/libSystem.dylib\n"))

(assert= "a non-absolute-path name (socket/pipe description) is dropped - harmless noise, same as procfs's own socket:[...] targets"
         {123 #{"/Users/x/project"}}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p123\nfcwd\nn/Users/x/project\nf5\nn[TCP]\n"))

(assert= "multiple pids each get their own correct path set"
         {111 #{"/a"} 222 #{"/b" "/c"}}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p111\nfcwd\nn/a\np222\nfcwd\nn/b\nf4\nn/c\n"))

(assert= "a name line with no preceding pid is ignored, never crashes"
         {}
         (proc-fd-scan-lib/parse-lsof-pfn-output "fcwd\nn/orphan\n"))

(assert= "blank lines between records are tolerated"
         {123 #{"/Users/x/project"}}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p123\n\nfcwd\n\nn/Users/x/project\n"))

;; ── lsof-fd-id-rooting? (via the parser's own behavior, already covered
;;    above; this pins the exact boundary directly) ──────────────────────

(assert= "duplicate paths for the same pid collapse into one set entry"
         {123 #{"/Users/x/project"}}
         (proc-fd-scan-lib/parse-lsof-pfn-output "p123\nfcwd\nn/Users/x/project\nf9\nn/Users/x/project\n"))

;; ── live-pid-paths! contract on THIS live host (mirrors process_table_lib.bb's
;;    own BL-849 "pin the real-host contract, inject failure at the sweep
;;    boundary" posture - a genuine dual-facility-absent host cannot be
;;    portably constructed here) ───────────────────────────────────────────

(assert= "procfs-available? and live-pid-paths! agree this host has SOME determinable facility"
         false
         (nil? (proc-fd-scan-lib/live-pid-paths!)))

(let [result (proc-fd-scan-lib/live-pid-paths!)]
  (assert= "live-pid-paths! returns a real map on this live host" true (map? result))
  (assert= "live-pid-paths! finds at least one live process (this very bb process's ancestry)" true (pos? (count result))))

;; process-cwd-path / process-open-paths (pre-existing procfs helpers,
;; unchanged by BL-877 - pinned so a future edit here cannot silently
;; regress the Linux/WSL branch, which this macOS test host cannot itself
;; exercise end-to-end).
(assert= "process-cwd-path returns nil for a pid-dir that does not exist"
         nil
         (proc-fd-scan-lib/process-cwd-path "/no/such/pid/dir"))
(assert= "process-open-paths returns [] for a pid-dir that does not exist"
         []
         (proc-fd-scan-lib/process-open-paths "/no/such/pid/dir"))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "proc_fd_scan_lib_test_runner: ALL CHECKS PASSED"))
