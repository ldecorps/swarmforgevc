#!/usr/bin/env bb
;; BL-1991 acceptance driver: EXECUTES local_model_repeat_guard's real
;; `answer` (loaded straight from swarmforge/scripts/, never restated), with
;; a FAKE process killer that only writes a sentinel file - the step handler
;; never ends a real process (ticket's own direction: "Fixture transcripts
;; and a fake process controller; never the live seat").
;;
;; Usage: bb bl1991RestartGuardCli.bb <event.json> <killed-file>
;; Prints the hook's normal stdout (its JSON note, or nothing) unchanged, so
;; the step handler can tell a restart (nil output, killed-file written)
;; from an ordinary call (whatever `answer` would otherwise return).

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*))
                         ".." ".." ".." ".." "swarmforge" "scripts" "local_model_repeat_guard.bb")))

;; BL-1992: this feature's own scope is restart-only - a no-op release-fn
;; keeps a restart-exhausted scenario (03) from side-effecting a real
;; parcel move / swarm_handoff.sh send into this fixture, which this
;; feature never asserts on. bl1992ReleaseGuardCli.bb exercises the real
;; release-parcel! for BL-1992's own scenarios.
(let [[event-path killed-file] *command-line-args*
      event (json/parse-string (slurp event-path))
      kill-fn (fn [] (spit killed-file "killed"))
      out (local-model-repeat-guard/answer event #(str/split-lines (slurp %)) kill-fn (fn [_cwd] nil))]
  (when out (println out)))
