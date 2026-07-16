#!/usr/bin/env bb
;; TDD runner for sandbox_sweep_lib.bb (BL-413) - pure assertions against
;; injected decision inputs, no real /tmp, no real process table.
(ns sandbox-sweep-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "sandbox_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── known-sandbox-prefix?: an ALLOWLIST, never a denylist ──────────────────
(assert= "known-sandbox-prefix?: sfvc- matches" true (sandbox-sweep-lib/known-sandbox-prefix? "sfvc-abc123"))
(assert= "known-sandbox-prefix?: aps- matches" true (sandbox-sweep-lib/known-sandbox-prefix? "aps-xyz789"))
(assert= "known-sandbox-prefix?: an unknown prefix does not match" false (sandbox-sweep-lib/known-sandbox-prefix? "tmp.abc123"))
(assert= "known-sandbox-prefix?: the swarm's own legacy socket dir name does not match" false
         (sandbox-sweep-lib/known-sandbox-prefix? "swarmforge-1000"))
(assert= "known-sandbox-prefix?: a substring match in the middle of a name does not count as a prefix" false
         (sandbox-sweep-lib/known-sandbox-prefix? "not-sfvc-prefixed"))

;; ── removable?: stale-sandbox-sweep-01 (Scenario Outline) - the four
;;    prefix-match x stale x live-process combinations ─────────────────────
(assert= "removable?: known prefix, stale, no live process -> removable" true
         (sandbox-sweep-lib/removable? {:known-sandbox-prefix? true :stale? true :has-live-process? false :socket-dir? false}))
(assert= "removable?: known prefix, NOT stale, no live process -> kept" false
         (sandbox-sweep-lib/removable? {:known-sandbox-prefix? true :stale? false :has-live-process? false :socket-dir? false}))
(assert= "removable?: known prefix, stale, HAS a live process -> kept" false
         (sandbox-sweep-lib/removable? {:known-sandbox-prefix? true :stale? true :has-live-process? true :socket-dir? false}))
(assert= "removable?: UNKNOWN prefix, stale, no live process -> kept" false
         (sandbox-sweep-lib/removable? {:known-sandbox-prefix? false :stale? true :has-live-process? false :socket-dir? false}))

;; ── removable?: stale-sandbox-sweep-02 - the socket-dir exclusion wins over
;;    age (and, per the engineering "newly-adjacent branch overlap" rule,
;;    over every other condition too - this case has EVERY other condition
;;    also pointing at "removable", proving socket-dir? alone decides it) ──
(assert= "removable?: socket dir wins over a known prefix + stale + no live process (every other signal says removable)"
         false
         (sandbox-sweep-lib/removable? {:known-sandbox-prefix? true :stale? true :has-live-process? false :socket-dir? true}))

;; ── removable?: the not-stale and has-live-process guards each independently
;;    override an otherwise-removable entry, proven with BOTH held true at
;;    once so the ordering itself is pinned (the engineering "test both
;;    branches' trigger conditions true at once" rule) ─────────────────────
(assert= "removable?: not stale AND has a live process (both guards true at once) -> still kept" false
         (sandbox-sweep-lib/removable? {:known-sandbox-prefix? true :stale? false :has-live-process? true :socket-dir? false}))

;; ── report ─────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: sandbox_sweep_lib.bb"))
