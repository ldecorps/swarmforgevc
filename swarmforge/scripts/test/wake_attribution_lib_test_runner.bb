#!/usr/bin/env bb
;; BL-870: TDD runner for wake_attribution_lib.bb - pure assertions
;; (build-attribution) plus fixture-based tests (motivating-handoff against
;; a real temp dir - no tmux, no live daemon, no real timers).

(ns wake-attribution-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "wake_attribution_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "wake-attribution-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── build-attribution (pure) ─────────────────────────────────────────────

(assert= "a landed wake with a present handoff names role/sweep/handoff/outcome"
         {:role "coder" :sweep "inbox-item" :handoffId "foo.handoff"
          :handoffPresent? true :outcome "landed" :atMs 1000}
         (wake-attribution-lib/build-attribution
          {:role "coder" :sweep "inbox-item" :handoff-id "foo.handoff"
           :outcome "landed" :at-ms 1000}))

(assert= "a wake with no handoff marks it explicitly absent, never a bare nil field"
         {:role "coder" :sweep "inbox-item" :handoffId nil
          :handoffPresent? false :outcome "landed" :atMs 1000}
         (wake-attribution-lib/build-attribution
          {:role "coder" :sweep "inbox-item" :handoff-id nil
           :outcome "landed" :at-ms 1000}))

(assert= "a skipped wake with a skip-reason records it"
         {:role "coordinator" :sweep "inbox-item" :handoffId "bar.handoff"
          :handoffPresent? true :outcome "skipped" :atMs 2000 :skipReason "busy"}
         (wake-attribution-lib/build-attribution
          {:role "coordinator" :sweep "inbox-item" :handoff-id "bar.handoff"
           :outcome "skipped" :at-ms 2000 :skip-reason "busy"}))

(assert= "a landed outcome never carries a skipReason field, even if one was passed"
         false
         (contains? (wake-attribution-lib/build-attribution
                     {:role "coder" :sweep "inbox-item" :handoff-id "foo.handoff"
                      :outcome "landed" :at-ms 1000 :skip-reason "busy"})
                    :skipReason))

(assert= "a skipped outcome with a blank skip-reason does not add the key"
         false
         (contains? (wake-attribution-lib/build-attribution
                     {:role "coder" :sweep "inbox-item" :handoff-id "foo.handoff"
                      :outcome "skipped" :at-ms 1000 :skip-reason ""})
                    :skipReason))

(assert= "sweep name constants are the exact strings the acceptance scenarios name"
         ["inbox-item" "stuck-in-process" "claim-idle-probe"]
         [wake-attribution-lib/sweep-inbox-item
          wake-attribution-lib/sweep-stuck-in-process
          wake-attribution-lib/sweep-claim-idle-probe])

(assert= "outcome constants are the exact strings the acceptance scenarios name"
         ["landed" "skipped"]
         [wake-attribution-lib/outcome-landed wake-attribution-lib/outcome-skipped])

;; ── motivating-handoff (real temp dir, no tmux) ───────────────────────────

(let [dir (mk-tmp)
      role-info {:role "coder" :worktree-path dir}]
  (assert= "an empty mailbox has no motivating handoff"
           nil
           (wake-attribution-lib/motivating-handoff role-info :new)))

(let [dir (mk-tmp)
      role-info {:role "coder" :worktree-path dir}
      new-dir (str (fs/path dir ".swarmforge" "handoffs" "inbox" "new"))]
  (fs/create-dirs new-dir)
  (spit (str (fs/path new-dir "00_20260810T000000Z_000001_from_specifier_to_coder.handoff")) "id: x\n")
  (assert= "a single handoff in the mailbox is named"
           "00_20260810T000000Z_000001_from_specifier_to_coder.handoff"
           (wake-attribution-lib/motivating-handoff role-info :new)))

(let [dir (mk-tmp)
      role-info {:role "coder" :worktree-path dir}
      new-dir (str (fs/path dir ".swarmforge" "handoffs" "inbox" "new"))]
  (fs/create-dirs new-dir)
  ;; BL-870: filename order is deterministic (priority_timestamp_sequence
  ;; prefix), so with two items present the earliest/highest-priority one is
  ;; named - never file-system listing order, which is unspecified.
  (spit (str (fs/path new-dir "50_20260810T000200Z_000002_from_coordinator_to_coder.handoff")) "id: y\n")
  (spit (str (fs/path new-dir "00_20260810T000100Z_000001_from_specifier_to_coder.handoff")) "id: x\n")
  (assert= "with multiple handoffs present, the filename-sorted first is named"
           "00_20260810T000100Z_000001_from_specifier_to_coder.handoff"
           (wake-attribution-lib/motivating-handoff role-info :new)))

(let [dir (mk-tmp)
      role-info {:role "coder" :worktree-path dir}
      new-dir (str (fs/path dir ".swarmforge" "handoffs" "inbox" "new"))]
  (fs/create-dirs new-dir)
  (spit (str (fs/path new-dir "not-a-handoff.chase.json")) "{}")
  (assert= "a sidecar file alone is never mistaken for a motivating handoff"
           nil
           (wake-attribution-lib/motivating-handoff role-info :new)))

(let [dir (mk-tmp)
      role-info {:role "coder" :worktree-path dir}
      in-process-dir (str (fs/path dir ".swarmforge" "handoffs" "inbox" "in_process"))]
  (fs/create-dirs in-process-dir)
  (spit (str (fs/path in-process-dir "00_20260810T000000Z_000001_from_coordinator_to_coder.handoff")) "id: x\n")
  (assert= ":in_process is read independently of :new"
           "00_20260810T000000Z_000001_from_coordinator_to_coder.handoff"
           (wake-attribution-lib/motivating-handoff role-info :in_process)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: wake_attribution_lib.bb"))
