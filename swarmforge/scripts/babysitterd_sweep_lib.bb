;; babysitterd_sweep_lib.bb — pure finding-assembly core for babysitterd (BL-611).
;;
;; Ports the deterministic health-sweep prototype
;; (.swarmforge/operator/babysitter_check.sh, untracked) into a pure,
;; unit-tested core: given a snapshot struct (tmux sessions/panes, process
;; liveness, file listings/ages, pane captures, meminfo, pause state) it
;; returns the findings list and the swarm-starved streak to persist. No
;; tmux, no fs, no clock read happens in this file — the gathering layer
;; (babysitter_check.bb) is a thin I/O wrapper that builds the snapshot and
;; persists the returned streak/dedup state.
;;
;; Every finding is {:key :severity ("CRIT"|"WARN") :message}.

(ns babysitterd-sweep-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; BL-996: classify-pane-busy? (below) now delegates to chase_sweep_lib.bb's
;; actively-processing? - the BL-970 chokepoint every wake predicate already
;; funnels through - instead of its own private whole-pane substring match.
;; Loading a sibling lib is a build-time module load, not the kind of live
;; fs/tmux/clock read this file's own header disclaims for its business
;; logic (chase_sweep_lib.bb is itself a pure classifier, same posture).
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "chase_sweep_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "master_main_reconcile_lib.bb")))

(defn format-all-clear-line
  "BL-779: human-facing sweep verdict when findings are empty. Names a live
   control pause instead of a bare idle-correct green line."
  [{:keys [pause-active? pause-until-ms]}]
  (if pause-active?
    (str "OK all checks green — " (backlog-depth-lib/format-control-pause-active-text pause-until-ms))
    "OK all checks green"))

;; ── check 1: live-session-per-role ──────────────────────────────────────────

;; BL-1017: how often a single role may be handed a session-recreate before
;; the sweep gives up and just keeps alerting. Deliberately small — a session
;; that will not come back is a human's problem, and a daemon that keeps
;; retrying it forever is a respawn storm, not a repair.
(def default-repair-cooldown-ms (* 10 60 1000))
(def default-max-repair-attempts 1)

(defn session-repair-allowed?
  "BL-1017 invariant 2 — repair is BOUNDED. Within `cooldown-ms` of the last
   attempt a role gets at most `max-attempts` repairs; once that window has
   elapsed the budget resets, so a role that vanishes again hours later is
   still repaired. With no prior attempt recorded (the common case, and every
   pre-BL-1017 caller) repair is allowed."
  [{:keys [now-ms last-repair-ms repair-attempts repair-cooldown-ms max-repair-attempts]
    :or {repair-attempts 0
         repair-cooldown-ms default-repair-cooldown-ms
         max-repair-attempts default-max-repair-attempts}}]
  (let [in-window? (boolean (and now-ms last-repair-ms
                                 (< (- now-ms last-repair-ms) repair-cooldown-ms)))]
    (or (not in-window?)
        (< repair-attempts max-repair-attempts))))

;; BL-1017: the other half of the bound — how an issued repair is RECORDED.
;; Pure (state in, state out) and kept here beside session-repair-allowed?
;; deliberately: the two must agree on what "inside the window" means, and a
;; bound whose accounting lived in the I/O gatherer could drift from the
;; predicate that reads it while both still looked correct in isolation. The
;; gatherer only persists what this returns.
;;
;; The attempt is recorded whether or not tmux succeeded. A repair that FAILED
;; is exactly the case the bound exists for — counting only successes would
;; let an unrecreatable session be retried every sweep forever, which is the
;; respawn storm invariant 2 forbids.
;;
;; Keys are plain strings, matching what the gatherer round-trips through JSON
;; (see its read-repair-state comment on never keywordizing).
(defn note-repair-attempt
  [state role now-ms cooldown-ms]
  (let [prior (get state role)
        last-ms (get prior "last-ms")
        in-window? (boolean (and last-ms (< (- now-ms last-ms) cooldown-ms)))]
    (assoc state role {"attempts" (if in-window? (inc (get prior "attempts" 0)) 1)
                       "last-ms" now-ms})))

(defn check-live-session
  ;; BL-804: should-stand? is topology-derived (mono_router_lib, via the
  ;; babysitter_check.bb gatherer) and defaults to true so every pre-BL-804
  ;; caller — classic packs, and every existing test that never mentions
  ;; the key — keeps CRIT-ing a missing session exactly as before. It is
  ;; consulted ONLY on the absence branch: once pane-exists? is true, the
  ;; process/menu/frozen/remote-control checks below (and their sibling
  ;; check-* fns) run unconditionally, so topology suppression can never
  ;; skip a check on a session that is actually present.
  ;;
  ;; BL-1017 / BL-1169: missing-session AND half-launch (pane up, agent gone)
  ;; both carry a bounded :repair intent. Placement rules that stay load-bearing:
  ;;   - missing-session hangs off the SAME branch should-stand? already guards,
  ;;     so invariant 1 (never resurrect a topology-dormant role) holds by
  ;;     construction;
  ;;   - repair is emitted ALONGSIDE the CRIT, never instead of it (BL-1169
  ;;     invariant 1 / BL-1017 posture);
  ;;   - process-gather-failed? stays repair-free — that branch is UNAVAILABLE,
  ;;     not a proven absence (BL-802 cry-wolf guard).
  [{:keys [role pane-exists? has-claude-process? process-gather-failed? should-stand?
           expected-process]
    :as opts
    :or {should-stand? true}}]
  (cond
    (and (not pane-exists?) (not should-stand?))
    nil

    (not pane-exists?)
    (cond-> {:key (str "pane-" role) :severity "CRIT"
             :message (str "swarmforge-" role ": tmux session missing")}
      (session-repair-allowed? opts)
      (assoc :repair {:action :ensure-session :role role}))

    ;; BL-802: the process gather itself failed (e.g. ps errored on an
    ;; unsupported dialect) — report the check unavailable, never the
    ;; half-launch CRIT below, which is a claim about a REAL absence.
    process-gather-failed?
    {:key (str "proc-gather-" role) :severity "UNAVAILABLE"
     :message (str "swarmforge-" role ": pane process gather unavailable this sweep (ps failed) — live-process check skipped")}

    (not has-claude-process?)
    (let [proc-name (or expected-process "agent")]
      (cond-> {:key (str "proc-" role) :severity "CRIT"
               :message (str "swarmforge-" role ": pane alive but NO " proc-name
                             " process under it (half-launch/exit)")}
        ;; Topology still gates repair (BL-804 / BL-1017 inv 1): a present
        ;; half-launch pane on a should-not-stand role alerts but is not
        ;; resurrected as if it were standing.
        (and should-stand? (session-repair-allowed? opts))
        (assoc :repair {:action :ensure-session :role role})))

    :else nil))
;; ── check 2: remote-control-flag ─────────────────────────────────────────────

(defn check-remote-control
  "Claude /rc only. Non-Claude seats (Cursor, gemini, …) set :rc-applicable?
   false in the gatherer — they never carry --remote-control and must not
   WARN as RC-degraded when their agent is correctly alive.
   BL-1070: when the liveness gate is unmet (agent absent, gather ok), emit
   UNAVAILABLE naming that the check could not run — never go quiet (inv 3)."
  [{:keys [role pane-exists? has-claude-process? has-remote-control? rc-applicable?
           process-gather-failed?]
    :or {rc-applicable? true}}]
  (cond
    (not (and pane-exists? rc-applicable?))
    nil

    process-gather-failed?
    nil

    (not has-claude-process?)
    {:key (str "rc-" role) :severity "UNAVAILABLE"
     :message (str "swarmforge-" role ": remote-control check could not be run — no agent process under the pane")}

    (not has-remote-control?)
    {:key (str "rc-" role) :severity "WARN"
     :message (str "swarmforge-" role ": claude alive but --remote-control flag missing (RC degraded)")}

    :else nil))

;; ── check 3: handoffd-supervisor-fresh ───────────────────────────────────────

(defn check-handoffd-supervisor-fresh
  [{:keys [handoffd-alive? supervisor-alive? log-age-secs max-age-secs]}]
  (cond
    (not handoffd-alive?)
    {:key "handoffd" :severity "CRIT"
     :message "handoffd.bb not running — no deliveries/chases (restart via start_handoff_daemon.sh only)"}

    (not supervisor-alive?)
    {:key "handoffd-sup" :severity "WARN"
     :message "handoffd_supervisor.bb not running"}

    (and log-age-secs max-age-secs (> log-age-secs max-age-secs))
    {:key "heartbeat" :severity "CRIT"
     :message (str "handoffd.log silent " log-age-secs "s (> " max-age-secs "s) — daemon may be futex-hung: process alive, ensure dead")}

    :else nil))

;; ── check 4: dead-letter-nonempty ────────────────────────────────────────────

(defn check-dead-letter
  [{:keys [failed-count]}]
  (when (pos? (long (or failed-count 0)))
    {:key "failed-box" :severity "CRIT"
     :message (str failed-count " parcel(s) in handoffs/failed/ dead-letter box")}))

;; ── check 5: stuck-in-process ─────────────────────────────────────────────────
;; BL-807 R1: gate on the busy signal the sweep already computes for check 10
;; (owner-busy?, threaded in by the gatherer's busy-by-role map) — a stuck
;; parcel whose owning role's pane is busy is suppressed, never warned. Age
;; and mailbox shape play no further role here: every item this function
;; receives was already past the stuck threshold by the gatherer (R2), and
;; the gatherer resolves the owning role for every mailbox shape (R4/R5) —
;; this decision only ever consumes the resolved :owner-busy? boolean.

(defn check-stuck-in-process
  [stuck-parcels]
  (vec
   (for [{:keys [name age-min owner-busy?]} (or stuck-parcels [])
         :when (not owner-busy?)]
     {:key (str "stuck-" (subs (str name) 0 (min 40 (count (str name)))))
      :severity "WARN"
      :message (str "in_process parcel older than 30m (age=" age-min "m): " name)})))

;; ── check 6: menu-blocked-pane ────────────────────────────────────────────────

(defn check-menu-blocked
  [{:keys [role menu-blocked?]}]
  (when menu-blocked?
    {:key (str "menu-" role) :severity "CRIT"
     :message (str "swarmforge-" role ": pane appears BLOCKED on an interactive menu/dialog — needs a human choice, do not auto-pick")}))

;; ── check 7: busy-but-frozen ──────────────────────────────────────────────────

(defn check-busy-frozen
  [{:keys [role busy? hash-history acp?]}]
  ;; BL-1081: this check is two pane-text heuristics stacked - a "busy" footer
  ;; and a pane hash unchanged across three sweeps - and each is defeated in a
  ;; different way by exactly the traps this ticket exists to remove: a
  ;; truncated tail, a ghost suggestion, a render that froze while the agent
  ;; kept working.
  ;;
  ;; For an ACP-hosted seat the turn's state is a FACT, not an inference: the
  ;; stop reason says whether it ended. So the pane comparison is not consulted
  ;; for such a seat at all - an ended turn is idle rather than frozen, and a
  ;; turn still running is working rather than hung. Whether a long-running
  ;; turn is hung is a question the pane hash never answered any better, and
  ;; answering it from ACP would need a duration this snapshot does not carry;
  ;; that is deliberately not smuggled in here.
  ;;
  ;; Every pane-driven seat keeps this check exactly as it was.
  (when-not acp?
    (let [history (or hash-history [])]
      (when (and busy?
                 (>= (count history) 3)
                 (apply = (take-last 3 history)))
        {:key (str "frozen-" role) :severity "WARN"
         :message (str "swarmforge-" role ": busy footer shown but pane content unchanged for 3 sweeps — possible hung turn")}))))

;; ── check 7b: an ACP seat's own control state (BL-1081) ───────────────────

(defn check-acp-seat
  "The structured facts, given a voice.

   Suppressing the pane checks for an ACP seat is only half a wiring: it makes
   the old inference stop lying without making the new fact say anything. A
   permission moment in particular NEEDS to reach a human - that is the whole
   point of handling it structurally instead of as a blocking menu - so it is
   surfaced here, from the request itself.

   Deliberately a different key and a different message from the menu CRIT.
   They are different conditions with different responses: a menu block means
   the agent is frozen waiting for a keystroke nobody may auto-press, while a
   structured request means the agent is waiting on a decision that CAN be
   routed. Conflating them is how a permission moment used to read as a stall."
  [{:keys [role acp? permission-pending? permission-tool]}]
  (when (and acp? permission-pending?)
    {:key (str "acp-permission-" role) :severity "CRIT"
     :message (str "swarmforge-" role ": blocked on a structured permission request"
                   (when (seq (str permission-tool)) (str " (" permission-tool ")"))
                   " — route or approve it; this is not a menu block and no pane"
                   " keystroke will clear it")}))

;; ── check 8: memory-floor ─────────────────────────────────────────────────────

(defn check-memory-floor
  [{:keys [available-mb floor-mb]}]
  (cond
    ;; BL-802: no readable memory facility this sweep (nil, distinct from a
    ;; genuinely low reading of 0) — report unavailable, never a fabricated
    ;; CRIT or a silent pass-through as OK.
    (nil? available-mb)
    {:key "memory" :severity "UNAVAILABLE"
     :message "memory floor check unavailable this sweep — no readable memory facility (BABYSITTER_MEMINFO_PATH unset, /proc/meminfo absent, vm_stat unavailable)"}

    (< (long available-mb) (long (or floor-mb 0)))
    {:key "memory" :severity "CRIT"
     :message (str "only " available-mb "MB available (< " floor-mb "MB) — check for orphaned vitest/stryker workers (free -h FIRST)")}

    :else nil))

;; ── check 11: claim-progress risk scan (BL-528 salvage) ──────────────────────

(def ^:private claim-risk-crit-severities #{"critical" "halt-imminent"})

(defn check-claim-risk
  [{:keys [role severity reclaims hint] :as assessment}]
  (when assessment
    {:key (str "claim-risk-" role)
     :severity (if (contains? claim-risk-crit-severities severity) "CRIT" "WARN")
     :message (str role " " severity " reclaims=" reclaims (when hint (str " — " hint)))}))

;; ── check 9: rotate-not-honored ───────────────────────────────────────────────

(defn check-rotate-not-honored
  "CRIT when a completed rotate note was not reflected in mono-router-active-role.
   BL-1129: standing packs never rotate — empty active-role is expected; suppress.
   bl1129CheckRotateNotHonoredSkipsStanding: acceptance handler registered"
  [{:keys [note-name note-target note-age-min grace-min
           note-mtime-ms active-role-file-mtime-ms active-role paused?
           rotation-router?]
    :as note}]
  (when (and note (not paused?)
             ;; Same gate as check-resident-stranded (BL-804 topology).
             rotation-router?
             note-age-min grace-min (> (long note-age-min) (long grace-min))
             note-mtime-ms active-role-file-mtime-ms
             (> (long note-mtime-ms) (long active-role-file-mtime-ms))
             note-target active-role
             (not= (str/lower-case (str note-target)) (str/lower-case (str active-role))))
    {:key (str "rotate-unhonored-" note-target) :severity "CRIT"
     :message (str "rotate note completed >" grace-min "m ago (" note-name
                   ") but mono-router-active-role is still '" active-role
                   "' not '" note-target
                   "' — instruction was delivered and marked done, never executed; re-issue or run rotate_to_role.sh " note-target)}))

;; ── check 10: swarm-starved (streak-gated, abandoned/aged-aware) ────────────

(defn- fresh-pending? [{:keys [abandoned? age-min]} pending-max-age-min]
  (and (not abandoned?) age-min (<= (long age-min) (long pending-max-age-min))))

;; BL-1109: a non-abandoned in_process claim is motion even when the owning
;; pane is idle this sweep (Cursor Thinking pause, rotate gap, follow-up bar).
;; owner-busy? remains on the claim for stuck-in-process (BL-807); starved
;; must not require it. nil abandoned? counts as live (gather never abandons).
(defn- motion-in-process? [{:keys [abandoned?]}]
  (not abandoned?))

(defn- swarm-starved-mailbox-clause [pending-claims in-process-claims]
  (let [n-pending (count (or pending-claims []))
        n-ip (count (or in-process-claims []))]
    (if (and (zero? n-pending) (zero? n-ip))
      "zero pending/in-process parcels"
      (str n-pending " pending and " n-ip
           " in-process claim(s) with no countable motion"))))

(defn- swarm-starved-message [active-ticket-count new-streak pending-claims in-process-claims]
  (str "swarm appears STARVED: " active-ticket-count
       " active ticket(s) but "
       (swarm-starved-mailbox-clause pending-claims in-process-claims)
       " and every pane idle for " new-streak
       " consecutive sweeps — likely a lost instruction or stale assignment; check the newest completed notes and ticket assigned_to fields"))

(def default-pending-max-age-min 120)

;; BL-1169: after this many consecutive idle sweeps, queue ./swarm ensure
;; alongside the swarm-starved CRIT so recovery is not escalation-only.
(def default-swarm-starved-ensure-streak 3)

(defn check-swarm-starved
  [{:keys [active-ticket-count any-pane-busy? paused? prev-streak
           pending-claims in-process-claims pending-max-age-min
           starved-ensure-streak control-plane-repair-allowed?]
    :or {pending-max-age-min default-pending-max-age-min
         starved-ensure-streak default-swarm-starved-ensure-streak
         control-plane-repair-allowed? true}}]
  (let [has-motion-pending? (some #(fresh-pending? % pending-max-age-min) (or pending-claims []))
        has-motion-inprocess? (some motion-in-process? (or in-process-claims []))
        idle-this-sweep? (and (not paused?)
                              (pos? (long (or active-ticket-count 0)))
                              (not any-pane-busy?)
                              (not has-motion-pending?)
                              (not has-motion-inprocess?))
        new-streak (if idle-this-sweep? (inc (long (or prev-streak 0))) 0)
        finding (when (>= new-streak 2)
                  (cond-> {:key "swarm-starved" :severity "CRIT"
                           :message (swarm-starved-message active-ticket-count new-streak
                                                           pending-claims in-process-claims)}
                    (and control-plane-repair-allowed?
                         (>= new-streak (long starved-ensure-streak)))
                    (assoc :repair {:action :ensure-control-plane})))]
    {:finding finding
     :new-streak new-streak}))
;; BL-996: was a private whole-pane substring match (`(str/includes? text
;; "esc to interrupt")` or'd with a spinner-glyph+elapsed-time co-occurrence)
;; - exactly the false-busy shape BL-970 fixed at the chokepoint (a pane
;; quoting the marker in old scrollback, not actually mid-turn, read as
;; busy). Delegates to the SAME classifier every wake predicate already
;; reaches instead of a second, private copy - see chase_sweep_lib.bb's own
;; actively-processing? for the structural/tail-window contract.
(defn classify-pane-busy?
  [pane-text]
  (chase-sweep-lib/actively-processing? pane-text))

;; ── check 12 / 17: resume-overdue (planned pause failed to auto-resume) ─────

(def default-resume-overdue-threshold-ms (* 15 60 1000))

(defn check-resume-overdue
  [{:keys [paused? now-ms until-ms overdue-threshold-ms]
    :or {overdue-threshold-ms default-resume-overdue-threshold-ms}}]
  (let [threshold-ms (long (or overdue-threshold-ms default-resume-overdue-threshold-ms))]
    (when (and paused? now-ms until-ms
               (> (- (long now-ms) (long until-ms)) threshold-ms))
      {:key "resume-overdue" :severity "CRIT"
       :message (str "pause untilMs expired " (quot (- (long now-ms) (long until-ms)) 60000)
                     "min ago but control-pause.json still active — auto-resume sweep failed, swarm sleeping past its window")})))

;; ── check: resident-stranded (BL-685, Class B) ──────────────────────────────
;; A mono-router resident that ended its turn in a NON-HOME role without the
;; protocol's mandatory rotate step sits dormant forever: dormant roles are
;; never poked, so the pipeline stops silently while every dashboard reads
;; green. Both existing safeguards miss this by construction - ROTATE_HOME
;; only fires if the resident runs ready_for_next.sh (it didn't run
;; anything), and rotate-unhonored (check 9, additive, deliberately
;; untouched) looks for a rotate instruction that was never written. So
;; every input here is observable from OUTSIDE the resident's own turn
;; (invariant 1): the active-role marker file, its mtime, the pane's busy
;; state, mailbox contents on disk, and a pending dispatch note - never
;; anything the stranded resident would have had to do.
;;
;; Grace rides the marker file's own mtime (how long the resident has been
;; in its current role) - no new persisted counter, so it cannot collide
;; with check-swarm-starved's single-scalar streak-file (the ticket's own
;; Wiring finding 2).

(def default-resident-stranded-grace-min 10)

(defn check-resident-stranded
  [{:keys [rotation-router? rotation-home resident-active-role
           resident-active-role-mtime-ms resident-pane-busy?
           resident-mailbox-empty? dispatch-note-pending? paused? now-ms
           resident-stranded-grace-min]
    :or {resident-stranded-grace-min default-resident-stranded-grace-min}}]
  (when (and rotation-router? (not paused?)
             resident-active-role rotation-home
             (not= (str/lower-case (str resident-active-role))
                   (str/lower-case (str rotation-home)))
             (not resident-pane-busy?)
             resident-mailbox-empty?
             (not dispatch-note-pending?)
             resident-active-role-mtime-ms now-ms
             (> (- (long now-ms) (long resident-active-role-mtime-ms))
                (* (long resident-stranded-grace-min) 60000)))
    {:key (str "resident-stranded-" resident-active-role) :severity "CRIT"
     :message (str "mono-router resident stranded as '" resident-active-role
                   "' (home: " rotation-home ") for >" resident-stranded-grace-min
                   "m - pane idle, mailbox empty, no dispatch note pending, no rotate instruction ever issued;"
                   " coordinator should re-dispatch (route work or rotate_to_role.sh " rotation-home ")")}))

;; ── check N: pipeline-code-on-main (BL-631) ─────────────────────────────────
;; Detects pipeline code landing on `main` outside QA's own integration path
;; (Article 4.2/BL-247) - the BL-590 post-mortem gap: nothing errored, and
;; nothing told anyone, when an entire pipeline pass ran in the master
;; checkout. This fn is pure: the gatherer (babysitter_check.bb, impure)
;; already resolved which commits are reachable from a main ref, NOT an
;; ancestor of swarmforge-QA (via is_qa_ancestor.sh, the ONE shared
;; predicate - BL-925 invariant 2), and touch a QA-exclusive path read at
;; runtime from BL-632's own check_pipeline_code_on_main.sh --list-paths
;; (never restated here - invariant 2) - merge commits diffed as a TWO-TREE
;; diff against their first parent, never plain `git show`, which is blind to
;; a merge's own content (BL-590's f8dc07963: 0 files plain, 20 against its
;; first parent).
;;
;; BL-1359: this paragraph used to say `git diff-tree -m --first-parent`, and
;; so did the gatherer. That flag is a revision-TRAVERSAL option and does
;; nothing on a single named commit, so `-m` alone decided the output - the
;; union of the diffs against EVERY parent. The gatherer now takes the
;; two-tree diff against the resolved first parent, which is what both
;; comments always claimed.
;;
;; BL-962: a merge's first-parent diff still legitimately includes everything
;; a QA-side parent brought in, which raised a false CRIT on every operator
;; reconciliation merge of QA-landed work. The gatherer now
;; adjudicates each merge's offending paths against its non-first parents
;; BEFORE handing them here: a path is exempt only when some parent is BOTH
;; QA-approved (the same is_qa_ancestor.sh predicate) AND holds
;; byte-identical content for it, so a path differing from every
;; QA-approved parent still reports (the coat-tails case), and any failure
;; in that adjudication fails the WHOLE sweep closed to
;; ancestry-unavailable. Non-merge commits are untouched. This fn only
;; classifies what it is handed - unchanged by BL-962.

(defn check-pipeline-code-on-main
  "offending-commits: seq of {:sha :subject :paths [...]} the gatherer
   already resolved as offending. ancestry-unavailable?: true when
   swarmforge-QA could not be resolved at all this sweep - fails CLOSED to
   an UNAVAILABLE finding, never a silent all-clear (invariant 3)."
  [{:keys [offending-commits ancestry-unavailable?]}]
  (if ancestry-unavailable?
    [{:key "pipeline-code-on-main" :severity "UNAVAILABLE"
      :message "pipeline-code-on-main check unavailable this sweep - the swarmforge-QA ref could not be resolved (fails closed, never reads as clean)"}]
    (mapv (fn [{:keys [sha subject paths]}]
            {:key (str "pipeline-code-on-main-" sha)
             :severity "CRIT"
             :message (str "pipeline code landed on main outside QA (Article 4.2/BL-247): "
                           sha " \"" subject "\" touches " (str/join ", " paths))})
          (or offending-commits []))))

;; ── check: main-sync-deadlock (BL-1187) ─────────────────────────────────────

(defn check-main-sync-deadlock
  [{:keys [deadlock-active? ahead behind reason overlapping-paths]}]
  (when deadlock-active?
    {:key "main-sync-deadlock" :severity "CRIT"
     :message (master-main-reconcile-lib/operator-deadlock-hint
               {:ahead ahead :behind behind :reason reason
                :overlapping-paths overlapping-paths})}))

;; ── nudge eligibility (scenario 13) ──────────────────────────────────────────

(defn nudge-eligible?
  [{:keys [key severity]}]
  (boolean
   (and (not= (str key) "main-sync-deadlock")
        (or (= "CRIT" severity)
            (and (= "WARN" severity) (str/starts-with? (str key) "stuck-"))))))

;; ── BL-653 escalation eligibility (scenario 04 vs 03/05) ─────────────────────

(defn escalation-eligible?
  "CRIT findings summon LLM judgement via BABYSITTER_ESCALATION. WARN
   stuck-* nudges the coordinator but stays below the operator escalation
   bar (BL-653 scenario 04)."
  [{:keys [severity]}]
  (= "CRIT" severity))

;; ── decide-nudges: pure dedup + cooldown decision (scenario 11) ─────────────

(def default-nudge-cooldown-ms (* 30 60 1000))

(defn decide-nudges
  "findings: seq of findings this sweep. opts: {:last-nudged-ms-by-key {} :now-ms :cooldown-ms}.
   Returns {:to-nudge [findings due now] :new-dedup-state {key -> now-ms for every nudged key}}."
  [findings {:keys [last-nudged-ms-by-key now-ms cooldown-ms]
             :or {last-nudged-ms-by-key {} cooldown-ms default-nudge-cooldown-ms}}]
  (let [eligible (filter nudge-eligible? findings)
        due? (fn [{:keys [key]}]
               (let [last-ms (get last-nudged-ms-by-key key)]
                 (or (nil? last-ms)
                     (>= (- (long now-ms) (long last-ms)) (long cooldown-ms)))))
        to-nudge (vec (filter due? eligible))]
    {:to-nudge to-nudge
     :new-dedup-state (reduce (fn [m {:keys [key]}] (assoc m key now-ms))
                               last-nudged-ms-by-key
                               to-nudge)}))

;; ── formatting ────────────────────────────────────────────────────────────

(defn format-finding-line
  [{:keys [key severity message]} ts]
  (str ts " " severity " [" key "] " message))

(defn format-nudge-message
  [findings]
  (str "babysitter health sweep: "
       (str/join " ; " (map :message findings))
       " — investigate and take the minimal correct action (or tell the human)."))

(defn decide-escalations
  "BL-653: same dedup/cooldown shape as decide-nudges, but only
   escalation-eligible? findings become operator BABYSITTER_ESCALATION
   events."
  [findings {:keys [last-escalated-ms-by-key now-ms cooldown-ms]
             :or {last-escalated-ms-by-key {} cooldown-ms default-nudge-cooldown-ms}}]
  (let [eligible (filter escalation-eligible? findings)
        due? (fn [{:keys [key]}]
               (let [last-ms (get last-escalated-ms-by-key key)]
                 (or (nil? last-ms)
                     (>= (- (long now-ms) (long last-ms)) (long cooldown-ms)))))
        to-escalate (vec (filter due? eligible))]
    {:to-escalate to-escalate
     :new-escalation-dedup-state (reduce (fn [m {:keys [key]}] (assoc m key now-ms))
                                         last-escalated-ms-by-key
                                         to-escalate)}))

;; ── BL-1171 disaster-class correlation ───────────────────────────────────────

(def disaster-class-key "disaster-class")
(def starvation-cascade-class "starvation-cascade")
(def handoffd-parse-dead-class "handoffd-parse-dead")
(def min-half-launch-for-cascade 3)

(def default-disaster-evidence-paths
  [".swarmforge/daemon/handoffd.log"
   ".swarmforge/babysitterd/streak"
   ".swarmforge/incidents/control-plane.json"])

(defn half-launch-finding? [{:keys [key message]}]
  (and (str/starts-with? (str key) "proc-")
       (str/includes? (str (or message "")) "half-launch")))

(defn handoffd-down-finding? [{:keys [key]}]
  (= "handoffd" (str key)))

(defn swarm-starved-finding? [{:keys [key]}]
  (= "swarm-starved" (str key)))

(defn count-half-launch-findings [findings]
  (count (filter half-launch-finding? findings)))

(defn starvation-cascade-candidate? [findings]
  (and (>= (count-half-launch-findings findings) min-half-launch-for-cascade)
       (some handoffd-down-finding? findings)
       (some swarm-starved-finding? findings)))

(defn handoffd-parse-error-snapshot? [{:keys [handoffd-startup-error]}]
  (boolean (seq (str (or handoffd-startup-error "")))))

(defn disaster-correlated-keys [findings]
  (into #{}
        (concat (map :key (filter handoffd-down-finding? findings))
                (map :key (filter swarm-starved-finding? findings))
                (map :key (filter half-launch-finding? findings)))))

(defn playbooks-path [repo-root]
  (when repo-root
    (str (fs/path (str repo-root) ".swarmforge" "operator" "failure-class-playbooks.json"))))

(defn read-failure-class-playbooks
  "BL-1170: operator playbook store — optional override for disaster-class detail."
  [repo-root]
  (let [path (playbooks-path repo-root)]
    (when (and path (fs/exists? path))
      (try
        (json/parse-string (slurp path) true)
        (catch Exception _ {})))))

(defn merge-playbook-into-disaster-class
  [disaster-class playbooks]
  (if-not (and disaster-class playbooks)
    disaster-class
    (let [fc (:failure_class disaster-class)
          pb (get playbooks (keyword fc) (get playbooks fc))]
      (if-not pb
        disaster-class
        (merge disaster-class
               (select-keys pb [:suggested_actions :summary :human_hotfix_required]))))))

(defn enrich-disaster-escalation [escalation repo-root]
  (let [playbooks (read-failure-class-playbooks repo-root)]
    (if-not playbooks
      escalation
      (update escalation :disaster-class #(merge-playbook-into-disaster-class % playbooks)))))

(defn build-starvation-cascade-disaster-escalation
  ([findings] (build-starvation-cascade-disaster-escalation findings nil))
  ([findings repo-root]
   (let [half-count (count-half-launch-findings findings)
         base {:key disaster-class-key
               :severity "CRIT"
               :message (str "disaster-class " starvation-cascade-class ": handoffd down, "
                             half-count " half-launch role(s), swarm starved")
               :disaster-class {:failure_class starvation-cascade-class
                                :likely_causes ["handoffd not running blocks delivery and respawn"
                                                "multiple role panes are half-launched (agent gone, shell up)"
                                                "swarm mailboxes are starved with work pending"]
                                :suggested_actions [{:action "run ./swarm ensure once" :owner "babysitterd"}
                                                    {:action "inspect handoffd.log last 20 lines" :owner "operator"}
                                                    {:action "confirm agents respawned after ensure" :owner "human"}]
                                :evidence_paths default-disaster-evidence-paths}}]
     (enrich-disaster-escalation base repo-root))))

(defn build-handoffd-parse-disaster-escalation
  ([snapshot] (build-handoffd-parse-disaster-escalation snapshot nil))
  ([{:keys [handoffd-log-path handoffd-startup-error]} repo-root]
   (let [log-path (or handoffd-log-path ".swarmforge/daemon/handoffd.log")
         base {:key disaster-class-key
               :severity "CRIT"
               :diagnose-only true
               :message (str "disaster-class " handoffd-parse-dead-class ": handoffd startup failed — "
                             "human hotfix required; see " log-path)
               :disaster-class {:failure_class handoffd-parse-dead-class
                                :likely_causes [(str "handoffd.bb failed to start: " handoffd-startup-error)]
                                :suggested_actions [{:action (str "inspect " log-path " and apply a human hotfix")
                                                     :owner "human"}]
                                :evidence_paths [log-path]
                                :diagnose_only true}}]
     (enrich-disaster-escalation base repo-root))))

(defn prepare-escalation-findings
  "Roll correlated CRIT symptoms into one disaster-class escalation per window."
  [findings snapshot]
  (let [eligible (vec (filter escalation-eligible? findings))
        repo-root (:repo-root snapshot)]
    (cond
      (handoffd-parse-error-snapshot? snapshot)
      [(build-handoffd-parse-disaster-escalation snapshot repo-root)]

      (starvation-cascade-candidate? eligible)
      [(build-starvation-cascade-disaster-escalation eligible repo-root)]

      :else eligible)))

(defn diagnose-only-disaster-sweep?
  "When true, the sweep must not queue bounded auto-repair (BL-1171 invariant 2)."
  [findings snapshot]
  (or (handoffd-parse-error-snapshot? snapshot)
      (boolean (:diagnose-only (first (prepare-escalation-findings findings snapshot))))))

(defn disaster-class-escalation? [{:keys [key]}]
  (= disaster-class-key (str key)))

;; ── check: control-plane-missing (BL-958 ownership) ─────────────────────────
;; babysitterd owns the response (:recover via ./swarm ensure when launch
;; scripts exist, else a single escalation). The gatherer observes via
;; control_plane_lib and threads the classification + bound here; this check
;; only decides the finding/repair. Per-role ensure-session repairs are
;; suppressed by assemble-findings when a control-plane ensure is queued —
;; ensure's :relaunch-roles path is the coordinated recovery, and racing it
;; with eight individual new-session calls is the wrong shape.

(defn check-control-plane
  [{:keys [control-plane-classification launch-scripts-present?
           control-plane-repair-allowed? socket-path control-plane-error]}]
  ;; BL-1071 invariant 3. control_plane_lib/classify returns only :up,
  ;; :control-plane-missing or :down, so :unavailable can ONLY mean the
  ;; observation itself could not be made - the observer threw. Reporting that
  ;; as nothing let the sweep print "OK all checks green" while knowing
  ;; nothing about the plane, which is the incident's own silent-blackout
  ;; mechanism one layer up. An unreadable probe is its own answer: never a
  ;; healthy reading (:up), never an absence (:down, or a queued recovery).
  (cond
    (= :unavailable control-plane-classification)
    {:key "control-plane" :severity "UNAVAILABLE"
     :message (str "control-plane observation unavailable this sweep"
                   (when socket-path (str " at " socket-path))
                   " — the observer could not complete"
                   (when (seq (str control-plane-error))
                     (str ": " control-plane-error))
                   "; the plane's state is unknown, not healthy and not missing")}

    (= :control-plane-missing control-plane-classification)
    (if launch-scripts-present?
      (cond-> {:key "control-plane" :severity "CRIT"
               :message (str "tmux control plane missing"
                             (when socket-path (str " at " socket-path))
                             "; role metadata still present — running ./swarm ensure")}
        control-plane-repair-allowed?
        (assoc :repair {:action :ensure-control-plane}))
      {:key "control-plane" :severity "CRIT"
       :message (str "tmux control plane missing"
                     (when socket-path (str " at " socket-path))
                     " and no persisted launch scripts exist to respawn roles from"
                     " — relaunch the swarm (./start-swarm.sh) and inspect "
                     ".swarmforge/incidents/control-plane.json")})))

;; ── assemble-findings: the single pure entry point ──────────────────────────
;; snapshot keys: :roles (seq of per-role maps for checks 1/2/6/7 — each may
;; carry :should-stand? (BL-804), topology-derived by the gatherer and
;; defaulting to true when absent),
;; :handoffd-alive? :handoffd-supervisor-alive? :handoffd-log-age-secs
;; :handoffd-max-age-secs, :failed-count, :stuck-parcels, :available-mb
;; :mem-floor-mb, :claim-risks (pre-scanned assessments), :rotate-note (or nil),
;; :pause {:active? :until-ms}, :now-ms, :active-ticket-count :any-pane-busy?
;; :prev-streak :pending-claims :in-process-claims :overdue-threshold-ms,
;; :offending-commits :ancestry-unavailable? (BL-631, check-pipeline-code-on-main).
;; :control-plane-classification :launch-scripts-present?
;; :control-plane-repair-allowed? :socket-path (BL-958 babysitter ownership).
;; :deadlock-active? :ahead :behind :reason :overlapping-paths (BL-1187).

(defn assemble-findings
  [{:keys [roles handoffd-alive? handoffd-supervisor-alive? handoffd-log-age-secs
           handoffd-max-age-secs failed-count stuck-parcels available-mb mem-floor-mb
           claim-risks rotate-note pause now-ms active-ticket-count any-pane-busy?
           prev-streak pending-claims in-process-claims overdue-threshold-ms
           pending-max-age-min offending-commits ancestry-unavailable?
           rotation-router? rotation-home resident-active-role
           resident-active-role-mtime-ms resident-pane-busy?
           resident-mailbox-empty? dispatch-note-pending?
           resident-stranded-grace-min
           control-plane-classification launch-scripts-present?
           control-plane-repair-allowed? socket-path control-plane-error
           deadlock-active? ahead behind reason overlapping-paths]}]
  (let [paused? (boolean (:active? pause))
        control-plane-finding (check-control-plane
                               {:control-plane-classification control-plane-classification
                                :launch-scripts-present? launch-scripts-present?
                                :control-plane-repair-allowed? control-plane-repair-allowed?
                                ;; BL-1071 scenario 06: the REASON the
                                ;; observation failed. The gatherer captures it
                                ;; and check-control-plane renders it, but this
                                ;; destructuring is the one place between them -
                                ;; a key absent here is dropped silently, and
                                ;; the finding degrades to "unavailable" with
                                ;; nowhere for a human to start.
                                :control-plane-error control-plane-error
                                :socket-path socket-path})
        {starved-finding :finding new-streak :new-streak}
        (check-swarm-starved {:active-ticket-count active-ticket-count
                              :any-pane-busy? any-pane-busy?
                              :paused? paused?
                              :prev-streak prev-streak
                              :pending-claims pending-claims
                              :in-process-claims in-process-claims
                              :pending-max-age-min pending-max-age-min
                              :control-plane-repair-allowed? control-plane-repair-allowed?})
        control-plane-ensure? (or (= :ensure-control-plane
                                     (get-in control-plane-finding [:repair :action]))
                                  (= :ensure-control-plane
                                     (get-in starved-finding [:repair :action])))
        role-findings (mapcat (fn [role]
                                 (remove nil?
                                         [(let [f (check-live-session role)]
                                            ;; Coordinated ./swarm ensure owns relaunch-roles;
                                            ;; do not also fire eight per-role creates.
                                            (cond-> f
                                              (and f control-plane-ensure? (:repair f))
                                              (dissoc :repair)))
                                          (check-remote-control role)
                                          (check-menu-blocked role)
                                          (check-busy-frozen role)
                                          ;; BL-1081: the structured facts are
                                          ;; CONSUMED here, in the same list as
                                          ;; the pane checks they replace. A
                                          ;; check nobody calls is the BL-419
                                          ;; shape this ticket bounced for.
                                          (check-acp-seat role)]))
                               (or roles []))
        handoffd-finding (check-handoffd-supervisor-fresh
                          {:handoffd-alive? handoffd-alive?
                           :supervisor-alive? handoffd-supervisor-alive?
                           :log-age-secs handoffd-log-age-secs
                           :max-age-secs handoffd-max-age-secs})
        dead-letter-finding (check-dead-letter {:failed-count failed-count})
        stuck-findings (check-stuck-in-process stuck-parcels)
        memory-finding (check-memory-floor {:available-mb available-mb :floor-mb mem-floor-mb})
        claim-findings (map check-claim-risk (or claim-risks []))
        rotate-finding (check-rotate-not-honored
                        (when rotate-note
                          (assoc rotate-note :paused? paused? :rotation-router? rotation-router?)))
        resume-overdue-finding (check-resume-overdue {:paused? paused?
                                                      :now-ms now-ms
                                                      :until-ms (:until-ms pause)
                                                      :overdue-threshold-ms overdue-threshold-ms})
        pipeline-code-on-main-findings (check-pipeline-code-on-main
                                        {:offending-commits offending-commits
                                         :ancestry-unavailable? ancestry-unavailable?})
        resident-stranded-finding (check-resident-stranded
                                   {:rotation-router? rotation-router?
                                    :rotation-home rotation-home
                                    :resident-active-role resident-active-role
                                    :resident-active-role-mtime-ms resident-active-role-mtime-ms
                                    :resident-pane-busy? resident-pane-busy?
                                    :resident-mailbox-empty? resident-mailbox-empty?
                                    :dispatch-note-pending? dispatch-note-pending?
                                    :paused? paused?
                                    :now-ms now-ms
                                    :resident-stranded-grace-min (or resident-stranded-grace-min default-resident-stranded-grace-min)})
        main-sync-deadlock-finding (check-main-sync-deadlock
                                    {:deadlock-active? deadlock-active?
                                     :ahead ahead :behind behind :reason reason
                                     :overlapping-paths overlapping-paths})
        findings (vec (remove nil?
                              (concat [control-plane-finding main-sync-deadlock-finding]
                                      role-findings
                                      [handoffd-finding dead-letter-finding]
                                      stuck-findings
                                      [memory-finding]
                                      claim-findings
                                      [rotate-finding starved-finding resume-overdue-finding
                                       resident-stranded-finding]
                                      pipeline-code-on-main-findings)))
        ;; BL-1017: repairs are SURFACED as their own key rather than left
        ;; buried inside the findings list. The live caller acts on this
        ;; directly - a decision it had to re-derive by re-inspecting findings
        ;; is the BL-419 shape (mechanism built, wired nowhere) this ticket's
        ;; required_wiring exists to prevent. Always a vector, never nil, so
        ;; the caller's `doseq` needs no nil guard.
        repairs (vec (keep :repair findings))]
    {:findings findings :new-streak new-streak :repairs repairs}))
