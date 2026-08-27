#!/usr/bin/env bb
;; BL-486: thin CLI wrapper so a human or a test can trigger the REAL
;; orphan-agent-reaper-sweep-lib/sweep! against a project root without a
;; Babashka<->JS FFI - modelled on reap_stale_test_fixtures.bb (BL-458).
;; All real configuration is read through the SAME env seam
;; orphan_agent_reaper_sweep_lib.bb itself reads
;; (SWARMFORGE_ORPHAN_REAP_STALE_HOURS, and the test-only
;; SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS override) - this wrapper takes only
;; the project-root argument.
;;
;; Usage: reap_orphan_agents.bb <project-root>

(require '[babashka.fs :as fs])

(defn usage []
  (binding [*out* *err*]
    (println "Usage: reap_orphan_agents.bb <project-root>"))
  (System/exit 1))

(def project-root (or (first *command-line-args*) (usage)))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "orphan_agent_reaper_sweep_lib.bb")))

(orphan-agent-reaper-sweep-lib/sweep! project-root)
(println "reap_orphan_agents: sweep complete")
