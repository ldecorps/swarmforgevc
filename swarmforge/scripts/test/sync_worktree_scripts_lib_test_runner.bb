#!/usr/bin/env bb
;; BL-373: TDD runner for sync_worktree_scripts_lib.bb's pure should-copy?
;; decision. No real git, no real filesystem - just set membership, so
;; every case is deterministic and instant.

(ns sync-worktree-scripts-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "sync_worktree_scripts_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(assert= "a path the worktree's git index already tracks is never copied over"
         false
         (sync-worktree-scripts-lib/should-copy?
          {:tracked-paths #{"swarmforge/scripts/handoffd.bb"}
           :dest-relative-path "swarmforge/scripts/handoffd.bb"}))

(assert= "a path the worktree's git index does NOT track is copied (the foreign-target-repo case)"
         true
         (sync-worktree-scripts-lib/should-copy?
          {:tracked-paths #{}
           :dest-relative-path "swarmforge/scripts/handoffd.bb"}))

(assert= "a new untracked file alongside tracked ones is still copied"
         true
         (sync-worktree-scripts-lib/should-copy?
          {:tracked-paths #{"swarmforge/scripts/handoffd.bb"}
           :dest-relative-path "swarmforge/scripts/brand_new_script.bb"}))

(assert= "an empty tracked-paths set never blocks a copy"
         true
         (sync-worktree-scripts-lib/should-copy?
          {:tracked-paths nil
           :dest-relative-path "swarmforge/scripts/handoffd.bb"}))

(assert= "only the exact tracked path is blocked - a same-named file in a different directory still copies"
         true
         (sync-worktree-scripts-lib/should-copy?
          {:tracked-paths #{"swarmforge/scripts/handoffd.bb"}
           :dest-relative-path "swarmforge/profiles/handoffd.bb"}))

(if (empty? @failures)
  (println "sync_worktree_scripts_lib (BL-373): ALL TESTS PASSED")
  (do (println (str "sync_worktree_scripts_lib (BL-373): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
