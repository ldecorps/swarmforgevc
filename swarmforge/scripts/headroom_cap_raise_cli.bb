#!/usr/bin/env bb
;; BL-1128: deterministic owner for raising active_backlog_max_depth on
;; sustained CPU+memory headroom (config-level, reversible), plus eligible
;; hold→paused unhold. Coordinator must run this rather than hand-edit depth.
;;
;; Usage:
;;   headroom_cap_raise_cli.bb <project-root> raise
;;   headroom_cap_raise_cli.bb <project-root> unhold
;;   headroom_cap_raise_cli.bb <project-root> undo

(ns headroom-cap-raise-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "headroom_cap_raise_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: headroom_cap_raise_cli.bb <project-root> <raise|unhold|undo>")
    (println "  raise  — raise configured depth when headroom+throttle allow")
    (println "  unhold — after a successful raise, move eligible hold/ → paused/")
    (println "  undo   — restore the prior configured depth from the last raise"))
  (System/exit 1))

(defn -main [& args]
  (when (not= 2 (count args))
    (usage))
  (let [[root cmd] args
        result (case cmd
                 "raise" (headroom-cap-raise-lib/run-raise! root {})
                 "unhold" (headroom-cap-raise-lib/run-unhold! root)
                 "undo" (headroom-cap-raise-lib/run-undo! root)
                 (usage))]
    (println (json/generate-string result))))

(apply -main *command-line-args*)
