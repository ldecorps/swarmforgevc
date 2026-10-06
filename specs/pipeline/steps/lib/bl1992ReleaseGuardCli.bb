#!/usr/bin/env bb
;; BL-1992 acceptance driver: EXECUTES local_model_repeat_guard's real
;; `answer` (loaded straight from swarmforge/scripts/, never restated), with
;; the SAME fake process killer bl1991RestartGuardCli.bb uses, but the REAL
;; release-parcel! (the default release-fn `answer` falls back to) - this
;; feature's own scope is the move-to-abandoned and the coordinator note,
;; so unlike BL-1991's own driver, release must run for real against the
;; fixture root.
;;
;; Usage: bb bl1992ReleaseGuardCli.bb <event.json> <killed-file>
;; Prints the hook's normal stdout (its JSON note, or nothing) unchanged.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*))
                         ".." ".." ".." ".." "swarmforge" "scripts" "local_model_repeat_guard.bb")))

(let [[event-path killed-file] *command-line-args*
      event (json/parse-string (slurp event-path))
      kill-fn (fn [] (spit killed-file "killed"))
      out (local-model-repeat-guard/answer event #(str/split-lines (slurp %)) kill-fn)]
  (when out (println out)))
