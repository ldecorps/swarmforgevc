;; Hotfix 2026-10-03 (local coder A/B, human ruling): swarm_handoff.bb
;; refuses a git_handoff whose task names a ticket other than the sender's
;; in-process parcel. At 13:00:39Z the qwen2.5 coder seat, holding QA's
;; BL-1916 bounce, read a tmp/handoff.txt left over from BL-1858 (task
;; BL-1858, commit 127768f186) and sent it; the self-audit challenge had
;; already been answered for that exact draft in an earlier session, so it
;; queued at once and reached the hardender (parcel 002384). Every other
;; gate passed it: the commit was BL-1858's own, so task and commit agreed.
;; Only the in-process parcel says which ticket the seat is working.
;;
;; Pure - no I/O. swarm_handoff.bb gathers the facts (the sender's
;; top-level in_process files, whether its roles.tsv row is master) and
;; calls `decide`. Fail-open: a ticket the in-process parcel does not name,
;; a master-resident role, and a batch seat (its parcels sit in batch_*
;; subdirectories, never top level) are all allowed.
;;
;; Loaded via load-file; refer as in-process-ticket-guard-lib/<name>.

(ns in-process-ticket-guard-lib
  (:require [clojure.string :as str]))

(def ^:private leading-ticket-pattern #"^\s*((?:BL|GH)-\d+)\b")
(def ^:private work-note-pattern #"^\s*Work\s+((?:BL|GH)-\d+)\b")

(defn task-ticket
  "The ticket id a git_handoff task header leads with (`BL-1916 [behavior:
   ...]` -> \"BL-1916\"), or nil."
  [task]
  (second (re-find leading-ticket-pattern (str task))))

(defn in-process-ticket
  "The ticket an in-process item works: a git_handoff's task header, or a
   coordinator `Work <id>: ...` note's message. Any other note names no
   ticket (nil)."
  [{:keys [type task message]}]
  (case type
    "git_handoff" (task-ticket task)
    "note" (second (re-find work-note-pattern (str message)))
    nil))

(defn refusal-message [ticket held]
  (str "IN_PROCESS_TICKET_MISMATCH: this git_handoff names " ticket
       ", but your in-process parcel is " (str/join ", " (sort held))
       ". A draft left from another ticket is never sent: write the draft for "
       "the in-process ticket (its task and a commit from HEAD) and send that."))

(defn decide
  "{:type :task :master-resident? :in-process [{:type :task :message} ...]}
   -> {:decision :refuse :message ...} when a git_handoff's task ticket is
   not among the tickets the sender's in-process items name, and at least
   one of them names one. {:decision :allow} otherwise."
  [{:keys [type task master-resident? in-process]}]
  (let [ticket (task-ticket task)
        held (set (keep in-process-ticket in-process))]
    (if (and (= "git_handoff" type)
             (not master-resident?)
             ticket
             (seq held)
             (not (contains? held ticket)))
      {:decision :refuse :message (refusal-message ticket held)}
      {:decision :allow})))
