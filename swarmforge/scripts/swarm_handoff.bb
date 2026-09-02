#!/usr/bin/env bb

(ns swarm-handoff
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.string :as str])
  (:import [java.nio.channels FileChannel]
           [java.nio.file OpenOption StandardOpenOption]
           [java.security MessageDigest]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_inject_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "ticket_close_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "duplicate_chain_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pre_qa_gate_gather_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "coordinator_config_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "required_stages_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "review_forward_evidence_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_commit_coherence_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "parcel_rollback_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "tree_collapse_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "landed_ticket_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_scope_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "unregistered_test_gate_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "reverse_hop_lib.bb")))

(def usage-text
  (str "Usage: swarm_handoff.sh <draft-file>\n\n"
       "Draft formats:\n\n"
       "type: awake\n"
       "to: <role>[,<role>...]\n"
       "priority: NN\n\n"
       "type: git_handoff\n"
       "to: <role>[,<role>...]\n"
       "priority: NN\n"
       "task: <short-stable-task-name>\n"
       "commit: <10-char-commit-abbrev>\n\n"
       "type: note\n"
       "to: <role>[,<role>...]\n"
       "priority: NN\n"
       "message: <one line, max 80 chars>\n\n"
       "type: rule_proposal\n"
       "to: <role>[,<role>...]\n"
       "priority: NN\n"
       "scope: constitution | role:<rolename> | engineering | project\n"
       "body: <proposed rule text, max 200 chars>\n"
       "rationale: <why the rule is needed, max 200 chars>"))

(def reserved-fields #{"id" "from" "role" "recipient" "created_at" "enqueued_at" "dequeued_at" "completed_at" "routing_skipped" "non-forwarding"})
(def allowed-fields #{"type" "to" "priority" "task" "commit" "message" "rejection_reason" "reroute_reason" "scope" "body" "rationale"})
(def allowed-types #{"awake" "git_handoff" "note" "rule_proposal"})
(def valid-scope-pattern #"constitution|engineering|project|role:[a-zA-Z][a-zA-Z0-9]*")

(defn usage []
  (binding [*out* *err*]
    (println usage-text)))

(defn exit! [status message]
  (binding [*out* *err*]
    (when message
      (println message)))
  (System/exit status))

;; BL-1021: every subprocess here goes through daemon-cycle-guard-lib/sh!,
;; the same bounded chokepoint BL-061/BL-967 put in front of handoffd.bb.
;; This script is NOT merely a CLI: handoffd's dispatch-gap, unassigned-active
;; and open-slot sweeps SPAWN it, so it sits on the daemon's critical path -
;; reached by a process-spawn edge that the guard lib's load-file closure gate
;; cannot walk (BL-1022 widens the gate; this closes the hole). It previously
;; used clojure.java.shell/sh, which has no timeout at all, so a wedged git or
;; tmux here wedged the daemon. The chokepoint is already in scope with no new
;; wiring: handoff_lib.bb load-files daemon_cycle_guard_lib.bb above.
;;
;; sh! keeps clojure.java.shell/sh's result shape ({:exit :out :err}), so
;; every caller below is unchanged; the vector+opts call form is required
;; because the varargs form silently drops :dir.
(defn command
  ([dir & args]
   (daemon-cycle-guard-lib/sh! (vec args) {:dir (str dir)})))

(defn git-root []
  (let [result (command "." "git" "rev-parse" "--show-toplevel")]
    (when (zero? (:exit result))
      (str/trim (:out result)))))

(defn git-common-dir []
  (let [result (command "." "git" "rev-parse" "--git-common-dir")]
    (when (zero? (:exit result))
      (let [path (str/trim (:out result))]
        (if (fs/absolute? path)
          (str (fs/path path))
          (str (fs/absolutize path)))))))

(defn project-root []
  (if-let [root (git-root)]
    (if (fs/exists? (fs/path root ".swarmforge" "roles.tsv"))
      root
      (if-let [common (git-common-dir)]
        (let [candidate (str (fs/parent common))]
          (if (fs/exists? (fs/path candidate ".swarmforge" "roles.tsv"))
            candidate
            (exit! 1 "Cannot find SwarmForge project root")))
        (exit! 1 "Cannot find SwarmForge project root")))
    (exit! 1 "Cannot find SwarmForge project root")))

(defn roles-file []
  (fs/path (project-root) ".swarmforge" "roles.tsv"))

(defn role-known? [role]
  (some (fn [line]
          (= role (first (str/split line #"\t"))))
        (str/split-lines (slurp (str (roles-file))))))

(defn sender-role []
  ;; BL-983 (invariant 3): a SEAT's outward identity is its STAGE - the
  ;; from:/role: headers, the filename, routing and every guard see the
  ;; stage, so no downstream role, board or metric ever learns which seat
  ;; did the work. A bare role IS its stage - byte-identical pre-seat
  ;; behavior. Mailbox PATHS (outbox/sent) still resolve via the full
  ;; SWARMFORGE_ROLE through handoff-lib/my-mailbox-base-dir, which is
  ;; seat-local disk state, not parcel content.
  (if-let [role (not-empty (System/getenv "SWARMFORGE_ROLE"))]
    (handoff-lib/seat-stage role)
    (exit! 1 "Set SWARMFORGE_ROLE.")))

(defn state-dir []
  (handoff-lib/my-mailbox-base-dir))

(defn timestamp []
  (.format java.time.format.DateTimeFormatter/ISO_INSTANT
           (java.time.Instant/now)))

(defn id-timestamp []
  (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
           (.atZone (java.time.Instant/now) java.time.ZoneOffset/UTC)))

(defn valid-priority? [priority]
  (boolean (re-matches #"[0-9][0-9]" priority)))

(defn parse-draft [draft]
  (loop [lines (str/split-lines (slurp (str draft)))
         line-no 0
         body-seen? false
         headers {}
         ordered []
         errors []]
    (if-let [line (first lines)]
      (let [line-no (inc line-no)]
        (cond
          body-seen?
          (recur (next lines) line-no body-seen? headers ordered
                 (cond-> errors
                   (not (str/blank? line))
                   (conj (format "Line %d: draft handoffs may contain headers only; payloads are generated by swarm_handoff.sh." line-no))))

          (str/blank? line)
          (recur (next lines) line-no true headers ordered errors)

          (not (str/includes? line ": "))
          (recur (next lines) line-no body-seen? headers ordered
                 (conj errors (format "Line %d: expected 'field: value'." line-no)))

          :else
          (let [[field value] (str/split line #": " 2)]
            (cond
              (or (str/blank? field) (str/blank? value))
              (recur (next lines) line-no body-seen? headers ordered
                     (conj errors (format "Line %d: field and value must both be non-empty." line-no)))

              (reserved-fields field)
              (recur (next lines) line-no body-seen? headers ordered
                     (conj errors (format "Line %d: header '%s' is reserved and must not be written by agents." line-no field)))

              (not (allowed-fields field))
              (recur (next lines) line-no body-seen? headers ordered
                     (conj errors (format "Line %d: unknown header '%s'." line-no field)))

              (contains? headers field)
              (recur (next lines) line-no body-seen? headers ordered
                     (conj errors (format "Line %d: duplicate header '%s'." line-no field)))

              :else
              (recur (next lines) line-no body-seen? (assoc headers field value) (conj ordered field) errors)))))
      {:headers headers :ordered ordered :errors errors})))

(defn validate-recipients [to]
  (if (str/blank? to)
    [[] []]
    (let [recipients (str/split to #"," -1)]
      [recipients
       (loop [remaining recipients seen #{} errors []]
         (if-let [recipient (first remaining)]
           (let [errors (cond-> errors
                          (str/blank? recipient)
                          (conj "Header 'to' contains an empty recipient.")
                          (str/includes? recipient "_")
                          (conj (format "Recipient role '%s' is invalid; role names may not contain underscores." recipient))
                          (contains? seen recipient)
                          (conj (format "Duplicate recipient '%s'." recipient))
                          (and (not (str/blank? recipient)) (not (role-known? recipient)))
                          (conj (format "Unknown recipient role '%s'." recipient)))]
             (recur (next remaining) (conj seen recipient) errors))
           errors))])))

(defn canonical-commit [commit]
  (handoff-lib/resolve-canonical-commit
   commit
   (:out (command "." "git" "rev-parse" (str "--disambiguate=" commit)))
   (fn [object] (str/trim (:out (command "." "git" "cat-file" "-t" object))))
   (fn [object] (str/trim (:out (command "." "git" "rev-parse" "--short=10" object))))))

(defn- check-backlog-depth []
  ;; BL-808: count tickets via the shared counter, never raw list-dir
  ;; (which counted the tracked .gitkeep as an active ticket).
  ;; BL-683 bl683DepthWarningCountsTicketsOnly: acceptance handler registered
  (let [project-root (project-root)
        active-dir (fs/path project-root "backlog" "active")
        max-depth (backlog-depth-lib/read-max-depth project-root)
        active-count (backlog-depth-lib/count-active-tickets active-dir)]
    (when (backlog-depth-lib/depth-exceeded? active-count max-depth)
      (binding [*out* *err*]
        (println (format "WARNING: Active backlog depth exceeded (active=%d, max=%d). Coordinator should promote paused items." active-count max-depth)))
      ;; BL-598: the send path already classified this steady-state depth warn
      ;; as non-actionable noise — record without blocking the handoff.
      (try
        (let [cli (str (fs/path project-root "extension" "out" "tools" "emit-alert-telemetry.js"))]
          (when (fs/exists? cli)
            (command project-root "node" cli (str project-root) "active-backlog-depth" "false-positive")))
        (catch Exception _ nil)))))

(def pre-qa-gate-remedy
  "Merge the named commit / land the named wiring and re-forward, or record a deliberately dropped commit under abandoned_commits:.")

(defn- pre-qa-gate-errors
  "BL-531: the QA-edge durability/wiring gate. Arms only for a git_handoff
   whose recipients include QA; a task name with no extractable ticket id
   skips it silently (no error, no warning). Infrastructure failures
   (missing role worktree, unreadable roles.tsv, absent main ref) print a
   warning and never block the send - only a positive finding does."
  [type to task-name canonical]
  (if-not (and (not (str/blank? task-name))
               canonical
               (pre-qa-gate-lib/gate-armed? {:type type :to to}))
    []
    (let [{:keys [findings warnings]}
          (pre-qa-gate-gather-lib/findings-for-git-handoff
           (project-root) {:to to :task-name task-name :cited-commit canonical})]
      (doseq [w warnings]
        (binding [*out* *err*] (println (str "PRE_QA_GATE WARNING: " w))))
      (if (seq findings)
        (conj (mapv pre-qa-gate-lib/format-finding-line findings) pre-qa-gate-remedy)
        []))))

(def pointer-gate-remedy
  "Flip the ticket's acceptance: pointer to the correct path (or promote the parked .feature.draft in the same commit) and re-send.")

(defn- pointer-gate-errors
  "BL-880: the early, existence-only acceptance-pointer check. Arms for
   every git_handoff whose task name resolves to a ticket id, EXCEPT one
   addressed to QA - that edge keeps calling pre-qa-gate-errors above
   unchanged, whose fuller BL-761 acceptance-contract evaluation already
   subsumes this exact check. Infrastructure failures (the cited commit's
   tree could not be read) print a warning and never block the send - only
   a positive existence finding does."
  [type to task-name canonical]
  (if-not (and (= "git_handoff" type)
               (not (str/blank? task-name))
               canonical)
    []
    (let [{:keys [findings warnings]}
          (pre-qa-gate-gather-lib/pointer-findings-for-git-handoff
           (project-root) {:to to :task-name task-name :cited-commit canonical})]
      (doseq [w warnings]
        (binding [*out* *err*] (println (str "ACCEPTANCE_POINTER_GATE WARNING: " w))))
      (if (seq findings)
        (conj (mapv pre-qa-gate-lib/format-finding-line findings) pointer-gate-remedy)
        []))))

(defn validate [headers ordered sender]
  (let [type (get headers "type")
        to (get headers "to")
        priority (get headers "priority")
        commit (get headers "commit")
        task-name (get headers "task")
        note-message (get headers "message")
        [recipients recipient-errors] (validate-recipients to)
        field-errors (for [field ordered
                           :let [valid? (case [type field]
                                          ["awake" "type"] true
                                          ["awake" "to"] true
                                          ["awake" "priority"] true
                                          ["git_handoff" "type"] true
                                          ["git_handoff" "to"] true
                                          ["git_handoff" "priority"] true
                                          ["git_handoff" "task"] true
                                          ["git_handoff" "commit"] true
                                          ["git_handoff" "rejection_reason"] true
                                          ["git_handoff" "reroute_reason"] true
                                          ["note" "type"] true
                                          ["note" "to"] true
                                          ["note" "priority"] true
                                          ["note" "message"] true
                                          ["note" "rejection_reason"] true
                                          ["note" "reroute_reason"] true
                                          ["rule_proposal" "type"] true
                                          ["rule_proposal" "to"] true
                                          ["rule_proposal" "priority"] true
                                          ["rule_proposal" "scope"] true
                                          ["rule_proposal" "body"] true
                                          ["rule_proposal" "rationale"] true
                                          false)]
                           :when (and type (not valid?))]
                       (format "Header '%s' is not allowed for type '%s'." field type))
        base-errors (cond-> []
                      (str/blank? type) (conj "Missing required header 'type'.")
                      (str/blank? to) (conj "Missing required header 'to'.")
                      (str/blank? priority) (conj "Missing required header 'priority'.")
                      (and (not (str/blank? type)) (not (allowed-types type)))
                      (conj (format "Header 'type' must be one of awake, git_handoff, note, or rule_proposal; got '%s'." type))
                      (and (not (str/blank? priority)) (not (valid-priority? priority)))
                      (conj (format "Header 'priority' must be two digits from 00 to 99; got '%s'." priority)))
        [canonical commit-error]
        (if (= "git_handoff" type)
          (cond
            (str/blank? commit) [nil "Missing required header 'commit' for git_handoff."]
            (not (re-matches #"[0-9a-fA-F]{10}" commit))
            [nil (format "Header 'commit' must be exactly 10 hexadecimal characters; got '%s'." commit)]
            :else (canonical-commit commit))
          [nil nil])
        dup-chain-block
        (when (and (= "git_handoff" type) (not (str/blank? task-name)))
          (duplicate-chain-guard-lib/blocking-parcel (project-root) task-name sender))
        ;; BL-953 task/commit coherence gate: refuses a git_handoff whose
        ;; commit POSITIVELY contradicts its task's ticket (see
        ;; task_commit_coherence_gate_lib.bb - fail-open is absolute; an
        ;; unreadable subject warns and passes). BL-1094: skip for the
        ;; daemon's dispatch-gap auto-route (HEAD is tip, not ticket work).
        coherence-block
        (when (and (= "git_handoff" type) canonical (not (str/blank? task-name))
                   (task-commit-coherence-gate-lib/check-enabled?
                    {:dispatch-gap-autoroute?
                     (= "1" (System/getenv
                             task-commit-coherence-gate-lib/dispatch-gap-autoroute-env))}))
          (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)
                {:keys [exit out]} (daemon-cycle-guard-lib/sh!
                                    ["git" "-C" (str (project-root))
                                     "log" "-1" "--format=%s" canonical])]
            (if-not (zero? exit)
              (do (binding [*out* *err*]
                    (println (str "TASK_COMMIT_COHERENCE WARNING: "
                                  (task-commit-coherence-gate-lib/warning-line task-ticket-id canonical))))
                  nil)
              (let [ids (task-commit-coherence-gate-lib/commit-ticket-ids (str/trim out))]
                (when (task-commit-coherence-gate-lib/blocked?
                       {:task-ticket-id task-ticket-id :commit-ticket-ids ids})
                  {:task-name task-name :task-ticket-id task-ticket-id
                   :commit canonical :commit-ticket-ids ids})))))
        ;; BL-806 review-forward-evidence gate: refuses a review role's
        ;; forward-direction git_handoff naming exactly the commit it
        ;; received for this task (Article 4.4 backstop; see
        ;; review_forward_evidence_gate_lib.bb).
        ;; BL-1293: and one that contributed nothing of its own - a bare
        ;; merge of the received parcel is a NEW commit, so identity alone
        ;; never saw the most common shape in this swarm.
        review-forward-nothing-own?
        (and (= "git_handoff" type) canonical (not (str/blank? task-name))
             (review-forward-evidence-gate-lib/forward-introduces-nothing-own?
              (project-root) canonical))
        ;; BL-1307: and the fact neither of those two reads - whether this
        ;; forward ADDED the role's own Article 4.4 evidence for THIS task
        ;; over the commit it received. b7d22b9ee3 (the architect's BL-1224
        ;; forward) resolved a real conflict, so it contributes content and
        ;; both older facts pass it, while carrying no review output at all.
        review-forward-received-commit
        (when (and (= "git_handoff" type) canonical (not (str/blank? task-name)))
          (review-forward-evidence-gate-lib/received-commit-for-task
           (project-root) sender task-name))
        review-forward-carries-own-evidence?
        (when (and (= "git_handoff" type) canonical (not (str/blank? task-name)))
          (review-forward-evidence-gate-lib/forward-carries-own-evidence?
           (project-root) review-forward-received-commit canonical task-name))
        review-forward-evidence-block?
        (and (= "git_handoff" type) canonical (not (str/blank? task-name))
             (review-forward-evidence-gate-lib/blocked?
              {:type type
               :sender sender
               :recipients recipients
               :task-name task-name
               :commit canonical
               :reroute-reason (get headers "reroute_reason")
               :introduces-nothing-own? review-forward-nothing-own?
               :carries-own-evidence? review-forward-carries-own-evidence?
               :received-commit review-forward-received-commit}))
        ;; BL-1213 parcel-rollback gate: refuses a git_handoff whose branch
        ;; tip holds pre-parcel content for a path the ticket's accepted
        ;; parcel commit changed, with no revert of it on this branch (see
        ;; parcel_rollback_guard_lib.bb). Same fail-open-on-unreadable-facts
        ;; posture as the coherence gate above.
        parcel-rollback-result
        (when (and (= "git_handoff" type) canonical (not (str/blank? task-name)))
          (parcel-rollback-guard-lib/findings-for-git-handoff
           {:root (project-root) :sender sender :task-name task-name :canonical canonical}))
        _ (when-let [warning (:warning parcel-rollback-result)]
            (binding [*out* *err*]
              (println (str "PARCEL_ROLLBACK WARNING: " warning))))
        parcel-rollback-block
        (when (parcel-rollback-guard-lib/blocked? parcel-rollback-result)
          parcel-rollback-result)
        ;; BL-1205 tree-collapse gate: refuses a git_handoff whose merge
        ;; into ANY named recipient's branch would mass-delete tracked
        ;; files - every hop, no ticket id required (see
        ;; tree_collapse_guard_lib.bb). Same fail-open posture; a warning
        ;; per unreadable recipient branch never blocks on its own.
        tree-collapse-result
        (when (and (= "git_handoff" type) canonical (seq recipients))
          (tree-collapse-guard-lib/findings-for-git-handoff
           {:root (project-root) :recipients recipients :commit canonical}))
        _ (doseq [warning (:warnings tree-collapse-result)]
            (binding [*out* *err*]
              (println (str "TREE_COLLAPSE WARNING: " warning))))
        tree-collapse-block
        (when (tree-collapse-guard-lib/blocked? tree-collapse-result)
          tree-collapse-result)
        ;; BL-1192 task-scope gate: refuses a git_handoff whose cited
        ;; commit's own commits since this task's last handoff carry a path
        ;; positively belonging to a DIFFERENT ticket than the task's own -
        ;; every hop, not only the QA edge BL-531 already covers (see
        ;; task_scope_gate_lib.bb). Same fail-open posture; a warning on an
        ;; unreadable commit history never blocks on its own.
        task-scope-result
        (when (and (= "git_handoff" type) canonical (not (str/blank? task-name)))
          (task-scope-gate-lib/findings-for-git-handoff
           {:root (project-root) :task-name task-name :commit canonical}))
        _ (when-let [warning (:warning task-scope-result)]
            (binding [*out* *err*]
              (println (str "TASK_SCOPE WARNING: " warning))))
        task-scope-block
        (when (task-scope-gate-lib/blocked? task-scope-result)
          task-scope-result)
        ;; BL-1240 unregistered-test gate: refuses a git_handoff whose own
        ;; parcel adds a file under swarmforge/scripts/test/ with no row in
        ;; suite-manifest.tsv, so the omission fails the ticket that created
        ;; it instead of accumulating invisibly until QA runs the full suite
        ;; (see unregistered_test_gate_lib.bb). Parcel-scoped, never
        ;; tree-scoped; same fail-open posture as every gate above.
        unregistered-test-result
        (when (and (= "git_handoff" type) canonical (not (str/blank? task-name)))
          (unregistered-test-gate-lib/findings-for-git-handoff
           {:root (project-root) :task-name task-name :commit canonical}))
        _ (when-let [warning (:warning unregistered-test-result)]
            (binding [*out* *err*]
              (println (str "UNREGISTERED_TEST WARNING: " warning))))
        unregistered-test-block
        (when (unregistered-test-gate-lib/blocked? unregistered-test-result)
          unregistered-test-result)
        git-errors (cond-> []
                     (= "git_handoff" type)
                     (into (cond-> []
                             (str/blank? task-name)
                             (conj "Missing required header 'task' for git_handoff.")
                             (> (count (or task-name "")) 80)
                             (conj (format "Header 'task' must be no longer than 80 characters; got %d." (count task-name)))
                             (and (not (str/blank? task-name))
                                  (ticket-close-guard-lib/git-handoff-blocked-for-task?
                                   (project-root) task-name))
                             (conj (format "Cannot send git_handoff for closed ticket %s (backlog/done/)."
                                           (pipeline-stage-lib/extract-ticket-id task-name)))
                             ;; BL-760 duplicate-chain-errors: refuses a git_handoff when the
                             ;; same ticket already has a live parcel in another role's mailbox
                             ;; (see duplicate_chain_guard_lib.bb).
                             dup-chain-block
                             (conj (duplicate-chain-guard-lib/refusal-message dup-chain-block))
                             coherence-block
                             (conj (task-commit-coherence-gate-lib/refusal-message coherence-block))
                             (and (not (str/blank? task-name)) canonical)
                             (-> (into (pre-qa-gate-errors type to task-name canonical))
                                 (into (pointer-gate-errors type to task-name canonical)))
                             review-forward-evidence-block?
                             (conj (review-forward-evidence-gate-lib/refusal-message
                                    {:sender sender :task-name task-name :commit canonical
                                     :introduces-nothing-own? review-forward-nothing-own?
                                     :carries-own-evidence? review-forward-carries-own-evidence?}))
                             parcel-rollback-block
                             (conj (parcel-rollback-guard-lib/refusal-message
                                    {:task-name task-name :findings (:findings parcel-rollback-block)}))
                             tree-collapse-block
                             (conj (tree-collapse-guard-lib/refusal-message tree-collapse-block))
                             unregistered-test-block
                             (conj (unregistered-test-gate-lib/refusal-message
                                    {:task-name task-name
                                     :findings (:findings unregistered-test-block)}))
                             task-scope-block
                             (conj (task-scope-gate-lib/refusal-message
                                    {:task-name task-name
                                     :findings (:findings task-scope-block)
                                     ;; BL-1276: carry the "could not evaluate
                                     ;; the acceptance exemption" flag into the
                                     ;; message, or the refusal reads as a plain
                                     ;; entanglement and sends the coder off to
                                     ;; rebuild for the wrong reason.
                                     :acceptance-unreadable? (:acceptance-unreadable? task-scope-block)}))))
                     (and (not= "git_handoff" type) (not (str/blank? commit)))
                     (conj "Header 'commit' is only allowed for git_handoff.")
                     (and (not= "git_handoff" type) (not (str/blank? task-name)))
                     (conj "Header 'task' is only allowed for git_handoff.")
                     commit-error
                     (conj commit-error))
        note-errors (cond-> []
                      (= "note" type)
                      (into (cond-> []
                              (str/blank? note-message)
                              (conj "Missing required header 'message' for note.")
                              (> (count (or note-message "")) 80)
                              (conj (format "Header 'message' must be no longer than 80 characters; got %d." (count note-message)))))
                      (and (not= "note" type) (not (str/blank? note-message)))
                      (conj "Header 'message' is only allowed for note."))
        scope (get headers "scope")
        proposal-body (get headers "body")
        rationale (get headers "rationale")
        rule-proposal-errors (cond-> []
                               (= "rule_proposal" type)
                               (into (cond-> []
                                       (str/blank? scope)
                                       (conj "Missing required header 'scope' for rule_proposal.")
                                       (and (not (str/blank? scope)) (not (re-matches valid-scope-pattern scope)))
                                       (conj (format "Header 'scope' must be one of constitution, engineering, project, or role:<rolename>; got '%s'." scope))
                                       (str/blank? proposal-body)
                                       (conj "Missing required header 'body' for rule_proposal.")
                                       (> (count (or proposal-body "")) 200)
                                       (conj (format "Header 'body' must be no longer than 200 characters; got %d." (count proposal-body)))
                                       (str/blank? rationale)
                                       (conj "Missing required header 'rationale' for rule_proposal.")
                                       (> (count (or rationale "")) 200)
                                       (conj (format "Header 'rationale' must be no longer than 200 characters; got %d." (count rationale)))))
                               (and (not= "rule_proposal" type) (not (str/blank? scope)))
                               (conj "Header 'scope' is only allowed for rule_proposal.")
                               (and (not= "rule_proposal" type) (not (str/blank? proposal-body)))
                               (conj "Header 'body' is only allowed for rule_proposal.")
                               (and (not= "rule_proposal" type) (not (str/blank? rationale)))
                               (conj "Header 'rationale' is only allowed for rule_proposal."))]
    {:recipients recipients
     :canonical-commit canonical
     :errors (vec (concat base-errors recipient-errors field-errors git-errors note-errors rule-proposal-errors))}))

(defn next-sequence []
  (let [dir (state-dir)
        seq-file (fs/path dir "sequence")
        lock-dir (fs/path dir "sequence.lock")]
    (fs/create-dirs dir)
    (loop []
      (if (try
            (fs/create-dir lock-dir)
            true
            (catch java.nio.file.FileAlreadyExistsException _
              false))
        nil
        (do
          (Thread/sleep 50)
          (recur))))
    (try
      (let [last-value (if (fs/exists? seq-file)
                         (try
                           (Long/parseLong (str/trim (slurp (str seq-file))))
                           (catch Exception _ 0))
                         0)
            next-value (inc last-value)
            formatted (format "%06d" next-value)]
        (spit (str seq-file) (str formatted "\n"))
        formatted)
      (finally
        (fs/delete lock-dir)))))

;; ── BL-606: specifier-declared required_stages routing ──────────────────
;; Wired at this ONE seam - the send path, for type: git_handoff only - per
;; the ticket's own "WIRING POINT" decision. Every guard below degrades to
;; leaving `recipients` byte-identical to the literal `to:` header: the
;; kill-switch off, a non-git_handoff type, more than one recipient, no
;; resolvable ticket id, no readable active ticket yaml, or an absent/
;; invalid/empty required_stages declaration (default-full) all fall through
;; to today's behavior with zero rewrite - DEFAULT-FULL and NO OUT-OF-BAND
;; STAGE INJECTION (BL-606 guardrails #1/#4) are both satisfied by having
;; every non-declared/non-actionable case return the identity recipients.

(defn- required-stages-routing-enabled? [conf-text]
  (or (= "1" (System/getenv "SWARMFORGE_REQUIRED_STAGES_ROUTING"))
      (= "true" (coordinator-config-lib/parse-config-value
                 conf-text "required_stages_routing_enabled" "false"))))

;; ── BL-1276: the landed-declaration reader moved to landed_ticket_lib.bb ──
;; It has a SECOND caller now - task_scope_gate_lib.bb needs the identical
;; answer for the acceptance-contract exemption, and the send-time gate and
;; BL-1257's review-time CLI must never disagree about it. Delegated rather
;; than duplicated; BL-992's ref-freshness reasoning lives in that file now.
(def ^:private yaml-id-field landed-ticket-lib/yaml-id-field)
(def ^:private active-ticket-yaml-content landed-ticket-lib/active-ticket-yaml-content)

(defn route-required-stages
  "{:recipients [...] :routing-skipped nil-or-map}. recipients is the
   already-validated literal `to:` list; routing-skipped, when present,
   is the runtime-trail record for whichever stage(s) got skipped this hop -
   {:ticket-id :from :to :skipped :reasons}.

   A `rejection_reason` (reviewer bounce) or `reroute_reason` (operator
   redo_from/reroute detour) on the draft names a deliberately-chosen,
   out-of-forward-order destination - routing only ever short-circuits the
   forward chain, never a backward rejection or an explicit detour, so
   either header present returns the literal recipients untouched. Kept
   because it is correct and cheap for the operator salvage paths
   (reroute.bb/redo_from.bb) that DO stamp one of these headers (architect
   BL-606 bounce defect 2).

   No reviewer bounce carries either header, though - every review role
   bounces by hand-writing a draft with a plain `to:`, so that guard alone
   is inert on the common bounce path. `sender` (also required, threaded
   from -main's own sender-role) closes that gap: routing is only ever a
   CANDIDATE when required-stages-lib/routes-forward? holds, i.e. `to`
   names a canonical stage strictly after the sender's own position. A
   bounce always targets an earlier stage relative to its sender, so it
   falls through to the literal recipients untouched without depending on
   anything the sender remembered to write (architect BL-606 bounce defect
   3)."
  [{:keys [type task recipients root headers sender]}]
  (let [identity-result {:recipients recipients :routing-skipped nil}]
    (if-not (and (= "git_handoff" type)
                 (= 1 (count recipients))
                 (nil? (get headers "rejection_reason"))
                 (nil? (get headers "reroute_reason"))
                 (required-stages-lib/routes-forward? sender (first recipients)))
      identity-result
      (let [conf-text (try (slurp (str (backlog-depth-lib/conf-file-path root))) (catch Exception _ nil))]
        (if-not (required-stages-routing-enabled? conf-text)
          identity-result
          (let [ticket-id (pipeline-stage-lib/extract-ticket-id task)
                content (active-ticket-yaml-content root ticket-id)]
            (if (nil? ticket-id)
              identity-result
              ;; BL-951: content may be nil (no active ticket copy in the
              ;; SENDER'S worktree - the BL-317/BL-325 staleness window, the
              ;; ticket's own third data point) - the skip RECORD no longer
              ;; needs it: it derives from the hop itself
              ;; (hop-skipped-stages sender delivered), so recording runs
              ;; for every forward hop whatever the declaration state.
              ;; Only the REWRITE decision still needs a usable declaration.
              (let [decision (when content
                               (required-stages-lib/resolve-effective
                                 (required-stages-lib/read-required-stages content)))
                    reasons-read (when content
                                   (required-stages-lib/read-stage-skip-reasons content))
                    reasons (or (:reasons reasons-read) {})
                    skip-reasons-malformed (:malformed reasons-read)
                    ;; BL-951: resolve-effective's own docstring requires a
                    ;; present-but-invalid declaration to be surfaced loudly
                    ;; by the caller, never folded into "no declaration at
                    ;; all" - carried onto the record, previously never read.
                    rejection-reason (when (:rejected? decision) (:rejection-reason decision))
                    ;; BL-623: record derives from what the hop actually skipped
                    ;; (sender → delivered), not only from whether the router rewrote.
                    emit-skip (fn [delivered rewritten-away]
                                (let [between (required-stages-lib/hop-skipped-stages sender delivered)
                                      skipped (vec (distinct
                                                     (concat (when rewritten-away [rewritten-away])
                                                             between)))]
                                  (when (seq skipped)
                                    (cond-> {:ticket-id ticket-id
                                             :from sender
                                             :to delivered
                                             :skipped skipped
                                             :reasons reasons}
                                      rejection-reason (assoc :rejection-reason rejection-reason)
                                      ;; BL-754: present-but-malformed skip reasons
                                      skip-reasons-malformed
                                      (assoc :skip-reasons-malformed skip-reasons-malformed)))))
                    literal-to (first recipients)]
                ;; BL-951: :default-full (absent, unparseable, or invalid
                ;; declaration - and nil content) previously RETURNED here,
                ;; before any recording, so the conservative default was the
                ;; one case with no audit trail - a coder->QA hop that
                ;; jumped four stages left no envelope header and no log
                ;; line (BL-631's own bounce-fix hop, measured). Recording
                ;; now runs for every forward hop; only the rewrite is
                ;; gated on a usable declaration.
                (if (or (nil? decision) (= :default-full (:source decision)))
                  (let [skip (emit-skip literal-to nil)]
                    (if skip
                      {:recipients recipients :routing-skipped skip}
                      identity-result))
                  (let [effective (:effective decision)
                        ;; BL-991: the declaration BINDS. The first declared
                        ;; stage strictly after the sender is the furthest
                        ;; this hop may travel, whatever it was addressed to.
                        ;; Computed from the SENDER alone, so it is the same
                        ;; answer on both branches below - the membership
                        ;; branch treated membership as permission (a coder
                        ;; addressing QA on a full chain went straight to QA),
                        ;; and the non-member branch rewrote forward of the
                        ;; ADDRESSED stage (with [coder cleaner qa], a coder
                        ;; addressing architect went to QA, jumping the
                        ;; declared cleaner). One guard ahead of both.
                        next-after-sender (required-stages-lib/next-required-stage effective sender)]
                    (if (and next-after-sender
                             (required-stages-lib/routes-forward? next-after-sender literal-to))
                      ;; A binding rewrite is NOT a skip of the stage it
                      ;; defers: QA is precisely what will still run, so the
                      ;; deferred target never goes in the skip record
                      ;; (invariant 2). Any stage genuinely passed over -
                      ;; one the declaration prunes, between the sender and
                      ;; the stage delivered to - is still recorded, by the
                      ;; same hop-derived rule as every other forward hop.
                      (let [skip (emit-skip next-after-sender nil)]
                        (if skip
                          {:recipients [next-after-sender] :routing-skipped skip}
                          {:recipients [next-after-sender] :routing-skipped nil}))
                    (if (contains? effective literal-to)
                      (let [skip (emit-skip literal-to nil)]
                        (if skip
                          {:recipients recipients :routing-skipped skip}
                          identity-result))
                      (let [next-stage (required-stages-lib/next-required-stage effective literal-to)]
                        (if (nil? next-stage)
                          identity-result
                          {:recipients [next-stage]
                           :routing-skipped (or (emit-skip next-stage literal-to)
                                                ;; rewrite with empty between still names the
                                                ;; rewritten-away literal (existing BL-606 contract)
                                                (cond-> {:ticket-id ticket-id
                                                         :from sender
                                                         :to next-stage
                                                         :skipped [literal-to]
                                                         :reasons reasons}
                                                  skip-reasons-malformed
                                                  (assoc :skip-reasons-malformed
                                                         skip-reasons-malformed)))}))))))))))))))
(defn- format-routing-skipped [{:keys [ticket-id from to skipped reasons rejection-reason
                                       skip-reasons-malformed]}]
  (str ticket-id " " from "->" to
       " skipped=" (str/join "," skipped)
       (when (seq reasons)
         (str " reasons=" (str/join ";" (map (fn [[k v]] (str k ":" v)) reasons))))
       ;; BL-754: observational — names the unparseable remainder, never blocks.
       (when skip-reasons-malformed
         (str " skip_reasons_malformed=\"" skip-reasons-malformed "\""))
       ;; BL-951: a present-but-invalid declaration's rejection travels on
       ;; the record (required_stages_lib's own loud-surfacing contract).
       (when rejection-reason
         (str " rejected=\"" rejection-reason "\""))))

(defn- report-nonfatal!
  "Observational failure posture: stderr line + :failed sentinel. Used by
   try-sync-deliver! and log-routing-skip! so neither can abort -main's let."
  [label e]
  (binding [*out* *err*]
    (println label (.getMessage e)))
  :failed)

(defn- log-routing-skip! [root entry]
  ;; BL-748: recording is observational. Same catch/report/keep-going posture
  ;; as try-sync-deliver! so a journal I/O failure never skips sync inject or
  ;; draft cleanup in -main's ordered let.
  (try
    (let [path (fs/path root ".swarmforge" "routing-skips.jsonl")]
      (fs/create-dirs (fs/parent path))
      (spit (str path) (str (json/generate-string entry) "\n") :append true)
      :ok)
    (catch Exception e
      (report-nonfatal! "ROUTING-SKIP RECORD FAILED:" e))))

(defn roles-table-lines
  "roles.tsv lines for this project, or [] when the table is absent."
  []
  (let [tsv (roles-file)]
    (if (fs/exists? tsv)
      (str/split-lines (slurp (str tsv)))
      [])))

(defn role-propagation [role-name]
  (if role-name
    (reverse-hop-lib/propagation-for (roles-table-lines) role-name)
    "forward-only"))

;; BL-1299: both of these read the pipeline order through
;; reverse_hop_lib.bb, which drops the coordinator AND every MASTER-RESIDENT
;; row. A role whose roles-table worktree is the master checkout - the
;; specifier as well as the coordinator - holds no code worktree of its own,
;; so a merge-only reverse copy addressed to it would land unapproved
;; in-flight work on the published branch. Residency is read from the table,
;; never from a second hardcoded role name.
(defn last-pack-role? [role]
  (= role (reverse-hop-lib/last-pipeline-role (roles-table-lines))))

(defn reverse-roles [sender]
  (reverse-hop-lib/reverse-recipients (roles-table-lines) sender (role-propagation sender)))

(defn with-non-forwarding [headers sender]
  (if (and (= "git_handoff" (get headers "type"))
           (last-pack-role? sender))
    (assoc headers "non-forwarding" "true")
    headers))

(defn inbound-non-forwarding? []
  (boolean
    ;; BL-1302 + BL-1313: batch-aware reader.
    (some handoff-lib/non-forwarding?
          (handoff-lib/my-handoff-files-with-batches (handoff-lib/my-mailbox-dir :in_process)))))

(defn sha256 [text]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256")
                        (.getBytes (str text) "UTF-8"))]
    (apply str (map #(format "%02x" (bit-and (int %) 0xff)) digest))))

(defn audit-pending-dir []
  (fs/path (project-root) ".swarmforge" "handoffs" "audit_pending"))

(defn sender-audit-dir [sender]
  (fs/path (audit-pending-dir) (sha256 sender)))

(defn audit-task-id [headers]
  (get headers "task"))

(defn audit-file [sender task-id]
  (fs/path (sender-audit-dir sender)
           (str (sha256 task-id) ".edn")))

(defn sender-audit-files [sender]
  (let [dir (sender-audit-dir sender)]
    (if (fs/directory? dir)
      (->> (fs/glob dir "*.edn")
           (filter fs/regular-file?)
           vec)
      [])))

(defn read-audit [path]
  (when (fs/regular-file? path)
    (try
      (edn/read-string (slurp (str path)))
      (catch Exception _ nil))))

(defn write-audit! [path candidate]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/create-temp-file {:dir (fs/parent path) :prefix ".audit."})]
    (spit (str tmp) (str (pr-str {:candidate candidate
                                  :created-at (timestamp)}) "\n"))
    (fs/move tmp path {:replace-existing true})))

(defn with-audit-lock [f]
  (let [dir (audit-pending-dir)
        path (fs/path dir ".lock")
        options (into-array OpenOption [StandardOpenOption/CREATE
                                        StandardOpenOption/WRITE])]
    (fs/create-dirs dir)
    (with-open [channel (FileChannel/open (fs/path path) options)]
      (.lock channel)
      (f))))

(defn sender-audit-dir-empty? [dir]
  (and (fs/directory? dir)
       (empty? (filter fs/regular-file? (fs/list-dir dir)))))

(defn remove-empty-sender-audit-dir! [sender]
  (let [dir (sender-audit-dir sender)]
    (when (sender-audit-dir-empty? dir)
      (fs/delete-if-exists dir))))

(defn delete-sender-audits! [sender]
  (doseq [path (sender-audit-files sender)]
    (fs/delete-if-exists path))
  (remove-empty-sender-audit-dir! sender))

(declare audit-candidate)

(defn invocation-fingerprint
  "The key the standing challenge is looked up under. BL-1306: it is DERIVED
   from audit-candidate, the shape the challenge was stored under, so the two
   can never again disagree about how a field is computed.

   They used to. This read :recipients from the raw `to:` header and :commit
   from the raw `commit:` header, while audit-candidate stored the POST-routing
   recipients and the canonical commit. Whenever BL-606's required_stages
   routing rewrote the recipient the two differed, invalidate-changed-
   invocation-audits! deleted the standing challenge at the top of every
   invocation, and the sender got AUDIT_REQUIRED forever - no number of
   correct, byte-identical retries could queue the parcel. Article 2.3's own
   instruction became a loop, and an idle re-invocation loop is what the
   daemon halts the whole swarm for.

   Callers must therefore pass the same post-routing values submit! will use.
   :version is dropped because the lookup compares only the keys it carries,
   and a stored candidate's :version is not part of what identifies an
   invocation."
  [draft sender headers recipients canonical-commit]
  (dissoc (audit-candidate draft sender headers recipients canonical-commit)
          :version))

(defn invalidate-changed-invocation-audits! [sender invocation]
  (with-audit-lock
    (fn []
      (doseq [path (sender-audit-files sender)
              :let [candidate (:candidate (read-audit path))]
              :when (not= invocation (select-keys candidate (keys invocation)))]
        (fs/delete-if-exists path))
      (remove-empty-sender-audit-dir! sender))))

(defn audit-candidate [draft sender headers recipients canonical-commit]
  {:version 1
   :sender sender
   :task-id (audit-task-id headers)
   :type (get headers "type")
   :recipients (vec recipients)
   :priority (get headers "priority")
   :task (get headers "task")
   :commit canonical-commit
   :non-forwarding (= "true" (get headers "non-forwarding"))
   :draft-fingerprint (sha256 (slurp (str draft)))})

(defn print-audit-required! [candidate]
  (binding [*out* *err*]
    (println "AUDIT_REQUIRED")
    (println "HANDOFF_NOT_QUEUED")
    (println "TASK_ID:" (:task-id candidate))
    (println "COMMIT:" (:commit candidate))
    (println)
    (println "Re-read the complete inbound task payload and every source it references.")
    (println "Compare the completed work product against every requirement and constraint,")
    (println "including interactions, boundaries, failure cases, and negative requirements.")
    (println "Establish requirement-to-evidence traceability appropriate to your role:")
    (println "every requirement must be covered by the work, supported by relevant verification,")
    (println "or identified as a gap.")
    (println "Review the complete committed diff, tests and checks, generated artifacts,")
    (println "and unrelated working-tree changes. Passing tools or clean formatting alone do")
    (println "not establish that the task is complete.")
    (println "Fix every finding, commit the corrections, rerun applicable checks, and repeat")
    (println "this audit against the revised candidate before running the handoff command again.")))

(defn submit-after-audit! [candidate submit!]
  (with-audit-lock
    (fn []
      (let [path (audit-file (:sender candidate) (:task-id candidate))
            previous (:candidate (read-audit path))]
        (if (= candidate previous)
          (let [result (submit!)]
            (delete-sender-audits! (:sender candidate))
            result)
          (do
            (delete-sender-audits! (:sender candidate))
            (write-audit! path candidate)
            (print-audit-required! candidate)
            nil))))))

(defn structure-instruction [handback?]
  (if handback?
    "The inbound tree is the structure. Replay this role's current task onto that shape."
    "This role's current tree is the structure. Replay the inbound work onto that shape."))

(defn body [type sender canonical-commit note-message scope proposal-body rationale recipients
            & {:keys [handback?] :or {handback? false}}]
  (let [lead (handoff-lib/handoff-body-lead recipients)]
    (case type
      "awake" "awake"
      "git_handoff" (str lead "merge_and_process " sender " " canonical-commit
                         "\n\n" (structure-instruction handback?))
      "note" (str lead note-message)
      "rule_proposal" (str lead
                           "Rule proposal (" scope ") from " sender ": " proposal-body
                           "\nRationale: " rationale))))

(defn write-handoff! [{:keys [headers recipients canonical-commit sender routing-skipped
                              priority non-forwarding reverse?]}]
  (let [timestamp-id (id-timestamp)
        created-at (timestamp)
        sequence (next-sequence)
        id (str timestamp-id "_" sequence "_from_" sender)
        recipient-slug (str/join "_" recipients)
        priority (or priority (get headers "priority"))
        type (get headers "type")
        non-forwarding? (if (some? non-forwarding)
                          non-forwarding
                          (= "true" (get headers "non-forwarding")))
        filename (str priority "_" timestamp-id "_" sequence "_from_" sender "_to_" recipient-slug ".handoff")
        outbox-dir (fs/path (state-dir) "outbox")
        outbox-file (fs/path outbox-dir filename)
        handoff-body (body type sender canonical-commit (get headers "message")
                           (get headers "scope") (get headers "body") (get headers "rationale")
                           recipients
                           :handback? (or reverse? non-forwarding?))
        lines (cond-> [(str "id: " id)
                       (str "from: " sender)
                       (str "to: " (str/join "," recipients))
                       (str "priority: " priority)
                       (str "type: " type)]
                (= "git_handoff" type)
                (conj (str "role: " sender)
                      (str "task: " (get headers "task"))
                      (str "commit: " canonical-commit))
                (= "note" type)
                (conj (str "message: " (get headers "message")))
                (= "rule_proposal" type)
                (conj (str "scope: " (get headers "scope"))
                      (str "body: " (get headers "body"))
                      (str "rationale: " (get headers "rationale")))
                (get headers "rejection_reason")
                (conj (str "rejection_reason: " (get headers "rejection_reason")))
                (get headers "reroute_reason")
                (conj (str "reroute_reason: " (get headers "reroute_reason")))
                routing-skipped
                (conj (str "routing_skipped: " (format-routing-skipped routing-skipped)))
                non-forwarding?
                (conj "non-forwarding: true")
                true
                (conj (str "created_at: " created-at)
                      ""
                      handoff-body))]
    (doseq [dir [outbox-dir (fs/path (state-dir) "sent") (fs/path (state-dir) "failed")]]
      (fs/create-dirs dir))
    ;; BL-365: durable install (write -> fsync -> rename) PLUS the sender's
    ;; own integrity floor (delete-and-reject if what actually landed on
    ;; disk is corrupt) - never a bare spit + fs/move. See
    ;; handoff-lib/atomic-write!'s and install-handoff!'s own docstrings.
    (when-not (handoff-lib/install-handoff! outbox-file (str (str/join "\n" lines) "\n"))
      (exit! 1 "HANDOFF WRITE FAILED: the installed file was corrupt (empty or missing required envelope headers); no handoff was queued."))
    (check-backlog-depth) ; Add backlog depth check after writing handoff
    outbox-file))

(defn write-handoffs! [ctx]
  (let [headers (with-non-forwarding (:headers ctx) (:sender ctx))
        ctx (assoc ctx :headers headers)
        forward (write-handoff! (assoc ctx :reverse? false
                                       :non-forwarding (= "true" (get headers "non-forwarding"))))
        reverse (when (= "git_handoff" (get headers "type"))
                  (mapv (fn [role]
                          (write-handoff! (assoc ctx
                                                 :recipients [role]
                                                 :priority "00"
                                                 :non-forwarding true
                                                 :reverse? true
                                                 :routing-skipped nil)))
                        (reverse-roles (:sender ctx))))]
    (into [forward] reverse)))

(defn error-report [draft errors]
  (binding [*out* *err*]
    (println "HANDOFF INVALID:" (str draft))
    (println)
    (println "Errors:")
    (doseq [error errors]
      (println "-" error))
    (println)
    (println usage-text)))

(defn skip-daemon? []
  (= "1" (System/getenv "SWARMFORGE_SKIP_DAEMON")))

(defn mailbox-only? []
  (= "1" (System/getenv "SWARMFORGE_MAILBOX_ONLY")))

(defn skip-sync-inject? []
  (or (mailbox-only?)
      (= "1" (System/getenv "SWARMFORGE_SKIP_SYNC_INJECT"))))

(defn deliver-sync! [outbox-file sender]
  (let [root (project-root)]
    (handoff-inject-lib/deliver-parcel! root outbox-file sender
                                        :log-fn (fn [& parts]
                                                  (binding [*out* *err*]
                                                    (apply println "HANDOFF DELIVER:" parts))))))

(defn try-sync-deliver! [outbox-file sender]
  (try
    (let [result (deliver-sync! outbox-file sender)]
      (if (= result :held) :held :delivered))
    (catch Exception e
      (report-nonfatal! "HANDOFF SYNC INJECT FAILED:" e))))

(defn deliver-all! [outbox-files sender]
  (mapv #(try-sync-deliver! % sender) outbox-files))

(defn -main [& args]
  (when (not= 1 (count args))
    (usage)
    (System/exit 1))
  (let [draft (fs/path (first args))]
    (when-not (fs/regular-file? draft)
      (exit! 1 (str "Draft file not found: " draft)))
    (let [sender (sender-role)]
      (when-not (role-known? sender)
        (exit! 1 (str "Unknown sender role: " sender)))
      (let [{:keys [headers ordered errors]} (parse-draft draft)
            headers (with-non-forwarding headers sender)
            validation (validate headers ordered sender)
            all-errors (vec (concat errors (:errors validation)))]
        (when (seq all-errors)
          (error-report draft all-errors)
          (System/exit 2))
        (when (and (= "git_handoff" (get headers "type"))
                   (inbound-non-forwarding?))
          (exit! 1 "Current inbound handoff is non-forwarding; do not send a git_handoff. Merge, then done_with_current."))
        (let [routed (route-required-stages {:type (get headers "type")
                                             :task (get headers "task")
                                             :recipients (:recipients validation)
                                             :root (project-root)
                                             :headers headers
                                             :sender sender})
              submit! (fn []
                        (let [files (write-handoffs! {:headers headers
                                                      :recipients (:recipients routed)
                                                      :canonical-commit (:canonical-commit validation)
                                                      :sender sender
                                                      :routing-skipped (:routing-skipped routed)})]
                          (when-let [skip (:routing-skipped routed)]
                            (log-routing-skip! (project-root)
                                               (assoc skip :sender sender :created_at (timestamp))))
                          files))
              ;; BL-1306: invalidate AFTER routing, on the same post-routing
              ;; values the challenge is stored under. Doing it before routing
              ;; compared the drafted recipient against the routed one and
              ;; deleted every standing challenge a reroute had produced.
              _ (invalidate-changed-invocation-audits!
                 sender (invocation-fingerprint draft sender headers
                                                (:recipients routed)
                                                (:canonical-commit validation)))
              outbox-files (if (= "git_handoff" (get headers "type"))
                             (submit-after-audit!
                              (audit-candidate draft sender headers
                                               (:recipients routed)
                                               (:canonical-commit validation))
                              submit!)
                             (submit!))]
          (when outbox-files
            (let [sync-results (if (skip-sync-inject?)
                                 (vec (repeat (count outbox-files) :skipped))
                                 (deliver-all! outbox-files sender))]
              (fs/delete draft)
              (doseq [[outbox-file sync-result] (map vector outbox-files sync-results)]
                (cond
                  (= sync-result :delivered)
                  (println (str "HANDOFF DELIVERED:" (str outbox-file)))

                  (= sync-result :held)
                  (println (str "HANDOFF HELD (ambulance):" (str outbox-file)))

                  (= sync-result :skipped)
                  (if (skip-daemon?)
                    (exit! 1 (str "Handoff queued for mailbox delivery but handoffd is disabled "
                                  "(SWARMFORGE_SKIP_DAEMON=1). Unset SKIP_DAEMON for mailbox-only mode. File: "
                                  outbox-file))
                    (println (str "HANDOFF QUEUED (mailbox only, no tmux inject):" (str outbox-file))))

                  (skip-daemon?)
                  (exit! 1 (str "Handoff queued but sync tmux injection failed; daemon disabled. "
                                "See inject-traffic.log. File: " outbox-file))

                  :else
                  (println (str "HANDOFF QUEUED (daemon backup will deliver):" (str outbox-file))))))))))))

(apply -main *command-line-args*)
