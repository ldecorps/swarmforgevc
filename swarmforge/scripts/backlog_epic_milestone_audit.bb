#!/usr/bin/env bb
;; backlog_epic_milestone_audit.bb — open-backlog hygiene:
;;   1. every non-epic live ticket has a non-empty epic:
;;   2. every type: epic tracker has a non-empty milestone:
;;
;; Usage:
;;   bb backlog_epic_milestone_audit.bb [project-root]
;; Exit 0 when clean; exit 1 when any violation.

(ns backlog-epic-milestone-audit
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: backlog_epic_milestone_audit.bb [project-root]"))
  (System/exit 2))

(def project-root
  (or (first *command-line-args*)
      (System/getProperty "user.dir")))

(defn field [text name]
  (when-let [[_ v] (re-find (re-pattern (str "(?m)^" name ":\\s*(.*)$")) text)]
    (let [v (-> v str/trim (str/replace #"^\"|\"$" "") (str/replace #"^'|'$" ""))]
      (when-not (str/blank? v) v))))

(defn open-ticket-files [root]
  (->> ["active" "paused" "hold"]
       (map #(fs/path root "backlog" %))
       (filter fs/directory?)
       (mapcat #(fs/glob % "BL-*.yaml"))
       (sort-by str)))

(defn -main []
  (let [files (open-ticket-files project-root)
        missing-epic (atom [])
        missing-ms (atom [])]
    (doseq [f files]
      (let [text (slurp (str f))
            id (or (field text "id") (fs/file-name f))
            typ (or (field text "type") "")
            epic (field text "epic")
            ms (field text "milestone")]
        (if (= typ "epic")
          (when-not ms
            (swap! missing-ms conj {:id id :path (str f)}))
          (when-not epic
            (swap! missing-epic conj {:id id :path (str f)})))))
    (println (str "open tickets: " (count files)))
    (println (str "missing epic (non-epic): " (count @missing-epic)))
    (doseq [v @missing-epic]
      (println (str "  MISSING-EPIC " (:id v) "  " (:path v))))
    (println (str "epics missing milestone: " (count @missing-ms)))
    (doseq [v @missing-ms]
      (println (str "  MISSING-MILESTONE " (:id v) "  " (:path v))))
    (if (and (empty? @missing-epic) (empty? @missing-ms))
      (do (println "backlog_epic_milestone_audit: ok")
          (System/exit 0))
      (do (println "backlog_epic_milestone_audit: FAIL")
          (System/exit 1)))))

(-main)
