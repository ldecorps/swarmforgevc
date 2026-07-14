#!/usr/bin/env bb
;; BL-328: TDD runner for build_freshness_lib.bb's pure functions - no
;; filesystem, no git, no process I/O. Mirrors operator_lib_test_runner.bb.

(ns build-freshness-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "build_freshness_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── stale? ──────────────────────────────────────────────────────────────
(assert-true "per-merged-code-reaches-daemons-01: a running sha behind main is stale"
             (build-freshness-lib/stale? "abc111" "def222"))
(assert-false "per-merged-code-reaches-daemons-06: a running sha matching main is not stale"
              (build-freshness-lib/stale? "abc111" "abc111"))
(assert-false "an unresolvable running sha (nil) is never reported stale - never fabricate"
              (build-freshness-lib/stale? nil "def222"))
(assert-false "an unresolvable running sha (blank string) is never reported stale"
              (build-freshness-lib/stale? "" "def222"))
(assert-false "an unresolvable main sha is never reported stale"
              (build-freshness-lib/stale? "abc111" nil))
(assert-false "both unresolvable is never reported stale"
              (build-freshness-lib/stale? nil nil))

;; ── freshness-entry ─────────────────────────────────────────────────────
(assert= "freshness-entry names both the running and main build for a stale process"
         {:name "bridge" :running_sha "abc111" :main_sha "def222" :stale true}
         (build-freshness-lib/freshness-entry {:name "bridge" :running-sha "abc111"} "def222"))

(assert= "freshness-entry for a fresh process"
         {:name "bridge" :running_sha "abc111" :main_sha "abc111" :stale false}
         (build-freshness-lib/freshness-entry {:name "bridge" :running-sha "abc111"} "abc111"))

(assert= "freshness-entry blanks an empty-string sha to nil, not a false-looking empty string"
         {:name "handoffd" :running_sha nil :main_sha "def222" :stale false}
         (build-freshness-lib/freshness-entry {:name "handoffd" :running-sha ""} "def222"))

;; ── freshness-report / stale-process-names ─────────────────────────────
(assert= "per-merged-code-reaches-daemons-03: every process gets its own entry, whatever language it is"
         [{:name "bridge (compiled)" :running_sha "abc111" :main_sha "def222" :stale true}
          {:name "handoffd (interpreted)" :running_sha "def222" :main_sha "def222" :stale false}]
         (build-freshness-lib/freshness-report
          [{:name "bridge (compiled)" :running-sha "abc111"}
           {:name "handoffd (interpreted)" :running-sha "def222"}]
          "def222"))

(assert= "stale-process-names extracts exactly the stale ones, in order"
         ["bridge" "bot"]
         (build-freshness-lib/stale-process-names
          [{:name "bridge" :running_sha "a" :main_sha "z" :stale true}
           {:name "handoffd" :running_sha "z" :main_sha "z" :stale false}
           {:name "bot" :running_sha "b" :main_sha "z" :stale true}]))

(assert= "stale-process-names is empty when nothing is stale"
         []
         (build-freshness-lib/stale-process-names
          [{:name "bridge" :running_sha "z" :main_sha "z" :stale false}]))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "build_freshness_lib: ALL TESTS PASSED"))
