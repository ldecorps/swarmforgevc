#!/usr/bin/env bb
;; BL-1118: thin CLI — after a Cursor/operator batch on main, merge origin/main.
;; Usage: post_hotfix_merge_origin.bb <project-root>
;; Exit 0 on noop/success; exit 1 on conflict (aborted, CONFLICTED: paths on stderr).

(ns post-hotfix-merge-origin-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "post_hotfix_merge_origin_lib.bb")))

(defn- sh [root & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str root) :continue true} args)]
    {:exit exit :out (str (or out "")) :err (str (or err ""))}))

(defn- porcelain-paths [root]
  (->> (str/split-lines (:out (sh root "git" "status" "--porcelain=v1" "-uall")))
       (remove str/blank?)
       (map (fn [line] (str/trim (subs line 2))))
       (remove str/blank?)
       vec))

(defn- rev-counts! [root]
  (let [counts (sh root "git" "rev-list" "--left-right" "--count" "origin/main...main")]
    (when-not (zero? (:exit counts))
      (throw (ex-info "rev-list failed" counts)))
    (let [[behind ahead] (map parse-long (str/split (str/trim (:out counts)) #"\s+"))]
      {:ahead (or ahead 0) :behind (or behind 0)})))

(defn- dirty-paths! [root]
  (porcelain-paths root))

(defn- mid-merge? [root]
  (fs/exists? (fs/path root ".git" "MERGE_HEAD")))

(defn- real-adapters [root daemon-dir]
  {:daemon-dir daemon-dir
   :fetch! (fn [] (sh root "git" "fetch" "origin" "main"))
   :rev-counts! (fn [] (rev-counts! root))
   :dirty-paths! (fn [] (dirty-paths! root))
   :merge! (fn []
             (let [r (sh root "git" "merge" "--no-edit" "origin/main")]
               (if (zero? (:exit r))
                 {:success true}
                 {:success false
                  :conflicted-paths
                  (post-hotfix-merge-origin-lib/conflicted-paths-from-status
                   (:out (sh root "git" "status" "--porcelain=v1")))})))
   :abort! (fn [] (sh root "git" "merge" "--abort"))
   :status-porcelain! (fn [] (:out (sh root "git" "status" "--porcelain=v1")))
   :mid-merge? (fn [] (mid-merge? root))})

(defn -main [& args]
  (let [root (fs/canonicalize (or (first args) "."))
        daemon-dir (str (fs/path root ".swarmforge" "daemon"))]
    (fs/create-dirs daemon-dir)
    (try
      (let [result (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
                    (real-adapters root daemon-dir))]
        (println (json/generate-string
                  (select-keys result [:ok? :outcome :ahead :behind :conflicted-paths :mid-merge?])
                  {:pretty false}))
        (System/exit (or (:exit result) 1)))
      (catch Exception e
        (binding [*out* *err*]
          (println "post_hotfix_merge_origin:" (.getMessage e)))
        (System/exit 2)))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
