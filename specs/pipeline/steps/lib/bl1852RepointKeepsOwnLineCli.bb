#!/usr/bin/env bb
;; BL-1852 acceptance driver: a thin CLI over the REAL
;; land_step_lib.bb/post-land-repoint! - every scenario drives this
;; function directly against a real git fixture, never a reimplementation
;; of the keep rule.
;;
;; Usage: bl1852RepointKeepsOwnLineCli.bb <root> [<landed-task-ticket-id>]
;; Prints one JSON line: the post-land-repoint! result map, :kept/:dropped
;; entries reduced to their :sha and :subject (and :reason for drops).

(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def land-step-lib-path (str (fs/path script-dir ".." ".." ".." ".." "swarmforge" "scripts" "land_step_lib.bb")))

(load-file land-step-lib-path)

(let [[root landed-task-ticket-id] *command-line-args*
      result (land-step-lib/post-land-repoint!
              (cond-> {:root root}
                (seq landed-task-ticket-id) (assoc :landed-task-ticket-id landed-task-ticket-id)))]
  (println (json/generate-string
            {:action (:action result)
             :reason (:reason result)
             :old-tip (:old-tip result)
             :new-tip (:new-tip result)
             :kept (mapv #(select-keys % [:sha :subject :already-applied?]) (or (:kept result) []))
             :dropped (mapv #(select-keys % [:sha :subject :reason]) (or (:dropped result) []))})))
