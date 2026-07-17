#!/usr/bin/env bb
;; BL-486: TDD runner for orphan_agent_reaper_lib.bb - pure assertions
;; against injected decision inputs, no real /proc, no real tmux socket, no
;; real process table. Mirrors fixture_reaper_lib_test_runner.bb's own
;; shape and the exact Examples table in
;; specs/features/BL-486-reap-orphaned-agent-processes.feature's
;; reap-orphaned-agent-processes-01 Scenario Outline.
(ns orphan-agent-reaper-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "orphan_agent_reaper_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn all-clear []
  {:in-live-window-set? false
   :cwd-inside-root? false
   :remote-control-agent? true
   :has-children? false
   :stale? true})

;; ── reapable?: reap-orphaned-agent-processes-01 (Scenario Outline) ────────
(assert= "all gates clear -> reaped"
         true
         (orphan-agent-reaper-lib/reapable? (all-clear)))

(assert= "in the live window set -> never reaped (the decapitation guard)"
         false
         (orphan-agent-reaper-lib/reapable? (assoc (all-clear) :in-live-window-set? true)))

(assert= "cwd still resolves inside the repo root -> never reaped"
         false
         (orphan-agent-reaper-lib/reapable? (assoc (all-clear) :cwd-inside-root? true)))

(assert= "not a SwarmForge remote-control agent -> never reaped"
         false
         (orphan-agent-reaper-lib/reapable? (assoc (all-clear) :remote-control-agent? false)))

(assert= "has live child processes -> never reaped"
         false
         (orphan-agent-reaper-lib/reapable? (assoc (all-clear) :has-children? true)))

(assert= "not yet past the stale threshold -> never reaped (protects an in-progress dry-run)"
         false
         (orphan-agent-reaper-lib/reapable? (assoc (all-clear) :stale? false)))

;; ── ordering: the live-window-set exclusion wins FIRST, even when every
;;    other signal says "reap" (engineering.prompt's newly-adjacent-branch
;;    rule - proving priority order, not just each gate alone) ────────────
(assert= "live-window-set wins over every other signal saying reap"
         false
         (orphan-agent-reaper-lib/reapable?
          {:in-live-window-set? true
           :cwd-inside-root? false
           :remote-control-agent? true
           :has-children? false
           :stale? true}))

;; ── report ──────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: orphan_agent_reaper_lib.bb"))
