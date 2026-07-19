#!/usr/bin/env bb
;; Reproduce 2026-07-19 mono-router handoff wake failures:
;;   handoffd injected into swarmforge-hardender / swarmforge-architect / …
;;   which do not exist under rotation router → `tmux send-literal failed`
;;   and parcels marked failed even when the mailbox file landed.
;;
;; resolve-wake-session is the pure decision; wake-session is the I/O wrapper.

(ns handoff-wake-session-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg))))

(defn assert-false [msg actual]
  (when actual
    (swap! failures conj (str "FAIL: " msg "\n  got truthy: " (pr-str actual)))))

;; ── wake remap (pure) ─────────────────────────────────────────────────────

(assert= "standing session wakes itself"
         "swarmforge-coder"
         (handoff-lib/resolve-wake-session
          {:configured-session "swarmforge-coder"
           :configured-exists? true
           :resident-session "swarmforge-coder"
           :resident-exists? true}))

(assert= "dormant hardender remaps to resident when hardender pane is missing"
         "swarmforge-coder"
         (handoff-lib/resolve-wake-session
          {:configured-session "swarmforge-hardender"
           :configured-exists? false
           :resident-session "swarmforge-coder"
           :resident-exists? true}))

(assert= "dormant architect remaps to resident"
         "swarmforge-coder"
         (handoff-lib/resolve-wake-session
          {:configured-session "swarmforge-architect"
           :configured-exists? false
           :resident-session "swarmforge-coder"
           :resident-exists? true}))

(assert= "dormant specifier remaps to resident (stuck-email flood companion)"
         "swarmforge-coder"
         (handoff-lib/resolve-wake-session
          {:configured-session "swarmforge-specifier"
           :configured-exists? false
           :resident-session "swarmforge-coder"
           :resident-exists? true}))

(assert= "if resident is also missing, keep configured name (caller sees real tmux failure)"
         "swarmforge-cleaner"
         (handoff-lib/resolve-wake-session
          {:configured-session "swarmforge-cleaner"
           :configured-exists? false
           :resident-session "swarmforge-coder"
           :resident-exists? false}))

(assert= "no resident known → keep configured"
         "swarmforge-QA"
         (handoff-lib/resolve-wake-session
          {:configured-session "swarmforge-QA"
           :configured-exists? false
           :resident-session nil
           :resident-exists? false}))

;; ── roles.tsv resident session parse ──────────────────────────────────────

(assert= "first non-coordinator session is the mono-router resident"
         "swarmforge-coder"
         (handoff-lib/parse-mono-router-resident-session
          (str "coder\tcodex\t.\tswarmforge-coder\n"
               "cleaner\tcodex\t.\tswarmforge-cleaner\n"
               "coordinator\taider\t.\tswarmforge-coordinator\n")))

(assert= "coordinator-first roles.tsv still picks first pipeline session"
         "swarmforge-coder"
         (handoff-lib/parse-mono-router-resident-session
          (str "coordinator\taider\t.\tswarmforge-coordinator\n"
               "coder\tcodex\t.\tswarmforge-coder\n"
               "QA\tcodex\t.\tswarmforge-QA\n")))

(assert= "blank roles.tsv → nil"
         nil
         (handoff-lib/parse-mono-router-resident-session ""))

;; ── stuck-escalation email gate (dormant mono-router panes) ───────────────
;; Incident: specifier had in_process mail, no standing pane; handoffd emailed
;; "specifier is stuck" forever. Consoles still get chase-escalations.json;
;; email must only fire for roles with a live session (or when clearing).

(assert-true "clearing escalation always allowed (recovery path)"
             (mono-router-lib/should-send-stuck-escalation-email?
              {:escalated? false :session-exists? false}))

(assert-false "escalating a dormant role (no standing pane) must NOT email"
              (mono-router-lib/should-send-stuck-escalation-email?
               {:escalated? true :session-exists? false}))

(assert-true "escalating a standing role may email"
             (mono-router-lib/should-send-stuck-escalation-email?
              {:escalated? true :session-exists? true}))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "handoff_wake_session_test_runner: ALL TESTS PASSED")
