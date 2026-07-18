#!/usr/bin/env bb

;; BL-518: mono-router rotation entry point. The one resident pipeline agent
;; calls this after sending its git_handoff to become the next role - the same
;; pane is respawned running <role>'s own launch script, so the stage runs on
;; that role's tailored model/effort (the model swap in-process rotation
;; cannot do). See swarmforge/packs/mono-router.prompt for when to call it.
;;
;; Usage: rotate_to_role.bb <role>
;;   <role> is the `to:` of the handoff you just sent (forward or bounce), or
;;   the pipeline's intake role to return home after a parcel finishes.

(ns rotate-to-role
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))

(defn -main [& args]
  (let [role (first args)]
    (when (str/blank? role)
      (binding [*out* *err*]
        (println "Usage: rotate_to_role.bb <role>"))
      (System/exit 2))
    (handoff-lib/respawn-as! role)))

(apply -main *command-line-args*)
