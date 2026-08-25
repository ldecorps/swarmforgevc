#!/usr/bin/env bb
;; BL-533: untracked acceptance never passes; multi-slice epic needs wiring.

(require '[babashka.fs :as fs])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "backlog_hygiene_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(when (:ok? (backlog-hygiene-lib/epic-wiring-exit-checklist
             "type: epic\ndecomposes_into: [A, B]\n" ["id: A\n" "id: B\n"]))
  (fail! "unwired multi-slice epic must fail checklist"))

(when-not (:ok? (backlog-hygiene-lib/epic-wiring-exit-checklist
                 "type: epic\ndecomposes_into: [A, B]\n"
                 ["id: A\nrequired_wiring: [x::y]\n" "id: B\n"]))
  (fail! "one wired child must pass"))

(when (backlog-hygiene-lib/required-wiring-nonempty? "id: X\n")
  (fail! "empty wiring must be false"))

(when-not (backlog-hygiene-lib/required-wiring-nonempty?
           "required_wiring:\n  - \"a::b\"\n")
  (fail! "block wiring must be nonempty"))

(if (empty? @failures)
  (println "bl533_exit_gates_property: ALL PROPERTIES HOLD")
  (do (println (str "bl533_exit_gates_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
