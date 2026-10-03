;; BL-1901: a queued parcel line that carries only its own ticket's commits
;; (and merges of origin/main) lands as one merge of origin/main and a
;; fast-forward push - the "should not be much more than a git merge" of
;; BL-1870's ruling A. Every other line goes through the land step exactly as
;; before. This lib is the pure decision; land_merge_path.bb is the impure
;; edge the lander runs.
;;
;; Loaded via load-file and referred to as land-merge-path-lib/foo.

(ns land-merge-path-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
;; The land step's own register rules (registry-specs, rows-to-retire,
;; rows-to-restore), reused so the merge path never holds a second copy.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "land_step_lib.bb")))

(defn- merge-commit? [c] (> (count (:parents c)) 1))

(defn- commit-problem
  "Why one commit on the line keeps the line off the merge path, or nil. A
   merge may name no ticket (a sync merge), but like every other commit it
   never names one besides the landing ticket (QA D2 on BL-1901)."
  [ticket {:keys [subject merge-parents-on-main?] :as c}]
  (let [ids (vec (pipeline-stage-lib/extract-ticket-ids subject))
        merge? (merge-commit? c)]
    (cond
      (and merge? (not (true? merge-parents-on-main?)))
      (str "the merge \"" subject "\" brings in a parent that is not on origin/main")
      (and (empty? ids) (not merge?)) (str "\"" subject "\" names no ticket and is no merge")
      (and (seq ids) (not= [ticket] ids)) (str "\"" subject "\" names " (str/join ", " ids) ", not only " ticket)
      :else nil)))

(defn line-verdict
  "PURE. `commits` are the line from origin/main to the queued commit, each
   {:sha :subject :parents [...] :merge-parents-on-main? bool-or-nil} (the
   last answered only for merges). Clean when every commit names `ticket` and
   no other, or is a merge whose other parents are all on origin/main and
   whose subject names no ticket or only `ticket`.
   {:clean? true} or {:clean? false :reason \"...\"}. An empty line (the
   commit is already on origin/main) is not a merge-path land."
  [ticket commits]
  (if (empty? commits)
    {:clean? false :reason "nothing on the line beyond origin/main"}
    (if-let [problem (some #(commit-problem ticket %) commits)]
      {:clean? false :reason problem}
      {:clean? true})))

(defn merge-message
  "The merge commit's message: names the landing ticket and no other."
  [ticket origin-sha]
  (str "Land " ticket ": merge origin/main " (subs origin-sha 0 (min 10 (count origin-sha)))))

(defn registry-pass-changes
  "PURE. What the land step's registry pass (land-step-lib's
   restore-other-tickets-registry-rows!) would change in a merged tree:
   `contents` is {registry-path {:origin text-or-nil :tree text-or-nil}},
   origin/main's and the merged tree's copies. One {:registry :retire
   :restore} per registry the pass would rewrite - `ticket`'s own rows
   still in the tree (BL-1631) and the rows an open other ticket owns on
   origin/main that the tree lacks (BL-1604) - in registry-specs order.
   Empty when the pass would change nothing (QA spec-gap note 003735)."
  [{:keys [ticket open-ids contents]}]
  (vec
   (for [{:keys [path row-key-fn owner-fn retirable?-fn]} land-step-lib/registry-specs
         :let [{:keys [origin tree]} (get contents path)
               tree-lines (land-step-lib/registry-data-lines tree)
               restore (land-step-lib/rows-to-restore
                        {:origin-lines (land-step-lib/registry-data-lines origin)
                         :replay-keys (set (keep row-key-fn tree-lines))
                         :row-key-fn row-key-fn
                         :owner-fn owner-fn
                         :task-ticket-id ticket
                         :open-ticket-ids open-ids})
               retire (land-step-lib/rows-to-retire
                       {:lines tree-lines
                        :owner-fn owner-fn
                        :task-ticket-id ticket
                        :retirable?-fn retirable?-fn})]
         :when (or (seq restore) (seq retire))]
     {:registry path :retire retire :restore restore})))

(defn registry-decline-reason
  "The fallback reason for registry-pass-changes' output, or nil when it is
   empty."
  [changes]
  (when (seq changes)
    (str "the land step's registry pass would change "
         (str/join "; " (for [{:keys [registry retire restore]} changes]
                          (str registry " (retire " (count retire) ", restore " (count restore) ")"))))))
