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

(defn- tip-contains-origin? [root]
  (zero? (:exit (sh root "git" "merge-base" "--is-ancestor" "origin/main" "HEAD"))))

;; BL-1236: same fix as handoffd.bb's master-main-merge-verdict - this CLI
;; carried a byte-identical copy of the broken legacy-diff-text predicate
;; and ends at the same `git reset --hard origin/main`, so it needed the
;; same replacement, not just the daemon. `git merge-tree --write-tree`
;; gives git's own verdict from its exit code alone; no merge-base call
;; needed, and a git that cannot answer is :unavailable, never "conflict".
(defn- merge-verdict! [root]
  (let [tree (sh root "git" "merge-tree" "--write-tree" "HEAD" "origin/main")]
    (master-main-reconcile-lib/merge-verdict (:exit tree))))

(defn- merge-origin! [root]
  ;; BL-1131: FF-only absorb after rematch-prepared lands — never open a
  ;; content-conflict merge for an operator to finish.
  (let [r (sh root "git" "merge" "--ff-only" "--no-edit" "origin/main")]
    (if (zero? (:exit r))
      {:success true}
      {:success false
       :conflicted-paths
       (post-hotfix-merge-origin-lib/conflicted-paths-from-status
        (:out (sh root "git" "status" "--porcelain=v1")))})))

;; BL-1214: a REAL 3-way merge, tried only when merge-origin! above
;; (--ff-only) failed - absorbs a non-conflicting two-way divergence
;; losslessly instead of falling straight to rematch-onto-origin!.
(defn- merge3-origin! [root]
  (let [r (sh root "git" "merge" "--no-edit" "origin/main")]
    (if (zero? (:exit r))
      {:success true}
      {:success false
       :conflicted-paths
       (post-hotfix-merge-origin-lib/conflicted-paths-from-status
        (:out (sh root "git" "status" "--porcelain=v1")))})))

(defn- push-onto-origin! [root]
  (let [r (sh root "git" "push" "origin" "main")]
    {:success (zero? (:exit r)) :error (str/trim (:err r))}))

(defn- reset-onto-origin! [root]
  (let [r (sh root "git" "reset" "--hard" "origin/main")]
    {:success (zero? (:exit r)) :error (str/trim (:err r))}))

(defn- rematch-onto-origin! [root]
  ;; BL-1138: rematch bookkeeping onto origin/main — reset, never conflicted absorb.
  ;; BL-1198: attempt a push first — only reset when that push is rejected.
  (master-main-reconcile-lib/rematch-with-push-first!
   {:push! (fn [] (push-onto-origin! root))
    :reset! (fn [] (reset-onto-origin! root))}))

(defn- real-adapters [root daemon-dir]
  {:daemon-dir daemon-dir
   :fetch! (fn [] (sh root "git" "fetch" "origin" "main"))
   :rev-counts! (fn [] (rev-counts! root))
   :dirty-paths! (fn [] (dirty-paths! root))
   :tip-contains-origin! (fn [] (tip-contains-origin? root))
   :merge-verdict! (fn [] (merge-verdict! root))
   :rematch! (fn [] (rematch-onto-origin! root))
   :merge! (fn [] (merge-origin! root))
   :merge3! (fn [] (merge3-origin! root))
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
