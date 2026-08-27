#!/usr/bin/env bb
;; TDD runner for named_tunnel_liveness_lib.bb (BL-1199) - pure assertions,
;; no git/process.
(ns named-tunnel-liveness-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "named_tunnel_liveness_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── liveness-verdict (feature scenario 01, ticket constraint) ────────────

(assert= "not configured at all is reported not-configured, regardless of pid state"
         :not-configured
         (named-tunnel-liveness-lib/liveness-verdict {:configured? false :pid-alive? true}))

(assert= "not configured and dead pid is STILL not-configured, never down (the ticket's own explicit constraint)"
         :not-configured
         (named-tunnel-liveness-lib/liveness-verdict {:configured? false :pid-alive? false}))

(assert= "configured with a live pid is up"
         :up
         (named-tunnel-liveness-lib/liveness-verdict {:configured? true :pid-alive? true}))

(assert= "configured with a dead pid is down - the exact 2026-08-27 incident shape (launcher exited 0, pid later died)"
         :down
         (named-tunnel-liveness-lib/liveness-verdict {:configured? true :pid-alive? false}))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: named_tunnel_liveness_lib.bb"))
