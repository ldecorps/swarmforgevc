#!/usr/bin/env bb
;; TDD runner for fixture_reaper_lib.bb (BL-458) - pure assertions against
;; injected decision inputs, no real /tmp, no real process table.
(ns fixture-reaper-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "fixture_reaper_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── known-fixture-prefix?: an ALLOWLIST, never a denylist ──────────────────
(assert= "known-fixture-prefix?: aps- matches" true (fixture-reaper-lib/known-fixture-prefix? "aps-front-desk-headless-abc123"))
(assert= "known-fixture-prefix?: sfvc- matches" true (fixture-reaper-lib/known-fixture-prefix? "sfvc-xyz789"))
(assert= "known-fixture-prefix?: bl404-front-desk- matches" true (fixture-reaper-lib/known-fixture-prefix? "bl404-front-desk-abc"))
(assert= "known-fixture-prefix?: an unknown prefix does not match" false (fixture-reaper-lib/known-fixture-prefix? "tmp.abc123"))
(assert= "known-fixture-prefix?: the swarm's own legacy socket dir name does not match" false
         (fixture-reaper-lib/known-fixture-prefix? "swarmforge-1000"))

;; ── reapable?: fixture-process-leak-01 (Scenario Outline) - the four
;;    prefix-match x stale x is-socket-root combinations ───────────────────
(assert= "reapable?: known prefix, stale, not socket root -> reaped" true
         (fixture-reaper-lib/reapable? {:known-fixture-prefix? true :stale? true :socket-root? false}))
(assert= "reapable?: known prefix, NOT stale, not socket root -> kept" false
         (fixture-reaper-lib/reapable? {:known-fixture-prefix? true :stale? false :socket-root? false}))
(assert= "reapable?: UNKNOWN prefix, stale, not socket root -> kept" false
         (fixture-reaper-lib/reapable? {:known-fixture-prefix? false :stale? true :socket-root? false}))
(assert= "reapable?: known prefix, stale, IS socket root -> kept" false
         (fixture-reaper-lib/reapable? {:known-fixture-prefix? true :stale? true :socket-root? true}))

;; ── reapable?: the socket-root exclusion wins over age even when every
;;    other signal says "reap" (the engineering "newly-adjacent branch
;;    overlap" rule - proving ordering, not just each branch alone) ────────
(assert= "reapable?: socket root wins over a known prefix + stale (every other signal says reap)" false
         (fixture-reaper-lib/reapable? {:known-fixture-prefix? true :stale? true :socket-root? true}))

;; ── report ─────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: fixture_reaper_lib.bb"))
