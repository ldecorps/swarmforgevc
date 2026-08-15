;; BL-806: refuses a forward-direction git_handoff from a review role
;; (cleaner, architect, hardender, documenter) whose commit: equals the
;; commit that role received for the same task - Article 4.4's "commit
;; your explicit-NONE evidence (or your fix) and forward THAT commit" as a
;; structural send-time backstop. BL-536 proved prompt text alone is not
;; enough: architect and hardener both fast-forward-merged and forwarded
;; the bare received hash, so QA's ancestry audit could not tell the
;; passes happened, and a full bounce + re-entry cycle was burned re-
;; running them.
;;
;; Split pure decision (`blocked?`, BL-654 property-tested, no fs) from the
;; one fs read it needs (`received-commit-for-task`) - the property test
;; carries no mailbox fixture. Direction and the review-role set are both
;; derived the same way required_stages_lib/routes-forward? already does
;; (BL-606's own architect bounce #3): a reviewer's bounce carries no
;; header this swarm's roles ever write, so direction comes from
;; sender-position, never an optional marker.

(ns review-forward-evidence-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "required_stages_lib.bb")))

(def review-roles
  "The four forward-chain review roles this gate covers (approval_context
   scope decision #1). coder is absent - a fresh task has nothing 'received'
   yet to compare against. QA is absent - its send paths (approval to
   coordinator, integration on main) are excluded this slice to avoid
   entangling integration mechanics."
  #{"cleaner" "architect" "hardender" "documenter"})

(defn- received-parcel-for-task
  "The newest git_handoff parcel in role-info's in_process box whose task
   field equals task-name exactly (batch roles hold several in-process
   tasks at once) - handoff-files' own filename sort (priority, then
   timestamp, then sequence) makes `last` the newest match."
  [role-info task-name]
  (->> (handoff-lib/handoff-files (handoff-lib/mailbox-dir role-info :in_process))
       (filter (fn [file]
                 (and (= "git_handoff" (handoff-lib/header-field file "type"))
                      (= task-name (handoff-lib/header-field file "task")))))
       last))

(defn received-commit-for-task
  "sender's received commit for task-name, or nil - the ONLY fs-touching
   function in this file. Fails open (nil) on every 'nothing to check
   against' shape: unknown sender role, no mailbox, no matching parcel, or
   a matching parcel with no commit header - the gate must never strand a
   legitimate send (ticket CONSTRAINTS: fail open on an initiating send, a
   drained box, an unreadable box, or a mailbox-less sender role)."
  [root sender task-name]
  (when-let [role-info (handoff-lib/load-role-info sender root)]
    (when-let [file (received-parcel-for-task role-info task-name)]
      (handoff-lib/header-field file "commit"))))

(defn blocked?
  "Pure decision (BL-654 property-tested): true only when EVERY one of -
   sender is a review role, type is git_handoff, exactly one recipient, the
   send moves forward (required_stages_lib/routes-forward?), no
   reroute_reason marks a deliberate detour, and the outgoing commit equals
   received-commit - holds. received-commit is the caller's own
   received-commit-for-task lookup (or nil on a fs miss, which can never
   equal a validated non-blank commit, so that failure mode also fails
   open here)."
  [{:keys [type sender recipients task-name commit reroute-reason received-commit]}]
  (boolean
   (and (= type "git_handoff")
        (review-roles sender)
        (= 1 (count recipients))
        (required-stages-lib/routes-forward? sender (first recipients))
        (str/blank? reroute-reason)
        (not (str/blank? task-name))
        (not (str/blank? commit))
        (= commit received-commit))))

(defn refusal-message
  [{:keys [sender task-name commit]}]
  (format (str "Cannot send git_handoff for %s: commit %s is exactly the "
               "commit %s already received for this task - Article 4.4 "
               "requires a clean review pass to commit its explicit-NONE "
               "evidence (or its fix) and forward THAT commit, never the "
               "bare received hash. If %s legitimately cannot act on this "
               "parcel, route it onward with a reroute_reason instead of a "
               "same-commit forward.")
          task-name commit commit sender))
