#!/usr/bin/env bb

;; BL-145 / full-stack ensure: `./swarm ensure` brings a swarm to a
;; known-good state in one idempotent command. It checks and repairs, in
;; order: the extension host, every configured agent pane, the handoff
;; daemon, the operator runtime, and (when Telegram is configured) the
;; front-desk supervisor that owns the Telegram bridge + Front Desk Bot.
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
;;   SWARMFORGE_SKIP_OPERATOR=1 / SWARMFORGE_SKIP_FRONT_DESK=1

(ns swarm-ensure
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "agent_runtime_lib.bb")))

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

(defn mono-router-standing-shape?
  "True when some configured role sessions are alive and others are absent —
   the BL-518 mono-router shape (resident + coordinator standing; remaining
   roles are dormant rotate targets, not crashed panes)."
  [socket rows]
  (let [alive? (fn [{:keys [session]}] (session-exists? socket session))
        alive (filter alive? rows)
        missing (remove alive? rows)]
    (and (seq alive) (seq missing))))

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
   so a repair never strips OpenRouter/OpenAI/Mistral/Cerebras/Perplexity auth
   from a live alternate-runtime pane. When SWARMFORGE_USE_CEREBRAS=1 or
   SWARMFORGE_USE_PERPLEXITY=1, that provider key wins for OPENAI_*."
  []
  (let [use-cerebras (= "1" (System/getenv "SWARMFORGE_USE_CEREBRAS"))
        use-perplexity (= "1" (System/getenv "SWARMFORGE_USE_PERPLEXITY"))
        cerebras (System/getenv "CEREBRAS_API_KEY")
        perplexity (System/getenv "PERPLEXITY_API_KEY")
        openai (cond
                 (and use-cerebras (not (str/blank? cerebras))) cerebras
                 (and use-perplexity (not (str/blank? perplexity))) perplexity
                 :else (System/getenv "OPENAI_API_KEY"))
        openai-base (cond
                      (and use-cerebras (not (str/blank? cerebras))) "https://api.cerebras.ai/v1"
                      (and use-perplexity (not (str/blank? perplexity))) "https://api.perplexity.ai"
                      :else (System/getenv "OPENAI_API_BASE"))
        openai-base-url (cond
                          (and use-cerebras (not (str/blank? cerebras))) "https://api.cerebras.ai/v1"
                          (and use-perplexity (not (str/blank? perplexity))) "https://api.perplexity.ai"
                          :else (System/getenv "OPENAI_BASE_URL"))]
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
      use-cerebras
      (concat ["-e" "SWARMFORGE_USE_CEREBRAS=1"])
      use-perplexity
      (concat ["-e" "SWARMFORGE_USE_PERPLEXITY=1"])
      (not (str/blank? openai))
      (concat ["-e" (str "OPENAI_API_KEY=" openai)])
      (not (str/blank? openai-base))
      (concat ["-e" (str "OPENAI_API_BASE=" openai-base)])
      (not (str/blank? openai-base-url))
      (concat ["-e" (str "OPENAI_BASE_URL=" openai-base-url)]))))

(defn openrouter-respawn-env-args
  "Deprecated name — prefer provider-respawn-env-args."
  []
  (provider-respawn-env-args))

(defn respawn-role! [socket role session]
  (let [launch-script (fs/path state-dir "launch" (str role ".sh"))
        env-args (provider-respawn-env-args)
        cmd (concat ["tmux" "-S" socket "respawn-pane" "-k"]
                    env-args
                    ["-t" session (str "zsh '" launch-script "'")])]
    (apply process/sh {:continue true} cmd)))

;; ── daemon component ─────────────────────────────────────────────────────────

(defn daemon-pid-file [] (fs/path state-dir "daemon" "handoffd.pid"))

(defn pid-alive? [pid]
  (when pid
    (some-> (java.lang.ProcessHandle/of pid) (.orElse nil) (.isAlive))))

(defn pid-from-file
  "Reads and parses a pid persisted at pid-file, or nil if it doesn't exist."
  [pid-file]
  (when (fs/exists? pid-file)
    (parse-long (str/trim (slurp (str pid-file))))))

(defn daemon-pid [] (pid-from-file (daemon-pid-file)))

(defn daemon-healthy? []
  (pid-alive? (daemon-pid)))

(defn ensure-daemon! []
  (sh! supervisor-cmd))

;; ── operator runtime + front-desk (Telegram bridge) ──────────────────────────

(defn operator-pid-file [] (fs/path state-dir "operator" "runtime.pid"))

(defn front-desk-pid-file [] (fs/path state-dir "operator" "front-desk-supervisor.pid"))

(defn operator-pid [] (pid-from-file (operator-pid-file)))

(defn front-desk-pid [] (pid-from-file (front-desk-pid-file)))

(defn operator-healthy? []
  (pid-alive? (operator-pid)))

(defn front-desk-healthy? []
  (pid-alive? (front-desk-pid)))

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
        extension-result (ensure-component! "extension" extension-healthy? bounce-extension!
                                             "bounced the extension dev host")
        rows (role-rows)
        router-shape? (and socket (mono-router-standing-shape? socket rows))
        role-results (if socket
                       (mapv (fn [{:keys [role session]}]
                               (if (and router-shape? (not (session-exists? socket session)))
                                 {:component (str "agent:" role)
                                  :status :dormant
                                  :action "mono-router rotate target; no standing session"}
                                 (ensure-component! (str "agent:" role)
                                                     #(pane-alive? socket session)
                                                     #(respawn-role! socket role session)
                                                     "respawned pane from its persisted launch script")))
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
        results (concat [extension-result] role-results [daemon-result]
                        (remove nil? [operator-result front-desk-result]))]
    (doseq [r results] (println (report-line r)))
    (System/exit (if (some #(= :failed (:status %)) results) 1 0))))

(-main)
