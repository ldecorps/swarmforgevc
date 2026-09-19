;; forward_evidence_lib.bb — BL-1609 pure decision core + shared reader.
;;
;; done_with_current_task.bb executes its -main as a side effect of being
;; loaded (like every done_with_current*/ready_for_next* entry script in
;; this family), so nothing may load-file it from a test or property runner
;; without also running its real mailbox logic. The one decision that needs
;; proving here is pulled out into this small, side-effect-free sibling
;; instead - the same "keep the lib pure, orchestration impure" split BL-654
;; established for provider_auth_observe_lib.bb and BL-1422 established for
;; work_note_evidence_lib.bb.
;;
;; sent-handoff-names-ticket-since? moves here from done_with_current_task.bb
;; (BL-1422's own copy) so both the Work-note gate and this ticket's forward
;; gate share the one reader instead of growing two independent copies of
;; the same outbox/sent scan.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "forward_evidence_lib.bb")))
;; and referred to as forward-evidence-lib/foo.

(ns forward-evidence-lib
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))

(defn- instant-after? [ts-str since-str]
  (try
    (.isAfter (java.time.Instant/parse ts-str) (java.time.Instant/parse since-str))
    (catch Exception _ false)))

(defn sent-dirs-for-seat
  "BL-1637: the directories a seat's completion gate scans for its own
   sent forwards - its own :sent and :outbox, plus, only when this role is
   a seat whose STAGE has its own resolvable roles.tsv row distinct from
   the seat itself (BL-983's design guarantee for every '@'-seat), the
   STAGE's :sent and :outbox too - the daemon may file a delivered forward
   there (its sent copy is filed by the parcel's `from:` header, which a
   seat stamps with its stage, not by the seat that sent it). A bare seat
   (no '@' row, or the stage row does not resolve - fixtures without
   roles.tsv, legacy packs) scans exactly its own two, byte-identical to
   pre-BL-1637 behavior."
  []
  (let [me (handoff-lib/current-role)
        stage (handoff-lib/seat-stage me)
        stage-ri (and stage (not= stage me) (handoff-lib/load-role-info stage))]
    (cond-> [(handoff-lib/my-mailbox-dir :sent) (handoff-lib/my-mailbox-dir :outbox)]
      stage-ri (conj (handoff-lib/mailbox-dir stage-ri :sent) (handoff-lib/mailbox-dir stage-ri :outbox)))))

(defn- seat-owned-file?
  "BL-1637: a file found in the STAGE's own dirs (never the seat's own -
   those are unambiguously the seat's) counts as this seat's forward only
   when its from_seat header, if present, names this seat. A file with no
   from_seat header at all (every file predating this fix) counts - the
   transition to the fix is green, never a false refusal for existing
   history."
  [me f]
  (let [seat-header (handoff-lib/header-field f "from_seat")]
    (or (nil? seat-header) (= seat-header me))))

(defn sent-handoff-names-ticket-since?
  "A git_handoff in this seat's own outbox/sent mailbox, or (BL-1637) its
   stage's, created after since-iso, whose task header's ticket id is
   exactly ticket-id - filtered to this seat's own forwards when the file
   lives in the stage's shared dirs (seat-owned-file? above). BOTH
   directions (outbox and sent) per the ticket's own direction:
   handoffd.bb's deliver! only moves an outbox file into sent/ AFTER the
   daemon has actually picked it up and delivered it (move-with-collision
   path (sent-dir ...)) - a git_handoff this role just sent via
   swarm_handoff.sh can sit in outbox/ for a real window before that sweep
   runs. Reading sent/ alone would false-refuse a role that sent its
   parcel and completed within that window."
  [ticket-id since-iso]
  (let [me (handoff-lib/current-role)
        own-dirs #{(handoff-lib/my-mailbox-dir :sent) (handoff-lib/my-mailbox-dir :outbox)}
        stage-dirs (remove own-dirs (sent-dirs-for-seat))
        matches? (fn [f]
                   (and (= ticket-id (pipeline-stage-lib/extract-ticket-id (handoff-lib/header-field f "task")))
                        (instant-after? (or (handoff-lib/header-field f "created_at") "") since-iso)))]
    (boolean
     (or (some matches? (mapcat handoff-lib/handoff-files own-dirs))
         (some matches? (filter (partial seat-owned-file? me)
                                 (mapcat handoff-lib/handoff-files stage-dirs)))))))

(defn inbound-window-start
  "BL-1645: the evidence window's lower bound for completing an inbound -
   its OWN created_at, else enqueued_at, else dequeued_at, else the epoch.
   A dispatch note IS the request; a commit or handoff naming its ticket
   produced any time after the dispatch existed is a response to it - the
   dequeue stamp (BL-1422's original choice) can legitimately postdate
   real work in a multi-item-queue-then-dequeue shape (BL-1614/BL-1637's
   incidents), and a re-dispatch after a bounce is itself created AFTER
   the first pass's own work, so created_at guards against riding stale
   evidence exactly as well as dequeued_at did. Shared by all three gate
   call sites (task Work-note gate, task forward gate, batch forward
   gate) so they cannot drift."
  [source-file]
  (or (handoff-lib/header-field source-file "created_at")
      (handoff-lib/header-field source-file "enqueued_at")
      (handoff-lib/header-field source-file "dequeued_at")
      "1970-01-01T00:00:00Z"))

(defn forwarding-inbound?
  "A git_handoff (never a note) that does not carry non-forwarding: true
   (Article 2.4's merge-only marker). Shared by the task and batch
   completion paths so both read the same header fields the same way."
  [source-file]
  (and (= "git_handoff" (handoff-lib/header-field source-file "type"))
       (not (handoff-lib/non-forwarding? source-file))))

(defn master-resident?
  "This role's own roles.tsv row has worktree-name \"master\"
   (handoff-lib/load-role-info) - never a hardcoded role-name list."
  []
  (= "master" (:worktree-name (handoff-lib/load-role-info (handoff-lib/current-role)))))

(defn forward-completion-decision
  "BL-1609's one decision table given what the caller has already
   determined:
     forwarding?      - the in_process item is a git_handoff (never a note -
                         those are BL-1422's gate, never this one) that does
                         not carry non-forwarding: true (Article 2.4's
                         merge-only marker - a handback completes exactly as
                         today, never gated here).
     master-resident? - this role's own roles.tsv row has worktree-name
                         \"master\" (handoff-lib/load-role-info) - the
                         specifier/coordinator's tracer-bullet git_handoffs
                         are answered with a note, never forwarded, so
                         gating them on a forward that will never exist
                         would refuse them forever.
     evidenced?       - a git_handoff naming the SAME ticket was created,
                         since the inbound's own dequeue, in this role's
                         outbox or sent mailbox (sent-handoff-names-ticket-
                         since? above).
     reason           - the --no-op reason argv already vetted non-blank,
                         or nil for a plain invocation.
   Returns :complete-plain | :complete-with-reason | :refuse.

   A nil/false forwarding? or a master-resident role always completes
   plainly regardless of evidenced?/reason - the gate never engages for
   them, which is exactly \"completes exactly as today.\" Otherwise: a
   stated reason always completes-with-reason (recorded, never silent);
   evidence with no reason completes plainly (no reason to record);
   neither refuses."
  [{:keys [forwarding? master-resident? evidenced? reason]}]
  (cond
    (not forwarding?) :complete-plain
    master-resident? :complete-plain
    (some? reason) :complete-with-reason
    evidenced? :complete-plain
    :else :refuse))
