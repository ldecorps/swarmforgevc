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
;;
;; BL-1293: the comparison used to be commit IDENTITY alone, and a merge is
;; a new commit - so a bare "Merge <received> into <role-branch>", the shape
;; this swarm produces at nearly every hop, passed while the role authored
;; nothing. The architect forwarded BL-1224 exactly that way (and BL-1183 the
;; same session); only a human-authored QA bounce noticing a missing evidence
;; file caught it. The gate now asks what the commit CONTRIBUTED, reusing the
;; primitive BL-1269 already built for the sibling pre-QA ancestry gate rather
;; than growing a second notion of it.

(ns review-forward-evidence-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "required_stages_lib.bb")))
;; BL-1293: for merge-introduces-nothing-unique? - the ONE definition of
;; "what did this commit contribute", shared, never copied.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_gather_lib.bb")))

(def review-roles
  "The four forward-chain review roles this gate covers (approval_context
   scope decision #1). coder is absent - a fresh task has nothing 'received'
   yet to compare against. QA is absent from THIS set - its forward
   direction is the approval hop to the coordinator, which
   required_stages_lib/routes-forward? cannot see (canonical-order has no
   coordinator entry), so it is gated by qa-approval-hop? below instead
   (BL-950; BL-806's original exclusion of both QA send paths was that
   slice's approved scope, taken back for the approval hop only). QA's
   OTHER send path - integrating on main and pushing origin - stays
   ungated, per BL-950's own out-of-scope line."
  #{"cleaner" "architect" "hardender" "documenter"})

(defn qa-approval-hop?
  "BL-950: QA's approval git_handoff to the coordinator - the last hop
   before a ticket closes, and the one BL-806 excluded. BL-585 went through
   it 4m09s after dequeue naming the documenter's own commit, leaving no
   evidence file anywhere in history - the identical BL-536 shape this gate
   exists for, one hop past where it reached. Direction needs its own
   predicate because routes-forward?'s canonical-order is the six pipeline
   stages and never contains coordinator. ONLY QA gets this hop: a review
   role sending to the coordinator is not an approval and stays ungated."
  [sender recipient]
  (and (= sender "QA") (= recipient "coordinator")))

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

(defn forward-introduces-nothing-own?
  "True when commit is a MERGE (two or more parents) whose combined diff
   against ALL its parents is empty - every line already exists in some parent, so the role that made it
   authored nothing of its own. The second fs-touching function in this file
   (see received-commit-for-task); `blocked?` stays pure and takes the answer.

   REUSES pre-qa-gate-gather-lib/merge-introduces-nothing-unique? (BL-1269),
   which is why this gate cannot drift from its sibling. Fails open (false)
   on a blank commit, a missing root, or a git invocation that cannot answer -
   the gate must never strand a legitimate send."
  [project-root commit]
  (boolean
   (and project-root
        (not (str/blank? commit))
        ;; MERGES only, the same guard no-dropped-work? applies: on a commit
        ;; with fewer than two parents the primitive's diff-tree is empty for
        ;; an unrelated reason (a root commit, an empty tree), and reading
        ;; that as "introduced nothing" would refuse a legitimate send.
        (>= (count (pre-qa-gate-gather-lib/commit-parents project-root commit)) 2)
        (pre-qa-gate-gather-lib/merge-introduces-nothing-unique? project-root commit))))

(defn blocked?
  "Pure decision (BL-654 property-tested): true only when EVERY one of -
   type is git_handoff, exactly one recipient, the send moves forward
   (a review role via required_stages_lib/routes-forward?, or QA's
   approval hop to the coordinator via qa-approval-hop? - BL-950), no
   reroute_reason marks a deliberate detour, and the outgoing commit equals
   received-commit - holds. received-commit is the caller's own
   received-commit-for-task lookup (or nil on a fs miss, which can never
   equal a validated non-blank commit, so that failure mode also fails
   open here).

   BL-1293: the last conjunct is no longer identity alone. The forward is
   refused when it names the received commit OR when it contributed nothing
   of its own (introduces-nothing-own?, the caller's own
   forward-introduces-nothing-own? lookup). Anything other than an explicit
   true - false, nil, absent - leaves the send alone, so an unreadable or
   unknown commit still fails open."
  [{:keys [type sender recipients task-name commit reroute-reason received-commit
           introduces-nothing-own?]}]
  (boolean
   (and (= type "git_handoff")
        (= 1 (count recipients))
        (or (and (review-roles sender)
                 (required-stages-lib/routes-forward? sender (first recipients)))
            (qa-approval-hop? sender (first recipients)))
        (str/blank? reroute-reason)
        (not (str/blank? task-name))
        (not (str/blank? commit))
        (or (= commit received-commit)
            (true? introduces-nothing-own?)))))

(defn refusal-message
  "Actionable, because Article 4.4 makes an explicit committed NONE a real
   pass and the role has to be told that is the way out: every refusal names
   the role, the task, the commit, and the evidence to commit."
  [{:keys [sender task-name commit introduces-nothing-own?]}]
  (if introduces-nothing-own?
    (format (str "Cannot send git_handoff for %s: commit %s is a merge that "
                 "introduces nothing %s authored over its parents - a bare "
                 "merge of the received parcel is not a review pass. Article "
                 "4.4 requires %s to commit its own work for %s - its fix, or "
                 "an explicit NONE evidence file under backlog/evidence/ "
                 "naming the ticket and the role when the sweep found no "
                 "defect - and forward THAT commit. If %s legitimately cannot "
                 "act on this parcel, route it onward with a reroute_reason "
                 "instead.")
            task-name commit sender sender task-name sender)
    (format (str "Cannot send git_handoff for %s: commit %s is exactly the "
                 "commit %s already received for this task - Article 4.4 "
                 "requires a clean review pass to commit its explicit-NONE "
                 "evidence (or its fix) under backlog/evidence/ and forward "
                 "THAT commit, never the bare received hash. If %s "
                 "legitimately cannot act on this parcel, route it onward "
                 "with a reroute_reason instead of a same-commit forward.")
            task-name commit commit sender)))
