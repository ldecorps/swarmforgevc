#!/usr/bin/env bb
;; BL-372: TDD runner for swarm_detach_lib.bb's pure detached?/decide-
;; launch-outcome decisions. No real processes, no real tmux - just data,
;; so every case (including the "still owned by the caller" failure path)
;; is deterministic and instant.

(ns swarm-detach-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_detach_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── detached? ─────────────────────────────────────────────────────────────

(assert= "a server re-parented away from the caller is detached"
         true
         (swarm-detach-lib/detached? {:server-ppid 1 :caller-pid 4242}))

(assert= "a server whose ppid still IS the caller's pid is not detached"
         false
         (swarm-detach-lib/detached? {:server-ppid 4242 :caller-pid 4242}))

(assert= "a server re-parented to a container subreaper (not literal pid 1) still counts as detached"
         true
         (swarm-detach-lib/detached? {:server-ppid 1641 :caller-pid 4242}))

(assert= "a missing server-ppid can never be judged detached"
         false
         (swarm-detach-lib/detached? {:server-ppid nil :caller-pid 4242}))

(assert= "a missing caller-pid can never be judged detached"
         false
         (swarm-detach-lib/detached? {:server-ppid 1 :caller-pid nil}))

;; ── decide-launch-outcome: BL-372 scenario 01/02 (ready + detached) ────────

(assert= "ready and detached is a clean pass"
         {:ok? true :message "swarm is up and its tmux server is detached from the caller"}
         (swarm-detach-lib/decide-launch-outcome {:ready? true :detached? true}))

;; ── decide-launch-outcome: BL-372 scenario 02 (still owned by caller) ─────

(assert= "ready but still owned by the caller fails loudly, naming the cause"
         {:ok? false
          :message "swarm came up but its tmux server is still owned by the caller - it will die when the caller exits"}
         (swarm-detach-lib/decide-launch-outcome {:ready? true :detached? false}))

;; ── decide-launch-outcome: BL-372 scenario 03 (readiness gate survives) ───

(assert= "never-ready fails on readiness alone, even if detachment somehow looked fine"
         {:ok? false :message "swarm did not become ready"}
         (swarm-detach-lib/decide-launch-outcome {:ready? false :detached? true}))

(assert= "never-ready AND not detached still reports the readiness failure first"
         {:ok? false :message "swarm did not become ready"}
         (swarm-detach-lib/decide-launch-outcome {:ready? false :detached? false}))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "swarm_detach_lib (BL-372): ALL TESTS PASSED")
  (do (println (str "swarm_detach_lib (BL-372): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
