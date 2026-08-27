#!/usr/bin/env bb
;; BL-458: thin CLI wrapper so a Node caller (runnerAdapter.js's pre-run
;; reap, or a human/shell test) can trigger the REAL fixture-reaper-sweep-
;; lib/sweep! without a Babashka<->JS FFI - the same pattern
;; resolve_swarm_socket.bb (BL-367) already established. All real
;; configuration is read through the SAME env seams
;; fixture_reaper_sweep_lib.bb itself reads (SWARMFORGE_FIXTURE_REAP_ROOT,
;; SWARMFORGE_LEGACY_SOCKET_DIR, SWARMFORGE_FIXTURE_REAP_STALE_HOURS,
;; SWARMFORGE_FIXTURE_REAP_MAX_PER_TICK) - this wrapper takes no arguments
;; of its own.
;;
;; Usage: reap_stale_test_fixtures.bb

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "fixture_reaper_sweep_lib.bb")))

(fixture-reaper-sweep-lib/sweep!)
(println "reap_stale_test_fixtures: sweep complete")
