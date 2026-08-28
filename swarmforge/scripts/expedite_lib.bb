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
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; ── argument parsing ───────────────────────────────────────────────────────
;; Pure, so it lives here and is tested. `value-flags` is the SINGLE source of
;; truth for which flags consume the next argv element: it drives both the strip
;; that finds the positionals and the reads below. Two copies of that knowledge
;; is a latent defect - add a value-taking flag, forget one copy, and its value
;; is silently parsed as the project root.

(def value-flags #{"--bounce-bound" "--stage-timeout-ms"})

(def boolean-flags #{"--override" "--no-restart" "--dry-run"})

(defn flag-value
  "The element after `flag`, or nil. Returns nil rather than the next flag when
   a value is missing, so `--bounce-bound --dry-run` cannot read as bound
   \"--dry-run\"."
  [args flag]
  (let [v (second (drop-while #(not= flag %) args))]
    (when (and v (not (str/starts-with? (str v) "--"))) v)))

(defn positionals
  "argv minus every flag and minus every value-flag's value, in order."
  [args]
  (loop [in (seq args) out []]
    (if (empty? in)
      out
      (let [a (str (first in))
            rest' (rest in)]
        (cond
          (contains? value-flags a) (recur (drop 1 rest') out)
          (str/starts-with? a "--") (recur rest' out)
          :else (recur rest' (conj out a)))))))

(defn parse-args [argv]
  (let [args (vec (map str argv))
        pos (positionals args)]
    {:project-root (first pos)
     :ticket (second pos)
     :override? (boolean (some #{"--override"} args))
     :no-restart? (boolean (some #{"--no-restart"} args))
     :dry-run? (boolean (some #{"--dry-run"} args))
     :bounce-bound (some-> (flag-value args "--bounce-bound") parse-long)
     :stage-timeout-ms (some-> (flag-value args "--stage-timeout-ms") parse-long)}))

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

;; ── stage verdict vocabulary ───────────────────────────────────────────────
;; Found by QA exercising the REAL spawn path: the driver's first vocabulary was
;; `pass` | `bounce` | everything-else-is-failure, and a real documenter session
;; returned `forward` — its documented no-op outcome for an internal change with
;; nothing user-facing to document ("forward the received commit unchanged rather
;; than manufacturing a doc entry"). A legitimate outcome failed the run.
;;
;; Invisible to 53 CLI assertions and 21/21 acceptance, because the fixture stage
;; runner only ever emitted `pass` or `bounce`. The seam encoded the driver
;; author's assumption about role vocabulary instead of the roles' actual
;; vocabulary — the exact class of defect a hand-run at QA is supposed to catch.
;;
;; Kept as data rather than a `case` in the driver so adding a verdict is one edit
;; in one place, and so the mapping is testable without spawning an agent.

(def advance-verdicts
  "Outcomes meaning 'this gate is satisfied, go to the next stage'. `forward` is a
   real role outcome, not a synonym invented here."
  #{:pass :forward :approved})

(def bounce-verdicts
  #{:bounce :send-back :sendback})

(defn classify-verdict
  "Pure: :advance | :bounce | :fail for a stage's reported verdict.

   Fails CLOSED on anything unrecognised — a typo or a new role outcome must stop
   the run loudly rather than be guessed into :advance, which would skip a gate."
  [verdict]
  (let [v (when-not (str/blank? (str verdict))
            (-> verdict name str/lower-case keyword))]
    (cond
      (contains? advance-verdicts v) :advance
      (contains? bounce-verdicts v) :bounce
      :else :fail)))

;; ── BL-1025: the QA hat's verdict, made machine-checkable ──────────────────
;; An expedite run is the SECOND constitutionally sanctioned way pipeline code
;; reaches main ("Same gates, no machinery", BL-567). Its QA hat gives a real
;; advance-or-bounce verdict - but with the swarm stopped there is no live QA
;; worktree, so `swarmforge-QA` never moves and Article 4.2's
;; pipeline-code-on-main check reads every commit of the run as having landed
;; outside QA. Three of BL-1021's did, on 2026-08-21.
;;
;; The fix is not to soften that check. It is to leave the verdict somewhere
;; the shared predicate (is_qa_ancestor.sh - the ONE approval predicate,
;; BL-925 invariant 2) can read: a durable per-sha record, written ONLY here,
;; never hand-authored, and never a substitute for the verdict itself. A
;; commit that merely CLAIMS an expedite run in its subject buys nothing
;; (BL-972).
;;
;; Machine-local under .swarmforge/ and per-month, the same layout and the
;; same reasoning as the bounce store the predicate already consults.

(def expedite-approval-store-dir ".swarmforge/expedite-approvals")

(defn expedite-approval-store-file
  "The store file an ISO-8601 instant belongs in. One file per month, so a
   long-lived repo's store stays greppable and the predicate's per-file
   read stays bounded."
  [at-iso]
  (str expedite-approval-store-dir "/" (subs (str at-iso) 0 7) ".jsonl"))

;; Recorded at the width every other verdict store in this repo uses. The
;; predicate prefix-matches, so a shorter record still resolves - but writing
;; a consistent width keeps the stores readable side by side.
(def ^:private approval-commit-width 10)

(defn qa-hat-verdict-record
  "Pure: the record an expedite stage's verdict leaves behind, or nil when it
   leaves none.

   Only the QA hat's verdict is an approval, so only that stage writes. A
   BOUNCE writes too, deliberately: 'a verdict on file that says no' and 'no
   verdict at all' are different states, and the check must be able to tell
   them apart rather than treat both as absence. Anything that classifies as
   :fail (a timeout, an unrecognised verdict) writes NOTHING - a run that
   fell over approved nothing, and a record is a claim about a gate that
   passed or refused, never about one that never finished."
  [{:keys [stage verdict ticket commit at]}]
  (let [class (classify-verdict verdict)
        sha (str/trim (str commit))]
    (when (and (= "QA" (str stage))
               (contains? #{:advance :bounce} class)
               (seq sha))
      {:at (str at)
       :ticket (str ticket)
       :stage "QA"
       ;; BL-1025 (architect bounce D1): `approval` is the LOAD-BEARING
       ;; field - the already-classified decision, so the reader
       ;; (is_qa_ancestor.sh, a different language with no import across the
       ;; boundary) never re-derives `advance-verdicts` as a hand-copied
       ;; literal. That mirroring is the exact hazard the Guardrails article
       ;; names after BL-897, and a "kept in sync" comment is not a gate.
       ;; The vocabulary now has exactly one spelling, here; a fourth advance
       ;; token added to advance-verdicts needs no second edit anywhere.
       :approval (= :advance class)
       ;; `verdict` stays for a human reading the store, and is deliberately
       ;; NOT what the predicate keys on.
       :verdict (-> verdict name str/lower-case)
       :commit (subs sha 0 (min approval-commit-width (count sha)))})))

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

;; ── BL-1023: run-ticket bookkeeping plan (decided at initiation) ──────────
;; The done-move used to silent-noop when the run ticket was not in active/.
;; That is the DEFAULT for an expedited ticket (specced into paused/, no
;; coordinator to promote). Decide ONCE up front: adopt into active, or
;; refuse — never finish claiming success with the ticket unmoved.

(def run-ticket-folders
  "Folders initiation will look in for the run ticket, in priority order."
  ["active" "paused" "hold"])

(def ^:private adoptable-run-folders #{"paused" "hold"})

(defn- refuse-missing [ticket]
  {:action :refuse :ticket ticket :folder nil
   :message (str "REFUSE run ticket " ticket
                 " was not found in backlog/{active,paused,hold}/"
                 " — cannot bookkeep at teardown")})

(defn- refuse-wrong-folder [ticket folder]
  {:action :refuse :ticket ticket :folder folder
   :message (str "REFUSE run ticket " ticket " is in backlog/" folder
                 "/ — cannot bookkeep at teardown")})

(defn- adopt-from [ticket folder]
  {:action :adopt :ticket ticket :folder folder :from folder :to "active"
   :message (str "ADOPT run ticket " ticket " from backlog/" folder
                 "/ into backlog/active/ so teardown can close it")})

(defn bookkeep-plan
  "Pure: given the folder the run ticket currently lives in (or nil), decide
   how initiation prepares teardown bookkeeping.

   Returns {:action :ready|:adopt|:refuse :ticket :folder ...}."
  [{:keys [folder ticket]}]
  (cond
    (nil? folder) (refuse-missing ticket)
    (= "active" folder) {:action :ready :ticket ticket :folder "active"}
    (contains? adoptable-run-folders folder) (adopt-from ticket folder)
    :else (refuse-wrong-folder ticket folder)))

(defn bookkeep-move-ok?
  "True only when a move-ticket! result reports success. A nil or missing
   :ok? is a failure — the pre-BL-1023 silent no-op shape."
  [move-result]
  (boolean (and (map? move-result) (true? (:ok? move-result)))))

(def forbidden-stop-flags
  "Flags initiation must never pass. --sweep-inbox archives pending handoffs —
   i.e. exactly the parcels a parked ticket needs in order to resume;
   --reset-worktrees reverts role worktrees. Scenario 13."
  #{"--sweep-inbox" "--reset-worktrees" "--full"})

;; ── BL-1030: reading the configured command as a command line ─────────────
;;
;; This guard was vacuous in production for one reason: it took a SEQ of
;; arguments and the only call site had none — it wrapped the whole configured
;; command string in a one-element vector, so the single element ever tested
;; for set membership was the entire command line. `./stop-swarm.sh
;; --sweep-inbox` is not equal to `--sweep-inbox`, so it was admitted, and
;; EXPEDITE_STOP_CMD is documented as a free-form knob whose natural value
;; carries flags. Four tests passed the whole time, because they were written
;; in a shape (`["./stop-swarm.sh" "--sweep-inbox"]`) the caller could not
;; produce.
;;
;; So there is now exactly ONE shape. The predicate takes the command LINE —
;; what EXPEDITE_STOP_CMD holds, and what `bash -lc` is handed — and tokenizes
;; it itself. A caller cannot pass the wrong shape because there is no other
;; shape to pass, and passing the old one throws rather than being coerced.

(def ^:private shell-operator-chars #{\; \& \| \( \) \< \>})
(def ^:private shell-space-chars #{\space \tab \newline \return})

(defn tokenize-command
  "The tokens `bash -lc` would produce for this command line, or nil when they
   cannot be known without running it.

   nil is a verdict, not a failure: an unterminated quote, a dangling escape,
   a parameter expansion or a command substitution all mean the words this line
   becomes depend on something not present here. The guard's whole job is to
   prevent one unrecoverable act, so it must not admit input it cannot read
   (BL-1030 invariant 2, approved 2026-08-22 — fail CLOSED).

   Operators are their own tokens, so `--full;` is a forbidden flag followed by
   a separator rather than a token that merely starts with one; a flag in the
   second half of a compound command is found the same way."
  [cmd]
  (when (string? cmd)
    (loop [cs (seq cmd), state :bare, cur nil, tokens []]
      (let [c (first cs)
            flush (fn [ts] (if (nil? cur) ts (conj ts cur)))]
        (cond
          (nil? c)
          (when (= :bare state) (flush tokens))

          (= :single state)
          (if (= \' c)
            (recur (next cs) :bare cur tokens)
            (recur (next cs) :single (str cur c) tokens))

          (= :double state)
          (cond
            (= \" c) (recur (next cs) :bare cur tokens)
            ;; Only a `$` or a backtick the shell would ACT on is unreadable;
            ;; one the backslash below has already defused is a literal.
            (or (= \$ c) (= \` c)) nil
            (= \\ c) (let [n (second cs)]
                       (cond
                         (nil? n) nil
                         ;; Inside double quotes bash unescapes exactly these
                         ;; four and leaves the backslash in place otherwise.
                         (#{\" \\ \$ \`} n) (recur (nnext cs) :double (str cur n) tokens)
                         :else (recur (nnext cs) :double (str cur c n) tokens)))
            :else (recur (next cs) :double (str cur c) tokens))

          ;; ── bare ──
          (or (= \$ c) (= \` c)) nil
          (= \\ c) (let [n (second cs)]
                     (if (nil? n) nil (recur (nnext cs) :bare (str cur n) tokens)))
          (= \' c) (recur (next cs) :single (or cur "") tokens)
          (= \" c) (recur (next cs) :double (or cur "") tokens)
          (shell-space-chars c) (recur (next cs) :bare nil (flush tokens))
          (shell-operator-chars c) (recur (next cs) :bare nil (conj (flush tokens) (str c)))
          :else (recur (next cs) :bare (str cur c) tokens))))))

(defn stop-invocation-verdict
  "Pure: may initiation run this configured stop command?

   Takes the command LINE. Returns {:ok? true :tokens [...]}, or a refusal
   carrying the reason and enough to name it:
     :forbidden-flag — a token IS one of forbidden-stop-flags. Whole tokens
                       only, so a target path spelling a flag is unaffected.
     :unreadable     — tokenize-command could not say what words it becomes."
  [cmd]
  (when-not (string? cmd)
    (throw (ex-info (str "BL-1030: stop-invocation-verdict takes the configured command LINE, "
                         "not a pre-split argument list - passing the wrong shape is the defect "
                         "this signature exists to prevent")
                    {:got (type cmd) :value cmd})))
  (if-let [tokens (tokenize-command cmd)]
    (if-let [flag (first (filter forbidden-stop-flags tokens))]
      {:ok? false :reason :forbidden-flag :flag flag :command cmd :tokens tokens}
      {:ok? true :command cmd :tokens tokens})
    {:ok? false :reason :unreadable :command cmd}))

(defn stop-invocation-ok?
  "Pure: is this stop invocation safe for a resumable park?"
  [cmd]
  (:ok? (stop-invocation-verdict cmd)))

(defn stop-refusal-message
  "The refusal line, derived from the verdict so the message and the decision
   cannot drift apart. nil for a verdict that admits."
  [{:keys [ok? reason flag command]}]
  (when-not ok?
    (case reason
      :forbidden-flag (str "stop command carries a forbidden flag: " flag " (in: " command ")")
      :unreadable (str "stop command could not be read as a command line, so it is refused"
                       " rather than admitted: " command)
      (str "stop command refused: " command))))

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
        ;; :degraded (start command fine, swarm came up short) is NOT ok — it
        ;; must be loud — but it is reported as its own outcome so nobody
        ;; debugs the start path when the start path worked.
        restart-ok? (boolean (or (nil? restart) (#{:ok :not-attempted} restart)))]
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

;; ── BL-1024: what the run leaves for someone else ──────────────────────────
;; The expeditor may not use handoffd, the mailboxes, tmux, or the coordinator
;; ("machinery it may never use"), so it cannot notify anyone through the
;; swarm. What it PRINTS is its only channel to the next actor - which is why
;; a deferral that never reaches the closing summary is not a deferral, it is
;; a drop.
;;
;; Two deliberate deferrals, neither of which had an owner before this:
;;   - move-ticket! moves with `git mv`, so every backlog move ends the run
;;     STAGED and uncommitted in the SHARED master checkout. Until someone
;;     commits them, main and the working tree disagree about where tickets
;;     live - and any role committing anything else there sweeps them into an
;;     unrelated commit.
;;   - parked tickets are left in backlog/hold/, which Article 3.1 makes
;;     human-held and forbids auto-promoting from. The coordinator may not
;;     restore them even after noticing active/ is empty.
;;
;; On 2026-08-21 the BL-1021 run ended "ticket=done restart=failed", named
;; neither, and the pipeline idled with an empty active/ until a human was
;; told.
;;
;; Pure, and derived from facts the run already holds (the park plan and
;; whether the run ticket moved) rather than tracked a second time.

(def hold-folder "backlog/hold/")

(def parked-tickets-owner
  "a human - Article 3.1 makes backlog/hold/ human-held and forbids the coordinator promoting from it")

(def uncommitted-moves-owner
  "whoever next commits in the master checkout - do it deliberately, or an unrelated commit sweeps them")

(defn- backlog-moves [ticket parked ticket-moved?]
  (cond-> (mapv #(str "backlog/active/ -> " hold-folder "  (" % ")") parked)
    ticket-moved? (conj (str "backlog/active/ -> backlog/done/  (" ticket ")"))))

(defn outstanding-work
  "Pure: every piece of work this run leaves for someone else, each with an
   owner. Empty when there is genuinely nothing - a dry run changed nothing,
   and a run that parked nothing must not manufacture a handover.

   Reported on EVERY ending, including the unhappy ones. A run that bounced
   past its bound, overran a stage, or failed its restart is exactly when the
   leavings matter most, and the failed-restart case is the one that bit."
  [{:keys [ticket parked ticket-moved? dry-run?]}]
  (if dry-run?
    []
    (let [parked (vec (remove nil? parked))
          moves (backlog-moves ticket parked ticket-moved?)]
      (cond-> []
        (seq parked)
        (conj {:subject "the parked tickets"
               :tickets parked
               :folder hold-folder
               :owner parked-tickets-owner})

        (seq moves)
        (conj {:subject "the uncommitted backlog moves"
               :moves (vec moves)
               :owner uncommitted-moves-owner})))))

(defn format-outstanding-summary
  "Pure: the closing summary's text. One `expedite ` prefix per line, matching
   every other line this run prints, so the whole run reads as one voice in a
   terminal."
  [{:keys [items parked]}]
  (let [line (fn [& parts] (str "expedite " (apply str parts)))]
    (if (empty? items)
      (str/join "\n" [(line "OUTSTANDING: nothing outstanding - this run left no work for anyone else")])
      (str/join
       "\n"
       (concat
        [(line "OUTSTANDING - this run left work for someone else:")]
        (mapcat (fn [{:keys [subject tickets folder moves owner]}]
                  (concat
                   [(line "  " subject ":")]
                   (when (seq tickets) [(line "    " (str/join ", " tickets) "  held in " folder)])
                   (map #(line "    " %) (or moves []))
                   [(line "    owner: " owner)]))
                items)
        ;; Honest in the other direction too: a run that parked nothing says
        ;; so out loud rather than leaving the reader to infer it from an
        ;; absent heading.
        (when (empty? parked)
          [(line "  no tickets are held - this run parked nothing")]))))))

;; ── stage timeouts ─────────────────────────────────────────────────────────
;; Scenario 15. By stopping the stack the expeditor kills the babysitter and the
;; Operator — the two processes that would otherwise notice it wedging. It has
;; deliberately killed its own watchdog, so it must observe itself.

;;
;; The value: 90 minutes, ruled 2026-08-22 (BL-1026) against measurement rather
;; than doubling. 45 was demonstrably too tight - run 1 of the BL-1021 expedite
;; killed its coder stage AT the budget while that stage was producing work run
;; 2 then reused from a checkpoint, so the kill cost a stage and bought nothing.
;; The one from-scratch coder stage ever observed therefore needed MORE than 45
;; minutes; run 2's coder, resuming from that checkpoint, took a further 31, so
;; the same work from scratch needed on the order of 76 minutes. 90 clears that
;; single measurement with roughly a fifth in hand, which is the honest claim -
;; not that 90 is the right number for every stage, but that it is above the
;; only from-scratch stage anyone has measured, where 45 was below it.
;;
;; It stays a blunt wall-clock budget on purpose: a progress-aware valve can
;; itself wedge, and this valve exists precisely because the expeditor has
;; killed its own watchdog. Raising it never disarms it - see
;; `stage-timeout-verdict`, whose boundary is `>=`.

(def default-stage-timeout-ms (* 90 60 1000))

(defn stage-timeout-verdict
  "Pure: has this stage overrun? Clock is injected — never (System/currentTimeMillis)
   inside a decision, so a fixture can pin one instant."
  [{:keys [started-at-ms now-ms timeout-ms]}]
  (let [budget (or timeout-ms default-stage-timeout-ms)
        elapsed (- (or now-ms 0) (or started-at-ms 0))]
    {:overrun? (>= elapsed budget)
     :elapsed-ms elapsed
     :timeout-ms budget}))

;; ── missing-verdict recovery ──────────────────────────────────────────────
;; Observed: expedite cleaner (BL-1248) exited 0 after announcing a Monitor wait
;; and never wrote verdict.json; the driver hard-failed :no-verdict. The class
;; is "child exits without a parseable verdict" — not a content fail. One
;; automatic re-invoke closes the hole; a second miss still fails closed.

(defn should-recover-missing-verdict?
  "Pure: one re-invoke when the child exited without a parseable verdict and
   was not timed out / over budget. `attempt` is 0-based."
  [{:keys [timed-out? overrun? parsed attempt]}]
  (and (not timed-out?)
       (not overrun?)
       (nil? parsed)
       (zero? (or attempt 0))))

(defn stage-user-prompt
  "Pure: the claude -p user message. Forbids Monitor/IDE waits so a stage cannot
   park on a notification that never arrives in offline expedite."
  [{:keys [role ticket verdict-file recovery?]}]
  (if recovery?
    (str "RECOVERY: previous " role " session for " ticket
         " exited without writing " verdict-file
         ". Write the stage verdict JSON to that path NOW."
         " Do not wait on Monitor, background jobs, or IDE notifications."
         " Run any remaining checks in the foreground, then write the verdict and exit.")
    (str "You are the " role " for " ticket
         ". Your task is appended to your system prompt."
         " Write your stage verdict as JSON to " verdict-file
         " as your LAST action before the process exits."
         " Do not wait on Monitor, background jobs, or IDE notifications"
         " — run checks in the foreground.")))

(defn finalize-stage-result
  "Pure: map a finished stage invoke onto the driver's verdict record.
   Timeout / overrun beat a missing file; missing parseable JSON is :no-verdict."
  [{:keys [timed-out? overrun? parsed role exit elapsed]}]
  (cond
    (or timed-out? overrun?)
    {:verdict :fail :reason :stage-timeout :stage role :elapsed elapsed
     :killed? (boolean timed-out?)}

    (nil? parsed)
    {:verdict :fail :reason :no-verdict :stage role :exit exit}

    :else
    (assoc parsed :stage role :exit exit :elapsed elapsed
           :verdict (keyword (or (:verdict parsed) "fail")))))

;; ── BL-1026: the stated-budget mirror gate ────────────────────────────────
;; `default-stage-timeout-ms` above is the code. Four places OUTSIDE the code
;; also state it - two usage comments a user reads with `--help` in mind, two
;; documents - and until this gate existed nothing held them together. That is
;; the shape the engineering guardrail names: a constant hand-mirrored across a
;; boundary no import can bridge, where drift fails silently. It did drift: the
;; raise from 45 lived only as an uncommitted working-tree edit while committed
;; main still said 45 in all five places.
;;
;; The gate compares each stated value against the CONSTANT rather than against
;; a second hardcoded literal, so retuning the default needs no edit here - only
;; the four prose sites, which is exactly what it is checking.

(def budget-mirror-sites
  ["swarmforge/scripts/expedite_cli.bb"
   "swarmforge/scripts/expedite.sh"
   "docs/reference/BL-567-expeditor-manual.md"
   "docs/how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md"])

;; Two spellings are in use and both must be read, because a document that
;; states the budget twice can disagree with ITSELF:
;;   `(default 45 min)`            - the usage comments and the how-to table
;;   `` `2700000` (45 min) ``      - the manual, which gives ms AND minutes
;; The leading ms literal is optional and only recognised when it immediately
;; precedes the minutes, so an unrelated backticked number is not mistaken for
;; a budget. A bare "45 min" in prose is not a statement of the default either -
;; it must be parenthesised, which is what every real site does.
(def ^:private budget-statement-re #"(?:`(\d+)`\s+)?\(\s*(?:default\s+)?(\d+)\s+min\)")

(defn budget-statements
  "Pure: every per-stage budget `content` states, in ms, in the order stated.
   A site that gives both an ms literal and a minute count yields BOTH, so a
   document cannot half-update itself and still pass."
  [content]
  (vec
    (mapcat
      (fn [[_ ms-literal minutes]]
        (let [from-minutes (* (parse-long minutes) 60 1000)]
          (if ms-literal
            [(parse-long ms-literal) from-minutes]
            [from-minutes])))
      (re-seq budget-statement-re (or content "")))))

(defn budget-mirror-findings
  "Pure: which readings disagree with the code's budget, and how. A reading is
   `{:site path :content text}`. Stating NOTHING is a finding in its own right -
   deleting the mention is drift too, and a gate that only compares values it
   finds would pass a site that stopped stating one."
  [readings expected-ms]
  (vec
    (mapcat
      (fn [{:keys [site content]}]
        (let [stated (budget-statements content)]
          (if (empty? stated)
            [{:site site :stated-ms nil :expected-ms expected-ms :reason :states-no-budget}]
            (for [s stated :when (not= s expected-ms)]
              {:site site :stated-ms s :expected-ms expected-ms :reason :disagrees}))))
      readings)))

(defn format-budget-mirror-findings
  "Pure: the findings as the text a human acts on. Every finding NAMES its site,
   because 'something disagrees' sends the reader hunting through four files."
  [findings]
  (if (empty? findings)
    (str "OK: every place the expeditor states its default per-stage budget agrees with the code")
    (str/join "\n"
      (cons (str "DRIFT: " (count findings) " stated budget(s) disagree with default-stage-timeout-ms")
            (map (fn [{:keys [site stated-ms expected-ms reason]}]
                   (if (= reason :states-no-budget)
                     (str "  " site " states no per-stage budget at all (expected " expected-ms " ms)")
                     (str "  " site " states " stated-ms " ms, the code says " expected-ms " ms")))
                 findings)))))

(defn read-budget-mirrors
  "The one impure step: read each stated site under `root`. A site that is
   missing reads as empty content, so it surfaces as :states-no-budget rather
   than vanishing from the gate."
  [root]
  (mapv (fn [rel]
          (let [f (str (fs/path root rel))]
            {:site rel :content (if (fs/exists? f) (slurp f) "")}))
        budget-mirror-sites))
