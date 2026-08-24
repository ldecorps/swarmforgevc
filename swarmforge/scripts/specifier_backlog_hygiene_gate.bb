#!/usr/bin/env bb
;; Per-file epic/milestone gate for the specifier (BL-544) plus corpus-level
;; duplicate-id refusal at mint (BL-1105).
;; Usage: bb specifier_backlog_hygiene_gate.bb <yaml-path> [<yaml-path> ...]
;;
;; Seams (tests / fixtures):
;;   BACKLOG_HYGIENE_ROOT              — local backlog/ tree to index (default: <repo>/backlog)
;;   BACKLOG_HYGIENE_PUBLISHED_ROOT    — directory standing in for the published corpus
;;   BACKLOG_HYGIENE_PUBLISHED_UNREADABLE=1 — force fail-closed published read
;;   BACKLOG_HYGIENE_PUBLISHED_REF     — git ref (default origin/main) when no dir seam

(ns specifier-backlog-hygiene-gate
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_hygiene_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: specifier_backlog_hygiene_gate.bb <yaml-path> [<yaml-path> ...]"))
  (System/exit 2))

(defn- repo-root []
  ;; *file* is swarmforge/scripts/<this>.bb → scripts → swarmforge → checkout root
  (str (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))))

(defn- backlog-root []
  (or (System/getenv "BACKLOG_HYGIENE_ROOT")
      (str (fs/path (repo-root) "backlog"))))

(defn- published-id-index []
  (cond
    (= "1" (System/getenv "BACKLOG_HYGIENE_PUBLISHED_UNREADABLE"))
    {:error "published corpus could not be read"}

    (System/getenv "BACKLOG_HYGIENE_PUBLISHED_ROOT")
    (backlog-hygiene-lib/read-dir-id-index (System/getenv "BACKLOG_HYGIENE_PUBLISHED_ROOT"))

    :else
    (backlog-hygiene-lib/read-published-id-index-from-git
     (repo-root)
     (or (System/getenv "BACKLOG_HYGIENE_PUBLISHED_REF") "origin/main"))))

(defn- subject-from-path [p]
  (let [text (slurp (str p))
        id (or (backlog-hygiene-lib/field text "id") (last (str/split (str p) #"/")))]
    {:id id :path (str p) :text text}))

(defn -main []
  (let [paths (seq *command-line-args*)]
    (when (empty? paths) (usage))
    (doseq [p paths]
      (when-not (fs/exists? p)
        (binding [*out* *err*]
          (println (str "specifier_backlog_hygiene_gate: no such file: " p)))
        (System/exit 2)))
    (let [subjects (mapv subject-from-path paths)
          per-file (mapcat (fn [{:keys [text id path]}]
                             (backlog-hygiene-lib/violations-for-text text {:id id :path path}))
                           subjects)
          local (backlog-hygiene-lib/read-local-id-index (backlog-root))
          published (published-id-index)
          dupes (backlog-hygiene-lib/duplicate-id-violations subjects local published)
          violations (vec (concat per-file dupes))]
      (doseq [v violations]
        (println (backlog-hygiene-lib/format-violation v)))
      (if (backlog-hygiene-lib/all-clean? violations)
        (do (println "specifier_backlog_hygiene_gate: ok")
            (System/exit 0))
        (do (println "specifier_backlog_hygiene_gate: FAIL — assign epic: on slices; set milestone: on type: epic trackers; refuse duplicate ticket ids before handoff")
            (System/exit 1))))))

(-main)
