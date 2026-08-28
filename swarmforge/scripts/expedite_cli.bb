#!/usr/bin/env bb
;; expedite_cli.bb — BL-567: the expeditor driver. Takes ONE ticket through
;; every pipeline gate with the swarm STOPPED, depending on none of the swarm's
;; runtime machinery.
;;
;; Every judgement lives in expedite_lib.bb; this file is IO and orchestration.
;; If you find yourself writing a `cond` here that decides something, it belongs
;; in the lib where it can be tested without a swarm.
;;
;; FORBIDDEN by this ticket's hard requirement, and absent by inspection:
;; handoffd, handoffd_supervisor, sync-deliver, swarm_handoff.bb, the
;; .swarmforge/handoffs/ mailboxes, tmux sessions/panes/wake injection,
;; rotate_to_role, ready_for_next, the coordinator, chase, the babysitter.
;; It DOES command their lifecycle (stop at the start, start at the end) —
;; commanding a thing's lifecycle is the opposite of depending on it.
;;
;; Usage:
;;   expedite_cli.bb <project-root> <BL-id> [options]
;;     --override            proceed even though the swarm is live (logged)
;;     --bounce-bound N      raise/lower the per-stage bound (default 3)
;;     --stage-timeout-ms N  per-stage budget (default 90 min)
;;     --no-restart          skip the final restart phase
;;     --dry-run             plan and print; touch nothing
;;
;; TEST SEAMS (env vars, same convention as SWARMFORGE_COST_RANK_NOW_MS's
;; injectable clock). Each is a seam, never an override of a gate:
;;   EXPEDITE_PROBE_FILE   JSON probe result instead of probing live processes
;;   EXPEDITE_STAGE_RUNNER script called per stage instead of spawning claude
;;   EXPEDITE_STOP_CMD     stop command (default ./stop-swarm.sh)
;;   EXPEDITE_START_CMD    start command (default ./start-swarm.sh)
;;   EXPEDITE_NOW_MS       pin the clock
;;   EXPEDITE_ANNOUNCE_CMD shell command for each milestone (BL-656); default
;;                         posts to the Operator topic via notify-expedite-milestone.js
;;                         Line text is passed in EXPEDITE_ANNOUNCE_LINE.

(ns expedite-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path scripts-dir "expedite_lib.bb")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))
(load-file (str (fs/path scripts-dir "expedite_progress_lib.bb")))
;; BL-1103: one shared wall-clock-bounded runner (was a private copy here).
(load-file (str (fs/path scripts-dir "bounded_run_lib.bb")))
(load-file (str (fs/path scripts-dir "expedite_announce_lib.bb")))

;; ── args ──────────────────────────────────────────────────────────────────

;; parse-args, flag-value and positionals moved to expedite_lib.bb by the cleaner
;; pass: they are pure decisions, they were untested here, and the set of
;; value-taking flags was duplicated between the positional strip and the reads -
;; a latent defect where a forgotten entry makes a flag's value parse as the
;; project root.

;; ── plumbing ──────────────────────────────────────────────────────────────

(defn- now-ms []
  (or (some-> (System/getenv "EXPEDITE_NOW_MS") parse-long)
      (System/currentTimeMillis)))

(defn- sh [opts & cmd]
  (apply process/sh (assoc opts :continue true) cmd))

;; BL-1103: private name kept at call sites; body lives in bounded_run_lib.bb.
;; The expeditor needs an ENFORCED bound (not a post-hoc report): by stopping
;; the stack it has killed the babysitter and Operator that would otherwise
;; notice it wedging.
(defn- sh-bounded [& args]
  (apply bounded-run-lib/run-bounded! args))

(defn- log! [& parts]
  (println (str "expedite " (str/join " " (map str parts)))))

(defn- default-announce-cmd [project-root]
  (str "node extension/out/tools/notify-expedite-milestone.js "
       (pr-str (str project-root))))

(defn- invoke-announce! [project-root line]
  (when-not (str/blank? line)
    (let [cmd (or (System/getenv "EXPEDITE_ANNOUNCE_CMD")
                  (default-announce-cmd project-root))]
      (try
        (let [{:keys [exit err]} (sh {:dir (str project-root)
                                      :extra-env {"EXPEDITE_ANNOUNCE_LINE" line}}
                                     "bash" "-lc" cmd)]
          (when (pos? exit)
            (log! "WARNING announce delivery failed:" (str/trim (or err "")))))
        (catch Exception e
          (log! "WARNING announce delivery failed:" (.getMessage e)))))))

(defn- announce-milestone! [{:keys [project-root ticket]} payload]
  (when-let [line (expedite-announce-lib/format-milestone (assoc payload :ticket ticket))]
    (invoke-announce! project-root line)))

(defn- write-json! [path data]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (json/generate-string data {:pretty true}) "\n")))

;; ── BL-1024: the leavings register, and the one way out ────────────────
;; The closing summary used to be computed at the TAIL of -main's let chain,
;; which every happy-ish ending falls through. Three PRE-FLIGHT refusals do
;; not: a forbidden stop flag, a teardown that never reached a clean slate,
;; and a run worktree that could not be created each terminated the process
;; from inside a helper, several frames below the code that reports. All three
;; sit strictly AFTER park-others! has staged real `git mv` moves - so each one
;; ended with sibling tickets genuinely parked in the shared master checkout
;; and nothing saying so. That is the 2026-08-21 incident this ticket exists to
;; fix, reached by a different trigger and on the COMMON path: a host running a
;; live swarm refuses teardown unless --override, and that is every host this
;; pipeline actually runs on.
;;
;; So the leavings are REGISTERED the instant they come into existence, refined
;; when more becomes known, and reported by the single exit every path goes
;; through. One exit point is the point: it makes "every ending reports its
;; leavings" structural rather than a convention the next early return forgets.
;; test_expedite_cli.sh asserts, from the source, that this file still holds
;; exactly one.

(def ^:private leavings
  "What this run has left for someone else, as far as it has got. nil until
   something is actually left, so a run that exits before parking reports
   nothing rather than an empty handover."
  (atom nil))

(defn- register-leavings! [facts] (reset! leavings facts))

(defn- note-ticket-moved! [moved?]
  (swap! leavings #(some-> % (assoc :ticket-moved? moved?))))

(defn- outstanding-now
  "The leavings as of right now. One derivation, read by both the terminal
   summary and the run record, so the two can never disagree."
  []
  (when-let [{:keys [ticket parked ticket-moved? dry-run?]} @leavings]
    (expedite-lib/outstanding-work {:ticket ticket :parked parked
                                    :ticket-moved? ticket-moved? :dry-run? dry-run?})))

(defn- report-leavings! [exit-code]
  (when-let [{:keys [run-dir ticket parked park]} @leavings]
    (let [items (outstanding-now)
          run-json (fs/path run-dir "run.json")]
      ;; A refused run never reaches -main's tail, so nothing has written
      ;; run.json for it. The run's only two channels to the next actor are
      ;; what it prints and what it writes; terminal text scrolls away, so the
      ;; leavings ride both. -main's own record is richer, so never overwrite
      ;; one that is already there.
      (when-not (fs/exists? run-json)
        (write-json! run-json {:outcome "refused"
                               :exit-code exit-code
                               :ticket-id ticket
                               :park park
                               :outstanding items
                               :finished-at-ms (now-ms)}))
      (println (expedite-lib/format-outstanding-summary {:items items :parked parked})))))

(defn- exit!
  "The ONLY way this process ends. Reports the leavings first - a run that
   ended badly is exactly when they matter most."
  [code]
  (report-leavings! code)
  (System/exit code))

(defn usage! []
  (binding [*out* *err*]
    (println "Usage: expedite_cli.bb <project-root> <BL-id> [--override] [--bounce-bound N] [--stage-timeout-ms N] [--no-restart] [--dry-run]"))
  (exit! 2))

(defn- now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

;; BL-1025: the impure half of expedite-lib/qa-hat-verdict-record - append the
;; QA hat's verdict where is_qa_ancestor.sh can read it. Written into the
;; PROJECT root, not the run worktree: the store is a fact about this repo's
;; approvals, and the worktree is torn down. Appended (never rewritten) so a
;; second run never erases the first run's verdicts.
;;
;; The sha recorded is the run worktree's HEAD at the instant the QA hat gave
;; its verdict - the commit that hat actually looked at. A worktree whose HEAD
;; cannot be read records nothing, rather than a record naming the wrong
;; commit: a verdict store that can be wrong is worse than one with a gap,
;; because the gap only costs a false CRIT while a wrong record waves real
;; work through.
(defn- worktree-head [dir]
  (let [{:keys [exit out]} (sh {:dir (str dir)} "git" "rev-parse" "HEAD")]
    (when (zero? exit) (str/trim out))))

(defn- record-qa-hat-verdict! [{:keys [project-root ticket dry-run?]} {:keys [dir]} stage res]
  (when-not dry-run?
    (when-let [record (expedite-lib/qa-hat-verdict-record
                       {:stage stage
                        :verdict (:verdict res)
                        :ticket ticket
                        :commit (worktree-head dir)
                        :at (now-iso)})]
      (let [f (fs/path project-root (expedite-lib/expedite-approval-store-file (:at record)))]
        (fs/create-dirs (fs/parent f))
        (spit (str f) (str (json/generate-string record) "\n") :append true)
        (log! "recorded QA-hat verdict" (:verdict record) "for" (:commit record) "->" (str f))
        record))))

(defn- write-progress! [run-dir ticket stage status & [detail]]
  (write-json! (fs/path run-dir "progress.json")
               {:ticket ticket
                :stage (name stage)
                :status (name status)
                :detail (str (or detail ""))
                :line (expedite-progress-lib/format-progress-line
                       {:ticket ticket :stage stage :status status :detail detail})
                :updated-at-ms (now-ms)}))

;; ── liveness probe (real) ─────────────────────────────────────────────────
;; The socket FILE is deliberately not consulted as a signal. We glob to find
;; CANDIDATE sockets, then ask each whether a server answers - the measured
;; 2026-07-25 case is a stopped swarm whose socket file still exists.

(defn- pids-matching
  "Live pids whose argv matches `needle`, excluding this process's own argv so
   the audit cannot invent phantom survivors (pgrep -f self-matches)."
  [needle]
  (let [{:keys [out]} (sh {} "ps" "-eo" "pid=,args=")
        self (str (.pid (java.lang.ProcessHandle/current)))]
    (->> (str/split-lines (or out ""))
         (remove str/blank?)
         (keep (fn [line]
                 (let [t (str/trim line)
                       [pid & _] (str/split t #"\s+")
                       argv (str/replace-first t (str pid) "")]
                   (when (and (not= pid self)
                              (str/includes? argv needle)
                              (not (str/includes? argv "expedite_cli.bb")))
                     pid))))
         vec)))

(defn- tmux-servers-answering [project-root]
  (let [socks (try (vec (fs/glob (fs/path project-root ".swarmforge" "tmux") "*.sock"))
                   (catch Exception _ []))]
    (count (filter (fn [s]
                     (zero? (:exit (sh {} "tmux" "-S" (str s) "list-sessions"))))
                   socks))))

(defn probe-liveness [project-root]
  (if-let [f (System/getenv "EXPEDITE_PROBE_FILE")]
    (json/parse-string (slurp f) true)
    (let [root (str project-root)]
      {:tmux-servers-answering (tmux-servers-answering project-root)
       ;; Root-scoped needles only — bare script names match every swarm on the
       ;; host (BL-782). "handoffd.bb " (trailing space) avoids the supervisor
       ;; script name, which still contains the substring "handoffd.bb".
       :handoffd (seq (pids-matching (str "handoffd.bb " root)))
       :handoffd-supervisor (seq (pids-matching (str "handoffd_supervisor.bb " root)))
       :babysitterd (seq (pids-matching (str "babysitterd.sh " root)))
       ;; --remote-control Operator has no project root in argv; scope via the
       ;; prompt path launch_operator.sh always passes for this root.
       :operator (seq (pids-matching (str root "/swarmforge/roles/operator.prompt")))
       :role-agents (count (pids-matching (str root "/.swarmforge/launch/")))})))

;; NOTE: tmux-servers-answering shells `tmux`, which expedite_lib's own
;; forbidden-command? would flag. That is correct and intended: PROBING whether
;; a server answers is how we establish the swarm is down, and it is the one
;; tmux call the instrumentation wrapper must whitelist. The wrapper's scenario
;; asserts no tmux SESSION work; a liveness probe is not session work. Stated
;; here so nobody "fixes" it into a socket-file glob and reintroduces BL-567's
;; original false positive.

;; ── backlog bookkeeping (minimal, reimplemented — never coordinator code) ──

(defn- backlog-dir [project-root sub] (fs/path project-root "backlog" sub))

(defn- ticket-file [project-root sub ticket]
  (first (filter #(str/starts-with? (fs/file-name %) (str ticket "-"))
                 (try (vec (fs/glob (backlog-dir project-root sub) "*.yaml"))
                      (catch Exception _ [])))))

(defn ticket-id-from-filename
  "`BL-567-expeditor-offline.yaml` -> `BL-567`. Splitting on the first dash
   yields `BL`, which silently makes every ticket look like the same id — the
   run's own ticket then fails to match and gets parked by its own initiation."
  [filename]
  (second (re-find #"^(BL-\d+)" (str filename))))

(defn- active-ticket-ids [project-root]
  (->> (try (vec (fs/glob (backlog-dir project-root "active") "*.yaml")) (catch Exception _ []))
       (keep #(ticket-id-from-filename (fs/file-name %)))
       vec))

(defn- move-ticket! [project-root ticket from to]
  ;; BL-1023: never silent-no-op. Callers need :ok? false when the source is
  ;; missing — discarding nil used to let a paused run ticket "pass" unmoved.
  (if-let [src (ticket-file project-root from ticket)]
    (let [dst (fs/path (backlog-dir project-root to) (fs/file-name src))]
      (fs/create-dirs (backlog-dir project-root to))
      (sh {:dir (str project-root)} "git" "mv"
          (str (fs/relativize project-root src)) (str (fs/relativize project-root dst)))
      {:ok? true :path (str dst) :ticket ticket :from from :to to})
    {:ok? false :ticket ticket :from from :to to}))

(defn- must-move-ticket!
  "Move or refuse loudly. Replaces the pre-BL-1023 silent when-let no-op."
  [project-root ticket from to & fail-parts]
  (let [moved (move-ticket! project-root ticket from to)]
    (when-not (expedite-lib/bookkeep-move-ok? moved)
      (apply log! fail-parts)
      (exit! 1))
    moved))

(defn- locate-run-ticket-folder [project-root ticket]
  (some (fn [sub] (when (ticket-file project-root sub ticket) sub))
        expedite-lib/run-ticket-folders))

(defn- apply-bookkeep-plan!
  [{:keys [project-root ticket dry-run?]} plan]
  (case (:action plan)
    :refuse (do (log! (:message plan)) (exit! 1))
    :adopt
    (do (log! (:message plan))
        (when-not dry-run?
          (must-move-ticket!
           project-root ticket (:from plan) "active"
           "REFUSE could not adopt run ticket" ticket
           "from backlog/" (:from plan) "/")))
    :ready nil
    (do (log! "REFUSE unrecognized bookkeep action" (pr-str (:action plan)))
        (exit! 1))))

(defn- ensure-run-ticket-bookkeepable!
  "BL-1023: decide at initiation whether teardown can close the run ticket.
   Adopt from paused/hold into active when needed; refuse when missing."
  [{:keys [project-root ticket] :as opts}]
  (let [folder (locate-run-ticket-folder project-root ticket)
        plan (expedite-lib/bookkeep-plan {:folder folder :ticket ticket})]
    (log! "bookkeep" (pr-str (select-keys plan [:action :ticket :folder])))
    (apply-bookkeep-plan! opts plan)
    plan))

(defn- role-branch-tips [project-root]
  (let [{:keys [out]} (sh {:dir (str project-root)} "git" "branch" "--format=%(refname:short) %(objectname:short)")]
    (into {} (for [line (str/split-lines (or out ""))
                   :let [[b sha] (str/split (str/trim line) #"\s+")]
                   :when (and b (str/starts-with? b "swarmforge-"))]
               [b sha]))))

;; ── initiation ────────────────────────────────────────────────────────────

(defn park-others! [{:keys [project-root ticket dry-run?]} run-dir]
  (let [plan (expedite-lib/park-plan {:active-tickets (active-ticket-ids project-root)
                                      :run-ticket ticket})]
    (when-not (:nothing-to-park? plan)
      (let [record {:parked-at-ms (now-ms)
                    :destination (:destination plan)
                    :tickets (vec (:park plan))
                    :role-branch-tips (role-branch-tips project-root)
                    :why (str "parked by the expeditor to free the pipeline for " ticket)}]
        (doseq [t (:park plan)]
          (log! "park" t "->" (str "backlog/" (:destination plan) "/"))
          (when-not dry-run?
            (must-move-ticket!
             project-root t "active" (:destination plan)
             "REFUSE could not park" t "from backlog/active/")))
        (when-not dry-run? (write-json! (fs/path run-dir "park-record.json") record)))
      (announce-milestone! {:project-root project-root :ticket ticket}
                           {:kind :park
                            :parked (vec (:park plan))
                            :destination (:destination plan)}))
    ;; BL-1024: registered AFTER the moves, so the register records what was
    ;; actually done rather than what was planned. Everything downstream of
    ;; this line may refuse and exit, and every one of those exits now reports
    ;; what is already parked and staged.
    (register-leavings! {:run-dir run-dir
                         :ticket ticket
                         :parked (vec (:park plan))
                         :ticket-moved? false
                         :dry-run? (boolean dry-run?)
                         :park plan})
    plan))

(defn configured-stop-command
  "What initiation would run to stop the stack. One source, read by the guard
   and by the runner, so the line that is CHECKED is the line that RUNS."
  []
  (or (System/getenv "EXPEDITE_STOP_CMD") "./stop-swarm.sh"))

(defn stop-stack! [{:keys [project-root dry-run?]} cmd]
  ;; No guard here any more. BL-1030 moved it into initiate!, ahead of
  ;; park-others!, because a check that only has to read an env var has no
  ;; reason to have parked half the backlog first — and because a guard
  ;; downstream of the parking is a guard whose refusal is never free.
  ;; The command is handed IN, already checked, so this cannot run a line the
  ;; guard did not see.
  (if dry-run?
    {:exit-code 0 :dry-run true}
    (let [{:keys [exit out err]} (sh {:dir (str project-root)} "bash" "-lc" cmd)]
      {:exit-code exit :out (str out) :err (str err)})))

;; ONE gate, in order: probe -> stop (initiation's job) -> re-probe -> refuse.
;;
;; The ticket specified this as two separate things and they contradicted each
;; other. Its interlock said "refuses to start if the swarm is live", justified by
;; "one ticket, one writer; no worktree contention" — while the operator's
;; lifecycle ruling made stopping the swarm part of INITIATION. Both cannot hold:
;; a gate that refuses a live swarm outright can never reach the teardown that
;; was supposed to bring it down.
;;
;; Resolved in favour of the rationale rather than the wording. The concern is
;; CONTENTION, not liveness as such, so: find it live, stop it, verify. Refuse
;; only when the swarm is live AND the stop path could not bring it down — which
;; is genuinely unresolved contention. This collapses the ticket's scenario 09 and
;; scenario 14 into one verified mechanism instead of two gates where the first
;; makes the second unreachable.

(defn initiate! [{:keys [project-root ticket override? dry-run?] :as opts} run-dir]
  (let [probe0 (probe-liveness project-root)
        live0 (expedite-lib/liveness-verdict probe0)]
    (log! "liveness" (pr-str live0))
    (when-not (:stopped? live0)
      (log! "swarm is live:" (str/join "," (:alive live0)) "- initiation will stop it"))
    ;; BL-1030: decided FIRST, before anything is parked. The old order left a
    ;; refusal exiting with every other active ticket already moved to
    ;; backlog/hold/ — residue from a check that needed nothing but an env var
    ;; to reach its verdict. A refusal now costs nothing: nothing has moved,
    ;; and the stop command has not run.
    (let [stop-cmd (configured-stop-command)
          stop-check (expedite-lib/stop-invocation-verdict stop-cmd)]
      (when-not (:ok? stop-check)
        (let [msg (expedite-lib/stop-refusal-message stop-check)]
          (announce-milestone! opts {:kind :initiation-refuse :survivors [] :reason msg})
          (log! "REFUSE" msg)
          (exit! 1)))
      ;; One binding, so the line that was CHECKED is the line that RUNS.
      ;; BL-1023: adopt (or refuse) the run ticket BEFORE parking siblings, so
      ;; teardown's active→done move has a source and the operator hears any
      ;; refusal before seven stages spend.
      (let [bookkeep (ensure-run-ticket-bookkeepable! opts)
            plan (park-others! opts run-dir)
            stop (stop-stack! opts stop-cmd)
            ;; Re-probe unconditionally. In dry-run the verdict is computed and
            ;; logged but not enforced, so a dry-run still TELLS you the teardown
            ;; would not have reached a clean slate instead of hiding it.
            probe1 (probe-liveness project-root)
            verdict (expedite-lib/teardown-verdict stop probe1)]
        (log! "teardown" (pr-str verdict))
        (when (:exit-code-lied? verdict)
          (log! "the stop command exited 0 but these survived:" (str/join "," (:alive verdict))))
        ;; --override is ONE decision - "run despite a live swarm" - so it covers
        ;; this gate too. Gating only the start check would leave the teardown
        ;; check refusing every overridden run, which makes the override dead and
        ;; is worse than not having it: an operator who cannot override reaches for
        ;; something cruder.
        (when-not (or dry-run? override? (:clean? verdict))
          (announce-milestone! opts {:kind :initiation-refuse
                                     :survivors (:alive verdict)
                                     :reason "teardown did not reach a clean slate"})
          (log! "REFUSE teardown did not reach a clean slate:" (str/join "," (:alive verdict)))
          (log! "remedy: stop the named processes by hand, or pass --override")
          (exit! 1))
        (when (and override? (not (:clean? verdict)))
          (log! "WARNING override in force; proceeding with these alive:"
                (str/join "," (:alive verdict))))
        (announce-milestone! opts {:kind :initiation-ok
                                   :was-live? (not (:stopped? live0))})
        {:gate {:override-used? (boolean (and override? (not (:clean? verdict))))
                :was-live? (not (:stopped? live0))
                :alive-before (:alive live0)}
         :bookkeep bookkeep
         :park plan
         :teardown verdict}))))

;; ── worktree ──────────────────────────────────────────────────────────────

(defn ensure-worktree! [{:keys [project-root ticket dry-run?]}]
  (let [branch (str "expedite/" ticket)
        dir (fs/path project-root ".worktrees" (str "expedite-" ticket))]
    (when-not (or dry-run? (fs/exists? dir))
      (let [{:keys [exit err]} (sh {:dir (str project-root)} "git" "worktree" "add" "-b" branch (str dir) "main")]
        (when-not (zero? exit)
          (log! "REFUSE could not create the run worktree:" (str/trim (str err)))
          (exit! 1))))
    (log! "worktree" (str dir) "on" branch)
    {:branch branch :dir (str dir)}))

;; ── stages ────────────────────────────────────────────────────────────────

(defn- settings-path [project-root role]
  (let [p (fs/path project-root ".swarmforge" "launch" (str role ".claude-settings.json"))]
    (when (fs/exists? p) (str p))))

(defn compose-prompt!
  "Compose this role's system prompt FRESH via PromptEngine. Never reads
   .swarmforge/prompts/<role>.md: that is a build output (stale between
   launches, absent on a bare host) and BL-546 makes PromptEngine the single
   authority. `task` becomes :task-injection, which lands AFTER the stable
   chunk so the prompt cache hits across stages and bounces."
  [role task out-path]
  (let [{:keys [system-prompt]} (prompt-engine-lib/compose role {:agent "claude"
                                                                 :task-injection task
                                                                 :deterministic? true})]
    (fs/create-dirs (fs/parent out-path))
    (spit (str out-path) system-prompt)
    (str out-path)))

(defn- parse-verdict-file
  "Nil when timed out, absent, or unparseable — never throws into the driver."
  [verdict-file timed-out?]
  (when (and (not timed-out?) (fs/exists? verdict-file))
    (try (json/parse-string (slurp verdict-file) true) (catch Exception _ nil))))

(defn- clear-verdict-file!
  "Drop a stale/partial verdict before a recovery re-invoke."
  [verdict-file]
  (when (fs/exists? verdict-file)
    (fs/delete verdict-file)))

(defn- stage-cmd
  [runner settings role ticket prompt-file verdict-file transcript attempt]
  (let [recovery? (pos? attempt)
        user (expedite-lib/stage-user-prompt
              {:role role :ticket ticket :verdict-file verdict-file
               :recovery? recovery? :attempt attempt})]
    (if runner
      ["bash" runner role ticket prompt-file verdict-file transcript]
      (concat ["claude" "-p"]
              (when settings ["--settings" settings])
              ["--append-system-prompt-file" prompt-file
               "--dangerously-skip-permissions"
               user]))))

(defn- invoke-stage-once!
  "Spawn one stage child. Returns {:exit :timed-out? :elapsed :parsed}."
  [{:keys [dir budget started transcript err-file cmd verdict-file]}]
  (let [{:keys [exit timed-out?]}
        (apply sh-bounded {:dir dir
                           :extra-env {"ANTHROPIC_API_KEY" "" "ANTHROPIC_AUTH_TOKEN" ""}}
               budget transcript err-file cmd)
        elapsed (expedite-lib/stage-timeout-verdict {:started-at-ms started
                                                     :now-ms (now-ms)
                                                     :timeout-ms budget})]
    {:exit exit
     :timed-out? timed-out?
     :elapsed elapsed
     :parsed (parse-verdict-file verdict-file timed-out?)}))

(defn run-stage!
  "One stage. Returns {:verdict :pass|:bounce|:fail ...}.

   The stage runner is a seam: EXPEDITE_STAGE_RUNNER replaces spawning claude,
   so every scenario can seed a gate outcome without a model in the loop. Both
   paths receive the same argv shape, so the test path exercises the real
   contract rather than a parallel one.

   Missing-verdict recovery: up to two re-invokes with escalating prompts that
   demand a written pass|bounce|fail. Still-missing after that fails closed —
   never a synthesized bounce."
  [{:keys [project-root ticket stage-timeout-ms]} {:keys [dir]} role task stage-dir]
  (let [prompt-file (compose-prompt! role task (fs/path stage-dir "prompt.md"))
        _ (spit (str (fs/path stage-dir "task.txt")) task)
        transcript (str (fs/path stage-dir "transcript.jsonl"))
        verdict-file (str (fs/path stage-dir "verdict.json"))
        settings (settings-path project-root role)
        started (now-ms)
        runner (System/getenv "EXPEDITE_STAGE_RUNNER")
        budget (or stage-timeout-ms expedite-lib/default-stage-timeout-ms)
        err-file (str (fs/path stage-dir "stderr.log"))]
    (loop [attempt 0]
      (let [cmd (stage-cmd runner settings role ticket prompt-file verdict-file
                           transcript attempt)
            {:keys [exit timed-out? elapsed parsed]}
            (invoke-stage-once! {:dir dir :budget budget :started started
                                 :transcript transcript :err-file err-file
                                 :cmd cmd :verdict-file verdict-file})
            recover? (expedite-lib/should-recover-missing-verdict?
                      {:timed-out? timed-out?
                       :overrun? (:overrun? elapsed)
                       :parsed parsed
                       :attempt attempt})]
        (if recover?
          (do (log! "no-verdict recovery" role "attempt" (inc attempt)
                    "of" expedite-lib/max-missing-verdict-recoveries)
              (clear-verdict-file! verdict-file)
              (recur (inc attempt)))
          (expedite-lib/finalize-stage-result
           {:timed-out? timed-out?
            :overrun? (:overrun? elapsed)
            :parsed parsed
            :role role
            :exit exit
            :elapsed elapsed
            :attempt attempt}))))))

(defn drive-stages!
  "Walk the chain, honouring bounces. Bounce accounting and the meaning of
   exhaustion both come from the lib."
  [{:keys [ticket bounce-bound] :as opts} worktree run-dir stages]
  (let [{:keys [bound] :as bound-info} (expedite-lib/bound-in-force bounce-bound)
        bounces (atom {})
        history (atom [])]
    (log! "bounce bound" bound (if (:raised? bound-info) "(RAISED explicitly)" "(default)"))
    (loop [stage (first stages) n 0]
      (cond
        (nil? stage) {:ticket :done :bounces @bounces :history @history :bound bound-info}

        (< 40 n) {:ticket :failed :reason :driver-step-cap :bounces @bounces :history @history :bound bound-info}

        :else
        (let [idx (count @history)
              stage-dir (fs/path run-dir (format "%02d-%s" idx stage))
              _ (write-progress! run-dir ticket stage :running (str "stage " (inc idx) "/" (count stages)))
              task (str "Ticket " ticket ". You are the " stage " stage of an offline expedited run. "
                        "Run checks in the foreground; never stand by for Monitor, background jobs, or IDE notifications; "
                        "write a pass/bounce/fail verdict.json as your last action before exit."
                        (when-let [b (seq (get @bounces stage))]
                          (str " This is a rework after " (count b) " bounce(s): "
                               (str/join "; " (map :reason b)))))
              _ (announce-milestone! opts {:kind :stage-entered
                                          :stage stage
                                          :idx (inc idx)
                                          :total (count stages)})
              res (run-stage! opts worktree stage task stage-dir)
              prior-bounces (get @bounces stage [])
              bounce-round (when (= :bounce (expedite-lib/classify-verdict (:verdict res)))
                             (inc (count prior-bounces)))]
          (announce-milestone! opts {:kind :stage-verdict
                                     :stage stage
                                     :verdict (:verdict res)
                                     :round bounce-round
                                     :reason (or (:reason res) (:class res))
                                     :evidence-path (:evidence-path res)})
          (write-progress! run-dir ticket stage
                           (case (expedite-lib/classify-verdict (:verdict res))
                             :advance :passed
                             :bounce :bounced
                             :fail :failed
                             :failed)
                           (str "verdict=" (name (:verdict res))
                                (when-let [r (:reason res)] (str " reason=" (name r)))))
          (swap! history conj (select-keys res [:stage :verdict :reason :class]))
          (write-json! (fs/path stage-dir "verdict.json") res)
          ;; BL-1025: a no-op for every stage but QA, and for a QA stage that
          ;; failed rather than ruled - see qa-hat-verdict-record.
          (record-qa-hat-verdict! opts worktree stage res)
          (case (expedite-lib/classify-verdict (:verdict res))
            :advance (recur (expedite-lib/next-stage stages stage) (inc n))

            :bounce
            (if-not (expedite-lib/bounce-payload-valid? res)
              (do (log! "REFUSE bounce-without-reason" stage
                        "- a bounce must carry an actionable reason or class")
                  {:ticket :failed :reason :bounce-without-reason
                   :stage stage :verdict (:verdict res)
                   :bounces @bounces :history @history :bound bound-info})
              (let [target (or (:target res) "coder")
                    prior (get @bounces stage [])
                    decision (expedite-lib/bounce-decision {:stage stage :bounces prior :bound bound})]
                (if (= :retry (:action decision))
                  (do (swap! bounces update stage (fnil conj []) (select-keys res [:reason :class]))
                      (log! "bounce" stage "round" (:round decision) "-> re-enter" target)
                      (recur target (inc n)))
                  (let [report (expedite-lib/exhaustion-report
                                {:stage stage :bounces (get @bounces stage)})]
                    (log! "EXHAUSTED" (pr-str report))
                    {:ticket :failed :reason :bounce-bound-exhausted
                     :exhaustion report :bounces @bounces :history @history :bound bound-info}))))

            :fail
            {:ticket :failed :reason (or (:reason res) :stage-failed)
             :stage stage :verdict (:verdict res)
             :bounces @bounces :history @history :bound bound-info}))))))

;; ── restart (non-blocking) ────────────────────────────────────────────────

(defn observe-live-set [project-root]
  (let [p (probe-liveness project-root)]
    {:tmux-servers (or (:tmux-servers-answering p) 0)
     :handoffd (if (:handoffd p) 1 0)
     :handoffd-supervisor (if (:handoffd-supervisor p) 1 0)
     :role-agents (or (:role-agents p) 0)}))

(defn restart-stack!
  "The final phase. It reports; it never gates the ticket verdict. Use case 1 is
   fixing a broken swarm workflow, so the start path may itself be what was under
   repair — a verdict that depended on a clean restart would report failure on
   completed work."
  [{:keys [project-root no-restart? dry-run?]}]
  (if (or no-restart? dry-run?)
    {:outcome :not-attempted}
    (let [cmd (or (System/getenv "EXPEDITE_START_CMD") "./start-swarm.sh")
          {:keys [exit err]} (sh {:dir (str project-root)} "bash" "-lc" cmd)
          delta (expedite-lib/live-set-delta (observe-live-set project-root))]
      ;; Three outcomes, not two. :failed means the START COMMAND failed;
      ;; :degraded means it succeeded and the swarm came up short. Collapsing
      ;; them would report a half-started swarm as a broken start path and send
      ;; a human to debug the wrong thing. Both are loud and neither retracts
      ;; the ticket verdict.
      {:outcome (cond (not (zero? exit)) :failed
                      (seq delta) :degraded
                      :else :ok)
       :exit exit
       :error (when-not (zero? exit) (str/trim (str err)))
       :live-set-delta delta})))

;; ── main ──────────────────────────────────────────────────────────────────

(defn -main [& argv]
  (let [{:keys [project-root ticket] :as opts} (expedite-lib/parse-args argv)]
    (when (or (str/blank? (str project-root)) (str/blank? (str ticket))) (usage!))
    (let [root (str (fs/canonicalize project-root))
          opts (assoc opts :project-root root)
          run-dir (fs/path root ".swarmforge" "expedite" ticket)
          _ (fs/create-dirs run-dir)
          _ (write-progress! run-dir ticket :init :running "teardown + worktree")
          init (initiate! opts run-dir)
          worktree (ensure-worktree! opts)
          stages (expedite-lib/stages-for {})
          staged (drive-stages! opts worktree run-dir stages)
          ;; BL-1023: ticket-moved? tracks the MOVE RESULT, never stages :done
          ;; alone — a when-let no-op used to leave this true while the file
          ;; sat unmoved in paused/.
          ticket-moved?
          (boolean
           (when (and (= :done (:ticket staged)) (not (:dry-run? opts)))
             (must-move-ticket!
              root ticket "active" "done"
              "REFUSE could not move run ticket" ticket
              "from backlog/active/ to backlog/done/"
              "- stages passed but bookkeeping failed")
             true))
          _ (note-ticket-moved! ticket-moved?)
          restart (restart-stack! opts)
          _ (announce-milestone! opts {:kind :final-verdict :outcome (:ticket staged)})
          _ (announce-milestone! opts {:kind :restart :outcome (:outcome restart)})
          _ (when (not (:dry-run? opts))
              (write-progress! run-dir ticket :done
                               (if (= :done (:ticket staged)) :passed :failed)
                               (str "ticket=" (name (:ticket staged)) " restart=" (name (:outcome restart)))))
          result (expedite-lib/run-result {:ticket (:ticket staged)
                                           :restart (:outcome restart)})
          ;; BL-1024: derived from facts the run already holds - the park plan
          ;; and whether the run ticket's own move happened - never tracked a
          ;; second time. Read from the register rather than recomputed, so the
          ;; record and the printed summary cannot drift apart.
          outstanding (outstanding-now)
          run-record (merge result
                            {:ticket-id ticket
                             :branch (:branch worktree)
                             :bound (:bound staged)
                             :history (:history staged)
                             :exhaustion (:exhaustion staged)
                             :park (:park init)
                             :bookkeep (:bookkeep init)
                             :parked-report (expedite-lib/parked-report
                                             (map (fn [t] {:ticket t}) (get-in init [:park :park])))
                             :teardown (:teardown init)
                             :override-used? (get-in init [:gate :override-used?])
                             :restart restart
                             :deferred ["bl-topic-record" "briefing-hooks" "pipeline-stage-sync"]
                             ;; BL-1024: the leavings ride run.json too, so a
                             ;; later reader gets them structured rather than
                             ;; only as terminal text that has scrolled away.
                             :outstanding outstanding
                             :finished-at-ms (now-ms)})]
      (write-json! (fs/path run-dir "run.json") run-record)
      (log! "ticket" (name (:ticket result)) "| restart" (name (:restart result))
            (if (:failed-half result) (str "| FAILED HALF: " (name (:failed-half result))) ""))
      (when-let [d (seq (:live-set-delta restart))]
        (log! "live-set delta (observed vs expected):" (pr-str (into {} d))))
      (when-let [e (:exhaustion staged)]
        (log! "probable-spec-defect:" (pr-str e)))
      (println (json/generate-string run-record {:pretty true}))
      ;; BL-1024: exit! prints the summary, so it is the last thing on the
      ;; terminal and - far more importantly - so this ending is not special.
      ;; The three pre-flight refusals never reach this line and used to report
      ;; nothing at all.
      (exit! (:exit-code result)))))

;; BL-782 acceptance / diagnostics: probe liveness without running a full
;; expedite traverse. Refuses EXPEDITE_PROBE_FILE so callers exercise the real
;; process-table path the defect hid behind.
(when (and (= 2 (count *command-line-args*))
           (= "--probe-liveness" (first *command-line-args*)))
  (when (System/getenv "EXPEDITE_PROBE_FILE")
    (binding [*out* *err*]
      (println "REFUSE --probe-liveness requires EXPEDITE_PROBE_FILE to be unset"))
    (exit! 1))
  (println (json/generate-string (probe-liveness (second *command-line-args*))))
  (flush)
  (exit! 0))

(apply -main *command-line-args*)
