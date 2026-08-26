#!/usr/bin/env bb
;; BL-1080: property — unsupported-agent family points at Cursor-seat how-to;
;; how-to states Cursor vs /pilot vs Claude (invariant 2).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def repo (str (fs/canonicalize (fs/path (fs/parent *file*) ".." ".." ".."))))
(def launcher (slurp (str (fs/path repo "swarmforge" "scripts" "swarmforge.sh"))))
(def howto-rel "docs/how-to/BL-1080-choose-a-cursor-seat.md")
(def howto (slurp (str (fs/path repo howto-rel))))

(def failures (atom []))

(defn- fail! [msg] (swap! failures conj msg))

(def sites
  (vec (re-seq #"Unsupported agent '\$agent' for role '\$role'[^\n\"]*" launcher)))

(when (< (count sites) 2)
  (fail! (str "expected ≥2 literal refusal sites, got " (count sites))))

(doseq [s sites]
  (when-not (str/includes? s howto-rel)
    (fail! (str "refusal missing how-to path: " s))))

(when (re-find #"refuse_unsupported_agent" launcher)
  (fail! "shared refuse_unsupported_agent helper collapses APS site count — keep dual literals"))

(when-not (re-find #"(?i)Cursor seat" howto)
  (fail! "how-to must name Cursor seat"))
(when-not (re-find #"/pilot" howto)
  (fail! "how-to must contrast /pilot"))
(when-not (re-find #"(?i)Claude" howto)
  (fail! "how-to must contrast Claude"))

(if (empty? @failures)
  (println "bl1080_cursor_seat_property: ALL PROPERTIES HOLD")
  (do (println (str "bl1080_cursor_seat_property: " (count @failures) " FAILURE(S)"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
