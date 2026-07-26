;; BL-648: the impure wiring half of the orphan-claim sweep - see
;; orphan_claim_lib.bb for the pure claim-reclaim? decision this drives.
;;
;; sweep! walks every role's own inbox/in_process (a role-info map shaped
;; like handoff_lib.bb's load-all-roles/load-role-info), and for any role
;; holding a claim whose owning session is confirmed dead - and which is not
;; the role the resident is about to resume - moves the claimed handoff(s)
;; back to that role's inbox/new (same basename, so the original priority
;; prefix travels unchanged) and logs a loud line naming the parcel.
;;
;; All I/O is behind adapters (:roles, :session-alive?, :log!) so tests never
;; need a real tmux socket or a live swarm - the same discipline
;; fixture_reaper_sweep_lib.bb / orphan_agent_reaper_sweep_lib.bb already use.

(ns orphan-claim-sweep-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "orphan_claim_lib.bb")))

(defn claim-files
  "Every claimed .handoff under role-info's in_process: flat files plus one
   level into any batch_* subdirectory (a batch-mode role's claim is a
   directory of handoffs, not a single file - BL-075/ready_for_next_batch.bb)."
  [role-info]
  (let [dir (handoff-lib/mailbox-dir role-info :in_process)]
    (into (handoff-lib/handoff-files dir)
          (mapcat handoff-lib/handoff-files (handoff-lib/batch-dirs dir)))))

(defn- reclaim-line [role claim-file target]
  (str "BL-648 RECLAIM: role=" role
       " owning session not alive - reclaiming orphaned claim "
       claim-file " -> " target))

(defn- unreclaimable-line [role claim-file ex]
  (str "BL-648 LOUD: role=" role
       " could not reclaim orphaned claim " claim-file
       " (" (.getMessage ^Exception ex) ") - left claimed; surfacing, not aborting the launch."))

(defn reclaim-file!
  "Moves one claimed handoff back to role-info's inbox/new (unchanged
   basename, so its original priority prefix is preserved untouched - no
   priority recomputation needed), drops its now-stale sidecars from the old
   in_process location, and logs a loud reclaim line. Returns the new path,
   or nil if the move could not be completed (a pre-existing target, EACCES,
   ENOSPC, a stale worktree path - the trigger class is open). A failed
   reclaim is never thrown past this function: it is surfaced via log! and
   the claim is simply left in place for the next sweep to retry, per
   invariant 1's 'resumes that role or surfaces the claim' - never a launch
   abort over one un-movable parcel."
  [role-info claim-file log!]
  (let [new-dir (handoff-lib/mailbox-dir role-info :new)
        target (fs/path new-dir (fs/file-name claim-file))]
    (try
      (fs/create-dirs new-dir)
      (fs/move claim-file target {:replace-existing false})
      (handoff-lib/remove-sidecars-of! claim-file)
      (log! (reclaim-line (:role role-info) (str claim-file) (str target)))
      (str target)
      (catch Exception e
        (log! (unreclaimable-line (:role role-info) (str claim-file) e))
        nil))))

(defn- safe-delete! [path]
  (try (fs/delete path) (catch Exception _ nil)))

(defn- cleanup-empty-batch-dirs!
  "After every handoff has been reclaimed out of role-info's batch_*
   in_process directories, drop any that are now empty (sidecars-only or
   nothing) - same disposable-sidecar rule clean-dir-sidecars-or-fail! uses
   elsewhere, but permissive here: this is a defensive sweep, not a normal
   completion, so an unexpected leftover file - or a delete that itself
   fails (EACCES, already gone, a stale mount) - just keeps the directory
   rather than aborting the whole sweep. Every fs/delete is individually
   guarded, and the whole pass is wrapped too: a listing failure on one
   batch dir must not stop cleanup of the next."
  [role-info]
  (try
    (let [dir (handoff-lib/mailbox-dir role-info :in_process)]
      (doseq [batch (handoff-lib/batch-dirs dir)]
        (try
          (doseq [entry (fs/list-dir batch)]
            (when (handoff-lib/sidecar-file? entry)
              (safe-delete! entry)))
          (when (and (fs/exists? batch) (empty? (fs/list-dir batch)))
            (safe-delete! batch))
          (catch Exception _ nil))))
    (catch Exception _ nil)))

(defn sweep!
  "adapters (map):
     :roles          - coll of role-info maps (handoff-lib/load-all-roles shape)
     :session-alive? - (fn [role-info]) -> bool; the ONLY injected liveness
                       probe (real callers pass a tmux session-exists? check,
                       tests inject a fake - BL-648's Background seam)
     :resumed-role   - role name the resident is about to boot as, or
                       nil/blank outside `rotation router` - never reclaimed
     :log!           - (fn [line])
   Returns a vector of {:role :reclaimed [new-paths...]}, one entry per role
   that held at least one claim (reclaimed or left alone). A role whose sweep
   itself fails unexpectedly (not a per-file reclaim failure - reclaim-file!
   already never throws - but e.g. a listing error reading its own
   in_process/) is isolated to its own entry {:role :reclaimed [] :error
   \"...\"} and logged; it never aborts the roles still left to sweep."
  [{:keys [roles session-alive? resumed-role log!]}]
  (let [resumed (not-empty (some-> resumed-role str str/trim))]
    (vec
     (keep
      (fn [role-info]
        (try
          (let [files (claim-files role-info)]
            (when (seq files)
              (let [reclaim? (orphan-claim-lib/claim-reclaim?
                               {:has-claim? true
                                :owner-alive? (boolean (session-alive? role-info))
                                :being-resumed? (= (:role role-info) resumed)})]
                (if reclaim?
                  (let [attempted (mapv #(reclaim-file! role-info % log!) files)
                        moved (vec (remove nil? attempted))]
                    (cleanup-empty-batch-dirs! role-info)
                    {:role (:role role-info) :reclaimed moved})
                  {:role (:role role-info) :reclaimed []}))))
          (catch Exception e
            (log! (str "BL-648 LOUD: role=" (:role role-info)
                       " orphan-claim sweep failed unexpectedly (" (.getMessage e)
                       ") - skipping this role, continuing sweep for the rest."))
            {:role (:role role-info) :reclaimed [] :error (.getMessage e)})))
      roles))))

(defn default-adapters
  "Real adapters for a live project root: every roles.tsv role, liveness via
   the project's own tmux socket, log lines to stdout (the launcher's own
   log redirection already carries stdout through to the launch log)."
  [root]
  (let [socket-file (fs/path root ".swarmforge" "tmux-socket")
        socket (when (fs/exists? socket-file) (str/trim (slurp (str socket-file))))]
    {:roles (handoff-lib/load-all-roles root)
     :session-alive? (fn [role-info]
                        (boolean (and socket (handoff-lib/session-exists? socket (:session role-info)))))
     :log! println}))
