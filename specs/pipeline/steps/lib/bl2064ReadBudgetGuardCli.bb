#!/usr/bin/env bb
;; BL-2064 acceptance driver: EXECUTES local_model_repeat_guard's real
;; `answer` (load-file'd straight from swarmforge/scripts/, never restated),
;; with a FAKE process killer and a FAKE release seam - each only writes a
;; sentinel file, never ending a real process or sending a real coordinator
;; note (the ticket's own direction: "the kill and release seams are
;; fakes" - this feature asserts only on which seam `answer` chose, the
;; same shape BL-1991's own bl1991RestartGuardCli.bb already uses for kill).
;;
;; Usage: bb bl2064ReadBudgetGuardCli.bb <event.json> <killed-file> <released-file>
;; Prints the hook's normal stdout (its JSON note, or nothing) unchanged.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*))
                         ".." ".." ".." ".." "swarmforge" "scripts" "local_model_repeat_guard.bb")))

(let [[event-path killed-file released-file] *command-line-args*
      event (json/parse-string (slurp event-path))
      kill-fn (fn [] (spit killed-file "killed"))
      release-fn (fn [_cwd] (spit released-file "released"))
      out (local-model-repeat-guard/answer event #(str/split-lines (slurp %)) kill-fn release-fn)]
  (when out (println out)))
