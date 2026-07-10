#!/usr/bin/env bb

(ns ready-for-next
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))
(load-file (str (fs/path (fs/parent *file*) "backlog_depth_lib.bb")))

(defn- promote-next-paused-item-if-needed []
  (let [project-root (dispatch-lib/project-root)
        active-dir (fs/path project-root "backlog" "active")
        paused-dir (fs/path project-root "backlog" "paused")
        max-depth (backlog-depth-lib/read-max-depth project-root)]
    (when (and (fs/exists? active-dir) (fs/exists? paused-dir))
      (let [active-count (count (fs/list-dir active-dir))
            paused-items (fs/list-dir paused-dir)]
        (when (and (backlog-depth-lib/under-depth-cap? active-count max-depth) (seq paused-items))
          (let [next-item (first (sort paused-items))] ; Promote oldest paused item
            (fs/move next-item (fs/path active-dir (fs/file-name next-item)))
            (println "Promoted paused item to active:" (fs/file-name next-item))))))))

(dispatch-lib/run-dispatch! {"batch" "ready_for_next_batch.sh" "task" "ready_for_next_task.sh"})

;; Fallback: Check backlog depth after dispatch
(promote-next-paused-item-if-needed)
