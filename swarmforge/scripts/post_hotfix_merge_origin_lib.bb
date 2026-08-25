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
  ;; BL-1130: designed recovery is rematch/refuse — never leave mid-merge.
  (when (mid-merge?)
    (abort!))
  (let [paths (or (:conflicted-paths merge-res)
                  (conflicted-paths-from-status (status-porcelain!)))
        still-mid? (boolean (mid-merge?))]
    (binding [*out* *err*]
      (println "CONFLICTED:" (str/join " " paths))
      (println "BL-1130: absorb refused — rematch tip onto origin/main (no editor)"))
    {:ok? false :exit 1 :outcome :refuse-rematch
     :conflicted-paths paths
     :mid-merge? still-mid?}))

(defn run-post-hotfix-merge!
  "Fetch origin/main; merge when behind. On predicted or real conflict:
   refuse-rematch without leaving MERGE_HEAD (BL-1130). Never reset/stash."
  [{:keys [daemon-dir fetch! rev-counts! dirty-paths! merge! abort!
           status-porcelain! mid-merge? would-conflict! tip-contains-origin!]}]
  (fetch!)
  (refresh-honest-surfaced! daemon-dir (set (or (dirty-paths!) #{})))
  (let [{:keys [behind]} (rev-counts!)
        tip-ok? (boolean (when tip-contains-origin! (tip-contains-origin!)))
        conflict? (boolean (when would-conflict! (would-conflict!)))
        plan (master-main-reconcile-lib/automated-absorb-plan
              {:merge-head-present? (boolean (mid-merge?))
               :behind behind
               :would-conflict? conflict?
               :tip-contains-origin? tip-ok?})]
    (case plan
      :noop (finish-ok daemon-dir rev-counts! :noop)
      :skip-human-merge-in-progress
      {:ok? false :exit 1 :outcome :human-merge-in-progress :mid-merge? true}
      :refuse-rematch
      (do
        (binding [*out* *err*]
          (println "BL-1130: absorb refused — rematch tip onto origin/main (no editor)"))
        {:ok? false :exit 1 :outcome :refuse-rematch :mid-merge? (boolean (mid-merge?))
         :ahead (:ahead (rev-counts!)) :behind behind})
      :run-merge
      (let [merge-res (merge!)]
        (if (:success merge-res)
          (finish-ok daemon-dir rev-counts! :merged)
          (finish-conflict abort! status-porcelain! mid-merge? merge-res))))))
