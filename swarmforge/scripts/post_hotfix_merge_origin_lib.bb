;; BL-1118: after a Cursor/operator batch advances local main, immediately
;; fetch+merge origin/main under BL-891 invariants (no reset/stash; abort on
;; conflict; print conflicted paths). Honesty refresh: a clean behind tip
;; must not stay stuck on a stale dirty sync reason.
;;
;;   (load-file ".../post_hotfix_merge_origin_lib.bb")
;;   post-hotfix-merge-origin-lib/foo

(ns post-hotfix-merge-origin-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "master_main_reconcile_lib.bb")))

(defn honest-reconcile-surfaced
  "When the worktree has no dirty paths, drop a stale 'dirty' surfaced reason
   so sync-action is wait-reconcile/ff-only — never wait-dirty-clear."
  [dirty-paths reconcile-surfaced]
  (if (and (empty? dirty-paths) (= "dirty" (str reconcile-surfaced)))
    nil
    reconcile-surfaced))

(defn post-merge-plan
  "Pure: :noop when not behind, else :attempt-merge."
  [behind]
  (if (zero? (or behind 0)) :noop :attempt-merge))

(defn conflicted-paths-from-status
  "Parse porcelain status lines that mark unmerged paths."
  [porcelain]
  (->> (str/split-lines (or porcelain ""))
       (keep (fn [line]
               (when (re-find #"^U|^.U|^AA|^DD" line)
                 (str/trim (subs line 2)))))
       (remove str/blank?)
       vec))

(defn- refresh-honest-surfaced!
  [daemon-dir dirty-paths]
  (let [state (master-main-reconcile-lib/read-state daemon-dir)
        honest (honest-reconcile-surfaced dirty-paths (:surfaced state))]
    (when (not= honest (:surfaced state))
      (master-main-reconcile-lib/write-state! daemon-dir (assoc state :surfaced honest)))
    honest))

(defn- finish-ok
  [daemon-dir rev-counts! outcome]
  (let [{:keys [ahead behind]} (rev-counts!)]
    (when (master-main-reconcile-lib/deadlock-clear? behind)
      (master-main-reconcile-lib/clear-deadlock! daemon-dir))
    {:ok? true :exit 0 :outcome outcome :ahead ahead :behind behind}))

(defn- finish-conflict
  [abort! status-porcelain! mid-merge? merge-res]
  (abort!)
  (let [paths (or (:conflicted-paths merge-res)
                  (conflicted-paths-from-status (status-porcelain!)))]
    (binding [*out* *err*]
      (println "CONFLICTED:" (str/join " " paths)))
    {:ok? false :exit 1 :outcome :conflict-abort
     :conflicted-paths paths
     :mid-merge? (boolean (mid-merge?))}))

(defn run-post-hotfix-merge!
  "Fetch origin/main; merge when behind. On conflict abort + print paths.
   Never reset/stash. Clears deadlock when behind becomes 0."
  [{:keys [daemon-dir fetch! rev-counts! dirty-paths! merge! abort!
           status-porcelain! mid-merge?]}]
  (fetch!)
  (refresh-honest-surfaced! daemon-dir (set (or (dirty-paths!) #{})))
  (let [{:keys [behind]} (rev-counts!)
        plan (post-merge-plan behind)]
    (if (= plan :noop)
      (finish-ok daemon-dir rev-counts! :noop)
      (let [merge-res (merge!)]
        (if (:success merge-res)
          (finish-ok daemon-dir rev-counts! :merged)
          (finish-conflict abort! status-porcelain! mid-merge? merge-res))))))
