;; BL-668: after QA lands on origin/main, fast-forward CLEAN pipeline role
;; branches in their own worktrees. Dirty worktrees, in_process parcels, and
;; non-ff branches are surfaced with logged skip reasons — never merge (non-ff),
;; rebase, stash, or reset.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "post_qa_branch_sweep_lib.bb")))
;; Referred to as post-qa-branch-sweep-lib/foo.
(ns post-qa-branch-sweep-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def merge-up-excluded-roles #{"coordinator" "specifier"})

(defn- read-json [path]
  (when (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true) (catch Exception _ nil))))

(defn state-path [daemon-dir]
  (str (fs/path daemon-dir "post-qa-branch-sweep-state.json")))

(defn- normalize-state [raw]
  (let [raw (or raw {})]
    {:landed-sha (:landed-sha raw)
     :settled (into {}
                    (map (fn [[k v]] [(if (keyword? k) (name k) (str k)) v])
                         (or (:settled raw) {})))
     :surfaced (vec (for [e (or (:surfaced raw) [])]
                      {:role (name (:role e))
                       :reason (name (:reason e))}))}))

(defn read-state [daemon-dir]
  (normalize-state (read-json (state-path daemon-dir))))

(defn write-state! [daemon-dir state]
  (fs/create-dirs daemon-dir)
  (spit (state-path daemon-dir) (json/generate-string state)))

(defn sweep-eligible-role?
  "Pipeline worktree roles only — coordinator/specifier are merge-up excluded."
  [role-info]
  (and role-info
       (not (contains? merge-up-excluded-roles (:role role-info)))
       (not= "master" (:worktree-name role-info))))

(defn decide-role
  [{:keys [head-sha landed-sha dirty? in-process? can-ff?]}]
  (cond
    (or (nil? landed-sha) (nil? head-sha))
    {:action :skip :reason :missing-ref}

    (= head-sha landed-sha)
    {:action :already-settled}

    dirty?
    {:action :surface :reason :dirty-worktree}

    in-process?
    {:action :surface :reason :in-process-work}

    can-ff?
    {:action :settle}

    :else
    {:action :surface :reason :divergent-branch}))

(defn normalize-state-for-landed
  [state landed-sha]
  (if (= (:landed-sha state) landed-sha)
    state
    {:landed-sha landed-sha :settled {} :surfaced []}))

(defn settled-at-landed?
  [state role landed-sha]
  (let [settled (get state :settled)]
    (= (get settled role) landed-sha)))

(defn surface-already-recorded?
  [state role reason]
  (let [reason-str (if (keyword? reason) (name reason) (str reason))]
    (some #(and (= (str (:role %)) role) (= (str (:reason %)) reason-str))
          (:surfaced state []))))

(defn surface-reason-text
  [reason]
  (case reason
    :dirty-worktree "dirty worktree"
    :in-process-work "in_process work present"
    :divergent-branch "branch cannot fast-forward to landed commit"
    :missing-ref "missing git ref"
    (str reason)))

(defn wake-for-reason?
  "BL-1361, human ruling 2026-09-04: TELL the role for every surfacing reason,
   but WAKE it only for a dirty worktree.

   A dirty worktree is the one reason that does not resolve itself. A branch
   that merely cannot fast-forward is merged the next time that role receives a
   parcel anyway, because a forwarded commit must carry the received commit as
   an ancestor - so waking for it spends a turn on something the role would
   have done for free. Waking is the exception here, so an unknown reason never
   wakes."
  [reason]
  (= :dirty-worktree (if (keyword? reason) reason (keyword (str reason)))))

(defn surface-notice
  "The one-liner a surfaced role is told: the landed commit, why the sweep
   could not settle its branch, and what it must do. Kept inside the 80-char
   note cap, because a note over the cap quarantines silently as .dead - a
   surfacing nobody hears is the defect this ticket exists to end, and an
   oversized message would reproduce it in a new way."
  [role reason landed-sha]
  (let [short-sha (subs (str landed-sha) 0 (min 10 (count (str landed-sha))))
        text (str "branch behind " short-sha ": " (surface-reason-text reason) " - merge up")]
    (if (<= (count text) 80) text (subs text 0 80))))

(defn record-surface!
  [state role reason]
  (update state :surfaced conj {:role role :reason (if (keyword? reason) (name reason) (str reason))}))

(defn sweep-one-role
  [state landed-sha role-name facts adapters]
  (let [decision (decide-role (assoc facts :landed-sha landed-sha))]
    (case (:action decision)
      (:skip :already-settled)
      [state nil]

      :settle
      (if (settled-at-landed? state role-name landed-sha)
        [state nil]
        (let [result ((:fast-forward! adapters) role-name facts)]
          (if (:success result)
            (let [new-state (update state :settled assoc role-name landed-sha)]
              ((:log! adapters) "post-qa-branch-sweep-settled" role-name landed-sha)
              [new-state {:type :settled :role role-name :landed-sha landed-sha}])
            (let [reason :divergent-branch
                  new-state (if (surface-already-recorded? state role-name reason)
                              state
                              (record-surface! state role-name reason))]
              ((:log! adapters) "post-qa-branch-sweep-surfaced" role-name (surface-reason-text reason))
              [new-state {:type :surfaced :role role-name :reason (name reason)}]))))

      :surface
      (let [reason (:reason decision)]
        (if (surface-already-recorded? state role-name reason)
          [state nil]
          (let [new-state (record-surface! state role-name reason)]
            ((:log! adapters) "post-qa-branch-sweep-surfaced" role-name (surface-reason-text reason))
            [new-state {:type :surfaced :role role-name :reason (name reason)}]))))))

(defn sweep!
  [daemon-dir landed-sha role-names adapters]
  (when (and landed-sha (seq role-names))
    (let [initial (normalize-state-for-landed (read-state daemon-dir) landed-sha)
          [final-state actions]
          (reduce
           (fn [[state actions] role-name]
             (let [facts ((:role-facts! adapters) role-name)
                   [new-state action] (sweep-one-role state landed-sha role-name facts adapters)]
               ;; BL-1361: the send. `action` is produced only for a NEW
               ;; surfacing - sweep-one-role returns nil when the record
               ;; already exists - so the existing surfaced record stays the
               ;; authority and a per-tick sweep is silent (invariant 2).
               ;;
               ;; One unreachable mailbox never withholds the rest (invariant
               ;; 3): a failure is logged and the reduce carries on. Wrapped
               ;; because a `tell!` that THROWS must not end the sweep either -
               ;; the roles after it are owed their notice.
               (when (and action (= :surfaced (:type action)) (:tell! adapters))
                 (let [reason (keyword (:reason action))
                       result (try
                                ((:tell! adapters) role-name reason
                                 (surface-notice role-name reason landed-sha)
                                 (wake-for-reason? reason))
                                (catch Exception e {:success false :error (str (.getMessage e))}))]
                   (when-not (:success result)
                     ((:log! adapters) "post-qa-branch-sweep-tell-failed"
                      role-name (str (:error result))))))
               [new-state (if action (conj actions action) actions)]))
           [initial []]
           role-names)]
      (write-state! daemon-dir (assoc final-state :landed-sha landed-sha))
      {:state final-state :actions actions})))
