#!/usr/bin/env bb

(ns ready-for-next
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))

(defn- promote-next-paused-item-if-needed []
  (let [project-root (dispatch-lib/project-root)
        conf-file (fs/path project-root ".swarmforge" "swarmforge.conf")
        active-dir (fs/path project-root "backlog" "active")
        paused-dir (fs/path project-root "backlog" "paused")
        max-depth (try
                    (->> (slurp (str conf-file))
                         str/split-lines
                         (filter #(str/starts-with? % "config active_backlog_max_depth"))
                         first
                         (re-find #"\d+")
                         parse-long)
                    (catch Exception _ 5))] ; Default to 5 if config is missing
    (when (and (fs/exists? active-dir) (fs/exists? paused-dir))
      (let [active-count (count (fs/list-dir active-dir))
            paused-items (fs/list-dir paused-dir)]
        (when (and (< active-count max-depth) (seq paused-items))
          (let [next-item (first (sort paused-items))] ; Promote oldest paused item
            (fs/move next-item (fs/path active-dir (fs/file-name next-item)))
            (println "Promoted paused item to active:" (fs/file-name next-item))))))))

(dispatch-lib/run-dispatch! {"batch" "ready_for_next_batch.sh" "task" "ready_for_next_task.sh"})

;; Fallback: Check backlog depth after dispatch
(promote-next-paused-item-if-needed)
