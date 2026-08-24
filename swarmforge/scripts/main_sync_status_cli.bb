#!/usr/bin/env bb
;; Coordinator step-0 seam: report ahead/behind and the only allowed action.
;; Usage: main_sync_status_cli.bb <project-root>
;; Prints one JSON object on stdout. Exit 0 always when git facts are readable;
;; exit 2 when fetch/rev-list fails (action wait-reconcile / unknown).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "master_main_reconcile_lib.bb")))

(defn- sh-ok [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- rev-counts! [root]
  (let [fetch (sh-ok root "git" "fetch" "origin" "main")
        counts (sh-ok root "git" "rev-list" "--left-right" "--count" "main...origin/main")]
    (when-not (zero? (:exit counts))
      (throw (ex-info "rev-list failed" counts)))
    (let [[behind ahead] (map parse-long (str/split (:out counts) #"\s+"))]
      {:ahead (or ahead 0)
       :behind (or behind 0)
       :fetch-ok? (zero? (:exit fetch))})))

(defn -main [& args]
  (let [root (fs/canonicalize (or (first args) "."))
        daemon-dir (fs/path root ".swarmforge" "daemon")]
    (try
      (let [{:keys [ahead behind]} (rev-counts! root)
            reconcile (master-main-reconcile-lib/read-state (str daemon-dir))
            deadlock (master-main-reconcile-lib/read-deadlock (str daemon-dir))
            ;; Auto-clear stale deadlock when tip has absorbed origin.
            _ (when (and (master-main-reconcile-lib/deadlock-active? deadlock)
                         (master-main-reconcile-lib/deadlock-clear? behind))
                (master-main-reconcile-lib/clear-deadlock! (str daemon-dir)))
            deadlock (master-main-reconcile-lib/read-deadlock (str daemon-dir))
            action (master-main-reconcile-lib/sync-action
                    {:ahead ahead
                     :behind behind
                     :reconcile-surfaced (:surfaced reconcile)
                     :reconcile-escalated (:escalated reconcile)
                     :deadlock-active? (master-main-reconcile-lib/deadlock-active? deadlock)})
            ready? (= action :proceed)]
        (println (json/generate-string
                  {:ahead ahead
                   :behind behind
                   :ready ready?
                   :action (name action)
                   :reconcile reconcile
                   :deadlock deadlock}
                  {:pretty false}))
        (System/exit 0))
      (catch Exception e
        (println (json/generate-string
                  {:ahead nil
                   :behind nil
                   :ready false
                   :action "wait-reconcile"
                   :error (str (.getMessage e))}
                  {:pretty false}))
        (System/exit 2)))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
