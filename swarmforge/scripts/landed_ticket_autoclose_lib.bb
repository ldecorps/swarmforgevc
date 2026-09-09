;; landed_ticket_autoclose_lib.bb — hotfix 2026-09-09: a ticket QA has landed
;; on origin/main is closed by the daemon itself, not left for the coordinator.
;;
;; Incident: BL-1278 went coder → cleaner → architect → hardener → documenter
;; → QA on the all-GLM pack, QA landed it (land-approvals row, commit on
;; origin/main) and sent the coordinator its git_handoff; the coordinator
;; completed that parcel WITHOUT the active/ → done/ move, lost track, and
;; began chasing a phantom "possible drop". The existing landed-but-open sweep
;; never even saw it: its detector reads commit SUBJECTS for "QA-approved" /
;; "QA pass inventory" and QA's subject was "BL-1278: QA review pass
;; evidence"; and when it does see one, it only nudges QA.
;;
;; This lib is the pure half. It (1) reads the durable land record QA writes
;; (.swarmforge/land-approvals/<YYYY-MM>.jsonl, land_step_lib.bb) as a second
;; landed signal beside the subject index, (2) decides which active tickets are
;; auto-close candidates and whether an attempt is due (per-ticket cooldown),
;; and (3) orchestrates one attempt through injected adapters. handoffd.bb
;; supplies the real adapters: close! runs close_ticket.sh, which goes through
;; commit_integrity_cli.bb and ticket_close_guard_lib.bb — the guard, not this
;; lib, remains the arbiter of whether a close is allowed. A refused close is
;; logged and the legacy QA nudge still fires; nothing here ever moves a file.

(ns landed-ticket-autoclose-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def default-cooldown-ms (* 30 60 1000))
(def coordinator-note-max-length 80)
(def attempts-file-name "landed-auto-close-attempts.json")

(defn short-sha [sha]
  (let [s (str (or sha ""))]
    (when-not (str/blank? s)
      (subs s 0 (min 10 (count s))))))

;; ── the land record ─────────────────────────────────────────────────────────

(defn parse-land-approval-lines
  "JSONL text → [{:ticket :commit}] in file order. Blank or unparsable lines
   are skipped, never fatal: one corrupt row must not blind the whole sweep."
  [text]
  (->> (str/split-lines (or text ""))
       (remove str/blank?)
       (keep (fn [line]
               (try
                 (let [m (json/parse-string line true)]
                   (when (map? m)
                     {:ticket (str (or (:ticket m) ""))
                      :commit (str (or (:commit m) ""))}))
                 (catch Exception _ nil))))
       vec))

(defn land-approvals-dir [root]
  (fs/path root ".swarmforge" "land-approvals"))

(defn read-land-approval-rows
  "Every row of every <YYYY-MM>.jsonl under the store, files in name order
   (oldest month first), rows in file order - so the LAST row for a ticket
   is its most recent land."
  [root]
  (let [dir (land-approvals-dir root)]
    (if-not (fs/exists? dir)
      []
      (->> (fs/list-dir dir)
           (filter #(str/ends-with? (fs/file-name %) ".jsonl"))
           (sort-by fs/file-name)
           (mapcat #(parse-land-approval-lines (try (slurp (str %)) (catch Exception _ ""))))
           vec))))

(defn index-store-approvals
  "ticket-id → short commit for every ACTIVE ticket whose most recent land
   row names a commit `ancestor?` answers true for (i.e. it reached
   origin/main). Only active ids are asked about, so the ancestry probe runs
   once per open ticket, not once per historical row."
  [rows active-ids ancestor?]
  (let [active (set active-ids)
        latest (reduce (fn [acc {:keys [ticket commit]}]
                         (if (and (contains? active ticket) (not (str/blank? commit)))
                           (assoc acc ticket commit)
                           acc))
                       {}
                       rows)]
    (into {}
          (for [[ticket commit] latest
                :when (true? (ancestor? commit))]
            [ticket (short-sha commit)]))))

;; ── decisions ───────────────────────────────────────────────────────────────

(defn auto-close-candidates
  "Active ids with a landed approval (subject index or store index, already
   merged by the caller) and no Close subject on main yet.
   [{:id :approval-commit} ...], deterministic order."
  [active-ids approvals closed-ids]
  (->> active-ids
       sort
       (keep (fn [id]
               (when-let [sha (get approvals id)]
                 (when-not (contains? (set closed-ids) id)
                   {:id id :approval-commit sha}))))
       vec))

(defn attempt-due?
  "An attempt is due when the ticket has no recorded attempt or the last one
   is older than the cooldown. Cooldown, not a one-shot: a close the guard
   refused now (QA's handoff not yet in the coordinator mailbox) may be
   allowed later."
  [attempts id now-ms cooldown-ms]
  (let [last-ms (get attempts (keyword id) (get attempts id 0))]
    (or (nil? last-ms)
        (not (number? last-ms))
        (>= (- now-ms last-ms) cooldown-ms))))

(defn coordinator-note-message [id sha]
  (let [msg (str id " closed by handoffd after QA land " sha " - promote next")]
    (if (<= (count msg) coordinator-note-max-length)
      msg
      (subs msg 0 coordinator-note-max-length))))

(defn coordinator-draft-lines
  "The coordinator learns the close from a note in its own mailbox (the same
   transport its other bookkeeping cues use), so its next turn is the
   promotion, not a search for a parcel that no longer exists."
  [id sha]
  ["type: note"
   "to: coordinator"
   "priority: 00"
   (str "message: " (coordinator-note-message id sha))])

;; ── attempt bookkeeping ─────────────────────────────────────────────────────

(defn attempts-path [daemon-dir]
  (fs/path daemon-dir attempts-file-name))

(defn read-attempts [daemon-dir]
  (or (try (let [m (json/parse-string (slurp (str (attempts-path daemon-dir))) true)]
             (when (map? m) m))
           (catch Exception _ nil))
      {}))

(defn write-attempt! [daemon-dir id now-ms]
  (fs/create-dirs daemon-dir)
  (spit (str (attempts-path daemon-dir))
        (json/generate-string (assoc (read-attempts daemon-dir) (keyword id) now-ms))))

;; ── one attempt, through adapters ───────────────────────────────────────────

(defn attempt-auto-close!
  "Runs at most one close for `item` ({:id :approval-commit}).
   Adapters: close! (item → {:ok? bool :detail str}), notify! (item → any),
   log! (tag & details), record-attempt! (id → any).
   Returns {:outcome :closed | :refused | :error | :skipped-cooldown}.
   The attempt is recorded before close! runs, so a close that crashes
   mid-way is not retried every tick."
  [{:keys [item now-ms attempts cooldown-ms close! notify! log! record-attempt!]}]
  (let [id (:id item)
        sha (:approval-commit item)
        cooldown (or cooldown-ms default-cooldown-ms)]
    (if-not (attempt-due? (or attempts {}) id (or now-ms 0) cooldown)
      {:outcome :skipped-cooldown :id id}
      (do
        (record-attempt! id)
        (try
          (let [{:keys [ok? detail]} (close! item)]
            (if ok?
              (do (log! "landed-auto-close" id sha)
                  (try (notify! item)
                       (catch Exception e
                         (log! "landed-auto-close-notify-error" id (.getMessage e))))
                  {:outcome :closed :id id})
              (do (log! "landed-auto-close-refused" id (str detail))
                  {:outcome :refused :id id :detail detail})))
          (catch Exception e
            (log! "landed-auto-close-error" id (.getMessage e))
            {:outcome :error :id id :detail (.getMessage e)}))))))
