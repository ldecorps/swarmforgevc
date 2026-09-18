;; BL-677: epic backfill over backlog/done/, slice 2 - the apply. Reads
;; BL-676's own report (after a human has amended and approved it) and
;; writes each proposed `epic:` into its `backlog/done/` ticket, in
;; batches, each batch committed through the shared commit-integrity path -
;; never a hand-typed commit on the shared main checkout, never one commit
;; per ticket. Reuses epic_backfill_proposals_lib.bb's own roster/sentinel
;; and backlog_hygiene_lib.bb's own field reader/ticket enumeration -
;; never a second parser of either.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "epic_backfill_apply_lib.bb")))
;; Referred to as epic-backfill-apply-lib/foo.
(ns epic-backfill-apply-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "backlog_hygiene_lib.bb")))
(load-file (str (fs/path script-dir "epic_backfill_proposals_lib.bb")))
(load-file (str (fs/path script-dir "commit_integrity_lib.bb")))

;; A batch of one commit per ticket is exactly what this ticket's own
;; constraints refuse; a batch of "everything in one commit" makes a
;; failed mid-run retry redo the whole backfill. 25 keeps each commit
;; small enough to verify by eye (qa_e2e_procedure's own "spot-check ten
;; rewritten tickets" step) while still being far fewer commits than
;; tickets for a report the size BL-676 measured (hundreds of rows).
(def default-batch-size 25)

;; ── Pure: the mapping file (BL-676's report, human-amended) ──────────────

;; Mirrors the ticket-YAML `human_approval: approved` convention already
;; used everywhere else in this backlog, rather than inventing a second
;; approval vocabulary for one markdown file.
(defn approved?
  [mapping-text]
  (boolean (re-find #"(?m)^human_approval:\s*approved\s*$" mapping-text)))

(defn parse-mapping-rows
  "id/tier/proposal/evidence rows from the SAME markdown table shape
   epic-backfill-proposals-lib/render-report emits - the mapping IS that
   report, possibly human-edited (a proposal cell filled in, a row's
   tier/evidence left alone) - never a second table format. The header
   separator row (all dashes) and any non-table line are silently
   skipped, never mistaken for a data row."
  [mapping-text]
  (->> (str/split-lines mapping-text)
       (keep (fn [line]
               (when-let [[_ id tier proposal evidence]
                          (re-matches #"\|\s*(BL-\d+)\s*\|\s*([\w-]+)\s*\|\s*([\w-]*)\s*\|\s*(.*?)\s*\|"
                                      (str/trim line))]
                 {:id id :tier tier :proposal proposal :evidence evidence})))
       vec))

;; ── Pure: refusal-before-any-write ───────────────────────────────────────

(defn unknown-epic-values
  "Every DISTINCT non-empty proposal value the roster (plus the
   pre-epic-era sentinel) does not recognize - a typo must fail loud,
   naming every offender, not just the first."
  [rows valid-epics]
  (->> rows
       (remove #(str/blank? (:proposal %)))
       (map :proposal)
       distinct
       (remove valid-epics)
       vec))

(defn missing-done-ids
  "Every mapping row naming a ticket id with no file under backlog/done/ -
   the mapping is stale against the tree (BL-676's report should be
   regenerated), refused rather than silently skipped."
  [rows done-ids]
  (->> rows
       (remove #(contains? done-ids (:id %)))
       (map :id)
       vec))

(defn refusal
  "nil when the mapping is safe to apply (every check below cleared);
   otherwise {:reason :detail}. Checked in the order a human would want
   to fix them: approval first (nothing else matters until this is true),
   then staleness (a row naming a ticket that no longer exists), then
   value validity (a typo'd epic). Every check reads ONLY the mapping and
   the CURRENT tree - never partial, never after any write."
  [mapping-text rows valid-epics done-ids]
  (cond
    (not (approved? mapping-text))
    {:reason :not-approved
     :detail "no human_approval: approved line in the mapping file"}

    (seq (missing-done-ids rows done-ids))
    {:reason :stale-mapping
     :detail (str "no backlog/done file for: " (str/join ", " (missing-done-ids rows done-ids)))}

    (seq (unknown-epic-values rows valid-epics))
    {:reason :unknown-epic
     :detail (str "not in the roster or the pre-epic-era sentinel: "
                  (str/join ", " (unknown-epic-values rows valid-epics)))}

    :else nil))

;; ── Pure: per-row decision ────────────────────────────────────────────────

;; Idempotency (invariant: re-running writes nothing) falls out of this
;; alone - a row this apply already wrote now has a non-empty epic on the
;; ticket it targets, so a second run classifies it :skip-already-tagged
;; exactly like a ticket someone else tagged by hand, never re-checked
;; against the specific proposed VALUE (the invariant is "never overwrite
;; a non-empty epic", not "overwrite unless it already matches").
(defn classify-row
  [row current-epic]
  (cond
    (not (str/blank? current-epic)) :skip-already-tagged
    (str/blank? (:proposal row)) :skip-empty-proposal
    :else :write))

;; ── Pure: inserting the one new line ─────────────────────────────────────

(defn with-epic-line
  "Inserts `epic: <value>` immediately after the ticket text's own
   `milestone:` line - a field every ticket carries (BL-677's own
   invariant 1 depends on this being additive: an absent epic: is the
   untagged case, never an empty string to overwrite). Never touches any
   other line; never called on a ticket already carrying a non-empty
   epic: (classify-row routes those to :skip-already-tagged first)."
  [text epic]
  (str/replace text #"(?m)^(milestone:.*)$" (str "$1\nepic: " epic)))

;; ── Pure: batching ────────────────────────────────────────────────────────

(defn partition-into-batches
  [write-rows batch-size]
  (mapv vec (partition-all batch-size write-rows)))

;; ── IO: reading the tree ──────────────────────────────────────────────────

(defn done-ticket-index
  "id -> {:repo-rel-path :abs-path :text :epic}, for every backlog/done/
   ticket (recursive - the epic milestone subfolders). Also returns
   every ticket's raw text (every pool, not just done/) so the roster -
   an epic definition may itself live outside backlog/done/ - is built
   the same way epic-backfill-proposals-lib/generate-report! already
   builds it, never a second, narrower roster read."
  [project-root]
  (let [backlog-root (str (fs/path project-root "backlog"))
        all-files (backlog-hygiene-lib/list-backlog-ticket-files backlog-root)
        done-dir (str (fs/normalize (fs/path backlog-root "done")))
        done-files (filter #(fs/starts-with? (fs/normalize %) done-dir) all-files)
        all-texts (mapv slurp all-files)
        index (into {}
                    (for [f done-files
                          :let [text (slurp f)
                                id (backlog-hygiene-lib/field text "id")]
                          :when id]
                      [id {:repo-rel-path (str (fs/relativize (fs/path project-root) (fs/path f)))
                           :abs-path (str f)
                           :text text
                           :epic (backlog-hygiene-lib/field text "epic")}]))]
    {:index index :all-texts all-texts}))

;; ── IO: apply ──────────────────────────────────────────────────────────────

;; The ticket's own approval_context names commit_integrity_cli.bb, but that
;; CLI exists for shell-driven, non-Babashka writers (its own doc comment:
;; "shell-driven writers on a shared checkout... route through the same
;; locked, pathspec-scoped, verify+retry commit") and additionally wires
;; ticket_close_guard_lib.bb's active/->done/ close-move validation, which
;; does not apply here - this apply only ever edits tickets already resting
;; in done/, never moves one there. This code is already a bb process, so it
;; calls the CLI's own underlying commit-integrity-lib/commit-with-integrity!
;; directly - the same locked, pathspec-scoped, verify+retry commit, without
;; the inapplicable close-guard hook.
(defn- default-commit-batch! [req]
  (commit-integrity-lib/commit-with-integrity! req))

(defn apply!
  "opts:
     :commit-batch! - (fn [{:project-root :paths :message}] -> result map),
       defaulting to a REAL commit_integrity_lib/commit-with-integrity!
       call. Tests inject a recording fake (BL-677's own 'injected commit
       runner' constraint) rather than driving real git.
     :batch-size - default default-batch-size; tests lower it to exercise
       batch boundaries against a small fixture tree.
   Returns {:refused true :reason :detail} on any refusal (no write, no
   commit - the whole backlog tree is byte-identical to before), else
   {:refused false :applied :skipped-already-tagged :skipped-empty-proposal
    :batches :commits}."
  [project-root mapping-text {:keys [commit-batch! batch-size]
                               :or {batch-size default-batch-size
                                    commit-batch! default-commit-batch!}}]
  (let [rows (parse-mapping-rows mapping-text)
        {:keys [index all-texts]} (done-ticket-index project-root)
        done-ids (set (keys index))
        roster (epic-backfill-proposals-lib/epic-roster all-texts)
        valid-epics (conj (set (map :slug roster)) epic-backfill-proposals-lib/sentinel-epic)
        refuse (refusal mapping-text rows valid-epics done-ids)]
    (if refuse
      (assoc refuse :refused true)
      (let [classified (map (fn [row] (assoc row :decision (classify-row row (:epic (get index (:id row)))))) rows)
            to-write (filterv #(= :write (:decision %)) classified)
            batches (partition-into-batches to-write batch-size)
            commits (atom [])]
        (doseq [batch batches]
          (doseq [row batch]
            (let [{:keys [abs-path text]} (get index (:id row))]
              (spit abs-path (with-epic-line text (:proposal row)))))
          (let [paths (mapv #(:repo-rel-path (get index (:id %))) batch)
                message (str "BL-677: epic backfill apply — " (count batch) " ticket(s)")
                result (commit-batch! {:project-root project-root :paths paths :message message})]
            (swap! commits conj result)
            (when-not (:success result)
              (throw (ex-info "epic-backfill-apply-lib: batch commit failed" {:result result})))))
        {:refused false
         :applied (count to-write)
         :skipped-already-tagged (count (filter #(= :skip-already-tagged (:decision %)) classified))
         :skipped-empty-proposal (count (filter #(= :skip-empty-proposal (:decision %)) classified))
         :batches (count batches)
         :commits @commits}))))
