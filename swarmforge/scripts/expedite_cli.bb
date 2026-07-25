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
;;     --stage-timeout-ms N  per-stage budget (default 45 min)
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

(ns expedite-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def scripts-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path scripts-dir "expedite_lib.bb")))
(load-file (str (fs/path scripts-dir "prompt_engine_lib.bb")))

;; ── args ──────────────────────────────────────────────────────────────────

;; parse-args, flag-value and positionals moved to expedite_lib.bb by the cleaner
;; pass: they are pure decisions, they were untested here, and the set of
;; value-taking flags was duplicated between the positional strip and the reads -
;; a latent defect where a forgotten entry makes a flag's value parse as the
;; project root.

(defn usage! []
  (binding [*out* *err*]
    (println "Usage: expedite_cli.bb <project-root> <BL-id> [--override] [--bounce-bound N] [--stage-timeout-ms N] [--no-restart] [--dry-run]"))
  (System/exit 2))

;; ── plumbing ──────────────────────────────────────────────────────────────

(defn- now-ms []
  (or (some-> (System/getenv "EXPEDITE_NOW_MS") parse-long)
      (System/currentTimeMillis)))

(defn- sh [opts & cmd]
  (apply process/sh (assoc opts :continue true) cmd))

(defn- log! [& parts]
  (println (str "expedite " (str/join " " (map str parts)))))

(defn- write-json! [path data]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (json/generate-string data {:pretty true}) "\n")))

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
    {:tmux-servers-answering (tmux-servers-answering project-root)
     :handoffd (seq (pids-matching "handoffd.bb"))
     :handoffd-supervisor (seq (pids-matching "handoffd_supervisor.bb"))
     :babysitterd (seq (pids-matching "babysitterd.sh"))
     :operator (seq (pids-matching "--remote-control Operator"))
     :role-agents (count (pids-matching (str project-root "/.swarmforge/launch/")))}))

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
  (when-let [src (ticket-file project-root from ticket)]
    (let [dst (fs/path (backlog-dir project-root to) (fs/file-name src))]
      (fs/create-dirs (backlog-dir project-root to))
      (sh {:dir (str project-root)} "git" "mv"
          (str (fs/relativize project-root src)) (str (fs/relativize project-root dst)))
      (str dst))))

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
          (when-not dry-run? (move-ticket! project-root t "active" (:destination plan))))
        (when-not dry-run? (write-json! (fs/path run-dir "park-record.json") record))))
    plan))

(defn stop-stack! [{:keys [project-root dry-run?]}]
  (let [cmd (or (System/getenv "EXPEDITE_STOP_CMD") "./stop-swarm.sh")]
    (when-not (expedite-lib/stop-invocation-ok? [cmd])
      (log! "REFUSE stop command carries a forbidden flag:" cmd)
      (System/exit 1))
    (if dry-run?
      {:exit-code 0 :dry-run true}
      (let [{:keys [exit out err]} (sh {:dir (str project-root)} "bash" "-lc" cmd)]
        {:exit-code exit :out (str out) :err (str err)}))))

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
    (let [plan (park-others! opts run-dir)
          stop (stop-stack! opts)
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
        (log! "REFUSE teardown did not reach a clean slate:" (str/join "," (:alive verdict)))
        (log! "remedy: stop the named processes by hand, or pass --override")
        (System/exit 1))
      (when (and override? (not (:clean? verdict)))
        (log! "WARNING override in force; proceeding with these alive:"
              (str/join "," (:alive verdict))))
      {:gate {:override-used? (boolean (and override? (not (:clean? verdict))))
              :was-live? (not (:stopped? live0))
              :alive-before (:alive live0)}
       :park plan
       :teardown verdict})))

;; ── worktree ──────────────────────────────────────────────────────────────

(defn ensure-worktree! [{:keys [project-root ticket dry-run?]}]
  (let [branch (str "expedite/" ticket)
        dir (fs/path project-root ".worktrees" (str "expedite-" ticket))]
    (when-not (or dry-run? (fs/exists? dir))
      (let [{:keys [exit err]} (sh {:dir (str project-root)} "git" "worktree" "add" "-b" branch (str dir) "main")]
        (when-not (zero? exit)
          (log! "REFUSE could not create the run worktree:" (str/trim (str err)))
          (System/exit 1))))
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

(defn run-stage!
  "One stage. Returns {:verdict :pass|:bounce|:fail ...}.

   The stage runner is a seam: EXPEDITE_STAGE_RUNNER replaces spawning claude,
   so every scenario can seed a gate outcome without a model in the loop. Both
   paths receive the same argv shape, so the test path exercises the real
   contract rather than a parallel one."
  [{:keys [project-root ticket stage-timeout-ms]} {:keys [dir]} role task stage-dir]
  (let [prompt-file (compose-prompt! role task (fs/path stage-dir "prompt.md"))
        _ (spit (str (fs/path stage-dir "task.txt")) task)
        transcript (str (fs/path stage-dir "transcript.jsonl"))
        verdict-file (str (fs/path stage-dir "verdict.json"))
        settings (settings-path project-root role)
        started (now-ms)
        runner (System/getenv "EXPEDITE_STAGE_RUNNER")
        cmd (if runner
              ["bash" runner role ticket prompt-file verdict-file transcript]
              (concat ["claude" "-p"]
                      (when settings ["--settings" settings])
                      ["--append-system-prompt-file" prompt-file
                       "--dangerously-skip-permissions"
                       (str "You are the " role " for " ticket
                            ". Your task is appended to your system prompt."
                            " Write your stage verdict as JSON to " verdict-file ".")]))
        {:keys [exit out err]} (apply sh {:dir dir
                                          :extra-env {"ANTHROPIC_API_KEY" "" "ANTHROPIC_AUTH_TOKEN" ""}}
                                      cmd)
        _ (spit transcript (str (str out) (str err)))
        elapsed (expedite-lib/stage-timeout-verdict {:started-at-ms started
                                                     :now-ms (now-ms)
                                                     :timeout-ms stage-timeout-ms})
        parsed (when (fs/exists? verdict-file)
                 (try (json/parse-string (slurp verdict-file) true) (catch Exception _ nil)))]
    (cond
      (:overrun? elapsed)
      {:verdict :fail :reason :stage-timeout :stage role :elapsed elapsed}

      (nil? parsed)
      {:verdict :fail :reason :no-verdict :stage role :exit exit}

      :else
      (assoc parsed :stage role :exit exit :elapsed elapsed
             :verdict (keyword (or (:verdict parsed) "fail"))))))

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
              task (str "Ticket " ticket ". You are the " stage " stage of an offline expedited run."
                        (when-let [b (seq (get @bounces stage))]
                          (str " This is a rework after " (count b) " bounce(s): "
                               (str/join "; " (map :reason b)))))
              res (run-stage! opts worktree stage task stage-dir)]
          (swap! history conj (select-keys res [:stage :verdict :reason :class]))
          (write-json! (fs/path stage-dir "verdict.json") res)
          (case (:verdict res)
            :pass (recur (expedite-lib/next-stage stages stage) (inc n))

            :bounce
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
                   :exhaustion report :bounces @bounces :history @history :bound bound-info})))

            {:ticket :failed :reason (or (:reason res) :stage-failed)
             :stage stage :bounces @bounces :history @history :bound bound-info}))))))

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
          init (initiate! opts run-dir)
          worktree (ensure-worktree! opts)
          stages (expedite-lib/stages-for {})
          staged (drive-stages! opts worktree run-dir stages)
          _ (when (and (= :done (:ticket staged)) (not (:dry-run? opts)))
              (move-ticket! root ticket "active" "done"))
          restart (restart-stack! opts)
          result (expedite-lib/run-result {:ticket (:ticket staged)
                                           :restart (:outcome restart)})
          run-record (merge result
                            {:ticket-id ticket
                             :branch (:branch worktree)
                             :bound (:bound staged)
                             :history (:history staged)
                             :exhaustion (:exhaustion staged)
                             :park (:park init)
                             :parked-report (expedite-lib/parked-report
                                             (map (fn [t] {:ticket t}) (get-in init [:park :park])))
                             :teardown (:teardown init)
                             :override-used? (get-in init [:gate :override-used?])
                             :restart restart
                             :deferred ["bl-topic-record" "briefing-hooks" "pipeline-stage-sync"]
                             :finished-at-ms (now-ms)})]
      (write-json! (fs/path run-dir "run.json") run-record)
      (log! "ticket" (name (:ticket result)) "| restart" (name (:restart result))
            (if (:failed-half result) (str "| FAILED HALF: " (name (:failed-half result))) ""))
      (when-let [d (seq (:live-set-delta restart))]
        (log! "live-set delta (observed vs expected):" (pr-str (into {} d))))
      (when-let [e (:exhaustion staged)]
        (log! "probable-spec-defect:" (pr-str e)))
      (println (json/generate-string run-record {:pretty true}))
      (System/exit (:exit-code result)))))

(apply -main *command-line-args*)
