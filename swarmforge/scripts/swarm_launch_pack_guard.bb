#!/usr/bin/env bb
;; Guard against bare ./swarm relaunch downgrading mono-router → full pack.
;;
;; Usage (from swarmforge.sh):
;;   bb swarm_launch_pack_guard.bb check <project-root> <config-path> \
;;        <SWARMFORGE_PACK> <SWARMFORGE_CONFIG> <explicit-pack-cli:0|1> \
;;        <SWARMFORGE_ALLOW_FULL_PACK>

(ns swarm-launch-pack-guard
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "swarm_identity_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: swarm_launch_pack_guard.bb check <project-root> <config-path> \\")
    (println "         <SWARMFORGE_PACK> <SWARMFORGE_CONFIG> <explicit-pack-cli:0|1> \\")
    (println "         <SWARMFORGE_ALLOW_FULL_PACK>"))
  (System/exit 2))

(defn -main []
  (let [args (vec *command-line-args*)]
    (when (or (< (count args) 6) (not= (first args) "check"))
      (usage))
    (let [project-root (nth args 1)
          config-path (nth args 2)
          downgrade (swarm-identity-lib/accidental-full-pack-downgrade?
                     {:project-root project-root
                      :config-path config-path
                      :swarmforge-pack (nth args 3)
                      :swarmforge-config (nth args 4)
                      :explicit-pack-cli? (= "1" (nth args 5))
                      :allow-full-pack? (nth args 6 "")})]
      (if downgrade
        (do (binding [*out* *err*]
              (println (str "Error: " (swarm-identity-lib/format-guard-message downgrade))))
            (System/exit 1))
        (System/exit 0)))))

(-main)
