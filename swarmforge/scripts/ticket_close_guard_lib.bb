;; BL-551 incident follow-up: keep backlog close, outbound git_handoffs, and
;; in-flight mailbox mail aligned. Pure decision + small fs helpers; callers
;; (commit_integrity_cli.bb, swarm_handoff.bb) own exit codes / user messages.
;;
;;  1. Close commits (active/ -> done/) require a QA git_handoff or note to
;;     coordinator referencing the same ticket id — never a coder bookkeeping
;;     note.
;;  2. swarm_handoff.bb refuses new git_handoffs for tickets already in
;;     backlog/done/ (see swarm_handoff.bb).
;;  3. After a successful close commit, abandon every role's new/ and
;;     in_process/ handoff whose task header matches the closed ticket
;;     (reuses salvage_lib.bb's abandon-stale!).

(ns ticket-close-guard-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "ticket_status_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "salvage_lib.bb")))

(defn ticket-id-from-backlog-path
  "Extract BL-551 / GH-22 from a backlog yaml path or filename."
  [path]
  (pipeline-stage-lib/extract-ticket-id (fs/file-name path)))

(defn parse-close-move
  "Returns a seq of {:ticket-id :active-path :done-path}, one entry per
   ticket whose active/ -> done/ move appears in paths - a close commit is
   a SET of tickets, and every layer of this guard must treat it as one
   (BL-869). Pairs each active/ path with the done/ path that shares its
   own ticket id, regardless of where either falls in paths - the old
   `(first (filter active))` / `(first (filter done))` shape silently
   collapsed a multi-ticket close to its first pair (fault B: an
   interleaved path order could even pair one ticket's active path with a
   DIFFERENT ticket's done path, fail the id match, and return nil - a
   multi-ticket close read as `{:allowed true}`, no validation at all).
   Entries are ordered by the position of their active/ path in paths.
   nil for a commit with no active->done pairing (ordinary commits)."
  [paths]
  (let [done-by-id (into {}
                          (keep (fn [p]
                                  (when (str/includes? p "backlog/done/")
                                    (when-let [id (ticket-id-from-backlog-path p)]
                                      [id p]))))
                          paths)]
    (seq
     (distinct
      (keep (fn [p]
              (when (str/includes? p "backlog/active/")
                (when-let [id (ticket-id-from-backlog-path p)]
                  (when-let [done-p (get done-by-id id)]
                    {:ticket-id id :active-path p :done-path done-p}))))
            paths)))))

(defn- coordinator-mailbox-handoffs [root]
  (when-let [coordinator (handoff-lib/load-role-info "coordinator" root)]
    (concat (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :completed))
            (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :new))
            (salvage-lib/handoff-files (handoff-lib/mailbox-dir coordinator :in_process)))))

(defn qa-approved-ticket?
  "True when coordinator's mailbox shows QA passed this ticket (git_handoff
   or note NAMING this ticket id among possibly several - Article 2.6 batch
   forwards - not just the first id the note happens to name; BL-869 fault
   A). Coder/architect bookkeeping notes do not qualify — from must be QA."
  [root ticket-id]
  (boolean
   (some (fn [file]
           (let [from (salvage-lib/header-field file "from")
                 typ (salvage-lib/header-field file "type")
                 task (salvage-lib/header-field file "task")
                 message (salvage-lib/header-field file "message")]
             (and (= "QA" from)
                  (contains? #{"git_handoff" "note"} typ)
                  (contains? (set (pipeline-stage-lib/ticket-ids-from-headers {:task task :message message}))
                             ticket-id))))
         (or (coordinator-mailbox-handoffs root) []))))


;; ── BL-1378: the expedite verdict record as a second approval PATH ────────
;;
;; The check above asks for a QA git_handoff or note in the coordinator's
;; mailbox. `expedite.sh` runs with the whole stack stopped and is forbidden by
;; design from touching "handoffd, the mailboxes, tmux, rotation or the
;; coordinator" (BL-567), so it can never put one there - the precondition was
;; not merely unmet for one ticket, it was unsatisfiable for EVERY
;; expedite-closed ticket, permanently, and the only ways past it were
;; bypassing the guard or forging a QA handoff.
;;
;; The expeditor already writes a durable QA-hat verdict record (BL-1025) that
;; is_qa_ancestor.sh - the ONE approval predicate - already reads. This adds an
;; approval PATH by reading that same store, never a second definition of
;; approval (BL-925 invariant 2). No new key is invented: the record carries
;; both the commit is_qa_ancestor.sh keys on and the ticket this guard needs.

(def expedite-approvals-dir
  "The store expedite_lib.bb writes at its QA hat, and is_qa_ancestor.sh reads.
   One path, named once."
  [".swarmforge" "expedite-approvals"])

(defn expedite-record-approves?
  "Invariant 3: a record closes only the ticket it NAMES, and only when it is a
   QA-stage record with approval true. All three together - a record matching
   on two of them closes nothing."
  [record ticket-id]
  (boolean
   (and (= (:ticket record) ticket-id)
        (= (:stage record) "QA")
        (true? (:approval record)))))

(defn- record-line-problem
  "The same untrusted-store rules is_qa_ancestor.sh applies, for the same
   reason: a line missing either field the verdict is made of is a corrupt
   record, and a store that cannot be trusted either way must not hand out the
   half of itself that happens to parse."
  [file line]
  (let [parsed (try (json/parse-string line true) (catch Exception _ ::unparseable))]
    (cond
      (= ::unparseable parsed) (str "the expedite verdict store " file " holds a line that is not a record")
      (not (string? (:commit parsed))) (str "the expedite verdict store " file " holds a record line with no commit field")
      (not (boolean? (:approval parsed))) (str "the expedite verdict store " file " holds a record line with no approval field")
      :else nil)))

(defn expedite-approval
  "Read the expedite verdict store for `ticket-id`.

   {:kind :absent}                       no store - no expedite path at all
   {:kind :problem  :detail \"...\"}      obstructed, unreadable or corrupt
   {:kind :no-match}                     readable, nothing approving this ticket
   {:kind :approved :commit :store-file} a QA record with approval true

   `:absent` is deliberately NOT `:problem`. A swarm that has never run the
   expeditor has no store, and that is the ordinary state of the world - the
   mailbox answer stands, and absence is never itself an approval (invariant
   2)."
  [root ticket-id]
  (let [dir (apply fs/path root expedite-approvals-dir)]
    (cond
      (and (fs/exists? dir) (not (fs/directory? dir)))
      {:kind :problem
       :detail (str "the expedite verdict store " (str dir) " exists but is not a directory (obstructed record store)")}

      (not (fs/exists? dir))
      {:kind :absent}

      :else
      (let [files (sort (map str (filter #(str/ends-with? (str %) ".jsonl") (fs/list-dir dir))))]
        (if (empty? files)
          {:kind :absent}
          (loop [remaining files matched nil]
            (if-let [file (first remaining)]
              (if-not (fs/readable? file)
                {:kind :problem :detail (str "the expedite verdict store " file " is unreadable")}
                (let [lines (remove str/blank? (str/split-lines (slurp file)))]
                  (if-let [problem (some #(record-line-problem file %) lines)]
                    {:kind :problem :detail problem}
                    (recur (rest remaining)
                           (or matched
                               (when-let [hit (first (filter #(expedite-record-approves? % ticket-id)
                                                             (map #(json/parse-string % true) lines)))]
                                 {:kind :approved :commit (:commit hit) :store-file file}))))))
              (or matched {:kind :no-match}))))))))

(defn close-verdict
  "PURE: the three answers this guard can get, and the one verdict they make.

   {:allowed? bool :reason kw :detail \"...\"}

   The MAILBOX DECIDES FIRST and decides alone. A store that cannot be read
   must never break a close the mailbox already approved: invariant 1 says the
   normal path is exactly as it was, and an unrelated corrupt file taking the
   pipeline's own close route down would be a worse defect than the one this
   fixes.

   Landing is required as well as approval, per the human's ruling of
   2026-09-03 (option 1): a ticket in backlog/done/ whose code is on no branch
   anyone reads is the situation this must not make official."
  [{:keys [qa-mailbox? store ancestor?]}]
  (cond
    qa-mailbox?
    {:allowed? true :reason :qa-mailbox-handoff}

    (= :problem (:kind store))
    {:allowed? false :reason :expedite-store-problem :detail (:detail store)}

    (= :approved (:kind store))
    (cond
      (true? ancestor?)
      {:allowed? true :reason :expedite-qa-verdict
       :detail (str "expedite QA verdict record for commit " (:commit store)
                    (when (:store-file store) (str " in " (:store-file store))))}

      (false? ancestor?)
      {:allowed? false :reason :expedite-commit-not-on-main
       :detail (str "the approved commit " (:commit store) " is not an ancestor of main")}

      ;; An ancestry question that could not be answered is not a yes.
      :else
      {:allowed? false :reason :expedite-ancestry-undeterminable
       :detail (str "whether the approved commit " (:commit store) " reached main could not be determined")})

    :else
    {:allowed? false :reason :missing-qa-approval}))

(defn ancestor-of-main?
  "Whether `commit` is contained by main. true / false / nil when the question
   could not be answered at all - which close-verdict refuses on, rather than
   guessing. Both refs are consulted because either can be the stale one
   (BL-891); a yes from either is a yes."
  [root commit]
  (let [ask (fn [ref]
              (let [{:keys [exit]} (process/sh {:dir (str root) :continue true}
                                               "git" "merge-base" "--is-ancestor" commit ref)]
                exit))
        resolvable? (fn [ref]
                      (zero? (:exit (process/sh {:dir (str root) :continue true}
                                                "git" "rev-parse" "--verify" "--quiet" (str ref "^{commit}")))))
        refs (filter resolvable? ["main" "origin/main"])]
    (cond
      (empty? refs) nil
      (some #(zero? (ask %)) refs) true
      ;; git answers 1 for "not an ancestor" and something else for a question
      ;; it could not ask at all.
      (every? #(= 1 (ask %)) refs) false
      :else nil)))

(defn validate-close-allowed
  "Returns {:allowed true :ticket-ids [...]} or {:allowed false :reason kw
   :ticket-ids [...] :blocked-ticket-ids [...]}, or {:allowed true} for a
   commit with no active->done move at all. Every ticket a close commit
   moves is validated independently (BL-869) - :ticket-ids names every
   ticket the commit closed, :blocked-ticket-ids only the ones that failed
   approval, so a partially-approved multi-ticket close names precisely
   the tickets still missing QA sign-off, not the whole set. The
   coordinator runs `git mv` before commit_integrity_cli, so a ticket may
   already appear under backlog/done/ on disk during a legitimate close —
   do not treat that as :already-done."
  [root paths]
  (if-let [closes (parse-close-move paths)]
    (let [ticket-ids (mapv :ticket-id closes)
          verdicts (into {}
                         (for [{:keys [ticket-id]} closes]
                           [ticket-id
                            (let [store (expedite-approval root ticket-id)]
                              (close-verdict {:qa-mailbox? (qa-approved-ticket? root ticket-id)
                                              :store store
                                              :ancestor? (when (= :approved (:kind store))
                                                           (ancestor-of-main? root (:commit store)))}))]))
          blocked (->> ticket-ids (remove #(:allowed? (get verdicts %))) vec)]
      (if (seq blocked)
        ;; The reason belongs to the tickets that actually failed, and a
        ;; multi-ticket close can fail for more than one reason at once - so
        ;; the detail is carried per ticket rather than flattened to the first.
        {:allowed false
         :reason (:reason (get verdicts (first blocked)))
         :ticket-ids ticket-ids
         :blocked-ticket-ids blocked
         :details (into {} (for [t blocked] [t (select-keys (get verdicts t) [:reason :detail])]))}
        {:allowed true :ticket-ids ticket-ids
         :details (into {} (for [t ticket-ids] [t (select-keys (get verdicts t) [:reason :detail])]))}))
    {:allowed true}))

(defn ticket-done?
  [root ticket-id]
  (= "done" (ticket-status-lib/current-status root ticket-id)))

(defn git-handoff-blocked-for-task?
  "True when a git_handoff draft's task header names a ticket already in
   backlog/done/."
  [root task]
  (when-let [ticket-id (pipeline-stage-lib/extract-ticket-id task)]
    (ticket-done? root ticket-id)))

(defn abandon-inflight-for-ticket!
  "Move every matching new/ and in_process/ handoff to abandoned/ across
   all roles. Returns the moved target paths (may be empty)."
  [root ticket-id]
  (salvage-lib/abandon-stale! root ticket-id))
