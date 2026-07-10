#!/usr/bin/env bb
;; TDD runner for backlog_depth_lib.bb (BL-216) - pure assertions over
;; provided conf text/counts, plus fixture-based tests for the impure
;; read-max-depth (real fs I/O against a temp dir, no live swarm).
(ns backlog-depth-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "backlog_depth_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── parse-max-depth (pure) ─────────────────────────────────────────────────

(assert= "parses a positive cap"
         3
         (backlog-depth-lib/parse-max-depth "config active_backlog_max_depth 3"))

(assert= "depth-fix-02: parses the -1 no-limit sentinel as -1, not 1 (the old unsigned-regex bug)"
         -1
         (backlog-depth-lib/parse-max-depth "config active_backlog_max_depth -1"))

(assert= "ignores surrounding comment/blank lines and other config keys"
         3
         (backlog-depth-lib/parse-max-depth "# a comment\n\nconfig mutation_cooldown_days 3\nconfig active_backlog_max_depth 3\n"))

(assert= "falls back to the default when the config line is absent"
         backlog-depth-lib/default-max-depth
         (backlog-depth-lib/parse-max-depth "config mutation_cooldown_days 3"))

(assert= "falls back to the default for nil conf text"
         backlog-depth-lib/default-max-depth
         (backlog-depth-lib/parse-max-depth nil))

(assert= "falls back to the default for empty conf text"
         backlog-depth-lib/default-max-depth
         (backlog-depth-lib/parse-max-depth ""))

;; ── no-limit? / depth-exceeded? / under-depth-cap? (pure) ─────────────────

(assert= "no-limit? is true for any negative value" true (backlog-depth-lib/no-limit? -1))
(assert= "no-limit? is false for zero" false (backlog-depth-lib/no-limit? 0))
(assert= "no-limit? is false for a positive value" false (backlog-depth-lib/no-limit? 3))

(assert= "depth-01a: no-limit (-1) never warns, however deep active/ is"
         false
         (backlog-depth-lib/depth-exceeded? 5 -1))

(assert= "depth-01b: a positive cap the active count exceeds warns"
         true
         (backlog-depth-lib/depth-exceeded? 5 3))

(assert= "depth-01c: a positive cap the active count does not exceed does not warn"
         false
         (backlog-depth-lib/depth-exceeded? 2 3))

(assert= "an active count exactly AT the cap does not warn - only strictly over triggers it"
         false
         (backlog-depth-lib/depth-exceeded? 3 3))

(assert= "depth-02: no-limit (-1) always leaves promotion ungated, however deep active/ is"
         true
         (backlog-depth-lib/under-depth-cap? 5 -1))

(assert= "a positive cap still gates promotion normally when active count is at/over it"
         false
         (backlog-depth-lib/under-depth-cap? 3 3))

(assert= "a positive cap still allows promotion when active count is under it"
         true
         (backlog-depth-lib/under-depth-cap? 1 3))

;; ── read-max-depth (fixture-based fs I/O, no live swarm) ──────────────────

(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "backlog-depth-test-"})))

(let [root (mk-tmp)]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf")) "config active_backlog_max_depth -1\n")
  (assert= "depth-03: read-max-depth reads the REAL tracked swarmforge/swarmforge.conf, not a silent default"
           -1
           (backlog-depth-lib/read-max-depth root)))

(let [root (mk-tmp)]
  ;; Deliberately no swarmforge/swarmforge.conf at all - the previous bug's
  ;; wrong path (.swarmforge/swarmforge.conf) made EVERY call fall through
  ;; to the exception handler regardless of what the real file said.
  (assert= "depth-04: an absent config degrades to the default, not a crash"
           backlog-depth-lib/default-max-depth
           (backlog-depth-lib/read-max-depth root)))

(let [root (mk-tmp)]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf")) "config active_backlog_max_depth 3\n")
  (assert= "read-max-depth reads a positive cap correctly too"
           3
           (backlog-depth-lib/read-max-depth root)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: backlog_depth_lib.bb"))
