#!/usr/bin/env bb

;; BL-145 / full-stack ensure: `./swarm ensure` brings a swarm to a
;; known-good state in one idempotent command. It checks and repairs, in
;; order: the extension host, every configured agent pane, the handoff
;; daemon, the operator runtime, the babysitter hawk (when enabled), and
;; (when Telegram is configured) the front-desk supervisor that owns the
;; Telegram bridge + Front Desk Bot.
;; Each component reports HEALTHY, FIXED (naming the repair), or FAILED -
;; never silently. A failed repair does not abort the remaining checks.
;; Exit status is non-zero if anything could not be brought to health.
;;
;; Usage: swarm_ensure.bb <project-root>
;;
;; Decision logic (classify) is a pure function driven by injected
;; healthy-before?/healthy-after? booleans, mirroring
;; handoffd_supervisor.bb's evaluate-health - see test_swarm_ensure.sh for
;; the fake-probe unit tests and the fixture-driven integration scenarios.
;;
;; Env overrides (tests + ops):
;;   SWARM_ENSURE_EXTENSION_CHECK_CMD / SWARM_ENSURE_EXTENSION_BOUNCE_CMD
;;   SWARM_ENSURE_SUPERVISOR_CMD
;;   SWARM_ENSURE_OPERATOR_CMD / SWARM_ENSURE_FRONT_DESK_CMD
;;   SWARM_ENSURE_BABYSITTER_CMD
;;   SWARMFORGE_SKIP_OPERATOR=1 / SWARMFORGE_SKIP_FRONT_DESK=1
;;   SWARMFORGE_SKIP_BABYSITTER=1

(ns swarm-ensure
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "agent_runtime_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "swarm_identity_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "launch_contract_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "provider_compat_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "mono_router_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: swarm_ensure.bb <project-root>"))
  (System/exit 1))

(def project-root
  (or (first *command-line-args*) (usage)))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def state-dir (fs/path project-root ".swarmforge"))
(def roles-file (fs/path state-dir "roles.tsv"))
(def socket-file (fs/path state-dir "tmux-socket"))
(def headless-marker-file (fs/path state-dir "headless-swarm"))
(def extension-dir (fs/path script-dir ".." ".." "extension"))

;; Real commands, overridable so tests can substitute lightweight fakes for
;; the extension check/bounce (which otherwise shells out to VS Code) and
;; for the daemon supervisor tick.
(def extension-check-cmd
  (or (System/getenv "SWARM_ENSURE_EXTENSION_CHECK_CMD")
      (str "node " (fs/path extension-dir "scripts" "checkExtensionHealth.js"))))

(def extension-bounce-cmd
  (or (System/getenv "SWARM_ENSURE_EXTENSION_BOUNCE_CMD")
      (str (fs/path extension-dir "scripts" "start-extension-dev.sh"))))

(def supervisor-cmd
  (or (System/getenv "SWARM_ENSURE_SUPERVISOR_CMD")
      (str "bb " (fs/path script-dir "handoffd_supervisor.bb") " " project-root " --check-once")))

(def operator-start-cmd
  (or (System/getenv "SWARM_ENSURE_OPERATOR_CMD")
      (str "bash " (fs/path script-dir "start_operator_runtime.sh") " " project-root)))

(def front-desk-start-cmd
  (or (System/getenv "SWARM_ENSURE_FRONT_DESK_CMD")
      (str "bash " (fs/path script-dir "launch_front_desk.sh") " " project-root)))

(def babysitter-start-cmd
  (or (System/getenv "SWARM_ENSURE_BABYSITTER_CMD")
      (str "bash " (fs/path script-dir "start_babysitter.sh") " " project-root)))

;; ── pure decision ────────────────────────────────────────────────────────────

(defn classify
  "Given whether a component was healthy before any repair was attempted and
   whether it is healthy after, decides the report status. A component never
   attempts repair when already healthy, so healthy-after? is only consulted
   when healthy-before? is false."
  [healthy-before? healthy-after?]
  (cond
    healthy-before? :healthy
    healthy-after? :fixed
    :else :failed))

;; ── shell helpers ────────────────────────────────────────────────────────────

(defn sh! [cmd-str]
  (let [{:keys [exit] :as result} (process/sh {:continue true} "sh" "-c" cmd-str)]
    (assoc result :ok? (zero? exit))))

(defn tmux-socket []
  (when (fs/exists? socket-file)
    (str/trim (slurp (str socket-file)))))

(defn role-rows
  "Each configured role as {:role :session}, read from roles.tsv (columns:
   role, worktree-name, worktree-path, session, display, agent,
   receive-mode, idle-clear-flag)."
  []
  (if (fs/exists? roles-file)
    (->> (str/split-lines (slurp (str roles-file)))
         (remove str/blank?)
         (map (fn [line]
                (let [fields (str/split line #"\t" -1)]
                  {:role (get fields 0) :session (get fields 3)})))
         (remove #(str/blank? (:session %))))
    []))

(defn rotation-router-mode?
  "True when this project is running (or last launched as) rotation router."
  []
  (let [identity-path (fs/path state-dir "swarm-identity")
        identity-text (when (fs/exists? identity-path) (slurp (str identity-path)))
        conf-path (or (get (mono-router-lib/parse-identity-map (or identity-text ""))
                           "active_backlog_max_depth_conf_path")
                      (str (fs/path project-root "swarmforge" "swarmforge.conf")))
        conf-text (when (and conf-path (fs/exists? conf-path))
                    (slurp conf-path))]
    (boolean
     (or (mono-router-lib/rotation-router-from-identity? identity-text)
         (mono-router-lib/conf-rotation-router? conf-text)))))

;; ── extension component ──────────────────────────────────────────────────────

(defn extension-healthy? []
  (:ok? (sh! extension-check-cmd)))

(defn bounce-extension! []
  (sh! extension-bounce-cmd))

;; ── agent-pane component ─────────────────────────────────────────────────────

(defn session-exists?
  "True when tmux has a session of this name on the project socket."
  [socket session]
  (zero? (:exit (process/sh {:continue true} "tmux" "-S" socket "has-session" "-t" session))))

(defn pane-alive?
  "A configured role's pane is healthy when its session exists and its pane
   has not exited (tmux's own pane_dead bookkeeping). A session that does
   not exist at all - the common case when its agent process crashed and
   nothing pins the pane open - reads as absent, same as a genuinely never-
   launched role; both need the identical repair (respawn from the
   persisted launch script)."
  [socket session]
  (let [result (process/sh {:continue true} "tmux" "-S" socket "list-panes" "-t" session
                            "-F" "#{pane_dead}")]
    (and (zero? (:exit result))
         (not (str/includes? (:out result) "1")))))

(defn provider-respawn-env-args
  "BL-130 pane -e passthrough for ensure repairs — same keys rotate/chase need
   so a repair never strips OpenRouter/OpenAI/Mistral/Cerebras/Perplexity/Gemini/Qwen
   auth from a live alternate-runtime pane.

   SRE 2026-07-19: when role's launch script CLI targets api.perplexity.ai,
   Perplexity wins for OPENAI_* even if SWARMFORGE_USE_PERPLEXITY was unset
   in the ensure process (provider_compat_lib/must-remap-to-perplexity?).
   Gemini: GEMINI_API_KEY, or SWARMFORGE_GEMINI_API_KEY mapped to GEMINI_API_KEY.
   Qwen: QWEN_API_KEY, or BAILIAN_CODING_PLAN_API_KEY mapped to QWEN_API_KEY."
  ([] (provider-respawn-env-args nil))
  ([role]
   (let [launch-cli (when role
                      (let [p (fs/path state-dir "launch" (str role ".sh"))]
                        (when (fs/exists? p) (slurp (str p)))))
         use-cerebras (= "1" (System/getenv "SWARMFORGE_USE_CEREBRAS"))
         use-perplexity (= "1" (System/getenv "SWARMFORGE_USE_PERPLEXITY"))
         use-qwen (= "1" (System/getenv "SWARMFORGE_USE_QWEN"))
         cerebras (System/getenv "CEREBRAS_API_KEY")
         perplexity (System/getenv "PERPLEXITY_API_KEY")
         qwen (let [q (System/getenv "QWEN_API_KEY")]
                (if (str/blank? q)
                  (System/getenv "BAILIAN_CODING_PLAN_API_KEY")
                  q))
         gemini (let [g (System/getenv "GEMINI_API_KEY")]
                  (if (str/blank? g)
                    (System/getenv "SWARMFORGE_GEMINI_API_KEY")
                    g))
         resolved (provider-compat-lib/resolve-openai-compat
                   {:use-cerebras use-cerebras
                    :use-perplexity use-perplexity
                    :use-qwen use-qwen
                    :cerebras-api-key cerebras
                    :perplexity-api-key perplexity
                    :qwen-api-key qwen
                    :openai-api-key (System/getenv "OPENAI_API_KEY")
                    :launch-cli launch-cli})
         openai (:openai-api-key resolved)
         openai-base (:openai-api-base resolved)
         openai-base-url (:openai-base-url resolved)
         force-perplexity (= :perplexity (:provider resolved))
         force-cerebras (= :cerebras (:provider resolved))
         force-qwen (= :qwen (:provider resolved))]
     (cond-> []
       (not (str/blank? (System/getenv "OPENROUTER_API_KEY")))
       (concat ["-e" (str "OPENROUTER_API_KEY=" (System/getenv "OPENROUTER_API_KEY"))])
       (not (str/blank? (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS")))
       (concat ["-e" (str "CLAUDE_CODE_MAX_OUTPUT_TOKENS=" (System/getenv "CLAUDE_CODE_MAX_OUTPUT_TOKENS"))])
       (not (str/blank? (System/getenv "MISTRAL_API_KEY")))
       (concat ["-e" (str "MISTRAL_API_KEY=" (System/getenv "MISTRAL_API_KEY"))])
       (not (str/blank? cerebras))
       (concat ["-e" (str "CEREBRAS_API_KEY=" cerebras)])
       (not (str/blank? perplexity))
       (concat ["-e" (str "PERPLEXITY_API_KEY=" perplexity)])
       (not (str/blank? qwen))
       (concat ["-e" (str "QWEN_API_KEY=" qwen)])
       (not (str/blank? gemini))
       (concat ["-e" (str "GEMINI_API_KEY=" gemini)])
       (or use-cerebras force-cerebras)
       (concat ["-e" "SWARMFORGE_USE_CEREBRAS=1"])
       (or use-perplexity force-perplexity)
       (concat ["-e" "SWARMFORGE_USE_PERPLEXITY=1"])
       (or use-qwen force-qwen)
       (concat ["-e" "SWARMFORGE_USE_QWEN=1"])
       (not (str/blank? openai))
       (concat ["-e" (str "OPENAI_API_KEY=" openai)])
       (not (str/blank? openai-base))
       (concat ["-e" (str "OPENAI_API_BASE=" openai-base)])
       (not (str/blank? openai-base-url))
       (concat ["-e" (str "OPENAI_BASE_URL=" openai-base-url)])))))

(defn respawn-role! [socket role session]
  (let [launch-script (fs/path state-dir "launch" (str role ".sh"))
        env-args (provider-respawn-env-args role)
        cmd (concat ["tmux" "-S" socket "respawn-pane" "-k"]
                    env-args
                    ["-t" session (str "zsh '" launch-script "'")])]
    (apply process/sh {:continue true} cmd)))

(defn create-session! [socket session]
  (process/sh {:continue true}
              "tmux" "-S" socket "new-session" "-d" "-s" session "-n" "swarm"))

(defn kill-session! [socket session]
  (process/sh {:continue true}
              "tmux" "-S" socket "kill-session" "-t" session))

(defn ensure-standing-role!
  "Create the session if missing, then respawn the launch script into it."
  [socket role session]
  (when-not (session-exists? socket session)
    (create-session! socket session)
    (Thread/sleep 250))
  (respawn-role! socket role session))

;; ── daemon component ─────────────────────────────────────────────────────────

(defn daemon-pid-file [] (fs/path state-dir "daemon" "handoffd.pid"))

(defn daemon-pid []
  (when (fs/exists? (daemon-pid-file))
    (parse-long (str/trim (slurp (str (daemon-pid-file)))))))

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn daemon-healthy? []
  (pid-alive? (daemon-pid)))

(defn ensure-daemon! []
  (sh! supervisor-cmd))

;; ── operator runtime + front-desk (Telegram bridge) ──────────────────────────

(defn operator-pid-file [] (fs/path state-dir "operator" "runtime.pid"))

(defn front-desk-pid-file [] (fs/path state-dir "operator" "front-desk-supervisor.pid"))

(defn babysitter-pid-file [] (fs/path state-dir "babysitter" "runtime.pid"))

(defn babysitter-enabled-file [] (fs/path state-dir "babysitter" "enabled"))

(defn operator-pid []
  (when (fs/exists? (operator-pid-file))
    (parse-long (str/trim (slurp (str (operator-pid-file)))))))

(defn front-desk-pid []
  (when (fs/exists? (front-desk-pid-file))
    (parse-long (str/trim (slurp (str (front-desk-pid-file)))))))

(defn operator-healthy? []
  (pid-alive? (operator-pid)))

(defn front-desk-healthy? []
  (pid-alive? (front-desk-pid)))

(defn babysitter-pid []
  (when (fs/exists? (babysitter-pid-file))
    (parse-long (str/trim (slurp (str (babysitter-pid-file)))))))

(defn babysitter-healthy? []
  (pid-alive? (babysitter-pid)))

(defn ensure-babysitter! []
  (sh! babysitter-start-cmd))

(defn ensure-operator! []
  (sh! operator-start-cmd))

(defn ensure-front-desk! []
  (sh! front-desk-start-cmd))

(defn env-set? [name]
  (let [v (System/getenv name)]
    (and (some? v) (not (str/blank? v)))))

(defn telegram-configured?
  "Front desk needs the same three Telegram vars launch_front_desk.sh requires."
  []
  (and (env-set? "TELEGRAM_BOT_TOKEN")
       (env-set? "TELEGRAM_CHAT_ID")
       (env-set? "TELEGRAM_PRINCIPAL_USER_ID")))

(defn operator-enabled?
  []
  (not= "1" (System/getenv "SWARMFORGE_SKIP_OPERATOR")))

(defn front-desk-enabled?
  "Ensure front-desk when Telegram is configured, or a prior supervisor pid
   file exists (repair a previously launched desk). Explicit skip wins."
  []
  (and (not= "1" (System/getenv "SWARMFORGE_SKIP_FRONT_DESK"))
       (or (telegram-configured?)
           (fs/exists? (front-desk-pid-file)))))

(defn babysitter-enabled?
  "Repair babysitter only when it was previously enabled or a runtime pid
   file exists — not merely because the start script is present."
  []
  (and (not= "1" (System/getenv "SWARMFORGE_SKIP_BABYSITTER"))
       (or (fs/exists? (babysitter-enabled-file))
           (fs/exists? (babysitter-pid-file)))))

;; ── launch-contract component (BL-530) ──────────────────────────────────────
;; A pack that names a non-default coordinator_agent (aider, codex, ...) must
;; also declare its own coordinator_model and rotation, never inherit the
;; Claude-only defaults (BL-512 audit rank 3: a missing model/rotation reads
;; as a healthy pane while thrashing weakly). This has no automated repair -
;; the fix is a human editing the pack file - so it is reported directly as
;; HEALTHY/FAILED, never routed through ensure-component!'s repair-then-
;; reclassify cycle (mirroring the "no tmux socket" branch below).

(defn effective-conf-text []
  "BL-530 architect bounce, defect 2: an unreadable conf must never read as
   HEALTHY (nil conf-text -> launch-contract-violations returns [] ->
   'HEALTHY' is indistinguishable from 'I could not read the conf'). Reuses
   backlog-depth-lib/conf-file-path for the persisted-path resolution
   (project-root, not the caller's own cwd - the identical problem that
   sibling already solved). Unlike that sibling, which is content to degrade
   a genuinely absent config to a single numeric default, a broken-but-
   present persisted path here still falls through to the tracked default
   conf explicitly - the check must always evaluate something real rather
   than go silent, which a bare reuse of conf-file-path would not do for a
   persisted key that no longer resolves (it returns that same broken path,
   not the default)."
  (let [primary (backlog-depth-lib/conf-file-path project-root)
        fallback (apply fs/path project-root backlog-depth-lib/default-conf-relpath)]
    (or (try (slurp (str primary)) (catch Exception _ nil))
        (when (not= (str primary) (str fallback))
          (try (slurp (str fallback)) (catch Exception _ nil))))))

(defn launch-contract-result []
  (let [violations (launch-contract-lib/launch-contract-violations (effective-conf-text))]
    (if (empty? violations)
      {:component "launch-contract" :status :healthy}
      {:component "launch-contract" :status :failed
       :action (str/join "; " (map :detail violations))})))

;; ── orchestration (never aborts on one failed repair) ───────────────────────

(defn ensure-component!
  "Runs one component's check/repair/reclassify cycle. Exceptions during the
   probe or repair are caught so one component's failure can never prevent
   the remaining components from being checked."
  [name healthy?-fn repair!-fn repair-description]
  (try
    (let [before (boolean (healthy?-fn))]
      (if before
        {:component name :status :healthy}
        (do
          (try (repair!-fn) (catch Exception _ nil))
          (let [after (boolean (healthy?-fn))]
            {:component name
             :status (classify before after)
             :action repair-description}))))
    (catch Exception e
      ;; BL-207: a genuine raw backend-failure detail (unlike the static
      ;; repair-description strings above, which describe the attempted
      ;; FIX, not why it failed) - the one place in this function worth
      ;; classifying into the stable Forge error taxonomy.
      (let [detail (str "probe error: " (.getMessage e))]
        {:component name :status :failed :action detail
         :category (:category (agent-runtime-lib/classify-provider-error detail))}))))

(defn ensure-role!
  "BL-530 architect bounce, defect 1: wraps ensure-component! for one
   agent pane with a deliberate exception to ensure's usual 'never abort on
   one failed repair' orchestration. When the swarm's launch contract is
   broken (missing coordinator_model/rotation for a pack that requires
   them - see launch-contract-result), respawning a dead pane would just
   restart it onto the same broken argv - the exact busy-idle thrash BL-512
   rank 3 describes, now reported as FIXED. Refusing the respawn is the
   point of this ticket, so a broken contract skips repair entirely for any
   pane that is not already alive; an already-healthy pane is left alone
   either way, since ensure never touches a pane that is already up."
  [name healthy?-fn respawn!-fn contract-broken?]
  (if (and contract-broken? (not (healthy?-fn)))
    {:component name :status :failed
     :action "respawn refused: launch contract broken - fix the pack conf, then rerun ensure"}
    (ensure-component! name healthy?-fn respawn!-fn
                        "respawned pane from its persisted launch script")))

(defn read-mono-router-active-role-marker
  "Contents of .swarmforge/mono-router-active-role, or nil."
  []
  (let [p (fs/path state-dir "mono-router-active-role")]
    (when (fs/exists? p)
      (str/trim (slurp (str p))))))

(defn ensure-mono-router-role!
  "BL-518 topology repair for one role under rotation router, merged with the
   BL-530 launch-contract refusal (ensure-role! above): a dormant rotate
   target is never respawned and never 'respawn refused' - contract-broken?
   only gates the branches that would actually attempt a respawn (:ok's
   dead-pane case and :ensure-standing), never the dormant or teardown-
   illicit decisions."
  [socket ordered-roles {:keys [role session]} contract-broken?]
  (let [alive (session-exists? socket session)
        action (mono-router-lib/topology-action ordered-roles role alive)
        class (mono-router-lib/classify-role ordered-roles role)
        class-name (name class)
        ;; Resident session name stays home (coder), but launch script follows
        ;; the durable active-role marker after rotate_to_role.
        launch-role (if (= class :resident)
                      (mono-router-lib/resident-launch-role
                       role (read-mono-router-active-role-marker))
                      role)
        component (str "agent:" role)
        refused {:component component :status :failed
                 :action "respawn refused: launch contract broken - fix the pack conf, then rerun ensure"}]
    (case action
      :ok
      (if (pane-alive? socket session)
        {:component component :status :healthy
         :action (str "mono-router " class-name
                      (when (and (= class :resident) (not= launch-role role))
                        (str " as " launch-role)))}
        (if contract-broken?
          refused
          (ensure-component! component
                             #(pane-alive? socket session)
                             #(ensure-standing-role! socket launch-role session)
                             (str "respawned dead mono-router " class-name " pane"
                                  (when (not= launch-role role)
                                    (str " as " launch-role))))))

      :dormant-ok
      {:component component :status :dormant
       :action "mono-router rotate target; no standing session"}

      :teardown-illicit
      (do
        (kill-session! socket session)
        (if (session-exists? socket session)
          {:component component :status :failed
           :action "could not tear down illicit standing session"}
          {:component component :status :fixed
           :action "tore down illicit standing session (mono-router dormant target)"}))

      :ensure-standing
      (if contract-broken?
        refused
        (ensure-component! component
                           #(pane-alive? socket session)
                           #(ensure-standing-role! socket launch-role session)
                           (str "restored mono-router " class-name " pane"
                                (when (not= launch-role role)
                                  (str " as " launch-role))))))))

(defn report-line [{:keys [component status action category]}]
  (case status
    :healthy (str component ": HEALTHY")
    :dormant (str component ": DORMANT" (when action (str " (" action ")")))
    :fixed (str component ": FIXED (" action ")")
    ;; BL-207: names the stable Forge error category alongside the raw
    ;; detail (never discarded) when one was classified, so an operator
    ;; scanning `./swarm ensure` output can tell "auth" from "unavailable"
    ;; from "unknown" at a glance, not just read provider-specific prose.
    :failed (str component ": FAILED"
                  (when category (str " [" (name category) "]"))
                  (when action (str " (" action ")")))))

(defn -main []
  (let [socket (tmux-socket)
        extension-result (if (fs/exists? headless-marker-file)
                           {:component "extension" :status :healthy
                            :action "skipped bounce (headless swarm owns tmux)"}
                           (ensure-component! "extension" extension-healthy? bounce-extension!
                                              "bounced the extension dev host"))
        ;; BL-530 architect bounce, defect 1: the launch-contract check must
        ;; be evaluated BEFORE any pane is respawned, not after, or a
        ;; broken contract only gets reported once ensure has already
        ;; respawned agents onto it.
        launch-contract-check (launch-contract-result)
        contract-broken? (= :failed (:status launch-contract-check))
        rows (role-rows)
        ordered (mapv :role rows)
        ;; BL-530 architect bounce (round 3): a live-shape fallback (some role
        ;; sessions standing, some absent) is equally the fingerprint of a
        ;; half-launched or partially-crashed classic pack — the exact
        ;; condition ensure exists to repair — so mono-router-ness is decided
        ;; ONLY by the declared conf/identity signal, never inferred from shape.
        router? (rotation-router-mode?)
        role-results (if socket
                       (mapv (fn [{:keys [role session] :as row}]
                               (if router?
                                 (ensure-mono-router-role! socket ordered row contract-broken?)
                                 (ensure-role! (str "agent:" role)
                                               #(pane-alive? socket session)
                                               #(respawn-role! socket role session)
                                               contract-broken?)))
                             rows)
                       (mapv (fn [{:keys [role]}]
                               (let [detail "no tmux socket found for this project root"]
                                 {:component (str "agent:" role) :status :failed
                                  :action detail
                                  :category (:category (agent-runtime-lib/classify-provider-error detail))}))
                             rows))
        daemon-result (ensure-component! "daemon" daemon-healthy? ensure-daemon!
                                          "restarted the handoff daemon")
        operator-result (when (operator-enabled?)
                          (ensure-component! "operator" operator-healthy? ensure-operator!
                                              "restarted the operator runtime"))
        front-desk-result (when (front-desk-enabled?)
                            (ensure-component! "front-desk" front-desk-healthy? ensure-front-desk!
                                                "restarted the Telegram front desk (bridge + bot)"))
        babysitter-result (when (babysitter-enabled?)
                            (ensure-component! "babysitter" babysitter-healthy? ensure-babysitter!
                                                "restarted the babysitter runtime"))
        results (concat [extension-result] role-results [daemon-result launch-contract-check]
                        (remove nil? [operator-result front-desk-result babysitter-result]))]
    (doseq [r results] (println (report-line r)))
    (System/exit (if (some #(= :failed (:status %)) results) 1 0))))

(-main)
