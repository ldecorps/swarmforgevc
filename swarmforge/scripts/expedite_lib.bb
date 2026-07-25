#!/usr/bin/env bb
;; expedite_lib.bb — BL-567: the PURE decisions behind the expeditor, the driver
;; that takes one ticket through every pipeline gate with the swarm STOPPED.
;;
;; Why a pure lib at all: the expeditor's whole value is that it works when the
;; swarm's machinery is broken, so its own decisions must be testable without a
;; swarm, without tmux, without mailboxes. Every judgement the driver makes —
;; is the swarm really stopped, where does a parked ticket go, has this bounce
;; run out, is the failure the coder's or the spec's — lives here as a function
;; of data. expedite_cli.bb does the IO and calls these.
;;
;; The machinery-independence rule (this ticket's hard requirement) is why there
;; is no require of handoff_lib.bb / mono_router_lib.bb / swarm_ensure.bb here.
;; This file may not reach for any of it, even when convenient.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "expedite_lib.bb")))
;; and referred to as expedite-lib/foo.

(ns expedite-lib
  (:require [clojure.string :as str]))

;; ── stage order ────────────────────────────────────────────────────────────
;; Mirrors swarmforge/PIPELINE.md's chain. specifier is included because a
;; bounced spec defect routes there; coordinator is NOT a chain stage (BL-317:
;; bookkeeping only, never a routing member).

(def default-stages
  ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"])

(defn stages-for
  "The stage chain for a ticket. A `roles:` manifest (BL-317) narrows it;
   absent means the full standard chain. coder and QA are always required even
   when a manifest omits them, so a narrowed chain can never skip the gate that
   writes code or the gate that integrates it."
  [{:keys [roles]}]
  (if (seq roles)
    (let [declared (set (map str roles))
          required (conj declared "coder" "QA")]
      (vec (filter required default-stages)))
    default-stages))

(defn next-stage
  "The stage after `stage`, or nil when `stage` is the last one."
  [stages stage]
  (let [idx (.indexOf (vec stages) stage)]
    (when (and (nat-int? idx) (< -1 idx (dec (count stages))))
      (nth stages (inc idx)))))

;; ── liveness ───────────────────────────────────────────────────────────────
;; Scenarios 09/10/14. The interlock the ticket ORIGINALLY specified globbed
;; `.swarmforge/tmux/*.sock` — measured 2026-07-25, that reads a fully stopped
;; swarm as LIVE, because kill_all_swarm.sh runs `tmux kill-server` and
;; deliberately leaves the socket FILE behind. An interlock that false-positives
;; on its own happy path teaches the operator to pass --override as routine,
;; which is how an interlock becomes decoration.
;;
;; So: the socket file is NOT a signal. `probe` carries the RESULT of asking
;; each candidate socket whether a server answers, plus the supervisor
;; processes that a "clean slate" teardown is known to leave behind (BL-637:
;; ./stop-swarm.sh printed SUCCESS with babysitterd and the Operator alive).

(def supervisor-keys
  "Processes that can wake, nudge, relaunch or recover agents. Each one left
   alive can interfere with an offline run, so each is part of liveness — not
   just handoffd, which is all the ticket's interlock named."
  [:handoffd :handoffd-supervisor :babysitterd :operator :role-agents])

(defn liveness-verdict
  "Pure: is the swarm stopped, given probe results?

   probe keys:
     :tmux-servers-answering  count of sockets where a server actually replied
                              (NOT the number of socket files on disk)
     :handoffd / :handoffd-supervisor / :babysitterd / :operator
                              truthy when that process is alive
     :role-agents             count of live role agent processes

   Returns {:stopped? bool :alive [names...]}. `alive` names what must die
   before an offline run may start, so the refusal message can be specific
   instead of 'the swarm is live'."
  [probe]
  (let [servers (or (:tmux-servers-answering probe) 0)
        agents (or (:role-agents probe) 0)
        alive (cond-> []
                (pos? servers) (conj "tmux-server")
                (pos? agents) (conj "role-agents")
                (:handoffd probe) (conj "handoffd")
                (:handoffd-supervisor probe) (conj "handoffd-supervisor")
                (:babysitterd probe) (conj "babysitterd")
                (:operator probe) (conj "operator"))]
    {:stopped? (empty? alive) :alive alive}))

(defn start-decision
  "Pure: may the run start? Scenarios 09/10/11/14.

   Fails CLOSED: an unknown or unprobed liveness reads as live, never as
   stopped — an interlock that guesses 'probably down' is worse than none.
   The override is honoured but always reported, so it can never be silent."
  [probe {:keys [override?]}]
  (let [{:keys [stopped? alive]} (liveness-verdict probe)]
    (cond
      stopped? {:start? true :reason :swarm-stopped :override-used? false}
      override? {:start? true :reason :override :override-used? true :alive alive}
      :else {:start? false :reason :swarm-live :override-used? false :alive alive})))

(defn teardown-verdict
  "Pure: did a teardown actually reach a clean slate? Scenario 14.

   The teardown's own exit code is deliberately NOT trusted. Measured
   2026-07-25: ./stop-swarm.sh exited 0 and printed 'clean slate' while
   babysitterd (up 1d08h, 5-minute sweeps that nudge agents) and the Operator
   agent (up 2d06h) were both still running. A driver that trusts the exit code
   passes that case by accident."
  [{:keys [exit-code]} probe]
  (let [{:keys [stopped? alive]} (liveness-verdict probe)]
    {:clean? stopped?
     :alive alive
     :exit-code-lied? (and (zero? (or exit-code 0)) (not stopped?))}))

;; ── park ───────────────────────────────────────────────────────────────────
;; Scenario 12. hold/, never paused/: paused/ IS the promotion queue
;; (promote-next-paused-item-if-needed), so a ticket carrying
;; `human_approval: approved` parked to paused/ auto-promotes itself back on the
;; next boot and silently un-parks. hold/ is a recognised live state
;; (backlog_epic_milestone_audit.bb treats active/paused/hold as live) that
;; promotion does not read.

(def park-dir "hold")

(defn park-plan
  "Pure: what must initiation park, and where to?

   Every ticket in active/ other than the one being run is parked. The
   expeditor never parks its OWN ticket — it is about to work it."
  [{:keys [active-tickets run-ticket]}]
  (let [to-park (vec (remove #{run-ticket} active-tickets))]
    {:park to-park
     :destination park-dir
     :nothing-to-park? (empty? to-park)}))

(def forbidden-stop-flags
  "Flags initiation must never pass. --sweep-inbox archives pending handoffs —
   i.e. exactly the parcels a parked ticket needs in order to resume;
   --reset-worktrees reverts role worktrees. Scenario 13."
  #{"--sweep-inbox" "--reset-worktrees" "--full"})

(defn stop-invocation-ok?
  "Pure: is this stop invocation safe for a resumable park?"
  [args]
  (empty? (filter forbidden-stop-flags (map str args))))

;; ── bounces ────────────────────────────────────────────────────────────────
;; Scenarios 05/05b/05c. Operator ruling 2026-07-25: the bound is 3, NOT 8.
;;
;; The rejected 8 was derived from BL-590 taking six architect send-backs the
;; same day — i.e. calibrated to the worst OBSERVED case, which silently
;; ratifies it. If six rounds is unacceptable, a bound of eight declares six
;; acceptable. BL-633 (invariants:) and BL-634 (slice-size envelope) exist to
;; stop tickets bouncing six times, so calibrating against the state they fix
;; would design the pathology into the tool.
;;
;; At 3 the bound stops being a runaway-loop backstop and becomes a QUALITY
;; SIGNAL: three rounds against one gate says the ticket is probably
;; mis-specified, not that the coder is failing.

(def default-bounce-bound 3)

(defn repeated-class
  "Pure: the defect class seen more than once across these bounce records, or
   nil. This is BL-633's signature — BL-590's #1/#4/#5/#6 were four instances
   of one unstated identity invariant; BL-606's three send-backs were all one
   routing-record property."
  [bounces]
  (->> bounces
       (keep :class)
       frequencies
       (filter (fn [[_ n]] (< 1 n)))
       (sort-by (comp - val))
       ffirst))

(defn bounce-decision
  "Pure: retry the target stage, or stop? Scenario 05.

   `bounces` is this (stage, ticket)'s bounce records, oldest first, each
   {:class ... :reason ...}. `bound` defaults to 3."
  [{:keys [stage bounces bound]}]
  (let [bound (or bound default-bounce-bound)
        n (count bounces)]
    (if (< n bound)
      {:action :retry :stage stage :round (inc n) :bound bound}
      {:action :exhausted :stage stage :rounds n :bound bound})))

(defn exhaustion-report
  "Pure: what does exhausting the bound MEAN? Scenario 05b.

   Not merely 'the run failed'. A class repeating across rounds is a probable
   SPEC defect and routes to the specifier — the offline equivalent of the
   recorded 'a QA bounce that is really a spec defect' disposition, which
   routes to the specifier rather than looping the coder.

   Honest refinement the scenarios do not pin but correctness demands: when the
   rounds show three UNRELATED classes there is no evidence of a mis-specified
   ticket, so this must not claim one. That case is reported as diffuse and
   left unattributed rather than blamed on a stage."
  [{:keys [stage bounces]}]
  (let [klass (repeated-class bounces)]
    (if klass
      {:verdict :probable-spec-defect
       :gate stage
       :repeated-class klass
       :route-to "specifier"
       :blame-stage nil
       :rounds (count bounces)}
      {:verdict :diffuse-failure
       :gate stage
       :repeated-class nil
       :route-to nil
       :blame-stage nil
       :rounds (count bounces)})))

(defn bound-in-force
  "Pure: the bound this run uses, and whether it was raised. Scenario 05c — a
   default of 3 that everyone raises to 8 in practice restores exactly the
   rejected behaviour, so a raise is never silent."
  [requested]
  (let [b (or requested default-bounce-bound)]
    {:bound b
     :default default-bounce-bound
     :raised? (> b default-bounce-bound)
     :explicit? (some? requested)}))

;; ── machinery independence ─────────────────────────────────────────────────
;; Scenarios 02/03. The instrumentation wrapper needs one shared answer to
;; "is this thing on the machinery side of the line?", so the driver and the
;; wrapper cannot drift apart about what is forbidden.

(def forbidden-path-fragments
  [".swarmforge/handoffs/"])

(def forbidden-commands
  ["tmux" "handoffd.bb" "handoffd_supervisor.bb" "swarm_handoff.bb"
   "rotate_to_role.bb" "rotate_to_role.sh" "ready_for_next.sh"
   "ready_for_next_task.bb" "sync-deliver"])

(defn forbidden-path?
  "Pure: would touching this path breach machinery independence?"
  [path]
  (let [p (str path)]
    (boolean (some #(str/includes? p %) forbidden-path-fragments))))

(defn forbidden-command?
  "Pure: is this argv invoking swarm machinery? Matches on the basename so an
   absolute path cannot slip past, and on any argument so `bash x/tmux` and
   `env tmux` are both caught."
  [argv]
  (let [parts (map #(last (str/split (str %) #"/")) argv)]
    (boolean (some (set forbidden-commands) parts))))

(defn machinery-findings
  "Pure: the breaches in an instrumentation record. Scenario 02 — the assertion
   must come from the wrapper's own record, never from reading driver source,
   so this takes observed events rather than inspecting anything."
  [events]
  (vec (for [{:keys [kind target] :as e} events
             :when (case kind
                     :open (forbidden-path? target)
                     :exec (forbidden-command? (if (coll? target) target [target]))
                     false)]
         (assoc e :breach true))))

;; ── restart ────────────────────────────────────────────────────────────────
;; Scenarios 16/17/18. The asymmetry that matters: teardown BLOCKS, restart
;; does NOT. Use case 1 is fixing a broken swarm workflow, so the start path
;; may itself be what is under repair. A verdict that depended on a clean
;; restart would report failure on completed work and disable the recovery tool
;; exactly when a start-path defect exists.

(defn run-result
  "Pure: combine the ticket verdict and the restart outcome WITHOUT letting the
   restart retract the ticket. Scenario 16.

   exit-code is non-zero when either half failed, but `ticket` stays whatever
   the gates decided, and the two are reported separately so nobody reads a
   failed restart as a failed ticket."
  [{:keys [ticket restart]}]
  (let [ticket-ok? (= :done ticket)
        restart-ok? (or (nil? restart) (= :ok restart))]
    {:ticket ticket
     :ticket-ok? ticket-ok?
     :restart (or restart :not-attempted)
     :restart-ok? restart-ok?
     :exit-code (if (and ticket-ok? restart-ok?) 0 1)
     :failed-half (cond (not ticket-ok?) :ticket
                        (not restart-ok?) :restart
                        :else nil)}))

(def expected-live-set
  "What a healthy full-stack start brings up, as counts. Used to REPORT a delta
   rather than to assert health — scenario 17 requires the report never claim
   what it did not observe."
  {:tmux-servers 1 :handoffd 1 :handoffd-supervisor 1 :role-agents 8})

(defn live-set-delta
  "Pure: observed minus expected, per key. Only keys that differ appear, so an
   empty map means 'matched what we expected' and never 'we asserted health'."
  ([observed] (live-set-delta expected-live-set observed))
  ([expected observed]
   (into {} (for [[k want] expected
                  :let [got (get observed k 0)]
                  :when (not= want got)]
              [k {:expected want :observed got}]))))

(defn parked-report
  "Pure: what initiation parked, for the restart phase to REPORT. Scenario 18 —
   never re-promote: the parked ticket may be stale against what this run
   changed, so promotion stays a human or coordinator decision."
  [parked]
  {:parked (vec parked)
   :still-held (vec (map :ticket parked))
   :promoted []
   :note "left in hold/ deliberately; promotion is not the expeditor's call"})

;; ── stage timeouts ─────────────────────────────────────────────────────────
;; Scenario 15. By stopping the stack the expeditor kills the babysitter and the
;; Operator — the two processes that would otherwise notice it wedging. It has
;; deliberately killed its own watchdog, so it must observe itself.

(def default-stage-timeout-ms (* 45 60 1000))

(defn stage-timeout-verdict
  "Pure: has this stage overrun? Clock is injected — never (System/currentTimeMillis)
   inside a decision, so a fixture can pin one instant."
  [{:keys [started-at-ms now-ms timeout-ms]}]
  (let [budget (or timeout-ms default-stage-timeout-ms)
        elapsed (- (or now-ms 0) (or started-at-ms 0))]
    {:overrun? (>= elapsed budget)
     :elapsed-ms elapsed
     :timeout-ms budget}))
