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
;;
;; BL-805: this IS the resident-invoked rotation entry the gate below refers
;; to. -main's call into handoff-lib/respawn-as! (handoff_lib.bb) is
;; unconditional, and respawn-as! itself refuses to respawn the pane while
;; the departing role's own inbox/in_process still holds a real, undrained
;; *.handoff parcel - run done_with_current.sh first, or set
;; SWARMFORGE_ROTATE_FORCE=1 to override. handoffd's own daemon-driven
;; rotation calls handoff-lib/rotate-resident-to! directly and never passes
;; through this entry, so it is never subject to this gate.

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
